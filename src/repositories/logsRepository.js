const pool = require('../db/pool')
const { safeMessage } = require('../utils/redact')

// Um log "pertence" a um usuário se a conta associada (conta_id) for dele,
// ou se o log foi gravado diretamente com o user_id dele (ex: erro antes de
// existir uma conta/token, como falha de OAuth ou post sem conta conectada).
// Logs sem conta_id nem user_id (eventos gerais do sistema) não pertencem a
// nenhuma sessão de usuário e nunca entram no histórico privado.
async function logVisivelPara(log, userId, isAdmin) {
  if (userId !== null && userId !== undefined) {
    if (log.user_id) return log.user_id === userId
    if (!log.conta_id) return false
  } else if (isAdmin) {
    return true
  } else {
    return false
  }
  if (!log.conta_id) return false
  const { rows: [row] } = await pool.query(`SELECT user_id FROM contas WHERE id = $1`, [log.conta_id])
  return row && row.user_id === userId
}

async function registrarLog({ type, message, platform = null, conta_id = null, user_id = null }) {
  const { rows: [log] } = await pool.query(`
    INSERT INTO logs (type, message, platform, conta_id, user_id)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING *
  `, [type, safeMessage(message), platform, conta_id, user_id])

  return log
}

async function listarLogs(limit = 50, userId, isAdmin) {
  const hasUserScope = userId !== null && userId !== undefined
  const where = hasUserScope
    ? `WHERE l.user_id = $2 OR l.conta_id IN (SELECT id FROM contas WHERE user_id = $2)`
    : (isAdmin ? '' : 'WHERE FALSE')
  const params = hasUserScope ? [limit, userId] : [limit]
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
  const hasUserScope = userId !== null && userId !== undefined
  const where = hasUserScope
    ? 'WHERE l.id > $1 AND (l.user_id = $2 OR l.conta_id IN (SELECT id FROM contas WHERE user_id = $2))'
    : (isAdmin ? 'WHERE l.id > $1' : 'WHERE FALSE')
  const params = hasUserScope ? [lastId, userId] : [lastId]
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
  if (userId !== null && userId !== undefined) {
    await pool.query(`DELETE FROM logs WHERE user_id = $1 OR conta_id IN (SELECT id FROM contas WHERE user_id = $1)`, [userId])
  } else if (isAdmin) {
    await pool.query(`DELETE FROM logs`)
  }
}

// Grava um evento nomeado (ex: 'post_published', 'youtube_video_ready') para
// consumo via polling — substitui o antigo broadcast via SSE, que dependia de
// uma conexão persistente que não existe em ambiente serverless. postUserId
// null significa evento geral, sem escopo de usuário.
async function broadcastEvent(eventName, data, postUserId = null) {
  await pool.query(
    `INSERT INTO app_events (event_name, payload, user_id) VALUES ($1, $2, $3)`,
    [eventName, JSON.stringify(data), postUserId]
  )
}

// Eventos mais recentes que lastId, sempre limitados ao usuário autenticado.
async function listarEventosDesde(lastId, userId, isAdmin) {
  const hasUserScope = userId !== null && userId !== undefined
  const where = hasUserScope
    ? 'WHERE id > $1 AND user_id = $2'
    : (isAdmin ? 'WHERE id > $1' : 'WHERE FALSE')
  const params = hasUserScope ? [lastId, userId] : [lastId]
  const { rows } = await pool.query(`
    SELECT id, event_name, payload, criado_em AS timestamp
    FROM app_events
    ${where}
    ORDER BY id ASC
    LIMIT 200
  `, params)
  return rows
}

// Remove logs e eventos com mais de 30 dias — sem isso, as tabelas crescem
// indefinidamente (todo post, toda renovação de token, todo erro gera uma
// linha) e pesam cada vez mais a base. Chamado pelo cron diário; mantém só o
// histórico recente, que é o que de fato importa para depuração.
async function limparAntigos() {
  const { rowCount: logsRemovidos } = await pool.query(
    `DELETE FROM logs WHERE criado_em < NOW() - INTERVAL '30 days'`
  )
  const { rowCount: eventosRemovidos } = await pool.query(
    `DELETE FROM app_events WHERE criado_em < NOW() - INTERVAL '30 days'`
  )
  return { logsRemovidos, eventosRemovidos }
}

module.exports = {
  registrarLog, listarLogs, listarLogsDesde, limparLogs,
  broadcastEvent, listarEventosDesde, limparAntigos
}
