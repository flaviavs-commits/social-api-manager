const pool = require('../db/pool')

// Clientes SSE conectados: Map<res, { userId, isAdmin }>
const sseClients = new Map()

// Um log "pertence" a um usuário se a conta associada (conta_id) for dele.
// Logs sem conta_id (eventos gerais do sistema) só vão para administradores.
async function logVisivelPara(log, userId, isAdmin) {
  if (isAdmin) return true
  if (!log.conta_id) return false
  const { rows: [row] } = await pool.query(`SELECT user_id FROM contas WHERE id = $1`, [log.conta_id])
  return row && row.user_id === userId
}

async function registrarLog({ type, message, platform = null, conta_id = null }) {
  const { rows: [log] } = await pool.query(`
    INSERT INTO logs (type, message, platform, conta_id)
    VALUES ($1, $2, $3, $4)
    RETURNING *
  `, [type, message, platform, conta_id])

  // Broadcast só para clientes que podem ver esse log (dono da conta ou admin)
  const payload = JSON.stringify({
    id:        log.id,
    type:      log.type,
    message:   log.message,
    platform:  log.platform,
    timestamp: log.criado_em,
  })

  for (const [res, client] of sseClients) {
    const visivel = await logVisivelPara(log, client.userId, client.isAdmin)
    if (!visivel) continue
    try { res.write(`data: ${payload}\n\n`) }
    catch { sseClients.delete(res) }
  }

  return log
}

async function listarLogs(limit = 50, userId, isAdmin) {
  const where = isAdmin ? '' : `WHERE l.conta_id IN (SELECT id FROM contas WHERE user_id = $2)`
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

async function limparLogs(userId, isAdmin) {
  if (isAdmin) {
    await pool.query(`DELETE FROM logs`)
  } else {
    await pool.query(`DELETE FROM logs WHERE conta_id IN (SELECT id FROM contas WHERE user_id = $1)`, [userId])
  }
}

function adicionarClienteSSE(res, userId, isAdmin) {
  sseClients.set(res, { userId, isAdmin })
  res.on('close', () => sseClients.delete(res))
}

// Envia um evento SSE customizado (ex: 'post_published') só para o dono ou admins
async function broadcastEvent(eventName, data, postUserId = null) {
  const payload = JSON.stringify(data)
  for (const [res, client] of sseClients) {
    if (postUserId !== null && !client.isAdmin && client.userId !== postUserId) continue
    try { res.write(`event: ${eventName}\ndata: ${payload}\n\n`) }
    catch { sseClients.delete(res) }
  }
}

module.exports = { registrarLog, listarLogs, limparLogs, adicionarClienteSSE, broadcastEvent }