const stripeGateway = require('./stripeGateway')

function getGateway() {
  const name = String(process.env.PAYMENT_GATEWAY || 'stripe').toLowerCase()
  if (name === 'stripe') return stripeGateway
  const unsupportedError = () => stripeGateway.gatewayError('O gateway de pagamento configurado não é suportado.', { code: 'payment_gateway_unsupported', statusCode: 503 })
  // async para que o erro sempre chegue como Promise rejeitada, igual ao
  // contrato assíncrono do gateway real — um throw síncrono aqui escaparia de
  // quem trata a chamada só com .catch() sem envolver em try/await.
  const unsupportedAsync = async () => { throw unsupportedError() }
  return {
    isConfigured: () => false,
    createCheckout: unsupportedAsync,
    expireCheckout: unsupportedAsync,
    getCheckoutSession: unsupportedAsync,
    listCheckoutSessions: unsupportedAsync,
    updateSubscriptionPlan: unsupportedAsync,
    // verifyWebhook é síncrona no gateway real (chamada sem await, dentro de
    // try/catch puro na rota do webhook) — o fallback precisa lançar na hora
    // por igual, ou o erro passaria batido pelo try/catch síncrono do chamador.
    verifyWebhook: () => { throw unsupportedError() },
  }
}

function isConfigured() {
  return getGateway().isConfigured()
}

function createCheckout(args) {
  return getGateway().createCheckout(args)
}

function verifyWebhook(rawBody, signatureHeader) {
  return getGateway().verifyWebhook(rawBody, signatureHeader)
}

function expireCheckout(gatewaySessionId) {
  return getGateway().expireCheckout(gatewaySessionId)
}

function getCheckoutSession(sessionId) {
  return getGateway().getCheckoutSession(sessionId)
}

function listCheckoutSessions(args) {
  return getGateway().listCheckoutSessions(args)
}

function updateSubscriptionPlan(args) {
  return getGateway().updateSubscriptionPlan(args)
}

module.exports = { isConfigured, createCheckout, expireCheckout, verifyWebhook, getCheckoutSession, listCheckoutSessions, updateSubscriptionPlan }
