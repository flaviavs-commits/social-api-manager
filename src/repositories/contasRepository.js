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

// ── Listar contas com tokens por plataforma ───────────────────────────────────
async function listarContas({ nicho, tipo, ativo, userId, isAdmin } = {}) {
  const conds = []
  const params = []

  if (!isAdmin) { params.push(userId); conds.push(`c.user_id = $${params.length}`) }
  if (nicho) { params.push(nicho); conds.push(`n.nome = $${params.length}`) }
  if (tipo)  { params.push(tipo);  conds.push(`c.tipo = $${params.length}::tipo_nivel`) }
  if (ativo !== undefined) { params.push(ativo); conds.push(`c.ativo = $${params.length}`) }

  const where = conds.length ? 'WHERE ' + conds.join(' AND ') : ''

  const { rows } = await pool.query(`
    SELECT
      c.id, c.email, c.instagram, c.tiktok, c.facebook, c.youtube, c.kwai,
      c.tipo, c.ativo, c.criado_em, c.user_id AS "userId", u.email AS "ownerEmail",
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
    LEFT JOIN users u ON u.id = c.user_id
    ${where}
    GROUP BY c.id, n.nome, u.email
    ORDER BY c.tipo, c.criado_em DESC
  `, params)

  return rows
}

// ── Criar conta ───────────────────────────────────────────────────────────────
async function criarConta({ email, instagram, tiktok, facebook, youtube, kwai, tipo, nicho_id, userId }) {
  const { rows } = await pool.query(`
    INSERT INTO contas (email, instagram, tiktok, facebook, youtube, kwai, tipo, nicho_id, user_id)
    VALUES ($1,$2,$3,$4,$5,$6,$7::tipo_nivel,$8,$9)
    RETURNING *
  `, [email, instagram, tiktok, facebook, youtube, kwai, tipo, nicho_id, userId])
  return rows[0]
}

// ── Buscar conta por ID ───────────────────────────────────────────────────────
async function buscarContaPorId(id, userId, isAdmin) {
  const { rows } = await pool.query(`
    SELECT c.*, n.nome AS nicho
    FROM contas c
    LEFT JOIN nichos n ON n.id = c.nicho_id
    WHERE c.id = $1
  `, [id])
  const conta = rows[0] || null
  if (!conta) return null
  if (!isAdmin && conta.user_id !== userId) return null
  return conta
}

// ── Criar conta rápida (para OAuth flow) ─────────────────────────────────────
// Regra de negócio: o e-mail informado define o agrupamento das redes da pessoa.
// - Mesmo e-mail usado em Facebook/Instagram/YouTube/TikTok -> tudo cai na mesma
//   conta (linha).
// - E-mail diferente por rede -> cada um vira uma conta separada.
//
// Antes de gravar, confere se essa rede social já está vinculada a alguma conta
// *do mesmo usuário* (a busca é sempre restrita ao userId, para um usuário nunca
// reaproveitar ou sobrescrever uma conta de outro usuário):
// - Se já está, e o e-mail informado bate com o da conta -> reaproveita a conta.
// - Se já está, mas o e-mail informado é diferente -> o e-mail informado é o
//   e-mail real da pessoa, então a conta é atualizada/realocada para ele.
async function criarContaRapida({ name, platform, group, email, userId }) {
  // Resolve nicho_id
  const { rows: [nicho] } = await pool.query(
    `SELECT id FROM nichos WHERE nome ILIKE $1 LIMIT 1`, [group || 'Geral']
  )

  // Nome da coluna interpolado diretamente no SQL abaixo (não há como
  // parametrizar identificador de coluna) — por isso a validação aqui é
  // obrigatória: só permite um dos 5 valores literais deste mapa, nunca o
  // que vier de "platform" sem passar por aqui.
  const campos = { facebook:'facebook', instagram:'instagram', youtube:'youtube', tiktok:'tiktok', kwai:'kwai' }
  if (!Object.prototype.hasOwnProperty.call(campos, platform)) {
    throw new Error('Plataforma inválida')
  }
  const col = campos[platform]

  const emailFinal = (email || '').trim().toLowerCase() ||
    `${name.replace(/[^a-z0-9]/gi, '').toLowerCase()}@pendente.local`

  // Essa rede social já está conectada em alguma conta deste usuário?
  const { rows: [contaExistente] } = await pool.query(
    `SELECT id, email FROM contas WHERE ${col} = $1 AND user_id = $2 LIMIT 1`, [name, userId]
  )

  if (contaExistente && contaExistente.email === emailFinal) {
    // Mesma pessoa, mesmo e-mail -> só reaproveita a conta já existente
    const { rows } = await pool.query(`SELECT * FROM contas WHERE id = $1`, [contaExistente.id])
    return rows[0]
  }

  // Já existe uma conta deste usuário dona desse e-mail real?
  const { rows: [contaDoEmail] } = await pool.query(
    `SELECT id FROM contas WHERE email = $1 AND user_id = $2 LIMIT 1`, [emailFinal, userId]
  )

  if (contaDoEmail) {
    // Move a rede social para a conta dona do e-mail informado
    if (contaExistente && contaExistente.id !== contaDoEmail.id) {
      await pool.query(`UPDATE contas SET ${col} = NULL WHERE id = $1`, [contaExistente.id])
    }
    const { rows } = await pool.query(
      `UPDATE contas SET ${col} = $1 WHERE id = $2 RETURNING *`, [name, contaDoEmail.id]
    )
    return rows[0]
  }

  if (contaExistente) {
    // Atualiza a conta existente para o e-mail real informado pela pessoa
    const { rows } = await pool.query(
      `UPDATE contas SET email = $1 WHERE id = $2 RETURNING *`, [emailFinal, contaExistente.id]
    )
    return rows[0]
  }

  // Nenhuma conta encontrada -> cria uma nova
  const { rows } = await pool.query(`
    INSERT INTO contas (email, ${col}, tipo, nicho_id, user_id)
    VALUES ($1, $2, 'NICHO', $3, $4)
    RETURNING *
  `, [emailFinal, name, nicho?.id || 1, userId])

  return rows[0]
}

async function deletarConta(id, userId, isAdmin) {
  const conta = await buscarContaPorId(id, userId, isAdmin)
  if (!conta) return false
  await pool.query('DELETE FROM tokens WHERE conta_id = $1', [id])
  const { rowCount } = await pool.query('DELETE FROM contas WHERE id = $1', [id])
  return rowCount > 0
}

module.exports = { getDashboardStats, listarContas, criarConta, buscarContaPorId, criarContaRapida, deletarConta }