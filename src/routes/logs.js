const { Router } = require('express')
const repo = require('../repositories/logsRepository')

const router = Router()

// GET /api/logs  → histórico
router.get('/', async (req, res) => {
  try {
    const limit = Number(req.query.limit) || 50
    const logs = await repo.listarLogs(limit)
    res.json({ logs })
  } catch (e) {
    res.status(500).json({ erro: e.message })
  }
})

// GET /api/logs/stream  → SSE em tempo real
router.get('/stream', (req, res) => {
  res.setHeader('Content-Type',  'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection',    'keep-alive')
  res.flushHeaders()

  repo.adicionarClienteSSE(res)

  // Heartbeat a cada 25s para manter conexão viva
  const hb = setInterval(() => {
    try { res.write(': ping\n\n') } catch { clearInterval(hb) }
  }, 25000)

  req.on('close', () => clearInterval(hb))
})

// DELETE /api/logs
router.delete('/', async (req, res) => {
  try {
    await repo.limparLogs()
    res.status(204).send()
  } catch (e) {
    res.status(500).json({ erro: e.message })
  }
})

module.exports = router