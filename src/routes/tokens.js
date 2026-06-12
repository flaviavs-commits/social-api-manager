const { Router } = require('express')
const repo = require('../repositories/tokensRepository')
const { PLATFORMS, parseId, serverError } = require('../utils/http')

const router = Router()

router.get('/', async (req, res) => {
  try {
    const { status, platform } = req.query

    if (status !== undefined && !['valid', 'expiring', 'expired', 'error'].includes(status)) {
      return res.status(400).json({ erro: 'status inválido' })
    }
    if (platform !== undefined && !PLATFORMS.includes(platform)) {
      return res.status(400).json({ erro: `platform inválida. Use um de: ${PLATFORMS.join(', ')}` })
    }

    const tokens = await repo.listarTokens({ status, platform })
    res.json({ tokens })
  } catch (e) {
    serverError(res, e)
  }
})

router.post('/', async (req, res) => {
  try {
    const { accountId, platform, accessToken, refreshToken, expiresAt, accountName } = req.body
    if (!accountId || !platform || !accessToken)
      return res.status(400).json({ erro: 'accountId, platform e accessToken são obrigatórios' })
    if (!PLATFORMS.includes(platform))
      return res.status(400).json({ erro: `platform inválida. Use um de: ${PLATFORMS.join(', ')}` })

    const accId = parseId(accountId)
    if (accId === null) return res.status(400).json({ erro: 'accountId inválido' })

    const token = await repo.salvarToken({ accountId: accId, platform, accessToken, refreshToken, expiresAt, accountName })
    res.status(201).json(token)
  } catch (e) {
    serverError(res, e, 'Não foi possível salvar o token')
  }
})

router.post('/renew-all', async (req, res) => {
  try {
    const result = await repo.renovarTodos()
    res.json(result)
  } catch (e) {
    serverError(res, e)
  }
})

router.post('/renew/:id', async (req, res) => {
  try {
    const id = parseId(req.params.id)
    if (id === null) return res.status(400).json({ erro: 'id inválido' })

    const result = await repo.renovarToken(id)
    res.json(result)
  } catch (e) {
    serverError(res, e)
  }
})

router.delete('/:id', async (req, res) => {
  try {
    const id = parseId(req.params.id)
    if (id === null) return res.status(400).json({ erro: 'id inválido' })

    const ok = await repo.deletarToken(id)
    if (!ok) return res.status(404).json({ erro: 'Token não encontrado' })
    res.status(204).send()
  } catch (e) {
    serverError(res, e)
  }
})

module.exports = router
