jest.mock('../../src/repositories/billingRepository', () => ({
  buscarPorMes: jest.fn(),
  criarPendente: jest.fn(),
  reservarProcessamento: jest.fn(),
  anexarCheckout: jest.fn(),
  marcarFalha: jest.fn(),
  manterProcessando: jest.fn(),
  confirmarPagamento: jest.fn(),
  marcarFalhaPorSession: jest.fn(),
}))

jest.mock('../../src/services/billing/paymentGateway', () => ({
  createCheckout: jest.fn(),
  expireCheckout: jest.fn(),
  verifyWebhook: jest.fn(),
  isConfigured: jest.fn(() => true),
}))

const billingRepo = require('../../src/repositories/billingRepository')
const paymentGateway = require('../../src/services/billing/paymentGateway')
const billingService = require('../../src/services/billing/billingService')

const user = { id: 7, email: 'cliente@allowed.test', plan: 'basico' }
const month = billingService.billingMonth(new Date('2026-08-17T12:00:00Z'))

function change(overrides = {}) {
  return {
    id: 12,
    userId: user.id,
    fromPlan: 'basico',
    toPlan: 'pro',
    amountCents: 10050,
    currency: 'brl',
    billingMonth: month,
    idempotencyKey: `plan-change-${user.id}-2026-08`,
    gateway: 'stripe',
    gatewaySessionId: null,
    status: 'pending',
    checkoutUrl: null,
    failureCode: null,
    createdAt: '2026-08-17T12:00:00.000Z',
    paidAt: null,
    ...overrides,
  }
}

beforeEach(() => {
  jest.clearAllMocks()
})

describe('billingService.requestPlanChange', () => {
  test('cria o primeiro checkout mesmo quando o plano escolhido já está no cadastro pendente', async () => {
    const pendingUser = { ...user, planActive: false }
    const pending = change({ toPlan: 'basico', amountCents: 5250 })
    billingRepo.buscarPorMes.mockResolvedValue(null)
    billingRepo.criarPendente.mockResolvedValue(pending)
    billingRepo.reservarProcessamento.mockResolvedValue(change({ toPlan: 'basico', amountCents: 5250, status: 'processing' }))
    billingRepo.anexarCheckout.mockResolvedValue(change({ toPlan: 'basico', amountCents: 5250, status: 'pending', gatewaySessionId: 'cs_basic', checkoutUrl: 'https://checkout.stripe.test/cs_basic' }))
    paymentGateway.createCheckout.mockResolvedValue({ id: 'cs_basic', url: 'https://checkout.stripe.test/cs_basic' })

    const result = await billingService.requestPlanChange({ user: pendingUser, targetPlan: 'basico', now: new Date('2026-08-17T12:00:00Z') })

    expect(result.checkoutUrl).toBe('https://checkout.stripe.test/cs_basic')
    expect(paymentGateway.createCheckout).toHaveBeenCalledWith(expect.objectContaining({
      toPlan: 'basico',
      amountCents: 5250,
    }))
  })

  test('reutiliza o checkout e não cria uma segunda cobrança no mesmo mês', async () => {
    const pending = change({ status: 'pending', gatewaySessionId: 'cs_123', checkoutUrl: 'https://checkout.stripe.test/cs_123' })
    billingRepo.buscarPorMes.mockResolvedValueOnce(null).mockResolvedValueOnce(pending)
    billingRepo.criarPendente.mockResolvedValue(change())
    billingRepo.reservarProcessamento.mockResolvedValue(change({ status: 'processing' }))
    billingRepo.anexarCheckout.mockResolvedValue(pending)
    paymentGateway.createCheckout.mockResolvedValue({ id: 'cs_123', url: pending.checkoutUrl })

    const first = await billingService.requestPlanChange({ user, targetPlan: 'pro', now: new Date('2026-08-17T12:00:00Z') })
    const second = await billingService.requestPlanChange({ user, targetPlan: 'pro', now: new Date('2026-08-17T12:00:00Z') })

    expect(first.checkoutUrl).toBe(pending.checkoutUrl)
    expect(second.checkoutUrl).toBe(pending.checkoutUrl)
    expect(paymentGateway.createCheckout).toHaveBeenCalledTimes(1)
    expect(paymentGateway.createCheckout).toHaveBeenCalledWith(expect.objectContaining({
      idempotencyKey: 'plan-change-7-2026-08',
      amountCents: 10050,
    }))
  })

  test('recusa uma troca para outro plano depois de já reservar a cobrança mensal', async () => {
    billingRepo.buscarPorMes.mockResolvedValue(change({ toPlan: 'pro', gatewaySessionId: 'cs_123' }))

    await expect(billingService.requestPlanChange({ user, targetPlan: 'premium', now: new Date('2026-08-17T12:00:00Z') }))
      .rejects.toMatchObject({ code: 'monthly_charge_exists', statusCode: 409 })
    expect(paymentGateway.createCheckout).not.toHaveBeenCalled()
  })

  test('mantém o registro em processamento quando a resposta do gateway é incerta', async () => {
    billingRepo.buscarPorMes.mockResolvedValue(null)
    billingRepo.criarPendente.mockResolvedValue(change())
    billingRepo.reservarProcessamento.mockResolvedValue(change({ status: 'processing' }))
    const error = Object.assign(new Error('timeout'), { code: 'gateway_connection_error', uncertain: true })
    paymentGateway.createCheckout.mockRejectedValue(error)

    const result = await billingService.requestPlanChange({ user, targetPlan: 'pro', now: new Date('2026-08-17T12:00:00Z') })

    expect(result).toMatchObject({ status: 'processing', httpStatus: 202, charged: false })
    expect(billingRepo.manterProcessando).toHaveBeenCalledWith(12)
    expect(billingRepo.marcarFalha).not.toHaveBeenCalled()
  })

  test('rejeita o antigo identificador de plano gratuito', async () => {
    await expect(billingService.requestPlanChange({ user, targetPlan: 'gratuito' }))
      .rejects.toMatchObject({ code: 'invalid_plan', statusCode: 400 })
    expect(paymentGateway.createCheckout).not.toHaveBeenCalled()
  })
})

describe('billingService.handleWebhook', () => {
  test('confirma uma sessão paga por meio do repositório transacional', async () => {
      billingRepo.confirmarPagamento.mockResolvedValue({ id: 12, status: 'paid', toPlan: 'pro' })

    const result = await billingService.handleWebhook({
      type: 'checkout.session.completed',
        data: { object: { id: 'cs_123', payment_status: 'paid', amount_total: 10050, currency: 'brl', payment_intent: 'pi_123', metadata: { to_plan: 'pro' } } },
    })

    expect(result).toEqual({ status: 'paid' })
    expect(billingRepo.confirmarPagamento).toHaveBeenCalledWith({
      gatewaySessionId: 'cs_123',
      gatewayPaymentId: 'pi_123',
      amountCents: 10050,
      currency: 'brl',
        toPlan: 'pro',
    })
  })

  test('não reativa um checkout cancelado depois do downgrade', async () => {
      billingRepo.confirmarPagamento.mockResolvedValue({ id: 12, status: 'cancelled', toPlan: 'pro' })

    const result = await billingService.handleWebhook({
      type: 'checkout.session.completed',
        data: { object: { id: 'cs_cancelled', payment_status: 'paid', amount_total: 10050, currency: 'brl', metadata: { to_plan: 'pro' } } },
    })

    expect(result).toEqual({ status: 'ignored' })
  })
})
