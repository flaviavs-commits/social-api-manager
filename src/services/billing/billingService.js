const billingRepo = require('../../repositories/billingRepository')
const subscriptionsRepo = require('../../repositories/subscriptionsRepository')
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

  // Troca de plano com uma assinatura já ativa (decisão de 10/09/2026, task
  // "idempotência de renovação e histórico de troca de plano"): NÃO cria um
  // novo Checkout Session. Antes desta task, toda troca — mesmo com
  // assinatura Stripe ativa — abria uma segunda assinatura em paralelo, sem
  // cancelar a primeira, um risco real de cobrar as duas ao mesmo tempo. A
  // partir daqui, só a primeira assinatura do usuário passa por
  // createCheckout; toda troca subsequente atualiza os itens da assinatura
  // existente (updateSubscriptionPlan), e a Stripe calcula o proration
  // sozinha. Checkout dinâmico continua existindo só para quem ainda não tem
  // nenhuma assinatura Stripe (initialPurchase).
  if (!initialPurchase) {
    const activeSubscription = await subscriptionsRepo.buscarPorUserId(user.id)
    if (activeSubscription?.stripeSubscriptionId && SUBSCRIPTION_STATUSES_GRANT_ACCESS.includes(activeSubscription.status)) {
      return updateActiveSubscriptionPlan({ user, activeSubscription, targetPlan, selectedPlan, amounts, now })
    }
  }

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
    // Reaproveita o Stripe Customer já salvo do usuário (se houver) — evita
    // criar um Customer duplicado a cada troca de plano. Buscado aqui, não
    // antes, para não gastar a query nos retornos antecipados acima.
    const currentUser = await usersRepo.buscarPorId(user.id)
    const checkout = await paymentGateway.createCheckout({
      billingId: reserved.id,
      userId: user.id,
      email: user.email,
      stripeCustomerId: currentUser?.stripeCustomerId || null,
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
    if (checkout.customer && checkout.customer !== currentUser?.stripeCustomerId) {
      await usersRepo.salvarStripeCustomerId(user.id, checkout.customer)
    }
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

// A chave de idempotência aqui é do lado do cliente (defesa contra duplo
// clique/retry), diferente da idempotência dos eventos do webhook — decisão
// registrada no IA.md de 10/09/2026: os handlers de webhook já são
// naturalmente idempotentes (UPDATE/INSERT com ON CONFLICT, nenhuma linha
// nova por evento), então não foi criada uma tabela de deduplicação por
// event.id. Aqui, uma chamada repetida com o mesmo plano-alvo no mesmo mês
// gera a mesma Idempotency-Key — a Stripe devolve a resposta já processada
// em vez de aplicar o proration duas vezes.
async function updateActiveSubscriptionPlan({ user, activeSubscription, targetPlan, selectedPlan, amounts, now }) {
  const month = billingMonth(now)
  const idempotencyKey = `subscription-update-${activeSubscription.stripeSubscriptionId}-${targetPlan}-${month.slice(0, 7)}`

  const updated = await paymentGateway.updateSubscriptionPlan({
    stripeSubscriptionId: activeSubscription.stripeSubscriptionId,
    planName: selectedPlan.name,
    planAmountCents: Number(selectedPlan.priceCents),
    toPlan: targetPlan,
    currency: String(selectedPlan.currency || 'brl').toLowerCase(),
    billingId: activeSubscription.id,
    userId: user.id,
    billingMonth: month,
    meuEcooSelected: amounts.meuEcooSelected,
    meuEcooAmountCents: amounts.meuEcooAmountCents,
    idempotencyKey,
  })

  await subscriptionsRepo.atualizarPorStripeSubscriptionId(activeSubscription.stripeSubscriptionId, { plan: targetPlan, status: updated.status })
  await usersRepo.atualizarPlanoPorAssinatura(user.id, { plan: targetPlan, planActive: true })
  // Histórico da troca (item 2 do corpo da task): não cria linha em
  // billing_plan_changes — esse fica reservado à primeira assinatura de cada
  // usuário (checkout dinâmico). Uma trilha de auditoria mínima entra no log
  // padrão do app, consultável na Central de Atividades/painel admin.
  await addLog('ok', `Troca de plano em assinatura ativa: ${user.plan || 'plano anterior'} → ${targetPlan} (assinatura ${activeSubscription.stripeSubscriptionId}).`, null, null, user.id)

  return {
    status: 'paid',
    plan: targetPlan,
    requestedPlan: targetPlan,
    charged: true,
    checkoutUrl: null,
    meuEcooSelected: amounts.meuEcooSelected,
    meuEcooAmountCents: amounts.meuEcooAmountCents,
    billingMonth: month,
    charge: null,
    httpStatus: 200,
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
  const [charge, subscription] = await Promise.all([
    billingRepo.buscarPorMes(userId, month),
    subscriptionsRepo.buscarPorUserId(userId),
  ])
  return {
    currentPlan: normalizePlan(currentPlan || DEFAULT_PLAN),
    planActive: planActive !== false,
    plans: publicPlanCatalog(),
    billingMonth: month,
    charge: publicCharge(charge),
    gatewayConfigured: paymentGateway.isConfigured(),
    // O frontend usa isso para decidir se mostra o botão "Gerenciar
    // assinatura" (Customer Portal) — só faz sentido quando há uma
    // assinatura Stripe de verdade em vigor, não numa cobrança avulsa antiga
    // ou numa assinatura já cancelada/nunca chegou a ativar.
    subscription: subscription ? {
      status: subscription.status,
      plan: subscription.plan,
      cancelAtPeriodEnd: subscription.cancelAtPeriodEnd === true,
      currentPeriodEnd: subscription.currentPeriodEnd,
      manageable: SUBSCRIPTION_STATUSES_GRANT_ACCESS.includes(subscription.status),
    } : null,
  }
}

// Cancelamento self-service via Customer Portal (task 4/5 da quebra de
// assinatura): a Stripe hospeda a tela de cancelar/trocar cartão/ver
// faturas — nenhuma UI própria de cancelamento é construída aqui.
async function createBillingPortalSession({ userId }) {
  const user = await usersRepo.buscarPorId(userId)
  if (!user?.stripeCustomerId) {
    throw new BillingError('Você ainda não tem uma assinatura paga para gerenciar.', 400, 'no_stripe_customer')
  }
  return paymentGateway.createPortalSession(user.stripeCustomerId)
}

// Peça reutilizável para quando um endpoint de exclusão/desativação de conta
// existir (task "cancelar a assinatura Stripe antes de excluir uma conta",
// 11/09/2026): sem isso, remover um usuário que ainda tem assinatura ativa
// deixa a Stripe cobrando um cliente que não existe mais no app. Idempotente
// e segura de chamar em qualquer conta — sem assinatura, ou já cancelada, é
// no-op (não é erro: a maioria das contas nunca teve uma assinatura Stripe).
// Atualiza `subscriptions` localmente na hora, em vez de confiar só no
// webhook `customer.subscription.deleted` chegar depois — se o chamador for
// excluir o usuário logo em seguida, o registro local já precisa refletir o
// cancelamento antes disso acontecer (o webhook, quando chegar, só confirma
// o mesmo estado, de forma idempotente).
async function cancelSubscriptionForUser(userId) {
  const subscription = await subscriptionsRepo.buscarPorUserId(userId)
  if (!subscription?.stripeSubscriptionId || subscription.status === 'canceled') {
    return { status: 'no_subscription' }
  }
  const canceled = await paymentGateway.cancelSubscription(subscription.stripeSubscriptionId)
  await subscriptionsRepo.atualizarPorStripeSubscriptionId(subscription.stripeSubscriptionId, { status: canceled.status || 'canceled' })
  return { status: 'canceled', stripeSubscriptionId: subscription.stripeSubscriptionId }
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

function adminPanelUrl() {
  const base = process.env.FRONTEND_URL || process.env.BASE_URL || ''
  return `${base.replace(/\/$/, '')}/admin.html`
}

// Decisão registrada no IA.md de 10/09/2026 (task "decidir escopo e
// destinatário de alerta"): todo admin ativo recebe o aviso, imediatamente
// por evento. Best-effort — se o e-mail falhar (ex.: Gmail não configurado),
// registra o próprio erro no log em vez de propagar e derrubar o webhook;
// o pagamento já está registrado no log de erro principal de qualquer forma.
async function alertUnlinkedPaymentAdmins(object, reason) {
  try {
    const recipients = await usersRepo.listarEmailsAdmins()
    if (!recipients.length) return
    await mailer.enviarEmailAlertaPagamentoNaoVinculado(recipients, {
      reason,
      sessionId: object?.id,
      amountCents: Number(object?.amount_total),
      currency: object?.currency,
      clientReferenceId: object?.client_reference_id,
      customerEmail: readCustomerEmail(object),
      adminUrl: adminPanelUrl(),
    })
  } catch (error) {
    await addLog('err', `Falha ao enviar alerta de pagamento não vinculado: ${error.message}`)
  }
}

// Mesmo padrão best-effort de alertUnlinkedPaymentAdmins, reaproveitado por
// reembolso parcial e disputa (task "decidir o que fazer em reembolso e
// disputa", 11/09/2026) — casos em que a conta já é conhecida, então o
// alerta genérico ("vincular no painel") não se aplica.
async function alertAdminsEventoStripe(title, description, rows) {
  try {
    const recipients = await usersRepo.listarEmailsAdmins()
    if (!recipients.length) return
    await mailer.enviarEmailAlertaEventoStripe(recipients, { title, description, rows, adminUrl: adminPanelUrl() })
  } catch (error) {
    await addLog('err', `Falha ao enviar alerta de evento Stripe (${title}): ${error.message}`)
  }
}

// Um pagamento confirmado que não conseguimos vincular a nenhuma conta é
// dinheiro que entrou sem ninguém ser creditado. Nunca falha silenciosamente:
// registra o que faltou para permitir a reconciliação manual e avisa todo
// admin por e-mail.
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
  await alertUnlinkedPaymentAdmins(object, reason)
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

// Ciclo de vida da assinatura (task "webhook de ciclo de vida", 10/09/2026).
// Estados que concedem acesso vs. revogam, conferido ao vivo contra
// docs.stripe.com/billing/subscriptions/webhooks: 'past_due' é aviso, não
// revogação (a Stripe já tenta cobrar de novo sozinha via Smart Retries).
const SUBSCRIPTION_STATUSES_GRANT_ACCESS = ['trialing', 'active']
const SUBSCRIPTION_STATUSES_REVOKE_ACCESS = ['canceled', 'unpaid']

// user_id vem em subscription_data.metadata (gravado na criação do checkout,
// task "checkout em modo assinatura") — é a via principal, mais direta que
// resolver pelo Customer. O Customer é o fallback para eventos em que a
// metadata não sobrevive (ex.: assinatura editada manualmente no dashboard
// da Stripe, sem passar pelo nosso checkout).
async function resolveSubscriptionUser(object) {
  const metadataUserId = Number(object?.metadata?.user_id)
  if (Number.isInteger(metadataUserId) && metadataUserId > 0) {
    const user = await usersRepo.buscarPorId(metadataUserId)
    if (user?.id) return user
  }
  if (object?.customer) {
    const user = await usersRepo.buscarPorStripeCustomerId(object.customer)
    if (user?.id) return user
  }
  return null
}

function subscriptionPeriodEnd(object) {
  const seconds = Number(object?.current_period_end)
  return Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000) : null
}

// Mesmo padrão de logUnlinkedPayment/alertUnlinkedPaymentAdmins (decisão do
// próprio corpo da task): nenhum evento de assinatura some silenciosamente
// sem log e sem avisar os admins, mesmo quando não é possível vinculá-lo a
// uma conta.
async function logUnlinkedSubscriptionEvent(object, reason) {
  await addLog(
    'err',
    `Evento de assinatura sem vínculo com uma conta (${reason}). ` +
    `subscription=${object?.id || object?.subscription || 'desconhecida'} ` +
    `customer=${object?.customer || 'desconhecido'}`
  )
  await alertUnlinkedPaymentAdmins(object, reason)
  return { status: 'unlinked', reason }
}

async function handleSubscriptionCreated(object) {
  const user = await resolveSubscriptionUser(object)
  if (!user?.id) return logUnlinkedSubscriptionEvent(object, 'não foi possível identificar a conta da nova assinatura')

  const toPlan = canonicalPlanId(object?.metadata?.to_plan)
  await subscriptionsRepo.criar({
    userId: user.id,
    stripeSubscriptionId: object.id,
    stripePriceId: object?.items?.data?.[0]?.price?.id || null,
    plan: toPlan || normalizePlan(user.plan || DEFAULT_PLAN),
    status: object.status,
    currentPeriodEnd: subscriptionPeriodEnd(object),
    cancelAtPeriodEnd: object?.cancel_at_period_end === true,
  })

  if (toPlan && SUBSCRIPTION_STATUSES_GRANT_ACCESS.includes(object.status)) {
    await usersRepo.atualizarPlanoPorAssinatura(user.id, { plan: toPlan, planActive: true })
  }
  return { status: 'ok' }
}

async function handleSubscriptionUpdated(object) {
  const toPlan = canonicalPlanId(object?.metadata?.to_plan)
  let subscription = await subscriptionsRepo.atualizarPorStripeSubscriptionId(object.id, {
    status: object.status,
    currentPeriodEnd: subscriptionPeriodEnd(object),
    cancelAtPeriodEnd: object?.cancel_at_period_end === true,
    plan: toPlan || null,
    stripePriceId: object?.items?.data?.[0]?.price?.id || null,
  })

  const user = await resolveSubscriptionUser(object)
  if (!subscription) {
    // O evento 'created' não chegou antes deste (reentrega fora de ordem, ou
    // assinatura criada fora do nosso checkout) — cria a linha agora em vez
    // de descartar o evento.
    if (!user?.id) return logUnlinkedSubscriptionEvent(object, 'assinatura desconhecida e conta não identificada')
    subscription = await subscriptionsRepo.criar({
      userId: user.id,
      stripeSubscriptionId: object.id,
      stripePriceId: object?.items?.data?.[0]?.price?.id || null,
      plan: toPlan || normalizePlan(user.plan || DEFAULT_PLAN),
      status: object.status,
      currentPeriodEnd: subscriptionPeriodEnd(object),
      cancelAtPeriodEnd: object?.cancel_at_period_end === true,
    })
  }
  if (!user?.id) return logUnlinkedSubscriptionEvent(object, 'não foi possível identificar a conta da assinatura atualizada')

  if (SUBSCRIPTION_STATUSES_GRANT_ACCESS.includes(object.status)) {
    await usersRepo.atualizarPlanoPorAssinatura(user.id, { plan: subscription?.plan || toPlan || null, planActive: true })
  } else if (SUBSCRIPTION_STATUSES_REVOKE_ACCESS.includes(object.status)) {
    await usersRepo.atualizarPlanoPorAssinatura(user.id, { planActive: false })
  }
  return { status: 'ok' }
}

async function handleSubscriptionDeleted(object) {
  await subscriptionsRepo.atualizarPorStripeSubscriptionId(object.id, { status: 'canceled' })
  const user = await resolveSubscriptionUser(object)
  if (!user?.id) return logUnlinkedSubscriptionEvent(object, 'não foi possível identificar a conta da assinatura cancelada')
  await usersRepo.atualizarPlanoPorAssinatura(user.id, { planActive: false })
  return { status: 'ok' }
}

// invoice.paid não carrega a metadata do checkout (metadata é da assinatura,
// não da fatura) — resolve pelo Customer, plano igual ao já salvo em
// `subscriptions` (a fonte de verdade do plano contratado).
async function handleInvoicePaid(object) {
  const user = object?.customer ? await usersRepo.buscarPorStripeCustomerId(object.customer) : null
  if (!user?.id) return logUnlinkedSubscriptionEvent(object, 'não foi possível identificar a conta da fatura paga')

  const subscription = object?.subscription ? await subscriptionsRepo.buscarPorStripeSubscriptionId(object.subscription) : null
  await usersRepo.atualizarPlanoPorAssinatura(user.id, { plan: subscription?.plan || null, planActive: true })
  return { status: 'paid' }
}

// past_due é aviso, não revogação (ver SUBSCRIPTION_STATUSES_REVOKE_ACCESS) —
// 'customer.subscription.updated' (que a Stripe dispara junto) é quem
// sincroniza o status 'past_due' em si; aqui só registra o log e avisa o
// cliente. Decisão registrada no IA.md de 10/09/2026 ("decidir alerta ao
// cliente em falha de cobrança recorrente"): a cada tentativa que falhar, não
// só perto do cancelamento — mais simples (um evento = um e-mail) e dá ao
// cliente a chance de agir cedo. E-mail best-effort: falha de envio (ex.:
// Gmail fora do ar) vira log de erro e não derruba o webhook, mesmo padrão já
// usado no alerta de pagamento não vinculado.
async function handleInvoicePaymentFailed(object) {
  const user = object?.customer ? await usersRepo.buscarPorStripeCustomerId(object.customer) : null
  await addLog(
    'err',
    `Falha de cobrança recorrente da assinatura (invoice.payment_failed). ` +
    `invoice=${object?.id || 'desconhecida'} customer=${object?.customer || 'desconhecido'}` +
    (user?.id ? ` user=${user.id}` : ' (conta não identificada)')
  )

  if (user?.email) {
    const subscription = object?.subscription ? await subscriptionsRepo.buscarPorStripeSubscriptionId(object.subscription) : null
    const plan = PLANS[canonicalPlanId(subscription?.plan || user.plan)]
    try {
      await mailer.enviarEmailFalhaCobrancaAssinatura(user.email, {
        fullName: user.fullName || user.full_name || null,
        planName: plan?.name || null,
      })
    } catch (error) {
      await addLog('err', `Falha ao enviar aviso de cobrança recusada ao cliente: ${error.message}`)
    }
  }

  return { status: 'failed' }
}

// Decisão registrada no IA.md de 11/09/2026 (task "decidir o que fazer em
// reembolso e disputa", Trilha B): reembolso TOTAL revoga acesso na hora —
// o dinheiro já voltou, não faz sentido o cliente continuar com acesso
// completo. Reembolso PARCIAL não revoga sozinho (pode ser cortesia
// pontual): só alerta um admin para decidir caso a caso. `charge.refunded`
// (boolean) só é true em reembolso total — confirmado contra
// docs.stripe.com/api/charges/object, 11/09/2026; reembolso parcial só move
// `amount_refunded`, sem marcar `refunded`.
async function handleChargeRefunded(object) {
  const isFullRefund = object?.refunded === true
  const user = object?.customer ? await usersRepo.buscarPorStripeCustomerId(object.customer) : null

  if (!isFullRefund) {
    await addLog('err', `Reembolso parcial recebido (charge.refunded). charge=${object?.id || 'desconhecida'} customer=${object?.customer || 'desconhecido'} valor_reembolsado=${object?.amount_refunded} de ${object?.amount} ${String(object?.currency || '').toUpperCase()}` + (user?.id ? ` user=${user.id}` : ' (conta não identificada)'))
    await alertAdminsEventoStripe(
      'Reembolso parcial recebido — decisão manual necessária',
      'A Stripe registrou um reembolso parcial. O acesso do cliente não foi revogado automaticamente — avalie se cabe alguma ação.',
      [['Charge', object?.id], ['Cliente (Stripe)', object?.customer], ['Conta no app', user?.id ? `#${user.id} (${user.email})` : 'não identificada'], ['Valor reembolsado', `${Number(object?.amount_refunded || 0) / 100} de ${Number(object?.amount || 0) / 100} ${String(object?.currency || '').toUpperCase()}`]]
    )
    return { status: 'partial_refund' }
  }

  if (!user?.id) {
    await addLog('err', `Reembolso total sem conta identificada (charge.refunded). charge=${object?.id || 'desconhecida'} customer=${object?.customer || 'desconhecido'}`)
    await alertAdminsEventoStripe(
      'Reembolso total sem conta identificada',
      'A Stripe confirmou um reembolso total, mas não foi possível identificar a conta para revogar o acesso — verifique manualmente.',
      [['Charge', object?.id], ['Cliente (Stripe)', object?.customer], ['Valor', `${Number(object?.amount || 0) / 100} ${String(object?.currency || '').toUpperCase()}`]]
    )
    return { status: 'unlinked' }
  }

  await usersRepo.atualizarPlanoPorAssinatura(user.id, { planActive: false })
  await addLog('ok', `Acesso revogado por reembolso total (charge.refunded). charge=${object.id} user=${user.id}`, null, null, user.id)
  return { status: 'refunded' }
}

// Disputa/chargeback (task "decidir o que fazer em reembolso e disputa",
// 11/09/2026): só alerta um admin, nunca revoga acesso sozinho — diferente
// do reembolso, uma disputa pode ser engano do cliente e leva dias para
// resolver; cortar acesso de quem nunca devia ter sido cortado é pior do
// que aguardar uma decisão humana. Não tenta resolver a conta: o objeto
// Dispute não carrega `customer` diretamente (confirmado contra
// docs.stripe.com/api/disputes/object, 11/09/2026 — só `charge`/
// `payment_intent`), e buscar o Charge só para identificar o cliente seria
// uma chamada extra à Stripe sem necessidade, já que a decisão é sempre
// alertar, nunca agir sozinho — o admin já pode olhar o charge no dashboard.
async function handleChargeDisputeCreated(object) {
  await addLog('err', `Disputa/chargeback aberta (charge.dispute.created). dispute=${object?.id || 'desconhecida'} charge=${object?.charge || 'desconhecido'} motivo=${object?.reason || 'não informado'} status=${object?.status || 'desconhecido'}`)
  await alertAdminsEventoStripe(
    'Disputa/chargeback aberta',
    'Um cliente contestou uma cobrança junto ao banco. O acesso não foi revogado — disputas podem ser resolvidas a favor da empresa, e podem levar dias.',
    [['Disputa', object?.id], ['Charge', object?.charge], ['Motivo', object?.reason], ['Status', object?.status], ['Valor', `${Number(object?.amount || 0) / 100} ${String(object?.currency || '').toUpperCase()}`]]
  )
  return { status: 'disputed' }
}

async function handleWebhook(event) {
  const object = event?.data?.object
  if (!object?.id) return { status: 'ignored' }

  if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
    if (event.type === 'checkout.session.completed' && object.payment_status !== 'paid') return { status: 'pending' }
    const metadata = object.metadata || {}
    const toPlan = canonicalPlanId(metadata.to_plan)

    if (toPlan) {
      let confirmed
      try {
        confirmed = await billingRepo.confirmarPagamento({
          gatewaySessionId: object.id,
          gatewayPaymentId: readPaymentIntentId(object.payment_intent),
          amountCents: Number(object.amount_total),
          currency: String(object.currency || '').toLowerCase(),
          toPlan,
        })
      } catch (error) {
        // Divergência de valor/moeda/plano entre o que foi cobrado e o que
        // foi registrado (ex.: Stripe Tax, cupom, preço mudou entre criar o
        // checkout e o cliente pagar) não é falha de servidor — é caso de
        // reconciliação, como um pagamento sem vínculo. Tratar como 500
        // faria a Stripe reentregar pra sempre com o mesmo resultado,
        // deixando o cliente pago sem plano num laço invisível. Qualquer
        // outro erro (ex.: falha real de banco) continua subindo — a Stripe
        // deve reentregar nesse caso.
        if (error.code === 'amount_mismatch' || error.code === 'plan_mismatch') {
          return logUnlinkedPayment(object, error.message)
        }
        throw error
      }
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

  if (event.type === 'customer.subscription.created') return handleSubscriptionCreated(object)
  if (event.type === 'customer.subscription.updated') return handleSubscriptionUpdated(object)
  if (event.type === 'customer.subscription.deleted') return handleSubscriptionDeleted(object)
  if (event.type === 'invoice.paid') return handleInvoicePaid(object)
  if (event.type === 'invoice.payment_failed') return handleInvoicePaymentFailed(object)
  if (event.type === 'charge.refunded') return handleChargeRefunded(object)
  if (event.type === 'charge.dispute.created') return handleChargeDisputeCreated(object)

  return { status: 'ignored' }
}

module.exports = { BillingError, billingMonth, publicCharge, requestPlanChange, getStatus, getPlanDirectLink, handleWebhook, getReconciliationReport, linkPaymentManually, createBillingPortalSession, cancelSubscriptionForUser }
