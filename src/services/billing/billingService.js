const billingRepo = require('../../repositories/billingRepository')
const usersRepo = require('../../repositories/usersRepository')
const paymentGateway = require('./paymentGateway')
const mailer = require('../mailer')
const { addLog } = require('../../middleware/logger')
const { DEFAULT_PLAN, PLANS, canonicalPlanId, findPlanByAmount, getMeuEcooPricing, normalizePlan, publicPlanCatalog } = require('../../config/plans')

class BillingError extends Error {
  constructor(message, statusCode = 400, code = 'billing_error') {
    super(message)
    this.name = 'BillingError'
    this.statusCode = statusCode
    this.code = code
  }
}

function billingMonth(now = new Date()) {
  const year = now.getUTCFullYear()
  const month = String(now.getUTCMonth() + 1).padStart(2, '0')
  return `${year}-${month}-01`
}

function publicCharge(change) {
  if (!change) return null
  return {
    id: change.id,
    requestedPlan: change.toPlan,
    amountCents: Number(change.amountCents),
    currency: change.currency,
    billingMonth: change.billingMonth,
    status: change.status,
    checkoutUrl: change.checkoutUrl || null,
    meuEcooSelected: change.meuEcooSelected === true,
    meuEcooAmountCents: Number(change.meuEcooAmountCents) || 0,
    failureCode: change.status === 'failed' ? change.failureCode : null,
    createdAt: change.createdAt,
    paidAt: change.paidAt || null,
  }
}

function billingAmounts(plan, meuEcooOptIn = false) {
  const meuEcooPricing = getMeuEcooPricing(plan)
  const meuEcooSelected = plan.meuEcooAccess === 'free' || (plan.meuEcooAccess === 'discount' && meuEcooOptIn === true)
  const meuEcooAmountCents = plan.meuEcooAccess === 'discount' && meuEcooSelected
    ? meuEcooPricing.finalPriceCents
    : 0
  return {
    amountCents: Number(plan.priceCents) + meuEcooAmountCents,
    meuEcooSelected,
    meuEcooAmountCents,
  }
}

function resultForChange(change, currentPlan) {
  if (!change) return null
  const status = change.status === 'paid' ? 'paid' : change.checkoutUrl ? 'checkout_pending' : change.status
  return {
    status,
    plan: currentPlan,
    requestedPlan: change.toPlan,
    charged: change.status === 'paid',
    checkoutUrl: change.checkoutUrl || null,
    meuEcooSelected: change.meuEcooSelected === true,
    meuEcooAmountCents: Number(change.meuEcooAmountCents) || 0,
    billingMonth: change.billingMonth,
    charge: publicCharge(change),
    httpStatus: status === 'processing' ? 202 : status === 'failed' ? 409 : 200,
  }
}

async function requestPlanChange({ user, targetPlan, meuEcoo = false, now = new Date() }) {
  if (!user?.id) throw new BillingError('Usuário não autenticado.', 401, 'not_authenticated')
  if (typeof targetPlan !== 'string' || !PLANS[targetPlan]) {
    throw new BillingError('Plano selecionado inválido.', 400, 'invalid_plan')
  }

  const currentPlan = normalizePlan(user.plan || DEFAULT_PLAN)
  const initialPurchase = user.planActive === false
  if (targetPlan === currentPlan && !initialPurchase) {
    return { status: 'unchanged', plan: currentPlan, requestedPlan: targetPlan, charged: false, checkoutUrl: null, charge: null, httpStatus: 200 }
  }

  const selectedPlan = PLANS[targetPlan]
  const amounts = billingAmounts(selectedPlan, meuEcoo)

  const month = billingMonth(now)
  const idempotencyKey = `plan-change-${user.id}-${month.slice(0, 7)}`
  let change = await billingRepo.buscarPorMes(user.id, month)

  if (change && change.toPlan !== targetPlan) {
    throw new BillingError('Você já possui uma cobrança de troca de plano neste mês. Não será criada uma segunda cobrança.', 409, 'monthly_charge_exists')
  }

  if (change?.status === 'paid') return resultForChange(change, change.toPlan)
  if (change?.status === 'pending' && change.checkoutUrl) return resultForChange(change, currentPlan)
  if (change?.status === 'failed' && change.gatewaySessionId) {
    throw new BillingError('A tentativa de pagamento deste mês já foi registrada. Não faremos uma nova cobrança automática.', 409, 'monthly_charge_attempted')
  }
  if (change?.status === 'cancelled') {
    throw new BillingError('A troca de plano deste mês foi cancelada. Não será criada uma nova cobrança.', 409, 'monthly_charge_attempted')
  }

  if (change && !change.gatewaySessionId && ['pending', 'failed'].includes(change.status)) {
    const currentAmount = Number(change.amountCents)
    const currentMeuEcooAmount = Number(change.meuEcooAmountCents) || 0
    if (currentAmount !== amounts.amountCents || change.meuEcooSelected !== amounts.meuEcooSelected || currentMeuEcooAmount !== amounts.meuEcooAmountCents) {
      change = await billingRepo.atualizarItensMeuEcoo(change.id, amounts) || change
    }
  }

  if (!change) {
    change = await billingRepo.criarPendente({
      userId: user.id,
      fromPlan: currentPlan,
      toPlan: targetPlan,
      amountCents: amounts.amountCents,
      currency: String(selectedPlan.currency || 'brl').toLowerCase(),
      billingMonth: month,
      idempotencyKey,
      gateway: String(process.env.PAYMENT_GATEWAY || 'stripe').toLowerCase(),
      meuEcooSelected: amounts.meuEcooSelected,
      meuEcooAmountCents: amounts.meuEcooAmountCents,
    })
    if (!change) {
      const existing = await billingRepo.buscarPorMes(user.id, month)
      if (existing?.toPlan !== targetPlan) {
        throw new BillingError('Você já possui uma cobrança de troca de plano neste mês. Não será criada uma segunda cobrança.', 409, 'monthly_charge_exists')
      }
      if (existing?.status === 'cancelled') {
        throw new BillingError('A troca de plano deste mês foi cancelada. Não será criada uma nova cobrança.', 409, 'monthly_charge_attempted')
      }
      if (existing && !(existing.status === 'pending' && !existing.checkoutUrl)) return resultForChange(existing, currentPlan)
      if (existing) {
        change = existing
      } else {
        throw new BillingError('Não foi possível registrar a cobrança com segurança.', 503, 'billing_record_unavailable')
      }
    }
  }

  const reserved = await billingRepo.reservarProcessamento(change.id)
  if (!reserved) {
    const current = await billingRepo.buscarPorMes(user.id, month)
    if (current?.status === 'processing') return resultForChange(current, currentPlan)
    if (current) return resultForChange(current, currentPlan)
    throw new BillingError('A cobrança está sendo processada. Tente novamente em instantes.', 202, 'billing_processing')
  }

  try {
    const checkout = await paymentGateway.createCheckout({
      billingId: reserved.id,
      userId: user.id,
      email: user.email,
      fromPlan: reserved.fromPlan,
      toPlan: reserved.toPlan,
      planName: selectedPlan.name,
      amountCents: Number(reserved.amountCents),
      planAmountCents: Number(selectedPlan.priceCents),
      meuEcooSelected: reserved.meuEcooSelected === true,
      meuEcooAmountCents: Number(reserved.meuEcooAmountCents) || 0,
      currency: reserved.currency,
      billingMonth: reserved.billingMonth,
      idempotencyKey: reserved.idempotencyKey,
    })
    const attached = await billingRepo.anexarCheckout(reserved.id, { gatewaySessionId: checkout.id, checkoutUrl: checkout.url })
    return resultForChange(attached || { ...reserved, status: 'pending', gatewaySessionId: checkout.id, checkoutUrl: checkout.url }, currentPlan)
  } catch (error) {
    if (error.uncertain) {
      await billingRepo.manterProcessando(reserved.id)
      return {
        status: 'processing',
        plan: currentPlan,
        requestedPlan: targetPlan,
        charged: false,
        checkoutUrl: null,
        meuEcooSelected: reserved.meuEcooSelected === true,
        meuEcooAmountCents: Number(reserved.meuEcooAmountCents) || 0,
        charge: publicCharge({ ...reserved, status: 'processing' }),
        httpStatus: 202,
      }
    }
    await billingRepo.marcarFalha(reserved.id, { code: error.code, message: error.message })
    throw error
  }
}

// Gera a URL do Payment Link estático de um plano já com o client_reference_id
// do usuário amarrado, conforme a documentação da Stripe
// (https://docs.stripe.com/payment-links/url-parameters). Uso: o time de
// suporte/vendas envia esse link (em vez do link "cru" de config/plans.json)
// para associar automaticamente o pagamento à conta do cliente no webhook.
function getPlanDirectLink({ plan, userId, email }) {
  const selectedPlan = PLANS[canonicalPlanId(plan)]
  if (!selectedPlan) throw new BillingError('Plano selecionado inválido.', 400, 'invalid_plan')
  if (!selectedPlan.checkoutUrl) throw new BillingError('Este plano não possui um link de pagamento configurado.', 503, 'plan_link_missing')
  if (!Number.isInteger(Number(userId)) || Number(userId) <= 0) throw new BillingError('Usuário inválido.', 400, 'invalid_user')

  const url = new URL(selectedPlan.checkoutUrl)
  url.searchParams.set('client_reference_id', `user:${userId}`)
  if (email) url.searchParams.set('prefilled_email', email)
  return url.toString()
}

async function getStatus({ userId, currentPlan, planActive }) {
  const month = billingMonth()
  const charge = await billingRepo.buscarPorMes(userId, month)
  return {
    currentPlan: normalizePlan(currentPlan || DEFAULT_PLAN),
    planActive: planActive !== false,
    plans: publicPlanCatalog(),
    billingMonth: month,
    charge: publicCharge(charge),
    gatewayConfigured: paymentGateway.isConfigured(),
  }
}

function readPaymentIntentId(value) {
  return typeof value === 'string' ? value : value?.id || null
}

// client_reference_id de um Payment Link direto (link enviado manualmente
// para um usuário já cadastrado) segue o padrão "user:<id>", da mesma forma
// como o checkout dinâmico usa "billing:<id>". Ver getPlanDirectLink().
function readUserIdFromClientReference(value) {
  const match = /^user:(\d+)$/.exec(String(value || ''))
  if (!match) return null
  const userId = Number(match[1])
  return Number.isInteger(userId) && userId > 0 ? userId : null
}

function getMeuEcooAccessUrl() {
  const configured = process.env.MEU_ECOO_ACCESS_URL || process.env.MEU_ECOO_URL || 'https://www.meuecoo.com/'
  try {
    const url = new URL(configured)
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('protocolo inválido')
    return url.toString()
  } catch {
    throw new BillingError('O link de acesso ao MeuEcoo não está configurado corretamente.', 503, 'meu_ecoo_access_url_invalid')
  }
}

function readCustomerEmail(object) {
  const email = object?.customer_email || object?.customer_details?.email
  return typeof email === 'string' && email.trim() ? email.trim().toLowerCase() : null
}

async function sendMeuEcooAccessEmail(change, object, metadata) {
  const plan = PLANS[canonicalPlanId(change?.toPlan)]
  const shouldGrantAccess = plan?.meuEcooAccess === 'free' || (plan?.meuEcooAccess === 'discount' && change?.meuEcooSelected === true)
  if (!change?.id || !plan || !shouldGrantAccess) return { status: 'not_selected' }

  let email = readCustomerEmail(object)
  let fullName = object?.customer_details?.name || null
  if (!email) {
    const userId = Number(change.userId || metadata?.user_id)
    if (Number.isInteger(userId) && userId > 0) {
      const user = await usersRepo.buscarPorId(userId)
      email = user?.email || null
      fullName = fullName || user?.fullName || user?.full_name || null
    }
  }
  if (!email) throw new BillingError('Não foi possível identificar o e-mail para liberar o MeuEcoo.', 503, 'meu_ecoo_recipient_missing')

  const reserved = await billingRepo.reservarEnvioMeuEcoo(change.id)
  if (!reserved) return { status: 'already_sent_or_processing' }

  try {
    await mailer.enviarEmailAcessoMeuEcoo(email, {
      fullName,
      planName: plan.name,
      offer: plan.meuEcooOffer,
      accessUrl: getMeuEcooAccessUrl(),
    })
    await billingRepo.marcarEnvioMeuEcooConcluido(change.id)
    return { status: 'sent' }
  } catch (error) {
    await billingRepo.marcarFalhaEnvioMeuEcoo(change.id, error.message).catch(() => {})
    throw new BillingError('O pagamento foi confirmado, mas não foi possível enviar o acesso ao MeuEcoo. O gateway tentará novamente.', 503, 'meu_ecoo_email_failed')
  }
}

// Um pagamento confirmado que não conseguimos vincular a nenhuma conta é
// dinheiro que entrou sem ninguém ser creditado. Nunca falha silenciosamente:
// registra o que faltou para permitir a reconciliação manual.
async function logUnlinkedPayment(object, reason) {
  await addLog(
    'err',
    `Pagamento confirmado sem vínculo com uma conta (${reason}). ` +
    `session=${object?.id || 'desconhecida'} ` +
    `payment_intent=${readPaymentIntentId(object?.payment_intent) || 'desconhecido'} ` +
    `valor=${object?.amount_total} ${String(object?.currency || '').toUpperCase()} ` +
    `client_reference_id=${object?.client_reference_id || 'ausente'} ` +
    `email=${readCustomerEmail(object) || 'ausente'}`
  )
  return { status: 'unlinked', reason }
}

// Resolve a conta de um pagamento feito fora do app. A referência explícita do
// link (client_reference_id) tem prioridade; o e-mail do comprador é a rede de
// segurança para os Payment Links que já circulam sem essa marcação.
async function resolveDirectLinkUser(object) {
  const userId = readUserIdFromClientReference(object.client_reference_id)
  if (userId) {
    const user = await usersRepo.buscarPorId(userId)
    return { user, matchedBy: 'client_reference_id' }
  }

  const email = readCustomerEmail(object)
  if (email) {
    const user = await usersRepo.buscarPorEmail(email)
    return { user, matchedBy: 'email' }
  }

  return { user: null, matchedBy: null }
}

async function handleDirectLinkPayment(object) {
  const amountCents = Number(object.amount_total)
  const currency = String(object.currency || '').toLowerCase()
  const directPlan = findPlanByAmount(amountCents, currency)
  if (!directPlan) return logUnlinkedPayment(object, 'o valor pago não corresponde a nenhum plano')

  const { user, matchedBy } = await resolveDirectLinkUser(object)
  if (!user?.id) return logUnlinkedPayment(object, 'não foi possível identificar a conta do comprador')

  const confirmed = await billingRepo.confirmarPagamentoDireto({
    userId: user.id,
    fromPlan: normalizePlan(user.plan || DEFAULT_PLAN),
    toPlan: directPlan,
    amountCents,
    currency,
    billingMonth: billingMonth(),
    gatewaySessionId: object.id,
    gatewayPaymentId: readPaymentIntentId(object.payment_intent),
  })

  if (confirmed?.status !== 'paid') {
    return logUnlinkedPayment(object, `já existe uma cobrança registrada no mês para o usuário ${user.id}`)
  }

  await addLog('ok', `Pagamento por link direto vinculado ao usuário ${user.id} (via ${matchedBy}): plano ${directPlan}, sessão ${object.id}.`, null, null, user.id)
  await sendMeuEcooAccessEmail(confirmed, object, { user_id: user.id })
  return { status: 'paid' }
}

// Relatório de conciliação: cruza as sessões de checkout pagas na Stripe
// contra billing_plan_changes e devolve só as que não têm cobrança 'paid'
// correspondente. Diferente de logUnlinkedPayment (que só registra o que o
// webhook já viu), este relatório consulta a Stripe diretamente — pega
// também o caso raro de o webhook nunca ter chegado (ex.: indisponibilidade).
// Painel admin completo (agrupamento, filtros, paginação) fica para uma task
// futura dedicada; aqui entrega o suficiente para achar e resolver o problema
// sem acesso direto ao banco, como pede o critério de aceite da task.
async function getReconciliationReport({ days = 7 } = {}) {
  const clampedDays = Math.min(Math.max(Number(days) || 7, 1), 30)
  const createdGteSeconds = Math.floor(Date.now() / 1000) - clampedDays * 86400

  const { sessions, truncated } = await paymentGateway.listCheckoutSessions({ createdGteSeconds })
  const paidSessions = sessions.filter(session => session.payment_status === 'paid')
  if (!paidSessions.length) return { unmatched: [], checked: 0, truncated }

  const existentes = await billingRepo.buscarPorGatewaySessions(paidSessions.map(session => session.id))
  const pagas = new Set(existentes.filter(change => change.status === 'paid').map(change => change.gatewaySessionId))

  const unmatched = paidSessions
    .filter(session => !pagas.has(session.id))
    .map(session => {
      const amountCents = Number(session.amount_total)
      const currency = String(session.currency || '').toLowerCase()
      return {
        sessionId: session.id,
        amountCents,
        currency,
        createdAt: new Date(session.created * 1000).toISOString(),
        clientReferenceId: session.client_reference_id || null,
        suggestedUserId: readUserIdFromClientReference(session.client_reference_id),
        customerEmail: readCustomerEmail(session),
        suggestedPlan: findPlanByAmount(amountCents, currency),
        paymentIntent: readPaymentIntentId(session.payment_intent),
      }
    })

  return { unmatched, checked: paidSessions.length, truncated }
}

// Ação administrativa do critério de aceite: vincula manualmente uma sessão
// paga na Stripe a uma conta, informando só a sessão (normalmente já em mãos
// vindo de uma linha do relatório de conciliação) — sem precisar mexer no
// banco diretamente. Reaproveita confirmarPagamentoDireto, a mesma função do
// vínculo automático por e-mail/client_reference_id: mesma idempotência por
// gateway_session_id (reexecutar a mesma vinculação não duplica a cobrança).
async function linkPaymentManually({ gatewaySessionId, userId, toPlan, adminId }) {
  if (!gatewaySessionId) throw new BillingError('Informe a sessão do gateway.', 400, 'missing_session_id')
  const canonicalToPlan = canonicalPlanId(toPlan)
  if (!canonicalToPlan) throw new BillingError('Plano selecionado inválido.', 400, 'invalid_plan')

  const session = await paymentGateway.getCheckoutSession(gatewaySessionId)
  if (session.payment_status !== 'paid') {
    throw new BillingError('Essa sessão não está marcada como paga na Stripe.', 400, 'session_not_paid')
  }

  const user = await usersRepo.buscarPorId(Number(userId))
  if (!user?.id) throw new BillingError('Usuário não encontrado.', 404, 'user_not_found')

  const amountCents = Number(session.amount_total)
  const currency = String(session.currency || '').toLowerCase()
  const confirmed = await billingRepo.confirmarPagamentoDireto({
    userId: user.id,
    fromPlan: normalizePlan(user.plan || DEFAULT_PLAN),
    toPlan: canonicalToPlan,
    amountCents,
    currency,
    billingMonth: billingMonth(),
    gatewaySessionId: session.id,
    gatewayPaymentId: readPaymentIntentId(session.payment_intent),
  })

  if (confirmed?.status !== 'paid') {
    throw new BillingError('Já existe uma cobrança registrada no mês para esse usuário — a vinculação manual não a sobrescreve.', 409, 'monthly_charge_exists')
  }

  await addLog('ok', `Pagamento vinculado manualmente por admin #${adminId}: usuário ${user.id}, plano ${canonicalToPlan}, sessão ${session.id}.`, null, null, adminId)
  await sendMeuEcooAccessEmail(confirmed, session, { user_id: user.id })
  return { status: 'paid' }
}

async function handleWebhook(event) {
  const object = event?.data?.object
  if (!object?.id) return { status: 'ignored' }

  if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
    if (event.type === 'checkout.session.completed' && object.payment_status !== 'paid') return { status: 'pending' }
    const metadata = object.metadata || {}
    const toPlan = canonicalPlanId(metadata.to_plan)

    if (toPlan) {
      const confirmed = await billingRepo.confirmarPagamento({
        gatewaySessionId: object.id,
        gatewayPaymentId: readPaymentIntentId(object.payment_intent),
        amountCents: Number(object.amount_total),
        currency: String(object.currency || '').toLowerCase(),
        toPlan,
      })
      if (confirmed?.status === 'paid') {
        await sendMeuEcooAccessEmail(confirmed, object, metadata)
        return { status: 'paid' }
      }
      return { status: 'ignored' }
    }

    // Sem metadata.to_plan: não veio do checkout dinâmico do app, então é um
    // pagamento feito direto por um Payment Link estático da Stripe.
    return handleDirectLinkPayment(object)
  }

  if (event.type === 'checkout.session.async_payment_failed') {
    await billingRepo.marcarFalhaPorSession(object.id, { code: 'async_payment_failed', message: 'O gateway informou que o pagamento não foi concluído.' })
    return { status: 'failed' }
  }

  if (event.type === 'checkout.session.expired') {
    await billingRepo.marcarFalhaPorSession(object.id, { code: 'checkout_expired', message: 'O checkout expirou antes da confirmação.' })
    return { status: 'failed' }
  }

  return { status: 'ignored' }
}

module.exports = { BillingError, billingMonth, publicCharge, requestPlanChange, getStatus, getPlanDirectLink, handleWebhook, getReconciliationReport, linkPaymentManually }
