const pool = require('../db/pool')
const { encrypt, decrypt } = require('../services/tokenCrypto')

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

// ── 2FA (TOTP) ─────────────────────────────────────────────────────────────
// Guarda o segredo cifrado e (durante o setup) ainda não habilitado — só vira
// enabled depois que o usuário confirma o primeiro código (ativarTotp).
async function salvarSegredoTotp(userId, segredo) {
  await pool.query(
    `UPDATE users SET totp_secret = $1, totp_enabled = FALSE WHERE id = $2`,
    [encrypt(segredo), userId]
  )
}

async function ativarTotp(userId) {
  await pool.query(`UPDATE users SET totp_enabled = TRUE WHERE id = $1`, [userId])
}

async function desativarTotp(userId) {
  await pool.query(`UPDATE users SET totp_secret = NULL, totp_enabled = FALSE WHERE id = $1`, [userId])
}

// Retorna o segredo TOTP decifrado e se está habilitado. Usado tanto na
// confirmação do setup quanto na validação durante o reset de senha.
async function buscarTotp(userIdOrEmail, porEmail = false) {
  const campo = porEmail ? 'email' : 'id'
  const valor = porEmail ? String(userIdOrEmail).trim().toLowerCase() : userIdOrEmail
  const { rows: [row] } = await pool.query(
    `SELECT id, totp_secret, totp_enabled FROM users WHERE ${campo} = $1 AND ativo = TRUE`,
    [valor]
  )
  if (!row) return null
  return {
    userId: row.id,
    secret: row.totp_secret ? decrypt(row.totp_secret) : null,
    enabled: row.totp_enabled
  }
}

async function atualizarAvatar(userId, avatarUrl) {
  const { rows: [user] } = await pool.query(
    `UPDATE users SET avatar_url = $1 WHERE id = $2 RETURNING id, avatar_url AS "avatarUrl"`,
    [avatarUrl, userId]
  )
  return user || null
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
  atualizarAvatar, salvarSegredoTotp, ativarTotp, desativarTotp, buscarTotp,
  listarTodos, contarAdmins, contarSuperAdmins, atualizarRole, atualizarAtivo
}
