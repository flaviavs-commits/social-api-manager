const pool = require('../db/pool')
const { encrypt, decrypt } = require('../services/tokenCrypto')

// Normaliza e-mails antes de gravar/consultar: remove espaços nas pontas e
// força minúsculas, evitando que " a@b.com " e "a@b.com" sejam tratados
// como contas diferentes.
function normalizarEmail(email) {
  return email.trim().toLowerCase()
}

const USER_COLS = 'id, email, role, plan, plan_active AS "planActive", plan_unrestricted, allowed_platforms AS "allowedPlatforms", full_name, avatar_url, totp_enabled, google_id, notification_preferences AS "notificationPreferences", ativo, criado_em, auth_tokens_invalidated_at'

async function buscarPorEmail(email) {
  const { rows: [user] } = await pool.query(
    `SELECT ${USER_COLS} FROM users WHERE email = $1 AND ativo = TRUE`,
    [normalizarEmail(email)]
  )
  return user || null
}

async function buscarPorId(id) {
  const { rows: [user] } = await pool.query(
    `SELECT ${USER_COLS} FROM users WHERE id = $1 AND ativo = TRUE`,
    [id]
  )
  return user || null
}

// Busca incluindo contas desativadas — usado em checagens de autorização
// administrativas, onde precisamos saber o papel do alvo mesmo se ele já
// estiver inativo (ex: impedir que um admin comum reative outro admin).
async function buscarPorIdIncluindoInativo(id) {
  const { rows: [user] } = await pool.query(
    `SELECT ${USER_COLS} FROM users WHERE id = $1`,
    [id]
  )
  return user || null
}

async function buscarPorGoogleId(googleId) {
  const { rows: [user] } = await pool.query(
    `SELECT ${USER_COLS} FROM users WHERE google_id = $1 AND ativo = TRUE`,
    [googleId]
  )
  return user || null
}

async function criar({ email, fullName, plan = 'basico', allowedPlatforms = ['instagram', 'youtube', 'tiktok', 'facebook'] }) {
  const { rows: [user] } = await pool.query(
    `INSERT INTO users (email, full_name, plan, plan_active, plan_unrestricted, allowed_platforms)
     VALUES ($1, $2, $3, FALSE, FALSE, $4::text[])
     RETURNING id, email, full_name AS "fullName"`,
    [normalizarEmail(email), fullName || null, plan, allowedPlatforms]
  )
  return user
}

async function criarComGoogle({ email, fullName, googleId, plan = 'basico', allowedPlatforms = ['instagram', 'youtube', 'tiktok', 'facebook'] }) {
  const { rows: [user] } = await pool.query(
    `INSERT INTO users (email, full_name, google_id, plan, plan_active, plan_unrestricted, allowed_platforms)
     VALUES ($1, $2, $3, $4, FALSE, FALSE, $5::text[])
     RETURNING id, email, full_name AS "fullName"`,
    [normalizarEmail(email), fullName || null, googleId, plan, allowedPlatforms]
  )
  return user
}

async function vincularGoogleId(userId, googleId) {
  await pool.query(`UPDATE users SET google_id = $1 WHERE id = $2`, [googleId, userId])
}

async function buscarZernioProfileId(userId) {
  const { rows: [row] } = await pool.query(
    'SELECT zernio_profile_id AS "zernioProfileId" FROM users WHERE id = $1 AND ativo = TRUE',
    [userId]
  )
  return row?.zernioProfileId || null
}

async function salvarZernioProfileId(userId, profileId) {
  const { rows: [row] } = await pool.query(
    `UPDATE users
        SET zernio_profile_id = $1
      WHERE id = $2 AND ativo = TRUE
        AND (zernio_profile_id IS NULL OR zernio_profile_id = $1)
      RETURNING zernio_profile_id AS "zernioProfileId"`,
    [profileId, userId]
  )
  if (!row) throw new Error('Não foi possível vincular o perfil de conexão ao cliente')
  return row.zernioProfileId
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

async function buscarPerfil(userId) {
  const { rows: [user] } = await pool.query(`
    SELECT id, email, full_name AS "fullName", role, avatar_url AS "avatarUrl",
           totp_enabled AS "totpEnabled", google_id IS NOT NULL AS "googleConnected",
           plan, plan_active AS "planActive", timezone, language, default_platform AS "defaultPlatform",
           notification_preferences AS "notificationPreferences", criado_em AS "createdAt"
    FROM users WHERE id = $1 AND ativo = TRUE
  `, [userId])
  return user || null
}

async function atualizarPerfil(userId, { fullName, timezone, language, defaultPlatform, notificationPreferences }) {
  const { rows: [user] } = await pool.query(`
    UPDATE users
    SET full_name = $1, timezone = $2, language = $3, default_platform = $4,
        notification_preferences = $5::jsonb
    WHERE id = $6 AND ativo = TRUE
    RETURNING id, email, full_name AS "fullName", role, avatar_url AS "avatarUrl",
              totp_enabled AS "totpEnabled", google_id IS NOT NULL AS "googleConnected",
              plan, plan_active AS "planActive", timezone, language, default_platform AS "defaultPlatform",
              notification_preferences AS "notificationPreferences", criado_em AS "createdAt"
  `, [fullName, timezone, language, defaultPlatform || null, JSON.stringify(notificationPreferences), userId])
  return user || null
}

async function invalidarSessoes(userId) {
  await pool.query(`UPDATE users SET auth_tokens_invalidated_at = NOW() WHERE id = $1`, [userId])
}

// ── Administração ────────────────────────────────────────────────────────────

async function listarTodos(userId) {
  if (userId === null || userId === undefined) return []
  const { rows } = await pool.query(`
    SELECT
      u.id, u.email, u.full_name AS "fullName", u.role, u.ativo, u.criado_em AS "criadoEm",
      COUNT(c.id) AS "totalContas"
    FROM users u
    LEFT JOIN contas c ON c.user_id = u.id
    WHERE u.id = $1
    GROUP BY u.id
    ORDER BY u.criado_em ASC
  `, [userId])
  return rows.map(r => ({ ...r, totalContas: Number(r.totalContas) }))
}

// Exceção documentada e deliberada à política de "admin não vê dado de
// outra conta" (server.js): só números agregados, sem nenhum dado
// individual (nome, e-mail, id) — decisão registrada no IA.md de
// 10/09/2026, Trilha B, pergunta feita explicitamente ao usuário antes de
// implementar. Usada pelo dashboard do painel admin.
async function obterMetricasAgregadas() {
  const [porPlano, porSituacao, total] = await Promise.all([
    pool.query(`SELECT plan, COUNT(*) AS total FROM users WHERE ativo = TRUE GROUP BY plan`),
    pool.query(`SELECT ativo, COUNT(*) AS total FROM users GROUP BY ativo`),
    pool.query(`SELECT COUNT(*) AS total FROM users`),
  ])
  return {
    totalUsuarios: Number(total.rows[0]?.total || 0),
    porPlano: Object.fromEntries(porPlano.rows.map(r => [r.plan, Number(r.total)])),
    ativos: Number(porSituacao.rows.find(r => r.ativo === true)?.total || 0),
    desativados: Number(porSituacao.rows.find(r => r.ativo === false)?.total || 0),
  }
}

// Reaproveitado entre toda assinatura futura do mesmo usuário (task
// "checkout em modo assinatura"), para não criar um Stripe Customer
// duplicado a cada checkout. Ver src/db/migrations/077_subscriptions.sql.
async function salvarStripeCustomerId(userId, stripeCustomerId) {
  const { rows: [user] } = await pool.query(
    `UPDATE users SET stripe_customer_id = $1 WHERE id = $2 RETURNING id, stripe_customer_id AS "stripeCustomerId"`,
    [stripeCustomerId, userId]
  )
  return user || null
}

async function buscarPorStripeCustomerId(stripeCustomerId) {
  const { rows: [user] } = await pool.query(
    `SELECT ${USER_COLS} FROM users WHERE stripe_customer_id = $1 AND ativo = TRUE`,
    [stripeCustomerId]
  )
  return user || null
}

async function contarAdmins() {
  const { rows: [r] } = await pool.query(`SELECT COUNT(*) AS total FROM users WHERE role = 'admin' AND ativo = TRUE`)
  return Number(r.total)
}

async function contarSuperAdmins() {
  const { rows: [r] } = await pool.query(`SELECT COUNT(*) AS total FROM users WHERE role = 'super_admin' AND ativo = TRUE`)
  return Number(r.total)
}

// Usado pelo alerta de pagamento não vinculado: todo admin ativo recebe o
// aviso (decisão registrada no IA.md de 10/09/2026). super_admin também
// entra — hoje é convertido em admin a cada boot (runtimeMigrations.js), mas
// incluir os dois papéis evita depender dessa conversão já ter rodado.
async function listarEmailsAdmins() {
  const { rows } = await pool.query(
    `SELECT email FROM users WHERE role IN ('admin', 'super_admin') AND ativo = TRUE ORDER BY email`
  )
  return rows.map(row => row.email)
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
  buscarZernioProfileId, salvarZernioProfileId,
  atualizarAvatar, buscarPerfil, atualizarPerfil, invalidarSessoes, salvarSegredoTotp, ativarTotp, desativarTotp, buscarTotp,
  listarTodos, obterMetricasAgregadas, contarAdmins, contarSuperAdmins, listarEmailsAdmins, atualizarRole, atualizarAtivo,
  salvarStripeCustomerId, buscarPorStripeCustomerId
}
