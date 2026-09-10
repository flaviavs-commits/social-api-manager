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
      amountCents: 11550,
      planAmountCents: 10050,
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

  test('busca uma sessão de checkout pelo id', async () => {
    global.fetch.mockResolvedValue({ ok: true, json: async () => ({ id: 'cs_123', payment_status: 'paid' }) })

    const result = await stripeGateway.getCheckoutSession('cs_123')

    expect(result).toEqual({ id: 'cs_123', payment_status: 'paid' })
    const [url] = global.fetch.mock.calls[0]
    expect(url).toBe('https://api.stripe.com/v1/checkout/sessions/cs_123')
  })

  test('propaga 404 quando a sessão não existe na Stripe', async () => {
    global.fetch.mockResolvedValue({ ok: false, status: 404, json: async () => ({ error: { message: 'No such checkout session' } }) })

    await expect(stripeGateway.getCheckoutSession('cs_inexistente')).rejects.toMatchObject({ statusCode: 404 })
  })

  test('lista sessões concluídas com o filtro created[gte] e status complete', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ id: 'cs_1' }, { id: 'cs_2' }], has_more: false }),
    })

    const result = await stripeGateway.listCheckoutSessions({ createdGteSeconds: 1700000000 })

    expect(result).toEqual({ sessions: [{ id: 'cs_1' }, { id: 'cs_2' }], truncated: false })
    const [url] = global.fetch.mock.calls[0]
    expect(url).toContain('status=complete')
    expect(url).toContain('created%5Bgte%5D=1700000000')
  })

  test('pagina até o limite e marca truncated quando ainda há mais páginas', async () => {
    const pagina = n => ({ id: `cs_${n}` })
    global.fetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [pagina(1)], has_more: true }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [pagina(2)], has_more: true }) })

    const result = await stripeGateway.listCheckoutSessions({ maxSessions: 2 })

    expect(result.sessions).toHaveLength(2)
    expect(result.truncated).toBe(true)
    expect(global.fetch).toHaveBeenCalledTimes(2)
  })
})
