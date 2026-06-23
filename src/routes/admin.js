const { Router } = require('express')
const usersRepo = require('../repositories/usersRepository')
const contasRepo = require('../repositories/contasRepository')
const requireSuperAdmin = require('../middleware/requireSuperAdmin')
const { parseId, serverError, isAdminRole } = require('../utils/http')

const router = Router()

// GET /api/admin/users
router.get('/users', async (req, res) => {
  try {
    const users = await usersRepo.listarTodos()
    res.json({ data: users })
  } catch (e) {
    serverError(res, e)
  }
})

// POST /api/admin/users/:id/role  { role: 'admin' | 'user' }  — somente super_admin
router.post('/users/:id/role', requireSuperAdmin, async (req, res) => {
  try {
    const id = parseId(req.params.id)
    if (id === null) return res.status(400).json({ erro: 'id inválido' })

    const { role } = req.body
    if (!['admin', 'user'].includes(role)) {
      return res.status(400).json({ erro: 'role deve ser "admin" ou "user"' })
    }

    if (id === req.user.id && req.user.role === 'super_admin') {
      const totalSuperAdmins = await usersRepo.contarSuperAdmins()
      if (totalSuperAdmins <= 1) {
        return res.status(400).json({ erro: 'Não é possível remover o único administrador principal do sistema.' })
      }
    }

    const user = await usersRepo.atualizarRole(id, role)
    if (!user) return res.status(404).json({ erro: 'Usuário não encontrado' })
    res.json({ user })
  } catch (e) {
    serverError(res, e, 'Não foi possível atualizar o papel do usuário')
  }
})

// POST /api/admin/users/:id/ativo  { ativo: true | false }
router.post('/users/:id/ativo', async (req, res) => {
  try {
    const id = parseId(req.params.id)
    if (id === null) return res.status(400).json({ erro: 'id inválido' })

    const { ativo } = req.body
    if (typeof ativo !== 'boolean') {
      return res.status(400).json({ erro: 'ativo deve ser true ou false' })
    }

    if (ativo === false && id === req.user.id) {
      return res.status(400).json({ erro: 'Você não pode desativar sua própria conta.' })
    }

    // Sem esta checagem, um admin comum poderia desativar outro admin ou o
    // super_admin (a rota só exige requireAdmin), tomando controle do sistema.
    // Só o super_admin pode ativar/desativar contas com papel administrativo.
    const alvo = await usersRepo.buscarPorIdIncluindoInativo(id)
    if (alvo && isAdminRole(alvo.role) && req.user.role !== 'super_admin') {
      return res.status(403).json({ erro: 'Apenas o administrador principal pode alterar contas administrativas.' })
    }

    const user = await usersRepo.atualizarAtivo(id, ativo)
    if (!user) return res.status(404).json({ erro: 'Usuário não encontrado' })
    res.json({ user })
  } catch (e) {
    serverError(res, e, 'Não foi possível atualizar o usuário')
  }
})

// GET /api/admin/accounts — todas as contas de redes sociais, de todos os usuários
router.get('/accounts', async (req, res) => {
  try {
    const contas = await contasRepo.listarContas({ isAdmin: true })
    res.json({ total: contas.length, data: contas })
  } catch (e) {
    serverError(res, e)
  }
})

module.exports = router
