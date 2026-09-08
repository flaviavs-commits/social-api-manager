const pool = require('../db/pool')
const { registrarLog } = require('./logsRepository')
const { encrypt, decrypt } = require('../services/tokenCrypto')

function mask(token) {
  if (!token) return token
  return token.slice(0, 10) + '...' + token.slice(-4)
}

function calcularStatus(expiresAt) {
  if (!expiresAt) return 'valid'
  const expiry = new Date(expiresAt).getTime()
  const now = Date.now()
  const sevenDays = 7 * 86400000
  if (expiry < now) return 'expired'
  if (expiry - now < sevenDays) return 'expiring'
  return 'valid'
}

async function atualizarStatusTokens() {
  await pool.query(`
    UPDATE tokens SET status =
      CASE
        WHEN expires_at < NOW()                      THEN 'expired'
        WHEN expires_at < NOW() + INTERVAL '7 days'  THEN 'expiring'
        ELSE 'valid'
      END
    WHERE expires_at IS NOT NULL
  `)
}

// ── Verifica se o usuário é dono da conta associada a um token ───────────────
async function tokenPertenceAoUsuario(tokenId, userId) {
  const { rows: [row] } = await pool.query(
    `SELECT c.user_id FROM tokens t JOIN contas c ON c.id = t.conta_id WHERE t.id = $1`,
    [tokenId]
  )
  return row && row.user_id === userId
}

// ── Listar tokens com info da conta ───────────────────────────────────────────
async function listarTokens({ status, platform, userId, isAdmin } = {}) {
  await atualizarStatusTokens()

  const conds = []
  const params = []
  if (status)   { params.push(status);   conds.push(`t.status = $${params.length}`) }
  if (platform) { params.push(platform); conds.push(`t.platform = $${params.length}`) }
  if (userId !== null && userId !== undefined) {
    params.push(userId)
    conds.push(`c.user_id = $${params.length}`)
  } else if (!isAdmin) conds.push('FALSE')
  const where = conds.length ? 'WHERE ' + conds.join(' AND ') : ''

  const { rows } = await pool.query(`
    SELECT
      t.id, t.conta_id AS "accountId", t.platform,
      t.access_token AS "accessToken",
      t.expires_at AS "expiresAt", t.status,
      COALESCE(t.account_name, c.handle, 'Conta removida') AS "accountName",
      c.avatar_url AS "avatarUrl",
      CEIL(EXTRACT(EPOCH FROM (t.expires_at - NOW())) / 86400) AS "daysLeft"
    FROM tokens t
    LEFT JOIN contas c ON c.id = t.conta_id
    ${where}
    ORDER BY t.expires_at ASC NULLS LAST
  `, params)

  return rows.map(t => {
    const daysLeft = Number(t.daysLeft) || 0
    return {
      ...t,
      accessToken: mask(decrypt(t.accessToken)),
      daysLeft: daysLeft > 0 ? daysLeft : 0,
      expiryLabel: daysLeft > 0 ? `${daysLeft} dias` : 'expirado'
    }
  })
}

// ── Salvar (ou substituir) token de uma conta ─────────────────────────────────
async function salvarToken({ accountId, platform, accessToken, refreshToken, expiresAt, accountName }) {
  const expiry = expiresAt ? new Date(expiresAt) : null
  const status = calcularStatus(expiry)

  let client
  let token
  try {
    client = await pool.connect()
    await client.query('BEGIN')
    // DELETE + INSERT precisa ser indivisível: callbacks OAuth duplicados e
    // retries de renovação não podem deixar dois tokens ativos para a mesma
    // conta/plataforma.
    await client.query('SELECT pg_advisory_xact_lock($1, hashtext($2))', [accountId, platform])
    await client.query(`DELETE FROM tokens WHERE conta_id = $1 AND platform = $2`, [accountId, platform])

    const result = await client.query(`
      INSERT INTO tokens (conta_id, platform, account_name, access_token, refresh_token, expires_at, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id, conta_id AS "accountId", platform, account_name AS "accountName",
        access_token AS "accessToken", expires_at AS "expiresAt", status
    `, [accountId, platform, accountName || null, encrypt(accessToken), refreshToken ? encrypt(refreshToken) : null, expiry ? expiry.toISOString() : null, status])
    token = result.rows[0]
    await client.query('COMMIT')
  } catch (err) {
    await client?.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client?.release()
  }

  await registrarLog({
    type: 'ok',
    message: `Token adicionado: [${platform}] expira em ${expiry ? expiry.toLocaleDateString('pt-BR') : 'sem data definida'}`,
    platform,
    conta_id: accountId
  })

  return { ...token, accessToken: mask(accessToken) }
}

// ── Renova o access_token do YouTube via refresh_token (Google OAuth) ─────────
async function renovarTokenYoutube(token, db = pool) {
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      grant_type: 'refresh_token',
      refresh_token: token.refresh_token
    })
  })
  const data = await tokenRes.json()

  if (data.error || !data.access_token) {
    throw new Error(data.error_description || data.error || 'Falha ao renovar token do Google')
  }

  const newExpiry = new Date(Date.now() + (data.expires_in || 3600) * 1000)
  await db.query(`UPDATE tokens SET access_token = $1, expires_at = $2, status = 'valid', atualizado_em = NOW() WHERE id = $3`,
    [encrypt(data.access_token), newExpiry.toISOString(), token.id])

  return newExpiry
}

// Busca a foto de perfil atual na rede social e atualiza contas.avatar_url —
// contas antigas (conectadas antes de existir essa captura, ou em que a rede
// não devolveu a foto na hora) nunca ganhavam avatar depois disso; renovar o
// token é o único momento em que já temos um access_token válido em mãos sem
// precisar refazer o OAuth inteiro, então aproveitamos para atualizar aqui.
// Falha ao buscar a foto não deve derrubar a renovação do token em si.
async function atualizarAvatarConta(contaId, avatarUrl, db = pool) {
  if (!avatarUrl) return
  try {
    // O refresh mantém uma transação aberta para proteger o token. O
    // avatar é best-effort; savepoint evita que uma falha nessa atualização
    // aborte a transação principal e faça a renovação parecer ter falhado.
    if (db !== pool) await db.query('SAVEPOINT avatar_update')
    await db.query(`UPDATE contas SET avatar_url = $1 WHERE id = $2`, [avatarUrl, contaId])
    if (db !== pool) await db.query('RELEASE SAVEPOINT avatar_update')
  } catch {
    if (db !== pool) await db.query('ROLLBACK TO SAVEPOINT avatar_update').catch(() => {})
    /* melhor esforço — não bloqueia a renovação do token */
  }
}

// ── Renova o access_token do Instagram via long-lived token refresh ──────────
async function renovarTokenInstagram(token, db = pool) {
  const res = await fetch(`https://graph.instagram.com/refresh_access_token` +
    `?grant_type=ig_refresh_token&access_token=${encodeURIComponent(token.access_token)}`)
  const data = await res.json()

  if (data.error || !data.access_token) {
    throw new Error(data.error?.message || data.error_message || 'Falha ao renovar token do Instagram')
  }

  const newExpiry = new Date(Date.now() + (data.expires_in || 60 * 86400) * 1000)
  await db.query(`UPDATE tokens SET access_token = $1, expires_at = $2, status = 'valid', atualizado_em = NOW() WHERE id = $3`,
    [encrypt(data.access_token), newExpiry.toISOString(), token.id])

  try {
    const profileRes = await fetch(`https://graph.instagram.com/v19.0/me?fields=profile_picture_url&access_token=${encodeURIComponent(data.access_token)}`)
    const profileData = await profileRes.json()
    await atualizarAvatarConta(token.conta_id, profileData.profile_picture_url, db)
  } catch { /* melhor esforço — não bloqueia a renovação do token */ }

  return newExpiry
}

// ── Renova o access_token do TikTok via refresh_token (rotaciona o refresh_token também) ──
async function renovarTokenTiktok(token, db = pool) {
  if (!token.refresh_token) throw new Error('Token TikTok sem refresh_token salvo')

  const res = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_key: process.env.TIKTOK_CLIENT_KEY,
      client_secret: process.env.TIKTOK_CLIENT_SECRET,
      grant_type: 'refresh_token',
      refresh_token: token.refresh_token
    })
  })
  const data = await res.json()

  if (data.error || !data.access_token) {
    throw new Error(data.error_description || data.error || 'Falha ao renovar token do TikTok')
  }

  const newExpiry = new Date(Date.now() + (data.expires_in || 86400) * 1000)
  await db.query(`UPDATE tokens SET access_token = $1, refresh_token = $2, expires_at = $3, status = 'valid', atualizado_em = NOW() WHERE id = $4`,
    [encrypt(data.access_token), encrypt(data.refresh_token || token.refresh_token), newExpiry.toISOString(), token.id])

  try {
    const profileRes = await fetch('https://open.tiktokapis.com/v2/user/info/?fields=avatar_url', {
      headers: { Authorization: `Bearer ${data.access_token}` }
    })
    const profileData = await profileRes.json()
    await atualizarAvatarConta(token.conta_id, profileData?.data?.user?.avatar_url, db)
  } catch { /* melhor esforço — não bloqueia a renovação do token */ }

  return newExpiry
}

// ── Renova o access_token do Facebook trocando o long-lived token atual por
// um novo (mesmo endpoint fb_exchange_token usado na conexão inicial, ver
// src/routes/oauth.js finalizarConexaoFacebook). O Facebook não tem
// refresh_token dedicado — re-trocar o token ainda válido por um novo é o
// mecanismo oficial de renovação (Graph API), e falha de verdade (em vez de
// só estender a data no banco) se o token já tiver sido revogado pelo
// usuário ou realmente expirado.
async function renovarTokenFacebook(token, db = pool) {
  const res = await fetch(`https://graph.facebook.com/v19.0/oauth/access_token` +
    `?grant_type=fb_exchange_token` +
    `&client_id=${process.env.META_APP_ID}` +
    `&client_secret=${encodeURIComponent(process.env.META_APP_SECRET)}` +
    `&fb_exchange_token=${encodeURIComponent(token.access_token)}`)
  const data = await res.json()

  if (data.error || !data.access_token) {
    throw new Error(data.error?.message || 'Falha ao renovar token do Facebook')
  }

  const newExpiry = new Date(Date.now() + (data.expires_in || 60 * 86400) * 1000)
  await db.query(`UPDATE tokens SET access_token = $1, expires_at = $2, status = 'valid', atualizado_em = NOW() WHERE id = $3`,
    [encrypt(data.access_token), newExpiry.toISOString(), token.id])

  return newExpiry
}

// ── Renovar um token específico ────────────────────────────────────────────────
async function renovarToken(id, userId, isAdmin) {
  const { rows: [initial] } = await pool.query(`
    SELECT t.*, c.user_id AS token_owner_id
      FROM tokens t
      JOIN contas c ON c.id = t.conta_id
     WHERE t.id = $1
  `, [id])
  if (!initial) throw new Error('Token não encontrado')
  if (userId !== null && userId !== undefined) {
    if (initial.token_owner_id !== userId) throw new Error('Token não encontrado')
  } else if (!isAdmin) {
    throw new Error('Token não encontrado')
  }

  // A renovação chama um provedor externo e pode durar vários segundos. Uma
  // trava de sessão ocuparia uma conexão enquanto a rede responde. Mantemos
  // a transação aberta e fazemos as queries do provedor pela mesma conexão;
  // assim o lock coordena a corrida sem consumir uma segunda conexão do pool.
  let client = await pool.connect()
  try {
    await client.query('BEGIN')
    const { rows: [lock] } = await client.query(
      'SELECT pg_try_advisory_xact_lock($1, hashtext($2)) AS acquired',
      [initial.conta_id, initial.platform]
    )
    if (lock?.acquired !== true) {
      await client.query('COMMIT')
      client.release()
      client = null
      return { success: true, inProgress: true, message: 'A renovação deste token já está em andamento.' }
    }

    const { rows: [token] } = await client.query(`
      SELECT t.*, c.user_id AS token_owner_id
        FROM tokens t
        JOIN contas c ON c.id = t.conta_id
       WHERE t.id = $1
    `, [id])
    if (!token) throw new Error('Token não encontrado')
    if (userId !== null && userId !== undefined && token.token_owner_id !== userId) throw new Error('Token não encontrado')

    // access_token/refresh_token vêm cifrados do banco — decifra antes de usar
    // nas chamadas de renovação contra a API de cada rede social.
    token.access_token = decrypt(token.access_token)
    token.refresh_token = decrypt(token.refresh_token)

    let outcome
    let logEntry
    try {
      if (token.platform === 'youtube' && token.refresh_token) {
        const newExpiry = await renovarTokenYoutube(token, client)
        logEntry = { type: 'ok', message: 'Token YouTube renovado automaticamente', platform: 'youtube', conta_id: token.conta_id }
        outcome = { success: true, message: 'Token renovado via refresh_token', newExpiry }
      }

      if (!outcome && token.platform === 'instagram') {
        const newExpiry = await renovarTokenInstagram(token, client)
        logEntry = { type: 'ok', message: 'Token Instagram renovado automaticamente', platform: 'instagram', conta_id: token.conta_id }
        outcome = { success: true, message: 'Token renovado via long-lived token refresh', newExpiry }
      }

      if (!outcome && token.platform === 'tiktok' && token.refresh_token) {
        const newExpiry = await renovarTokenTiktok(token, client)
        logEntry = { type: 'ok', message: 'Token TikTok renovado automaticamente', platform: 'tiktok', conta_id: token.conta_id }
        outcome = { success: true, message: 'Token renovado via refresh_token', newExpiry }
      }

      if (!outcome && token.platform === 'facebook') {
        const newExpiry = await renovarTokenFacebook(token, client)
        logEntry = { type: 'ok', message: 'Token Facebook renovado automaticamente (fb_exchange_token)', platform: 'facebook', conta_id: token.conta_id }
        outcome = { success: true, message: 'Token renovado via fb_exchange_token', newExpiry }
      }

      if (!outcome) {
        logEntry = { type: 'warn', message: `Token ${token.platform} exige reconexão manual`, platform: token.platform, conta_id: token.conta_id }
        outcome = {
          success: false,
          requiresReconnect: true,
          message: `${token.platform} exige que o usuário reconecte manualmente via OAuth`,
          oauthUrl: `/auth/${token.platform}`
        }
      }
    } catch (err) {
      await client.query(`UPDATE tokens SET status = 'error', atualizado_em = NOW() WHERE id = $1`, [token.id])
      logEntry = { type: 'err', message: `Falha ao renovar token ${token.platform}: ${err.message}`, platform: token.platform, conta_id: token.conta_id }
      outcome = {
        success: false,
        requiresReconnect: true,
        message: `Não foi possível renovar automaticamente: ${err.message}. Reconecte via OAuth.`,
        oauthUrl: `/auth/${token.platform}`
      }
    }

    await client.query('COMMIT')
    client.release()
    client = null
    try { await registrarLog(logEntry) } catch { /* falha de log não invalida a renovação */ }
    return outcome
  } catch (err) {
    await client?.query('ROLLBACK').catch(() => {})
    client?.release()
    throw err
  }
}

// ── Renovar todos os tokens expirados/expirando ────────────────────────────────
async function renovarTodos(userId, isAdmin) {
  await atualizarStatusTokens()
  const hasUserScope = userId !== null && userId !== undefined
  const params = hasUserScope ? [userId] : []
  const ownerFilter = hasUserScope ? `AND c.user_id = $1` : (isAdmin ? '' : 'AND FALSE')
  const { rows: toRenew } = await pool.query(`
    SELECT t.id FROM tokens t
    JOIN contas c ON c.id = t.conta_id
    WHERE t.status IN ('expired', 'expiring') ${ownerFilter}
  `, params)

  const results = { renewed: [], requiresManual: [], failed: [] }

  for (const { id } of toRenew) {
    const r = await renovarToken(id, hasUserScope ? userId : null, hasUserScope ? false : isAdmin)
    if (r.success) results.renewed.push(id)
    else if (r.requiresReconnect) results.requiresManual.push(id)
    else results.failed.push(id)
  }

  return { ...results, total: toRenew.length }
}

// ── Deletar token ────────────────────────────────────────────────────────────
async function deletarToken(id, userId, isAdmin) {
  if (userId !== null && userId !== undefined) {
    if (!(await tokenPertenceAoUsuario(id, userId))) return false
  } else if (!isAdmin) {
    return false
  }
  const { rowCount } = await pool.query(`DELETE FROM tokens WHERE id = $1`, [id])
  return rowCount > 0
}

module.exports = { listarTokens, salvarToken, renovarToken, renovarTodos, deletarToken }
