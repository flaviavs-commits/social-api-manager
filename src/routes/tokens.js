const { Router } = require('express')
const repo = require('../repositories/tokensRepository')

const router = Router()

router.get('/', async (req, res) => {
  try {
    const tokens = await repo.listarTokens(req.query)
    res.json({ tokens })
  } catch (e) {
    res.status(500).json({ erro: e.message })
  }
})

router.post('/', async (req, res) => {
  try {
    const { accountId, platform, accessToken, refreshToken, expiresAt, accountName } = req.body
    if (!accountId || !platform || !accessToken)
      return res.status(400).json({ erro: 'accountId, platform e accessToken são obrigatórios' })
    const token = await repo.salvarToken({ accountId, platform, accessToken, refreshToken, expiresAt, accountName })
    res.status(201).json(token)
  } catch (e) {
    res.status(400).json({ erro: e.message })
  }
})

router.post('/renew-all', async (req, res) => {
  try {
    const result = await repo.renovarTodos()
    res.json(result)
  } catch (e) {
    res.status(500).json({ erro: e.message })
  }
})

router.post('/renew/:id', async (req, res) => {
  try {
    const result = await repo.renovarToken(Number(req.params.id))
    res.json(result)
  } catch (e) {
    res.status(500).json({ erro: e.message })
  }
})

router.delete('/:id', async (req, res) => {
  try {
    const ok = await repo.deletarToken(Number(req.params.id))
    if (!ok) return res.status(404).json({ erro: 'Token não encontrado' })
    res.status(204).send()
  } catch (e) {
    res.status(500).json({ erro: e.message })
  }
})

module.exports = router
