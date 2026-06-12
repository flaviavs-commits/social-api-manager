const { Router } = require('express')
const repo = require('../repositories/contasRepository')
const { PLATFORMS, TIPOS, parseId, serverError } = require('../utils/http')

const router = Router()

// GET /api/accounts/stats  → dashboard
router.get('/stats', async (req, res) => {
  try {
    const stats = await repo.getDashboardStats()
    res.json(stats)
  } catch (e) {
    serverError(res, e)
  }
})

// GET /api/accounts
router.get('/', async (req, res) => {
  try {
    const { nicho, tipo, ativo } = req.query

    if (tipo !== undefined && !TIPOS.includes(tipo)) {
      return res.status(400).json({ erro: `tipo inválido. Use um de: ${TIPOS.join(', ')}` })
    }

    const contas = await repo.listarContas({
      nicho: nicho || null,
      tipo:  tipo  || null,
      ativo: ativo !== undefined ? ativo === 'true' : undefined,
    })
    res.json({ total: contas.length, data: contas })
  } catch (e) {
    serverError(res, e)
  }
})

// GET /api/accounts/:id
router.get('/:id', async (req, res) => {
  try {
    const id = parseId(req.params.id)
    if (id === null) return res.status(400).json({ erro: 'id inválido' })

    const conta = await repo.buscarContaPorId(id)
    if (!conta) return res.status(404).json({ erro: 'Conta não encontrada' })
    res.json(conta)
  } catch (e) {
    serverError(res, e)
  }
})

// POST /api/accounts  → criar conta (modal "Conectar conta")
router.post('/', async (req, res) => {
  try {
    // Aceita tanto criação rápida (name+platform+group) quanto completa
    const { name, platform, group, email, tipo, nicho_id, ...rest } = req.body

    let conta
    if (name && platform) {
      if (!PLATFORMS.includes(platform)) {
        return res.status(400).json({ erro: `platform inválida. Use um de: ${PLATFORMS.join(', ')}` })
      }
      conta = await repo.criarContaRapida({ name, platform, group, email })
    } else {
      if (tipo !== undefined && !TIPOS.includes(tipo)) {
        return res.status(400).json({ erro: `tipo inválido. Use um de: ${TIPOS.join(', ')}` })
      }
      conta = await repo.criarConta({ email, tipo, nicho_id, ...rest })
    }

    res.status(201).json({ account: conta })
  } catch (e) {
    serverError(res, e, 'Não foi possível criar a conta')
  }
})

module.exports = router