const tokens = require('../../repositories/tokensRepository')
const accounts = require('../../repositories/contasRepository')
const { PLATFORMS, parseId, serverError } = require('../../utils/http')

const STATUSES = ['valid', 'expiring', 'expired', 'error']

async function list(req, res) {
  try {
    const { status, platform } = req.query
    if (status !== undefined && !STATUSES.includes(status)) return res.status(400).json({ erro: 'status inválido' })
    if (platform !== undefined && !PLATFORMS.includes(platform)) return res.status(400).json({ erro: `platform inválida. Use um de: ${PLATFORMS.join(', ')}` })
    res.json({ tokens: await tokens.listarTokens({ status, platform, userId: req.user.id, isAdmin: false }) })
  } catch (error) { serverError(res, error) }
}

async function create(req, res) {
  try {
    const { accountId, platform, accessToken, refreshToken, expiresAt, accountName } = req.body
    if (!accountId || !platform || !accessToken) return res.status(400).json({ erro: 'accountId, platform e accessToken são obrigatórios' })
    if (!PLATFORMS.includes(platform)) return res.status(400).json({ erro: `platform inválida. Use um de: ${PLATFORMS.join(', ')}` })
    const id = parseId(accountId)
    if (id === null) return res.status(400).json({ erro: 'accountId inválido' })
    if (!await accounts.buscarContaPorId(id, req.user.id, false)) return res.status(404).json({ erro: 'Conta não encontrada' })
    res.status(201).json(await tokens.salvarToken({ accountId: id, platform, accessToken, refreshToken, expiresAt, accountName }))
  } catch (error) { serverError(res, error, 'Não foi possível salvar o token') }
}

async function renewAll(req, res) {
  try { res.json(await tokens.renovarTodos(req.user.id, false)) }
  catch (error) { serverError(res, error) }
}

async function renew(req, res) {
  try {
    const id = parseId(req.params.id)
    if (id === null) return res.status(400).json({ erro: 'id inválido' })
    res.json(await tokens.renovarToken(id, req.user.id, false))
  } catch (error) { serverError(res, error) }
}

async function remove(req, res) {
  try {
    const id = parseId(req.params.id)
    if (id === null) return res.status(400).json({ erro: 'id inválido' })
    if (!await tokens.deletarToken(id, req.user.id, false)) return res.status(404).json({ erro: 'Token não encontrado' })
    res.status(204).send()
  } catch (error) { serverError(res, error) }
}

module.exports = { list, create, renewAll, renew, remove }
