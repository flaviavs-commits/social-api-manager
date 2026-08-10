const accounts = require('../../repositories/contasRepository')
const zernioClient = require('../../infra/social/zernioClient')
const { addLog } = require('../../middleware/logger')
const { PLATFORMS, TIPOS, parseId, serverError } = require('../../utils/http')

async function reconciliarContasZernio(userId) {
  const locais = await accounts.listarIdsZernioDoUsuario(userId)
  if (!locais.length) return

  try {
    const resposta = await zernioClient.listAccounts()
    const idsAtivos = (resposta.accounts || []).map(account => account._id).filter(Boolean)
    const removidas = await accounts.removerContasZernioAusentes(userId, idsAtivos)
    if (removidas) addLog('info', `${removidas} conexão(ões) removida(s) após sincronização com o Zernio`, null, null, userId)
  } catch (error) {
    // Falha no provedor não deve impedir o usuário de ver e gerenciar as
    // contas locais, nem deve ser interpretada como exclusão remota.
    addLog('warn', `Não foi possível sincronizar exclusões do Zernio: ${error.message}`, null, null, userId)
  }
}

async function getStats(req, res) {
  try { res.json(await accounts.getDashboardStats(req.user.id, false)) }
  catch (error) { serverError(res, error) }
}

async function list(req, res) {
  try {
    const { platform, tipo, ativo } = req.query
    if (platform !== undefined && !PLATFORMS.includes(platform)) return res.status(400).json({ erro: `platform inválida. Use um de: ${PLATFORMS.join(', ')}` })
    if (tipo !== undefined && !TIPOS.includes(tipo)) return res.status(400).json({ erro: `tipo inválido. Use um de: ${TIPOS.join(', ')}` })
    await reconciliarContasZernio(req.user.id)
    const data = await accounts.listarContas({ platform: platform || null, tipo: tipo || null, ativo: ativo !== undefined ? ativo === 'true' : undefined, userId: req.user.id, isAdmin: false })
    res.json({ total: data.length, data })
  } catch (error) { serverError(res, error) }
}

async function getById(req, res) {
  try {
    const id = parseId(req.params.id)
    if (id === null) return res.status(400).json({ erro: 'id inválido' })
    const account = await accounts.buscarContaPorId(id, req.user.id, false)
    if (!account) return res.status(404).json({ erro: 'Conta não encontrada' })
    res.json(account)
  } catch (error) { serverError(res, error) }
}

async function create(req, res) {
  try {
    const { name, platform, tipo } = req.body
    if (name !== undefined && (typeof name !== 'string' || name.length > 200)) return res.status(400).json({ erro: 'Nome da conta inválido.' })
    if (!PLATFORMS.includes(platform)) return res.status(400).json({ erro: `platform inválida. Use um de: ${PLATFORMS.join(', ')}` })
    if (!name && tipo !== undefined && !TIPOS.includes(tipo)) return res.status(400).json({ erro: `tipo inválido. Use um de: ${TIPOS.join(', ')}` })
    const account = name
      ? await accounts.criarContaRapida({ name, platform, userId: req.user.id })
      : await accounts.criarConta({ platform, handle: req.body.handle, tipo, userId: req.user.id })
    res.status(201).json({ account })
  } catch (error) { serverError(res, error, 'Não foi possível criar a conta') }
}

async function remove(req, res) {
  try {
    const id = parseId(req.params.id)
    if (id === null) return res.status(400).json({ erro: 'id inválido' })
    const removed = await accounts.deletarConta(id, req.user.id, false)
    if (!removed) return res.status(404).json({ erro: 'Conta não encontrada' })
    addLog('info', `Conta ID ${id} deletada`)
    res.json({ deleted: true })
  } catch (error) { serverError(res, error) }
}

module.exports = { getStats, list, getById, create, remove }
