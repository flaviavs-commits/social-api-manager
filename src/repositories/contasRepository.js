const pool = require('../db/pool')

// ── Stats para o dashboard ────────────────────────────────────────────────────
async function getDashboardStats(userId, isAdmin) {
  // Atualiza status dos tokens antes de calcular
  await pool.query(`
    UPDATE tokens SET status =
      CASE
        WHEN expires_at < NOW()                        THEN 'expired'
        WHEN expires_at < NOW() + INTERVAL '7 days'   THEN 'expiring'
        ELSE 'valid'
      END
    WHERE expires_at IS NOT NULL
  `)

  const ownerFilter = isAdmin ? '' : `WHERE c.user_id = $1`
  const ownerParams = isAdmin ? [] : [userId]

  // Totais gerais
  const { rows: [summary] } = await pool.query(`
    SELECT
      COUNT(DISTINCT c.id)                                              AS "totalAccounts",
      COUNT(*) FILTER (WHERE t.status = 'valid')                       AS "validTokensTotal",
      COUNT(*) FILTER (WHERE t.status = 'expiring')                    AS "expiringTokensTotal",
      COUNT(*) FILTER (WHERE t.status IN ('expired','error'))          AS "errorTotal"
    FROM contas c
    LEFT JOIN tokens t ON t.conta_id = c.id
    ${ownerFilter}
  `, ownerParams)

  // Totais por plataforma
  const { rows: platforms } = await pool.query(`
    SELECT
      t.platform,
      COUNT(*)                                              AS total,
      COUNT(*) FILTER (WHERE t.status = 'valid')           AS active,
      COUNT(*) FILTER (WHERE t.status = 'expiring')        AS "expiringTokens",
      COUNT(*) FILTER (WHERE t.status IN ('expired','error')) AS error
    FROM tokens t
    JOIN contas c ON c.id = t.conta_id
    ${ownerFilter}
    GROUP BY t.platform
    ORDER BY t.platform
  `, ownerParams)

  return {
    summary: {
      totalAccounts:      Number(summary.totalAccounts),
      validTokensTotal:   Number(summary.validTokensTotal),
      expiringTokensTotal:Number(summary.expiringTokensTotal),
      errorTotal:         Number(summary.errorTotal),
    },
    platforms: platforms.map(p => ({
      platform:       p.platform,
      total:          Number(p.total),
      active:         Number(p.active),
      expiringTokens: Number(p.expiringTokens),
      error:          Number(p.error),
    }))
  }
}

// ── Listar contas com tokens ───────────────────────────────────────────────────
async function listarContas({ platform, tipo, ativo, userId, isAdmin } = {}) {
  const conds = []
  const params = []

  if (!isAdmin) { params.push(userId); conds.push(`c.user_id = $${params.length}`) }
  if (platform) { params.push(platform); conds.push(`c.platform = $${params.length}`) }
  if (tipo)  { params.push(tipo);  conds.push(`c.tipo = $${params.length}::tipo_nivel`) }
  if (ativo !== undefined) { params.push(ativo); conds.push(`c.ativo = $${params.length}`) }

  const where = conds.length ? 'WHERE ' + conds.join(' AND ') : ''

  const { rows } = await pool.query(`
    SELECT
      c.id, c.platform, c.handle, c.tipo, c.ativo, c.criado_em, c.avatar_url AS "avatarUrl",
      c.user_id AS "userId", u.email AS "ownerEmail",
      JSON_AGG(
        JSON_BUILD_OBJECT(
          'id',           t.id,
          'platform',     t.platform,
          'accountName',  t.account_name,
          'accessToken',  LEFT(t.access_token, 12) || '...',
          'expiresAt',    t.expires_at,
          'status',       t.status
        )
      ) FILTER (WHERE t.id IS NOT NULL) AS tokens
    FROM contas c
    LEFT JOIN tokens t ON t.conta_id = c.id
    LEFT JOIN users u ON u.id = c.user_id
    ${where}
    GROUP BY c.id, u.email
    ORDER BY c.tipo, c.criado_em DESC
  `, params)

  return rows
}

// ── Criar conta ───────────────────────────────────────────────────────────────
async function criarConta({ platform, handle, tipo, userId }) {
  const { rows } = await pool.query(`
    INSERT INTO contas (platform, handle, tipo, user_id)
    VALUES ($1,$2,$3::tipo_nivel,$4)
    RETURNING *
  `, [platform, handle, tipo, userId])
  return rows[0]
}

// ── Buscar conta por ID ───────────────────────────────────────────────────────
async function buscarContaPorId(id, userId, isAdmin) {
  const { rows: [conta] } = await pool.query(`SELECT * FROM contas WHERE id = $1`, [id])
  if (!conta) return null
  if (!isAdmin && conta.user_id !== userId) return null
  return conta
}

// ── Criar conta rápida (para OAuth flow) ─────────────────────────────────────
// Cada conexão de rede social é sua própria linha em "contas" (platform +
// handle), sem agrupamento por e-mail/nicho. Se o usuário já tem essa mesma
// combinação (mesma plataforma + mesmo handle) conectada, reaproveita a
// linha existente em vez de duplicar.
async function criarContaRapida({ name, platform, userId, avatarUrl = null }) {
  if (!['facebook', 'instagram', 'youtube', 'tiktok', 'kwai'].includes(platform)) {
    throw new Error('Plataforma inválida')
  }

  const { rows: [existente] } = await pool.query(
    `SELECT * FROM contas WHERE platform = $1 AND handle = $2 AND user_id = $3 LIMIT 1`,
    [platform, name, userId]
  )
  if (existente) {
    if (avatarUrl && avatarUrl !== existente.avatar_url) {
      const { rows: [atualizada] } = await pool.query(
        `UPDATE contas SET avatar_url = $1 WHERE id = $2 RETURNING *`, [avatarUrl, existente.id]
      )
      return atualizada
    }
    return existente
  }

  const { rows: [conta] } = await pool.query(`
    INSERT INTO contas (platform, handle, tipo, user_id, avatar_url)
    VALUES ($1, $2, 'NICHO', $3, $4)
    RETURNING *
  `, [platform, name, userId, avatarUrl])

  return conta
}

async function deletarConta(id, userId, isAdmin) {
  const conta = await buscarContaPorId(id, userId, isAdmin)
  if (!conta) return false
  await pool.query('DELETE FROM tokens WHERE conta_id = $1', [id])
  const { rowCount } = await pool.query('DELETE FROM contas WHERE id = $1', [id])
  return rowCount > 0
}

module.exports = { getDashboardStats, listarContas, criarConta, buscarContaPorId, criarContaRapida, deletarConta }
