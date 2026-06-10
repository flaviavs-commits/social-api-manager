const pool = require('../db/pool')

// ── Stats para o dashboard ────────────────────────────────────────────────────
async function getDashboardStats() {
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

  // Totais gerais
  const { rows: [summary] } = await pool.query(`
    SELECT
      (SELECT COUNT(*) FROM contas WHERE ativo = TRUE)                           AS "totalAccounts",
      (SELECT COUNT(*) FROM tokens WHERE status = 'valid')                       AS "validTokensTotal",
      (SELECT COUNT(*) FROM tokens WHERE status = 'expiring')                    AS "expiringTokensTotal",
      (SELECT COUNT(*) FROM tokens WHERE status IN ('expired','error'))          AS "errorTotal"
  `)

  // Totais por plataforma
  const { rows: platforms } = await pool.query(`
    SELECT
      t.platform,
      COUNT(*)                                              AS total,
      COUNT(*) FILTER (WHERE t.status = 'valid')           AS active,
      COUNT(*) FILTER (WHERE t.status = 'expiring')        AS "expiringTokens",
      COUNT(*) FILTER (WHERE t.status IN ('expired','error')) AS error
    FROM tokens t
    GROUP BY t.platform
    ORDER BY t.platform
  `)

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

// ── Listar contas com tokens por plataforma ───────────────────────────────────
async function listarContas({ nicho, tipo, ativo } = {}) {
  const conds = []
  const params = []

  if (nicho) { params.push(nicho); conds.push(`n.nome = $${params.length}`) }
  if (tipo)  { params.push(tipo);  conds.push(`c.tipo = $${params.length}::tipo_nivel`) }
  if (ativo !== undefined) { params.push(ativo); conds.push(`c.ativo = $${params.length}`) }

  const where = conds.length ? 'WHERE ' + conds.join(' AND ') : ''

  const { rows } = await pool.query(`
    SELECT
      c.id, c.email, c.instagram, c.tiktok, c.facebook, c.youtube, c.kwai,
      c.tipo, c.ativo, c.criado_em,
      n.nome AS nicho,
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
    LEFT JOIN nichos n ON n.id = c.nicho_id
    LEFT JOIN tokens t ON t.conta_id = c.id
    ${where}
    GROUP BY c.id, n.nome
    ORDER BY c.tipo, c.criado_em DESC
  `, params)

  return rows
}

// ── Criar conta ───────────────────────────────────────────────────────────────
async function criarConta({ email, instagram, tiktok, facebook, youtube, kwai, tipo, nicho_id }) {
  const { rows } = await pool.query(`
    INSERT INTO contas (email, instagram, tiktok, facebook, youtube, kwai, tipo, nicho_id)
    VALUES ($1,$2,$3,$4,$5,$6,$7::tipo_nivel,$8)
    RETURNING *
  `, [email, instagram, tiktok, facebook, youtube, kwai, tipo, nicho_id])
  return rows[0]
}

// ── Buscar conta por ID ───────────────────────────────────────────────────────
async function buscarContaPorId(id) {
  const { rows } = await pool.query(`
    SELECT c.*, n.nome AS nicho
    FROM contas c
    LEFT JOIN nichos n ON n.id = c.nicho_id
    WHERE c.id = $1
  `, [id])
  return rows[0] || null
}

// ── Criar conta rápida (para OAuth flow) ─────────────────────────────────────
async function criarContaRapida({ name, platform, group }) {
  // Resolve nicho_id
  const { rows: [nicho] } = await pool.query(
    `SELECT id FROM nichos WHERE nome ILIKE $1 LIMIT 1`, [group || 'Gerais']
  )

  const campos = { facebook:'facebook', instagram:'instagram', youtube:'youtube', tiktok:'tiktok' }
  const col = campos[platform] || 'instagram'

  const email = `${name.replace(/[^a-z0-9]/gi, '').toLowerCase()}@pendente.local`

  const { rows } = await pool.query(`
    INSERT INTO contas (email, ${col}, tipo, nicho_id)
    VALUES ($1, $2, 'NICHO', $3)
    ON CONFLICT (email) DO UPDATE SET ${col} = EXCLUDED.${col}
    RETURNING *
  `, [email, name, nicho?.id || 1])

  return rows[0]
}

module.exports = { getDashboardStats, listarContas, criarConta, buscarContaPorId, criarContaRapida }