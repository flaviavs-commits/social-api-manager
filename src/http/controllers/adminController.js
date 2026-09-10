const users = require('../../repositories/usersRepository')
const { parseId, serverError } = require('../../utils/http')
const { invalidarCacheUsuario } = require('../../middleware/requireAuth')
const billingService = require('../../services/billing/billingService')
const { addLog } = require('../../middleware/logger')

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
    await addLog('ok', `Papel alterado para "${req.body.role}".`, null, null, req.user.id)
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
    await addLog('ok', `Situação alterada para "${req.body.ativo ? 'ativo' : 'desativado'}".`, null, null, req.user.id)
    res.json({ user })
  } catch (error) { serverError(res, error, 'Não foi possível atualizar o usuário') }
}

// Resolve um e-mail específico para um usuário — não lista o diretório de
// contas (listUsers/listarTodos devolve só a própria conta do admin, por
// design: "O painel administrativo mostra somente a própria conta" em
// server.js). Isso é o que alimenta os fluxos de gerar link e vincular
// pagamento manualmente para um cliente: o admin já sabe o e-mail (veio de
// um contato do cliente, ou do relatório de conciliação) e só precisa
// resolvê-lo para um id. Consulta auditada como as demais.
async function searchUserByEmail(req, res) {
  try {
    const email = String(req.query.email || '').trim()
    if (!email) return res.status(400).json({ erro: 'Informe um e-mail.' })
    const target = await users.buscarPorEmail(email)
    if (!target) return res.status(404).json({ erro: 'Nenhum usuário encontrado com esse e-mail.' })
    await addLog('ok', `Consulta por e-mail: ${target.email} (usuário #${target.id}).`, null, null, req.user.id)
    res.json({ user: { id: target.id, email: target.email, fullName: target.fullName, plan: target.plan } })
  } catch (error) { serverError(res, error, 'Não foi possível buscar esse usuário agora.') }
}

// Gera o Payment Link do plano já com o client_reference_id do usuário-alvo
// (ver billingService.getPlanDirectLink), para casos em que o time precise
// mandar o link manualmente para um cliente. Toda geração fica registrada no
// log do próprio admin que a fez (auditoria) — um dos dois pontos do painel
// admin em que um admin acessa algo de outra conta (o outro é getPlanLink
// abaixo, para vincular manualmente um pagamento não conciliado).
async function getPlanLink(req, res) {
  try {
    const id = parseId(req.params.id)
    if (id === null) return res.status(400).json({ erro: 'id inválido' })
    const target = await users.buscarPorId(id)
    if (!target) return res.status(404).json({ erro: 'Usuário não encontrado' })
    const url = billingService.getPlanDirectLink({ plan: req.params.plan, userId: target.id, email: target.email })
    await addLog('ok', `Link de pagamento do plano "${req.params.plan}" gerado para ${target.email} (usuário #${target.id}).`, null, null, req.user.id)
    res.json({ url })
  } catch (error) { serverError(res, error, 'Não foi possível gerar o link de pagamento agora.') }
}

// Resumo agregado para o dashboard do painel admin (ver
// usersRepository.obterMetricasAgregadas — exceção documentada à política de
// "sem diretório global", só números, sem nenhum dado individual).
async function getDashboard(req, res) {
  try {
    const [metrics, reconciliation] = await Promise.all([
      users.obterMetricasAgregadas(),
      billingService.getReconciliationReport({ days: 7 }).catch(() => ({ unmatched: [] })),
    ])
    res.json({ ...metrics, pagamentosNaoConciliados: reconciliation.unmatched.length })
  } catch (error) { serverError(res, error, 'Não foi possível carregar as métricas agora.') }
}

// Cruza a Stripe com o banco e devolve as sessões pagas sem cobrança 'paid'
// correspondente — pagamento que entrou sem ninguém ser creditado.
async function getReconciliationReport(req, res) {
  try {
    const report = await billingService.getReconciliationReport({ days: req.query.days })
    res.json(report)
  } catch (error) { serverError(res, error, 'Não foi possível carregar o relatório de conciliação agora.') }
}

// Vincula manualmente uma sessão paga (normalmente vinda de uma linha do
// relatório de conciliação) a uma conta e a um plano escolhidos pelo admin,
// sem precisar de acesso direto ao banco. Auditado no log do admin que agiu.
async function linkPayment(req, res) {
  try {
    const result = await billingService.linkPaymentManually({
      gatewaySessionId: req.params.sessionId,
      userId: req.body?.userId,
      toPlan: req.body?.plan,
      adminId: req.user.id,
    })
    res.json(result)
  } catch (error) { serverError(res, error, 'Não foi possível vincular esse pagamento agora.') }
}

module.exports = { listUsers, updateRole, updateActive, searchUserByEmail, getPlanLink, getDashboard, getReconciliationReport, linkPayment }
