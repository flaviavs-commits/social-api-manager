const billingRepo = require('../../repositories/billingRepository')
const usersRepo = require('../../repositories/usersRepository')
const paymentGateway = require('./paymentGateway')
const mailer = require('../mailer')
const { DEFAULT_PLAN, PLANS, canonicalPlanId, getMeuEcooPricing, normalizePlan, publicPlanCatalog } = require('../../config/plans')

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

async function handleWebhook(event) {
  const object = event?.data?.object
  if (!object?.id) return { status: 'ignored' }

  if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
    if (event.type === 'checkout.session.completed' && object.payment_status !== 'paid') return { status: 'pending' }
    const metadata = object.metadata || {}
    const toPlan = canonicalPlanId(metadata.to_plan)
    if (!toPlan) throw new BillingError('Webhook sem plano registrado.', 400, 'invalid_webhook_plan')
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

module.exports = { BillingError, billingMonth, publicCharge, requestPlanChange, getStatus, handleWebhook }
