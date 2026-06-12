const pool = require('../db/pool')

// Clientes SSE conectados
const sseClients = new Set()

async function registrarLog({ type, message, platform = null, conta_id = null }) {
  const { rows: [log] } = await pool.query(`
    INSERT INTO logs (type, message, platform, conta_id)
    VALUES ($1, $2, $3, $4)
    RETURNING *
  `, [type, message, platform, conta_id])

  // Broadcast para todos os clientes SSE conectados
  const payload = JSON.stringify({
    id:        log.id,
    type:      log.type,
    message:   log.message,
    platform:  log.platform,
    timestamp: log.criado_em,
  })

  sseClients.forEach(res => {
    try { res.write(`data: ${payload}\n\n`) }
    catch { sseClients.delete(res) }
  })

  return log
}

async function listarLogs(limit = 50) {
  const { rows } = await pool.query(`
    SELECT id, type, message, platform, criado_em AS timestamp
    FROM logs
    ORDER BY criado_em DESC
    LIMIT $1
  `, [limit])
  return rows
}

async function limparLogs() {
  await pool.query(`DELETE FROM logs`)
}

function adicionarClienteSSE(res) {
  sseClients.add(res)
  res.on('close', () => sseClients.delete(res))
}

// Envia um evento SSE customizado (ex: 'post_published') para todos os clientes
function broadcastEvent(eventName, data) {
  const payload = JSON.stringify(data)
  sseClients.forEach(res => {
    try { res.write(`event: ${eventName}\ndata: ${payload}\n\n`) }
    catch { sseClients.delete(res) }
  })
}

module.exports = { registrarLog, listarLogs, limparLogs, adicionarClienteSSE, broadcastEvent }