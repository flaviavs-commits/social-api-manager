const users = require('../../repositories/usersRepository')
const requireSuperAdmin = require('../../middleware/requireSuperAdmin')
const { parseId, serverError, isAdminRole } = require('../../utils/http')
const { invalidarCacheUsuario } = require('../../middleware/requireAuth')

async function listUsers(_req, res) {
  try { res.json({ data: await users.listarTodos() }) }
  catch (error) { serverError(res, error) }
}

async function updateRole(req, res) {
  try {
    const id = parseId(req.params.id)
    if (id === null) return res.status(400).json({ erro: 'id inválido' })
    if (!['admin', 'user'].includes(req.body.role)) return res.status(400).json({ erro: 'role deve ser "admin" ou "user"' })
    if (id === req.user.id) {
      const totalSuperAdmins = await users.contarSuperAdmins()
      if (totalSuperAdmins <= 1) return res.status(400).json({ erro: 'Não é possível remover o único administrador principal do sistema.' })
    }
    const user = await users.atualizarRole(id, req.body.role)
    if (!user) return res.status(404).json({ erro: 'Usuário não encontrado' })
    invalidarCacheUsuario(id)
    res.json({ user })
  } catch (error) { serverError(res, error, 'Não foi possível atualizar o papel do usuário') }
}

async function updateActive(req, res) {
  try {
    const id = parseId(req.params.id)
    if (id === null) return res.status(400).json({ erro: 'id inválido' })
    if (typeof req.body.ativo !== 'boolean') return res.status(400).json({ erro: 'ativo deve ser true ou false' })
    if (!req.body.ativo && id === req.user.id) return res.status(400).json({ erro: 'Você não pode desativar sua própria conta.' })
    const target = await users.buscarPorIdIncluindoInativo(id)
    if (target && isAdminRole(target.role) && req.user.role !== 'super_admin') return res.status(403).json({ erro: 'Apenas o administrador principal pode alterar contas administrativas.' })
    const user = await users.atualizarAtivo(id, req.body.ativo)
    if (!user) return res.status(404).json({ erro: 'Usuário não encontrado' })
    invalidarCacheUsuario(id)
    res.json({ user })
  } catch (error) { serverError(res, error, 'Não foi possível atualizar o usuário') }
}

module.exports = { listUsers, updateRole: [requireSuperAdmin, updateRole], updateActive }
