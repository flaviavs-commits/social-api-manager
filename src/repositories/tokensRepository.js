const pool = require('../db/pool')
const { registrarLog } = require('./logsRepository')

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

// ── Listar tokens com info da conta ───────────────────────────────────────────
async function listarTokens({ status, platform } = {}) {
  await atualizarStatusTokens()

  const conds = []
  const params = []
  if (status)   { params.push(status);   conds.push(`t.status = $${params.length}`) }
  if (platform) { params.push(platform); conds.push(`t.platform = $${params.length}`) }
  const where = conds.length ? 'WHERE ' + conds.join(' AND ') : ''

  const { rows } = await pool.query(`
    SELECT
      t.id, t.conta_id AS "accountId", t.platform,
      t.access_token AS "accessToken",
      t.expires_at AS "expiresAt", t.status,
      COALESCE(t.account_name, c.email, 'Conta removida') AS "accountName",
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
      accessToken: mask(t.accessToken),
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
  `, [accountId, platform, accountName || null, accessToken, refreshToken || null, expiry ? expiry.toISOString() : null, status])

  await registrarLog({
    type: 'ok',
    message: `Token adicionado: [${platform}] expira em ${expiry ? expiry.toLocaleDateString('pt-BR') : 'sem data definida'}`,
    platform,
    conta_id: accountId
  })

  return { ...token, accessToken: mask(token.accessToken) }
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
    [data.access_token, newExpiry.toISOString(), token.id])

  return newExpiry
}

// ── Renovar um token específico ────────────────────────────────────────────────
async function renovarToken(id) {
  const { rows: [token] } = await pool.query(`SELECT * FROM tokens WHERE id = $1`, [id])
  if (!token) throw new Error('Token não encontrado')

  if (token.platform === 'youtube' && token.refresh_token) {
    const newExpiry = await renovarTokenYoutube(token)
    await registrarLog({ type: 'ok', message: 'Token YouTube renovado automaticamente', platform: 'youtube', conta_id: token.conta_id })
    return { success: true, message: 'Token renovado via refresh_token', newExpiry }
  }

  if (token.platform === 'facebook') {
    const newExpiry = new Date(Date.now() + 60 * 86400000)
    await pool.query(`UPDATE tokens SET expires_at = $1, status = 'valid', atualizado_em = NOW() WHERE id = $2`, [newExpiry.toISOString(), id])
    await registrarLog({ type: 'ok', message: 'Token Facebook estendido por mais 60 dias', platform: 'facebook', conta_id: token.conta_id })
    return { success: true, message: 'Token estendido por mais 60 dias', newExpiry }
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
async function renovarTodos() {
  await atualizarStatusTokens()
  const { rows: toRenew } = await pool.query(`SELECT * FROM tokens WHERE status IN ('expired', 'expiring')`)

  const results = { renewed: [], requiresManual: [], failed: [] }

  for (const token of toRenew) {
    if (token.platform === 'youtube' && token.refresh_token) {
      try {
        await renovarTokenYoutube(token)
        results.renewed.push(token.id)
        await registrarLog({ type: 'ok', message: 'Auto-renovado [youtube]', platform: 'youtube', conta_id: token.conta_id })
      } catch (err) {
        results.failed.push(token.id)
        await registrarLog({ type: 'err', message: `Falha ao renovar token YouTube: ${err.message}`, platform: 'youtube', conta_id: token.conta_id })
      }
    } else if (token.platform === 'facebook') {
      const newExpiry = new Date(Date.now() + 60 * 86400000)
      await pool.query(`UPDATE tokens SET status = 'valid', expires_at = $1, atualizado_em = NOW() WHERE id = $2`, [newExpiry.toISOString(), token.id])
      results.renewed.push(token.id)
      await registrarLog({ type: 'ok', message: 'Auto-renovado [facebook]', platform: 'facebook', conta_id: token.conta_id })
    } else {
      results.requiresManual.push(token.id)
      await registrarLog({ type: 'warn', message: `Reconexão manual necessária [${token.platform}]`, platform: token.platform, conta_id: token.conta_id })
    }
  }

  return { ...results, total: toRenew.length }
}

// ── Deletar token ────────────────────────────────────────────────────────────
async function deletarToken(id) {
  const { rowCount } = await pool.query(`DELETE FROM tokens WHERE id = $1`, [id])
  return rowCount > 0
}

module.exports = { listarTokens, salvarToken, renovarToken, renovarTodos, deletarToken }
