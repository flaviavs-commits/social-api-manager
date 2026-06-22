const pool = require('../db/pool')

// Um log "pertence" a um usuário se a conta associada (conta_id) for dele,
// ou se o log foi gravado diretamente com o user_id dele (ex: erro antes de
// existir uma conta/token, como falha de OAuth ou post sem conta conectada).
// Logs sem conta_id nem user_id (eventos gerais do sistema) só vão para administradores.
async function logVisivelPara(log, userId, isAdmin) {
  if (isAdmin) return true
  if (log.user_id) return log.user_id === userId
  if (!log.conta_id) return false
  const { rows: [row] } = await pool.query(`SELECT user_id FROM contas WHERE id = $1`, [log.conta_id])
  return row && row.user_id === userId
}

async function registrarLog({ type, message, platform = null, conta_id = null, user_id = null }) {
  const { rows: [log] } = await pool.query(`
    INSERT INTO logs (type, message, platform, conta_id, user_id)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING *
  `, [type, message, platform, conta_id, user_id])

  return log
}

async function listarLogs(limit = 50, userId, isAdmin) {
  const where = isAdmin ? '' : `WHERE l.user_id = $2 OR l.conta_id IN (SELECT id FROM contas WHERE user_id = $2)`
  const params = isAdmin ? [limit] : [limit, userId]
  const { rows } = await pool.query(`
    SELECT l.id, l.type, l.message, l.platform, l.criado_em AS timestamp
    FROM logs l
    ${where}
    ORDER BY l.criado_em DESC
    LIMIT $1
  `, params)
  return rows
}

// Logs mais recentes que lastId, em ordem cronológica — usado pelo polling do
// frontend (substitui o SSE: sem conexão persistente, o cliente busca a cada
// poucos segundos só o que ainda não viu, identificado pelo id do último log
// recebido na rodada anterior).
async function listarLogsDesde(lastId, userId, isAdmin) {
  const where = isAdmin ? 'WHERE l.id > $1' : 'WHERE l.id > $1 AND (l.user_id = $2 OR l.conta_id IN (SELECT id FROM contas WHERE user_id = $2))'
  const params = isAdmin ? [lastId] : [lastId, userId]
  const { rows } = await pool.query(`
    SELECT l.id, l.type, l.message, l.platform, l.criado_em AS timestamp
    FROM logs l
    ${where}
    ORDER BY l.id ASC
    LIMIT 200
  `, params)
  return rows
}

async function limparLogs(userId, isAdmin) {
  if (isAdmin) {
    await pool.query(`DELETE FROM logs`)
  } else {
    await pool.query(`DELETE FROM logs WHERE conta_id IN (SELECT id FROM contas WHERE user_id = $1)`, [userId])
  }
}

// Grava um evento nomeado (ex: 'post_published', 'youtube_video_ready') para
// consumo via polling — substitui o antigo broadcast via SSE, que dependia de
// uma conexão persistente que não existe em ambiente serverless. postUserId
// null significa visível só para admins (mesma regra usada nos logs).
async function broadcastEvent(eventName, data, postUserId = null) {
  await pool.query(
    `INSERT INTO app_events (event_name, payload, user_id) VALUES ($1, $2, $3)`,
    [eventName, JSON.stringify(data), postUserId]
  )
}

// Eventos mais recentes que lastId, visíveis para o usuário (dele ou, se
// admin, todos) — mesmo modelo de cursor usado em listarLogsDesde.
async function listarEventosDesde(lastId, userId, isAdmin) {
  const where = isAdmin ? 'WHERE id > $1' : 'WHERE id > $1 AND (user_id = $2 OR user_id IS NULL)'
  const params = isAdmin ? [lastId] : [lastId, userId]
  const { rows } = await pool.query(`
    SELECT id, event_name, payload, criado_em AS timestamp
    FROM app_events
    ${where}
    ORDER BY id ASC
    LIMIT 200
  `, params)
  return rows
}

module.exports = {
  registrarLog, listarLogs, listarLogsDesde, limparLogs,
  broadcastEvent, listarEventosDesde
}
