const users = require('../../repositories/usersRepository')
const { parseId, serverError } = require('../../utils/http')
const { invalidarCacheUsuario } = require('../../middleware/requireAuth')

async function listUsers(req, res) {
  try { res.json({ data: await users.listarTodos(req.user.id) }) }
  catch (error) { serverError(res, error) }
}

async function updateRole(req, res) {
  try {
    const id = parseId(req.params.id)
    if (id === null) return res.status(400).json({ erro: 'id inválido' })
    if (id !== req.user.id) return res.status(403).json({ erro: 'Você não pode alterar o papel de outra conta.' })
    if (!['admin', 'user'].includes(req.body.role)) return res.status(400).json({ erro: 'role deve ser "admin" ou "user"' })
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
    if (id !== req.user.id) return res.status(403).json({ erro: 'Você não pode alterar outra conta.' })
    if (typeof req.body.ativo !== 'boolean') return res.status(400).json({ erro: 'ativo deve ser true ou false' })
    if (!req.body.ativo && id === req.user.id) return res.status(400).json({ erro: 'Você não pode desativar sua própria conta.' })
    const user = await users.atualizarAtivo(id, req.body.ativo)
    if (!user) return res.status(404).json({ erro: 'Usuário não encontrado' })
    invalidarCacheUsuario(id)
    res.json({ user })
  } catch (error) { serverError(res, error, 'Não foi possível atualizar o usuário') }
}

module.exports = { listUsers, updateRole, updateActive }
