const crypto = require('crypto')

const originalEnv = { ...process.env }
const stripeGateway = require('../../src/services/billing/stripeGateway')

beforeEach(() => {
  process.env.PAYMENT_GATEWAY = 'stripe'
  process.env.STRIPE_SECRET_KEY = 'sk_test_example'
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_example'
  process.env.FRONTEND_URL = 'https://app.example.com'
  global.fetch = jest.fn()
})

afterAll(() => {
  process.env = originalEnv
})

describe('stripeGateway', () => {
  test('cria checkout hospedado com chave idempotente e sem dados de cartão', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'cs_test_123', url: 'https://checkout.stripe.test/cs_test_123' }),
    })

    const result = await stripeGateway.createCheckout({
      billingId: 12,
      userId: 7,
      email: 'cliente@example.com',
      fromPlan: 'basico',
      toPlan: 'pro',
      planName: 'EcooMidia Pro',
      amountCents: 10050,
      currency: 'brl',
      billingMonth: '2026-08-01',
      idempotencyKey: 'plan-change-7-2026-08',
      meuEcooSelected: true,
      meuEcooAmountCents: 1500,
    })

    expect(result).toEqual({ id: 'cs_test_123', url: 'https://checkout.stripe.test/cs_test_123' })
    const [, options] = global.fetch.mock.calls[0]
    expect(options.headers['Idempotency-Key']).toBe('plan-change-7-2026-08')
    expect(String(options.body)).toContain('line_items%5B0%5D%5Bprice_data%5D%5Bunit_amount%5D=10050')
    expect(String(options.body)).toContain('line_items%5B1%5D%5Bprice_data%5D%5Bunit_amount%5D=1500')
    expect(String(options.body)).toContain('line_items%5B1%5D%5Bprice_data%5D%5Bproduct_data%5D%5Bname%5D=MeuEcoo')
    expect(String(options.body)).not.toMatch(/card|cvv|cvc|number/i)
  })

  test('valida a assinatura do webhook sobre o corpo bruto', () => {
    const payload = JSON.stringify({ id: 'evt_123', type: 'checkout.session.completed' })
    const timestamp = Math.floor(Date.now() / 1000)
    const signature = crypto.createHmac('sha256', process.env.STRIPE_WEBHOOK_SECRET).update(`${timestamp}.${payload}`).digest('hex')

    expect(stripeGateway.verifyWebhook(Buffer.from(payload), `t=${timestamp},v1=${signature}`)).toEqual(JSON.parse(payload))
    expect(() => stripeGateway.verifyWebhook(Buffer.from(payload), `t=${timestamp},v1=invalid`)).toThrow(expect.objectContaining({ code: 'invalid_webhook_signature' }))
  })
})
