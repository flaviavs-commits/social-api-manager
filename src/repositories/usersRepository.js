const pool = require('../db/pool')

// Normaliza e-mails antes de gravar/consultar: remove espaços nas pontas e
// força minúsculas, evitando que " a@b.com " e "a@b.com" sejam tratados
// como contas diferentes.
function normalizarEmail(email) {
  return email.trim().toLowerCase()
}

async function buscarPorEmail(email) {
  const { rows: [user] } = await pool.query(
    `SELECT * FROM users WHERE email = $1 AND ativo = TRUE`,
    [normalizarEmail(email)]
  )
  return user || null
}

async function buscarPorId(id) {
  const { rows: [user] } = await pool.query(
    `SELECT * FROM users WHERE id = $1 AND ativo = TRUE`,
    [id]
  )
  return user || null
}

// Busca incluindo contas desativadas — usado em checagens de autorização
// administrativas, onde precisamos saber o papel do alvo mesmo se ele já
// estiver inativo (ex: impedir que um admin comum reative outro admin).
async function buscarPorIdIncluindoInativo(id) {
  const { rows: [user] } = await pool.query(
    `SELECT * FROM users WHERE id = $1`,
    [id]
  )
  return user || null
}

async function buscarPorGoogleId(googleId) {
  const { rows: [user] } = await pool.query(
    `SELECT * FROM users WHERE google_id = $1 AND ativo = TRUE`,
    [googleId]
  )
  return user || null
}

async function criar({ email, fullName }) {
  const { rows: [user] } = await pool.query(
    `INSERT INTO users (email, full_name)
     VALUES ($1, $2)
     RETURNING id, email, full_name AS "fullName"`,
    [normalizarEmail(email), fullName || null]
  )
  return user
}

async function criarComGoogle({ email, fullName, googleId }) {
  const { rows: [user] } = await pool.query(
    `INSERT INTO users (email, full_name, google_id)
     VALUES ($1, $2, $3)
     RETURNING id, email, full_name AS "fullName"`,
    [normalizarEmail(email), fullName || null, googleId]
  )
  return user
}

async function vincularGoogleId(userId, googleId) {
  await pool.query(`UPDATE users SET google_id = $1 WHERE id = $2`, [googleId, userId])
}

// ── Administração ────────────────────────────────────────────────────────────

async function listarTodos() {
  const { rows } = await pool.query(`
    SELECT
      u.id, u.email, u.full_name AS "fullName", u.role, u.ativo, u.criado_em AS "criadoEm",
      COUNT(c.id) AS "totalContas"
    FROM users u
    LEFT JOIN contas c ON c.user_id = u.id
    GROUP BY u.id
    ORDER BY u.criado_em ASC
  `)
  return rows.map(r => ({ ...r, totalContas: Number(r.totalContas) }))
}

async function contarAdmins() {
  const { rows: [r] } = await pool.query(`SELECT COUNT(*) AS total FROM users WHERE role IN ('admin', 'super_admin') AND ativo = TRUE`)
  return Number(r.total)
}

async function contarSuperAdmins() {
  const { rows: [r] } = await pool.query(`SELECT COUNT(*) AS total FROM users WHERE role = 'super_admin' AND ativo = TRUE`)
  return Number(r.total)
}

async function atualizarRole(id, role) {
  const { rows: [user] } = await pool.query(
    `UPDATE users SET role = $1 WHERE id = $2 RETURNING id, email, role`,
    [role, id]
  )
  return user || null
}

async function atualizarAtivo(id, ativo) {
  const { rows: [user] } = await pool.query(
    `UPDATE users SET ativo = $1 WHERE id = $2 RETURNING id, email, ativo`,
    [ativo, id]
  )
  return user || null
}

module.exports = {
  buscarPorEmail, buscarPorId, buscarPorIdIncluindoInativo, buscarPorGoogleId, criar, criarComGoogle, vincularGoogleId,
  listarTodos, contarAdmins, contarSuperAdmins, atualizarRole, atualizarAtivo
}
