const { Router } = require('express')
const repo = require('../repositories/contasRepository')
const { addLog } = require('../middleware/logger')
const { PLATFORMS, TIPOS, parseId, serverError } = require('../utils/http')

// Contas e conexões de redes sociais são sempre restritas ao dono, mesmo para
// admin/super_admin — cada pessoa só vê e gerencia as próprias redes sociais
// no uso normal do painel. Ver [[project_isolamento_contas_admin]].

const router = Router()

// GET /api/accounts/stats  → dashboard
router.get('/stats', async (req, res) => {
  try {
    const stats = await repo.getDashboardStats(req.user.id, false)
    res.json(stats)
  } catch (e) {
    serverError(res, e)
  }
})

// GET /api/accounts
router.get('/', async (req, res) => {
  try {
    const { platform, tipo, ativo } = req.query

    if (platform !== undefined && !PLATFORMS.includes(platform)) {
      return res.status(400).json({ erro: `platform inválida. Use um de: ${PLATFORMS.join(', ')}` })
    }
    if (tipo !== undefined && !TIPOS.includes(tipo)) {
      return res.status(400).json({ erro: `tipo inválido. Use um de: ${TIPOS.join(', ')}` })
    }

    const contas = await repo.listarContas({
      platform: platform || null,
      tipo:  tipo  || null,
      ativo: ativo !== undefined ? ativo === 'true' : undefined,
      userId: req.user.id,
      isAdmin: false,
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

    const conta = await repo.buscarContaPorId(id, req.user.id, false)
    if (!conta) return res.status(404).json({ erro: 'Conta não encontrada' })
    res.json(conta)
  } catch (e) {
    serverError(res, e)
  }
})

// POST /api/accounts  → criar conta (modal "Conectar conta")
router.post('/', async (req, res) => {
  try {
    const { name, platform, tipo } = req.body

    if (name !== undefined && (typeof name !== 'string' || name.length > 200))
      return res.status(400).json({ erro: 'Nome da conta inválido.' })
    if (!PLATFORMS.includes(platform)) {
      return res.status(400).json({ erro: `platform inválida. Use um de: ${PLATFORMS.join(', ')}` })
    }

    let conta
    if (name) {
      conta = await repo.criarContaRapida({ name, platform, userId: req.user.id })
    } else {
      if (tipo !== undefined && !TIPOS.includes(tipo)) {
        return res.status(400).json({ erro: `tipo inválido. Use um de: ${TIPOS.join(', ')}` })
      }
      conta = await repo.criarConta({ platform, handle: req.body.handle, tipo, userId: req.user.id })
    }

    res.status(201).json({ account: conta })
  } catch (e) {
    serverError(res, e, 'Não foi possível criar a conta')
  }
})

// DELETE /api/accounts/:id
router.delete('/:id', async (req, res) => {
  try {
    const id = parseId(req.params.id)
    if (id === null) return res.status(400).json({ erro: 'id inválido' })

    const ok = await repo.deletarConta(id, req.user.id, false)
    if (!ok) return res.status(404).json({ erro: 'Conta não encontrada' })

    addLog('info', `Conta ID ${id} deletada`)
    res.json({ deleted: true })
  } catch (e) {
    serverError(res, e)
  }
})

module.exports = router