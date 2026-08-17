const stripeGateway = require('./stripeGateway')

function getGateway() {
  const name = String(process.env.PAYMENT_GATEWAY || 'stripe').toLowerCase()
  if (name === 'stripe') return stripeGateway
  return {
    isConfigured: () => false,
    createCheckout: () => stripeGateway.gatewayError('O gateway de pagamento configurado não é suportado.', { code: 'payment_gateway_unsupported', statusCode: 503 }),
    expireCheckout: () => stripeGateway.gatewayError('O gateway de pagamento configurado não é suportado.', { code: 'payment_gateway_unsupported', statusCode: 503 }),
    verifyWebhook: () => stripeGateway.gatewayError('O gateway de pagamento configurado não é suportado.', { code: 'payment_gateway_unsupported', statusCode: 503 }),
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

module.exports = { isConfigured, createCheckout, expireCheckout, verifyWebhook }
