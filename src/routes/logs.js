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

// GET /api/logs/since/:lastId  → logs novos desde o último id visto (polling)
// Substitui o antigo SSE (/stream): sem conexão persistente, o frontend chama
// isso a cada poucos segundos para buscar só o que ainda não viu.
router.get('/since/:lastId', async (req, res) => {
  try {
    const lastId = Number(req.params.lastId)
    if (!Number.isInteger(lastId) || lastId < 0) return res.status(400).json({ erro: 'lastId inválido' })
    const logs = await repo.listarLogsDesde(lastId, req.user.id, isAdminRole(req.user.role))
    res.json({ logs })
  } catch (e) {
    serverError(res, e)
  }
})

// GET /api/logs/events/since/:lastId  → eventos nomeados novos (post_published,
// youtube_video_ready) desde o último id visto — mesmo modelo de polling.
router.get('/events/since/:lastId', async (req, res) => {
  try {
    const lastId = Number(req.params.lastId)
    if (!Number.isInteger(lastId) || lastId < 0) return res.status(400).json({ erro: 'lastId inválido' })
    const events = await repo.listarEventosDesde(lastId, req.user.id, isAdminRole(req.user.role))
    res.json({ events })
  } catch (e) {
    serverError(res, e)
  }
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