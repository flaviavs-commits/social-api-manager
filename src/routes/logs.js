const { Router } = require('express')
const repo = require('../repositories/logsRepository')
const { serverError, isAdminRole } = require('../utils/http')

const router = Router()

// GET /api/logs  → histórico
router.get('/', async (req, res) => {
  try {
    const requested = Number(req.query.limit)
    const limit = Number.isInteger(requested) && requested > 0
      ? Math.min(requested, 200)
      : 50
    const logs = await repo.listarLogs(limit, req.user.id, isAdminRole(req.user.role))
    res.json({ logs })
  } catch (e) {
    serverError(res, e)
  }
})

// GET /api/logs/stream  → SSE em tempo real
router.get('/stream', (req, res) => {
  res.setHeader('Content-Type',  'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection',    'keep-alive')
  res.flushHeaders()

  repo.adicionarClienteSSE(res, req.user.id, isAdminRole(req.user.role))

  // Heartbeat a cada 25s para manter conexão viva
  const hb = setInterval(() => {
    try { res.write(': ping\n\n') } catch { clearInterval(hb) }
  }, 25000)

  req.on('close', () => clearInterval(hb))
})

// DELETE /api/logs
router.delete('/', async (req, res) => {
  try {
    await repo.limparLogs(req.user.id, isAdminRole(req.user.role))
    res.status(204).send()
  } catch (e) {
    serverError(res, e)
  }
})

module.exports = router