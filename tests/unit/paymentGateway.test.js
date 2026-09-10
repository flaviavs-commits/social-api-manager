const originalEnv = { ...process.env }
const paymentGateway = require('../../src/services/billing/paymentGateway')

afterEach(() => { process.env = { ...originalEnv } })

describe('paymentGateway — seleção de gateway', () => {
  test('métodos assíncronos rejeitam (nunca resolvem com um Error como valor)', async () => {
    process.env.PAYMENT_GATEWAY = 'outro'

    await expect(paymentGateway.createCheckout({})).rejects.toMatchObject({ code: 'payment_gateway_unsupported' })
    await expect(paymentGateway.expireCheckout('cs_1')).rejects.toMatchObject({ code: 'payment_gateway_unsupported' })
    await expect(paymentGateway.getCheckoutSession('cs_1')).rejects.toMatchObject({ code: 'payment_gateway_unsupported' })
    await expect(paymentGateway.listCheckoutSessions({})).rejects.toMatchObject({ code: 'payment_gateway_unsupported' })
    expect(paymentGateway.isConfigured()).toBe(false)
  })

  test('verifyWebhook continua síncrono e lança na hora, como o gateway real', () => {
    process.env.PAYMENT_GATEWAY = 'outro'

    expect(() => paymentGateway.verifyWebhook(Buffer.from('{}'), 't=1,v1=x')).toThrow(expect.objectContaining({ code: 'payment_gateway_unsupported' }))
  })
})
