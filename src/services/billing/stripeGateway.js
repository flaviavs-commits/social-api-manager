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

async function createCheckout({ billingId, userId, email, fromPlan, toPlan, planName, amountCents, planAmountCents = amountCents, currency, billingMonth, idempotencyKey, meuEcooSelected = false, meuEcooAmountCents = 0 }) {
  ensureStripeConfigured()
  if (!Number.isInteger(Number(amountCents)) || Number(amountCents) <= 0 || !Number.isInteger(Number(planAmountCents)) || Number(planAmountCents) <= 0) {
    throw gatewayError('O valor do plano não é válido.', { code: 'invalid_amount', statusCode: 400 })
  }

  const params = new URLSearchParams()
  params.set('mode', 'payment')
  params.set('success_url', getReturnUrl('PAYMENT_SUCCESS_URL', '/app/perfil?billing=success'))
  params.set('cancel_url', getReturnUrl('PAYMENT_CANCEL_URL', '/app/perfil?billing=cancelled'))
  params.set('customer_email', email)
  params.set('client_reference_id', `billing:${billingId}`)
  params.set('line_items[0][price_data][currency]', String(currency).toLowerCase())
  params.set('line_items[0][price_data][unit_amount]', String(planAmountCents))
  params.set('line_items[0][price_data][product_data][name]', `Plano ${planName}`)
  params.set('line_items[0][price_data][product_data][description]', `Troca do plano ${fromPlan} para ${toPlan}`)
  params.set('line_items[0][quantity]', '1')
  if (meuEcooSelected && Number(meuEcooAmountCents) > 0) {
    params.set('line_items[1][price_data][currency]', String(currency).toLowerCase())
    params.set('line_items[1][price_data][unit_amount]', String(Math.round(Number(meuEcooAmountCents))))
    params.set('line_items[1][price_data][product_data][name]', 'MeuEcoo')
    params.set('line_items[1][price_data][product_data][description]', 'Acesso opcional ao MeuEcoo com cupom de 40% do plano Pro')
    params.set('line_items[1][quantity]', '1')
  }
  params.set('metadata[billing_id]', String(billingId))
  params.set('metadata[user_id]', String(userId))
  params.set('metadata[to_plan]', String(toPlan))
  params.set('metadata[billing_month]', String(billingMonth))
  params.set('payment_intent_data[metadata][billing_id]', String(billingId))
  params.set('payment_intent_data[metadata][user_id]', String(userId))
  params.set('payment_intent_data[metadata][to_plan]', String(toPlan))
  params.set('payment_intent_data[metadata][billing_month]', String(billingMonth))

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
  return { id: body.id, url: body.url }
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

module.exports = { createCheckout, expireCheckout, verifyWebhook, isConfigured, gatewayError }
