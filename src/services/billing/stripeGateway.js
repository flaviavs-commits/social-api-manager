const crypto = require('crypto')

const STRIPE_API_URL = 'https://api.stripe.com/v1'
const WEBHOOK_TOLERANCE_SECONDS = 5 * 60

function gatewayError(message, { code = 'gateway_error', statusCode = 502, uncertain = false } = {}) {
  const error = new Error(message)
  error.code = code
  error.statusCode = statusCode
  error.uncertain = uncertain
  return error
}

function getBaseUrl() {
  const value = process.env.FRONTEND_URL || process.env.BASE_URL
  if (!value) throw gatewayError('A URL pública do aplicativo não está configurada.', { code: 'payment_return_url_missing', statusCode: 503 })
  try {
    const url = new URL(value)
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('protocolo inválido')
    return url.origin
  } catch {
    throw gatewayError('A URL pública do aplicativo não está configurada corretamente.', { code: 'payment_return_url_invalid', statusCode: 503 })
  }
}

function getReturnUrl(name, fallbackPath) {
  const configured = process.env[name]
  if (configured) return configured
  return `${getBaseUrl()}${fallbackPath}`
}

function ensureStripeConfigured() {
  if (String(process.env.PAYMENT_GATEWAY || 'stripe').toLowerCase() !== 'stripe') {
    throw gatewayError('O gateway de pagamento configurado não é suportado.', { code: 'payment_gateway_unsupported', statusCode: 503 })
  }
  if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_WEBHOOK_SECRET) {
    throw gatewayError('O gateway de pagamento ainda não foi configurado por completo.', { code: 'payment_gateway_not_configured', statusCode: 503 })
  }
}

function isConfigured() {
  return String(process.env.PAYMENT_GATEWAY || 'stripe').toLowerCase() === 'stripe' && Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_WEBHOOK_SECRET)
}

async function requestStripe(path, options = {}) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10_000)
  try {
    return await fetch(`${STRIPE_API_URL}${path}`, {
      ...options,
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
        ...options.headers,
      },
    })
  } catch (error) {
    throw gatewayError('Não foi possível confirmar a resposta do gateway.', { code: 'gateway_connection_error', statusCode: 503, uncertain: true })
  } finally {
    clearTimeout(timeout)
  }
}

// Assinatura recorrente de verdade (decisão de 10/09/2026, task "definir se
// os planos mensais são assinatura ou cobrança avulsa"). mode=subscription
// exige que cada line_item referencie um Price recorrente — usamos
// price_data com `recurring` inline em vez de Price pré-criado na Stripe,
// para não ter que gerenciar Price IDs manualmente a cada mudança de preço
// (confirmado contra docs.stripe.com/api/checkout/sessions/create,
// 10/09/2026: price_data aceita `recurring` e isso é o suficiente).
// O MeuEcoo também virou recorrente na mesma assinatura (decisão explícita
// do usuário, mesma data) — os dois itens cobram todo mês juntos.
async function createCheckout({ billingId, userId, email, stripeCustomerId, fromPlan, toPlan, planName, amountCents, planAmountCents = amountCents, currency, billingMonth, idempotencyKey, meuEcooSelected = false, meuEcooAmountCents = 0 }) {
  ensureStripeConfigured()
  if (!Number.isInteger(Number(amountCents)) || Number(amountCents) <= 0 || !Number.isInteger(Number(planAmountCents)) || Number(planAmountCents) <= 0) {
    throw gatewayError('O valor do plano não é válido.', { code: 'invalid_amount', statusCode: 400 })
  }

  const params = new URLSearchParams()
  params.set('mode', 'subscription')
  params.set('success_url', getReturnUrl('PAYMENT_SUCCESS_URL', '/app/perfil?billing=success'))
  params.set('cancel_url', getReturnUrl('PAYMENT_CANCEL_URL', '/app/perfil?billing=cancelled'))
  // Reaproveita o mesmo Stripe Customer entre assinaturas do mesmo usuário
  // (evita duplicar Customer a cada troca de plano); só manda customer_email
  // na primeira vez, quando ainda não existe um Customer salvo.
  if (stripeCustomerId) params.set('customer', stripeCustomerId)
  else params.set('customer_email', email)
  params.set('client_reference_id', `billing:${billingId}`)
  params.set('line_items[0][price_data][currency]', String(currency).toLowerCase())
  params.set('line_items[0][price_data][unit_amount]', String(planAmountCents))
  params.set('line_items[0][price_data][recurring][interval]', 'month')
  params.set('line_items[0][price_data][product_data][name]', `Plano ${planName}`)
  params.set('line_items[0][price_data][product_data][description]', `Troca do plano ${fromPlan} para ${toPlan}`)
  params.set('line_items[0][quantity]', '1')
  if (meuEcooSelected && Number(meuEcooAmountCents) > 0) {
    params.set('line_items[1][price_data][currency]', String(currency).toLowerCase())
    params.set('line_items[1][price_data][unit_amount]', String(Math.round(Number(meuEcooAmountCents))))
    params.set('line_items[1][price_data][recurring][interval]', 'month')
    params.set('line_items[1][price_data][product_data][name]', 'MeuEcoo')
    params.set('line_items[1][price_data][product_data][description]', 'Acesso opcional ao MeuEcoo com cupom de 40% do plano Pro')
    params.set('line_items[1][quantity]', '1')
  }
  params.set('metadata[billing_id]', String(billingId))
  params.set('metadata[user_id]', String(userId))
  params.set('metadata[to_plan]', String(toPlan))
  params.set('metadata[billing_month]', String(billingMonth))
  // subscription_data.metadata é o equivalente de payment_intent_data em
  // mode=subscription (payment_intent_data só existe em mode=payment/setup).
  params.set('subscription_data[metadata][billing_id]', String(billingId))
  params.set('subscription_data[metadata][user_id]', String(userId))
  params.set('subscription_data[metadata][to_plan]', String(toPlan))
  params.set('subscription_data[metadata][billing_month]', String(billingMonth))

  const response = await requestStripe('/checkout/sessions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Idempotency-Key': idempotencyKey,
    },
    body: params,
  })
  const body = await response.json().catch(() => null)
  if (!response.ok) {
    const message = body?.error?.message || 'O gateway recusou a criação do checkout.'
    throw gatewayError(message, {
      code: body?.error?.code || `stripe_http_${response.status}`,
      statusCode: response.status >= 500 ? 503 : 502,
      uncertain: response.status >= 500,
    })
  }
  if (!body?.id || !body?.url) {
    throw gatewayError('O gateway não retornou um checkout válido.', { code: 'invalid_gateway_response', statusCode: 503, uncertain: true })
  }
  return { id: body.id, url: body.url, customer: body.customer || null }
}

async function getSubscription(subscriptionId) {
  ensureStripeConfigured()
  const response = await requestStripe(`/subscriptions/${encodeURIComponent(subscriptionId)}`, { method: 'GET' })
  const body = await response.json().catch(() => null)
  if (!response.ok) {
    const message = body?.error?.message || 'O gateway não encontrou essa assinatura.'
    throw gatewayError(message, {
      code: body?.error?.code || `stripe_http_${response.status}`,
      statusCode: response.status === 404 ? 404 : response.status >= 500 ? 503 : 502,
      uncertain: response.status >= 500,
    })
  }
  return body
}

// Troca de plano com uma assinatura já ativa (decisão de 10/09/2026, task
// "idempotência de renovação e histórico de troca de plano"): em vez de criar
// uma segunda assinatura em paralelo (o que a task encontrou como risco real
// de cobrar as duas ao mesmo tempo), atualiza os itens da assinatura
// existente — a Stripe calcula o proration sozinha na próxima fatura
// (`proration_behavior: create_prorations`, o comportamento padrão da API,
// confirmado contra docs.stripe.com/api/subscriptions/update). Só a primeira
// assinatura do usuário passa por createCheckout; toda troca subsequente
// passa por aqui.
async function updateSubscriptionPlan({ stripeSubscriptionId, planName, planAmountCents, toPlan, currency, billingId, userId, billingMonth, meuEcooSelected = false, meuEcooAmountCents = 0, idempotencyKey }) {
  ensureStripeConfigured()
  const subscription = await getSubscription(stripeSubscriptionId)
  const items = Array.isArray(subscription?.items?.data) ? subscription.items.data : []
  if (!items.length) {
    throw gatewayError('A assinatura não tem itens para atualizar.', { code: 'subscription_without_items', statusCode: 503, uncertain: true })
  }

  const planItem = items[0]
  const meuEcooItem = items[1] || null

  const params = new URLSearchParams()
  params.set('proration_behavior', 'create_prorations')
  params.set('items[0][id]', planItem.id)
  params.set('items[0][price_data][currency]', String(currency).toLowerCase())
  params.set('items[0][price_data][unit_amount]', String(planAmountCents))
  params.set('items[0][price_data][recurring][interval]', 'month')
  params.set('items[0][price_data][product_data][name]', `Plano ${planName}`)

  if (meuEcooSelected && Number(meuEcooAmountCents) > 0) {
    // Reaproveita o item existente (troca só o preço) se já havia MeuEcoo na
    // assinatura; cria um item novo se está sendo adicionado agora.
    if (meuEcooItem) params.set('items[1][id]', meuEcooItem.id)
    params.set('items[1][price_data][currency]', String(currency).toLowerCase())
    params.set('items[1][price_data][unit_amount]', String(Math.round(Number(meuEcooAmountCents))))
    params.set('items[1][price_data][recurring][interval]', 'month')
    params.set('items[1][price_data][product_data][name]', 'MeuEcoo')
  } else if (meuEcooItem) {
    // MeuEcoo estava na assinatura e deixou de ser selecionado — remove o
    // item em vez de deixar cobrando (`deleted: true` é como a API de
    // assinatura remove um item, diferente de simplesmente omiti-lo).
    params.set('items[1][id]', meuEcooItem.id)
    params.set('items[1][deleted]', 'true')
  }

  params.set('metadata[billing_id]', String(billingId))
  params.set('metadata[user_id]', String(userId))
  params.set('metadata[to_plan]', String(toPlan))
  params.set('metadata[billing_month]', String(billingMonth))

  const response = await requestStripe(`/subscriptions/${encodeURIComponent(stripeSubscriptionId)}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Idempotency-Key': idempotencyKey,
    },
    body: params,
  })
  const body = await response.json().catch(() => null)
  if (!response.ok) {
    const message = body?.error?.message || 'O gateway recusou a atualização da assinatura.'
    throw gatewayError(message, {
      code: body?.error?.code || `stripe_http_${response.status}`,
      statusCode: response.status >= 500 ? 503 : 502,
      uncertain: response.status >= 500,
    })
  }
  return { id: body.id, status: body.status }
}

// Cancelamento self-service via Customer Portal (task 4/5 da quebra de
// assinatura): a Stripe hospeda a própria tela de cancelar/trocar
// cartão/ver faturas — o app só cria a sessão e redireciona. Confirmado
// contra docs.stripe.com/api/customer_portal/sessions/create, 10/09/2026:
// `customer` + `return_url` bastam; sem `configuration`, usa a configuração
// padrão da conta Stripe (portal.stripe.com define o que o cliente pode
// fazer — cancelar, trocar cartão, ver faturas — fora do código do app).
async function createPortalSession(stripeCustomerId) {
  ensureStripeConfigured()
  // "Tem Stripe Customer?" é regra de negócio (decide se o usuário já
  // assinou alguma vez), não do gateway — validada em billingService antes
  // de chegar aqui. Este módulo só fala com a API da Stripe.
  const params = new URLSearchParams()
  params.set('customer', stripeCustomerId)
  params.set('return_url', getReturnUrl('BILLING_PORTAL_RETURN_URL', '/app/perfil'))

  const response = await requestStripe('/billing_portal/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params,
  })
  const body = await response.json().catch(() => null)
  if (!response.ok) {
    const message = body?.error?.message || 'O gateway recusou a criação do portal.'
    throw gatewayError(message, {
      code: body?.error?.code || `stripe_http_${response.status}`,
      statusCode: response.status >= 500 ? 503 : 502,
      uncertain: response.status >= 500,
    })
  }
  if (!body?.url) {
    throw gatewayError('O gateway não retornou uma sessão de portal válida.', { code: 'invalid_gateway_response', statusCode: 503, uncertain: true })
  }
  return { url: body.url }
}

async function expireCheckout(gatewaySessionId) {
  ensureStripeConfigured()
  if (!gatewaySessionId) return false
  const response = await requestStripe(`/checkout/sessions/${encodeURIComponent(gatewaySessionId)}/expire`, {
    method: 'POST',
  })
  if (!response.ok) return false
  return true
}

async function getCheckoutSession(sessionId) {
  ensureStripeConfigured()
  const response = await requestStripe(`/checkout/sessions/${encodeURIComponent(sessionId)}`, { method: 'GET' })
  const body = await response.json().catch(() => null)
  if (!response.ok) {
    const message = body?.error?.message || 'O gateway não encontrou essa sessão de pagamento.'
    throw gatewayError(message, {
      code: body?.error?.code || `stripe_http_${response.status}`,
      statusCode: response.status === 404 ? 404 : response.status >= 500 ? 503 : 502,
      uncertain: response.status >= 500,
    })
  }
  return body
}

// Usada pelo relatório de conciliação: lista sessões de checkout concluídas
// desde `createdGteSeconds` (epoch em segundos), paginando até `maxSessions`
// para manter o custo de chamadas à Stripe previsível. Filtra só `status:
// complete` no servidor — payment_status ainda precisa ser conferido pelo
// chamador, porque uma sessão "complete" pode não ter sido efetivamente paga
// (ex.: pagamento assíncrono ainda pendente).
async function listCheckoutSessions({ createdGteSeconds, maxSessions = 500 }) {
  ensureStripeConfigured()
  const sessions = []
  let startingAfter = null
  let truncated = false

  while (sessions.length < maxSessions) {
    const params = new URLSearchParams()
    params.set('status', 'complete')
    params.set('limit', '100')
    if (createdGteSeconds) params.set('created[gte]', String(createdGteSeconds))
    if (startingAfter) params.set('starting_after', startingAfter)

    const response = await requestStripe(`/checkout/sessions?${params.toString()}`, { method: 'GET' })
    const body = await response.json().catch(() => null)
    if (!response.ok) {
      const message = body?.error?.message || 'O gateway não retornou a lista de sessões.'
      throw gatewayError(message, {
        code: body?.error?.code || `stripe_http_${response.status}`,
        statusCode: response.status >= 500 ? 503 : 502,
        uncertain: response.status >= 500,
      })
    }
    const page = Array.isArray(body?.data) ? body.data : []
    sessions.push(...page)
    if (!body?.has_more || page.length === 0) break
    if (sessions.length >= maxSessions) { truncated = Boolean(body.has_more); break }
    startingAfter = page[page.length - 1]?.id
    if (!startingAfter) break
  }

  return { sessions: sessions.slice(0, maxSessions), truncated }
}

function verifyWebhook(rawBody, signatureHeader) {
  if (!process.env.STRIPE_WEBHOOK_SECRET) {
    throw gatewayError('O webhook do gateway ainda não foi configurado.', { code: 'payment_webhook_not_configured', statusCode: 503 })
  }
  const payload = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody || ''), 'utf8')
  const values = String(signatureHeader || '').split(',').reduce((result, item) => {
    const [key, value] = item.split('=', 2)
    if (key && value) result[key] = result[key] ? [].concat(result[key], value) : value
    return result
  }, {})
  const timestamp = Number(values.t)
  const signatures = Array.isArray(values.v1) ? values.v1 : values.v1 ? [values.v1] : []
  if (!Number.isSafeInteger(timestamp) || Math.abs(Math.floor(Date.now() / 1000) - timestamp) > WEBHOOK_TOLERANCE_SECONDS || !signatures.length) {
    throw gatewayError('Assinatura do webhook inválida.', { code: 'invalid_webhook_signature', statusCode: 400 })
  }

  const expected = crypto.createHmac('sha256', process.env.STRIPE_WEBHOOK_SECRET).update(`${timestamp}.${payload.toString('utf8')}`).digest('hex')
  const valid = signatures.some(signature => {
    const received = Buffer.from(String(signature))
    const expectedBuffer = Buffer.from(expected)
    return received.length === expectedBuffer.length && crypto.timingSafeEqual(received, expectedBuffer)
  })
  if (!valid) throw gatewayError('Assinatura do webhook inválida.', { code: 'invalid_webhook_signature', statusCode: 400 })

  try {
    return JSON.parse(payload.toString('utf8'))
  } catch {
    throw gatewayError('Payload do webhook inválido.', { code: 'invalid_webhook_payload', statusCode: 400 })
  }
}

module.exports = { createCheckout, expireCheckout, verifyWebhook, isConfigured, gatewayError, getCheckoutSession, listCheckoutSessions, getSubscription, updateSubscriptionPlan, createPortalSession }
