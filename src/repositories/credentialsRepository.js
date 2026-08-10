const pool = require('../db/pool')
const crypto = require('crypto')

function hashResetToken(token) {
  return `sha256:${crypto.createHash('sha256').update(String(token)).digest('hex')}`
}

async function criar(userId, passwordHash) {
  await pool.query(
    `INSERT INTO credentials (user_id, password_hash) VALUES ($1, $2)`,
    [userId, passwordHash]
  )
}

async function buscarPorUserId(userId) {
  const { rows: [cred] } = await pool.query(
    `SELECT id, user_id, password_hash FROM credentials WHERE user_id = $1`,
    [userId]
  )
  return cred || null
}

async function atualizarSenha(userId, passwordHash) {
  await pool.query(
    `UPDATE credentials SET password_hash = $1, reset_token = NULL, reset_token_expires = NULL, atualizado_em = NOW() WHERE user_id = $2`,
    [passwordHash, userId]
  )
}

// Troca a senha e invalida o token de reset numa única operação atômica,
// condicionada ao token ainda estar válido — evita que duas requisições
// concorrentes com o mesmo token consigam trocar a senha duas vezes.
async function atualizarSenhaPorResetToken(token, passwordHash) {
  const tokenHash = hashResetToken(token)
  const { rows: [cred] } = await pool.query(
    `UPDATE credentials
     SET password_hash = $1, reset_token = NULL, reset_token_expires = NULL, atualizado_em = NOW()
     WHERE reset_token = $2 AND reset_token_expires > NOW()
     RETURNING user_id`,
    [passwordHash, tokenHash]
  )
  return cred || null
}

async function gerarTokenReset(userId) {
  const token = crypto.randomBytes(32).toString('hex')
  const expira = new Date(Date.now() + 60 * 60 * 1000)
  await pool.query(
    `UPDATE credentials SET reset_token = $1, reset_token_expires = $2 WHERE user_id = $3`,
    [hashResetToken(token), expira.toISOString(), userId]
  )
  return token
}

async function buscarPorResetToken(token) {
  const tokenHash = hashResetToken(token)
  const { rows: [cred] } = await pool.query(
    `SELECT c.user_id, c.reset_token_expires, u.email FROM credentials c
     JOIN users u ON u.id = c.user_id
     WHERE c.reset_token = $1 AND c.reset_token_expires > NOW()`,
    [tokenHash]
  )
  return cred || null
}

async function limparTokenReset(userId) {
  await pool.query(
    `UPDATE credentials SET reset_token = NULL, reset_token_expires = NULL WHERE user_id = $1`,
    [userId]
  )
}

module.exports = { criar, buscarPorUserId, atualizarSenha, atualizarSenhaPorResetToken, gerarTokenReset, buscarPorResetToken, limparTokenReset }
