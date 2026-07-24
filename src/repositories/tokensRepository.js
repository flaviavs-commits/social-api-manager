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
  if (!isAdmin) { params.push(userId);   conds.push(`c.user_id = $${params.length}`) }
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

  await pool.query(`DELETE FROM tokens WHERE conta_id = $1 AND platform = $2`, [accountId, platform])

  const { rows: [token] } = await pool.query(`
    INSERT INTO tokens (conta_id, platform, account_name, access_token, refresh_token, expires_at, status)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING id, conta_id AS "accountId", platform, account_name AS "accountName",
      access_token AS "accessToken", expires_at AS "expiresAt", status
  `, [accountId, platform, accountName || null, encrypt(accessToken), refreshToken ? encrypt(refreshToken) : null, expiry ? expiry.toISOString() : null, status])

  await registrarLog({
    type: 'ok',
    message: `Token adicionado: [${platform}] expira em ${expiry ? expiry.toLocaleDateString('pt-BR') : 'sem data definida'}`,
    platform,
    conta_id: accountId
  })

  return { ...token, accessToken: mask(accessToken) }
}

// ── Renova o access_token do YouTube via refresh_token (Google OAuth) ─────────
async function renovarTokenYoutube(token) {
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
  await pool.query(`UPDATE tokens SET access_token = $1, expires_at = $2, status = 'valid', atualizado_em = NOW() WHERE id = $3`,
    [encrypt(data.access_token), newExpiry.toISOString(), token.id])

  return newExpiry
}

// Busca a foto de perfil atual na rede social e atualiza contas.avatar_url —
// contas antigas (conectadas antes de existir essa captura, ou em que a rede
// não devolveu a foto na hora) nunca ganhavam avatar depois disso; renovar o
// token é o único momento em que já temos um access_token válido em mãos sem
// precisar refazer o OAuth inteiro, então aproveitamos para atualizar aqui.
// Falha ao buscar a foto não deve derrubar a renovação do token em si.
async function atualizarAvatarConta(contaId, avatarUrl) {
  if (!avatarUrl) return
  try {
    await pool.query(`UPDATE contas SET avatar_url = $1 WHERE id = $2`, [avatarUrl, contaId])
  } catch { /* melhor esforço — não bloqueia a renovação do token */ }
}

// ── Renova o access_token do Instagram via long-lived token refresh ──────────
async function renovarTokenInstagram(token) {
  const res = await fetch(`https://graph.instagram.com/refresh_access_token` +
    `?grant_type=ig_refresh_token&access_token=${encodeURIComponent(token.access_token)}`)
  const data = await res.json()

  if (data.error || !data.access_token) {
    throw new Error(data.error?.message || data.error_message || 'Falha ao renovar token do Instagram')
  }

  const newExpiry = new Date(Date.now() + (data.expires_in || 60 * 86400) * 1000)
  await pool.query(`UPDATE tokens SET access_token = $1, expires_at = $2, status = 'valid', atualizado_em = NOW() WHERE id = $3`,
    [encrypt(data.access_token), newExpiry.toISOString(), token.id])

  try {
    const profileRes = await fetch(`https://graph.instagram.com/v19.0/me?fields=profile_picture_url&access_token=${encodeURIComponent(data.access_token)}`)
    const profileData = await profileRes.json()
    await atualizarAvatarConta(token.conta_id, profileData.profile_picture_url)
  } catch { /* melhor esforço — não bloqueia a renovação do token */ }

  return newExpiry
}

// ── Renova o access_token do TikTok via refresh_token (rotaciona o refresh_token também) ──
async function renovarTokenTiktok(token) {
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
  await pool.query(`UPDATE tokens SET access_token = $1, refresh_token = $2, expires_at = $3, status = 'valid', atualizado_em = NOW() WHERE id = $4`,
    [encrypt(data.access_token), encrypt(data.refresh_token || token.refresh_token), newExpiry.toISOString(), token.id])

  try {
    const profileRes = await fetch('https://open.tiktokapis.com/v2/user/info/?fields=avatar_url', {
      headers: { Authorization: `Bearer ${data.access_token}` }
    })
    const profileData = await profileRes.json()
    await atualizarAvatarConta(token.conta_id, profileData?.data?.user?.avatar_url)
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
async function renovarTokenFacebook(token) {
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
  await pool.query(`UPDATE tokens SET access_token = $1, expires_at = $2, status = 'valid', atualizado_em = NOW() WHERE id = $3`,
    [encrypt(data.access_token), newExpiry.toISOString(), token.id])

  return newExpiry
}

// ── Renova o access_token do Threads via refresh_access_token (long-lived,
// mesmo padrão do Instagram, API própria em graph.threads.net) ──────────────
async function renovarTokenThreads(token) {
  const res = await fetch(`https://graph.threads.net/refresh_access_token` +
    `?grant_type=th_refresh_token&access_token=${encodeURIComponent(token.access_token)}`)
  const data = await res.json()

  if (data.error || !data.access_token) {
    throw new Error(data.error?.message || 'Falha ao renovar token do Threads')
  }

  const newExpiry = new Date(Date.now() + (data.expires_in || 60 * 86400) * 1000)
  await pool.query(`UPDATE tokens SET access_token = $1, expires_at = $2, status = 'valid', atualizado_em = NOW() WHERE id = $3`,
    [encrypt(data.access_token), newExpiry.toISOString(), token.id])

  return newExpiry
}

// ── Renova o access_token do Pinterest via refresh_token (OAuth padrão) ─────
async function renovarTokenPinterest(token) {
  if (!token.refresh_token) throw new Error('Token Pinterest sem refresh_token salvo')

  const basicAuth = Buffer.from(`${process.env.PINTEREST_APP_ID}:${process.env.PINTEREST_APP_SECRET}`).toString('base64')
  const res = await fetch('https://api.pinterest.com/v5/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${basicAuth}` },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: token.refresh_token })
  })
  const data = await res.json()

  if (!data.access_token) {
    throw new Error(data.message || 'Falha ao renovar token do Pinterest')
  }

  const newExpiry = new Date(Date.now() + (data.expires_in || 30 * 86400) * 1000)
  await pool.query(`UPDATE tokens SET access_token = $1, expires_at = $2, status = 'valid', atualizado_em = NOW() WHERE id = $3`,
    [encrypt(data.access_token), newExpiry.toISOString(), token.id])

  return newExpiry
}

// ── Renovar um token específico ────────────────────────────────────────────────
async function renovarToken(id, userId, isAdmin) {
  const { rows: [token] } = await pool.query(`SELECT * FROM tokens WHERE id = $1`, [id])
  if (!token) throw new Error('Token não encontrado')
  if (!isAdmin && !(await tokenPertenceAoUsuario(id, userId))) throw new Error('Token não encontrado')

  // access_token/refresh_token vêm cifrados do banco — decifra antes de usar
  // nas chamadas de renovação contra a API de cada rede social.
  token.access_token = decrypt(token.access_token)
  token.refresh_token = decrypt(token.refresh_token)

  try {
    if (token.platform === 'youtube' && token.refresh_token) {
      const newExpiry = await renovarTokenYoutube(token)
      await registrarLog({ type: 'ok', message: 'Token YouTube renovado automaticamente', platform: 'youtube', conta_id: token.conta_id })
      return { success: true, message: 'Token renovado via refresh_token', newExpiry }
    }

    if (token.platform === 'instagram') {
      const newExpiry = await renovarTokenInstagram(token)
      await registrarLog({ type: 'ok', message: 'Token Instagram renovado automaticamente', platform: 'instagram', conta_id: token.conta_id })
      return { success: true, message: 'Token renovado via long-lived token refresh', newExpiry }
    }

    if (token.platform === 'tiktok' && token.refresh_token) {
      const newExpiry = await renovarTokenTiktok(token)
      await registrarLog({ type: 'ok', message: 'Token TikTok renovado automaticamente', platform: 'tiktok', conta_id: token.conta_id })
      return { success: true, message: 'Token renovado via refresh_token', newExpiry }
    }

    if (token.platform === 'facebook') {
      const newExpiry = await renovarTokenFacebook(token)
      await registrarLog({ type: 'ok', message: 'Token Facebook renovado automaticamente (fb_exchange_token)', platform: 'facebook', conta_id: token.conta_id })
      return { success: true, message: 'Token renovado via fb_exchange_token', newExpiry }
    }

    if (token.platform === 'threads') {
      const newExpiry = await renovarTokenThreads(token)
      await registrarLog({ type: 'ok', message: 'Token Threads renovado automaticamente', platform: 'threads', conta_id: token.conta_id })
      return { success: true, message: 'Token renovado via long-lived token refresh', newExpiry }
    }

    if (token.platform === 'pinterest' && token.refresh_token) {
      const newExpiry = await renovarTokenPinterest(token)
      await registrarLog({ type: 'ok', message: 'Token Pinterest renovado automaticamente', platform: 'pinterest', conta_id: token.conta_id })
      return { success: true, message: 'Token renovado via refresh_token', newExpiry }
    }

    // LinkedIn: refresh_token programático só é concedido a parceiros
    // aprovados na Marketing Developer Platform (ver guia de referência,
    // Cap. 5.4) — sem isso, cai no fallback "exige reconexão manual" abaixo.

  } catch (err) {
    await pool.query(`UPDATE tokens SET status = 'error', atualizado_em = NOW() WHERE id = $1`, [token.id])
    await registrarLog({ type: 'err', message: `Falha ao renovar token ${token.platform}: ${err.message}`, platform: token.platform, conta_id: token.conta_id })
    return {
      success: false,
      requiresReconnect: true,
      message: `Não foi possível renovar automaticamente: ${err.message}. Reconecte via OAuth.`,
      oauthUrl: `/auth/${token.platform}`
    }
  }

  await registrarLog({ type: 'warn', message: `Token ${token.platform} exige reconexão manual`, platform: token.platform, conta_id: token.conta_id })
  return {
    success: false,
    requiresReconnect: true,
    message: `${token.platform} exige que o usuário reconecte manualmente via OAuth`,
    oauthUrl: `/auth/${token.platform}`
  }
}

// ── Renovar todos os tokens expirados/expirando ────────────────────────────────
async function renovarTodos(userId, isAdmin) {
  await atualizarStatusTokens()
  const params = isAdmin ? [] : [userId]
  const ownerFilter = isAdmin ? '' : `AND c.user_id = $1`
  const { rows: toRenew } = await pool.query(`
    SELECT t.id FROM tokens t
    JOIN contas c ON c.id = t.conta_id
    WHERE t.status IN ('expired', 'expiring') ${ownerFilter}
  `, params)

  const results = { renewed: [], requiresManual: [], failed: [] }

  for (const { id } of toRenew) {
    const r = await renovarToken(id, userId, isAdmin)
    if (r.success) results.renewed.push(id)
    else if (r.requiresReconnect) results.requiresManual.push(id)
    else results.failed.push(id)
  }

  return { ...results, total: toRenew.length }
}

// ── Deletar token ────────────────────────────────────────────────────────────
async function deletarToken(id, userId, isAdmin) {
  if (!isAdmin && !(await tokenPertenceAoUsuario(id, userId))) return false
  const { rowCount } = await pool.query(`DELETE FROM tokens WHERE id = $1`, [id])
  return rowCount > 0
}

module.exports = { listarTokens, salvarToken, renovarToken, renovarTodos, deletarToken }
