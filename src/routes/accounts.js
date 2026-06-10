const { Router } = require('express')
const repo = require('../repositories/contasRepository')

const router = Router()

// GET /api/accounts/stats  → dashboard
router.get('/stats', async (req, res) => {
  try {
    const stats = await repo.getDashboardStats()
    res.json(stats)
  } catch (e) {
    console.error(e)
    res.status(500).json({ erro: e.message })
  }
})

// GET /api/accounts
router.get('/', async (req, res) => {
  try {
    const { nicho, tipo, ativo } = req.query
    const contas = await repo.listarContas({
      nicho: nicho || null,
      tipo:  tipo  || null,
      ativo: ativo !== undefined ? ativo === 'true' : undefined,
    })
    res.json({ total: contas.length, data: contas })
  } catch (e) {
    res.status(500).json({ erro: e.message })
  }
})

// GET /api/accounts/:id
router.get('/:id', async (req, res) => {
  try {
    const conta = await repo.buscarContaPorId(Number(req.params.id))
    if (!conta) return res.status(404).json({ erro: 'Conta não encontrada' })
    res.json(conta)
  } catch (e) {
    res.status(500).json({ erro: e.message })
  }
})

// POST /api/accounts  → criar conta (modal "Conectar conta")
router.post('/', async (req, res) => {
  try {
    // Aceita tanto criação rápida (name+platform+group) quanto completa
    const { name, platform, group, email, tipo, nicho_id, ...rest } = req.body

    let conta
    if (name && platform) {
      conta = await repo.criarContaRapida({ name, platform, group })
    } else {
      conta = await repo.criarConta({ email, tipo, nicho_id, ...rest })
    }

    res.status(201).json({ account: conta })
  } catch (e) {
    console.error(e)
    res.status(400).json({ erro: e.message })
  }
})

module.exports = router