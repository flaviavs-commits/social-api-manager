jest.mock('../../src/repositories/billingRepository', () => ({
  buscarPorMes: jest.fn(),
  buscarPorGatewaySessions: jest.fn(),
  criarPendente: jest.fn(),
  atualizarItensMeuEcoo: jest.fn(),
  reservarProcessamento: jest.fn(),
  anexarCheckout: jest.fn(),
  marcarFalha: jest.fn(),
  manterProcessando: jest.fn(),
  confirmarPagamento: jest.fn(),
  confirmarPagamentoDireto: jest.fn(),
  marcarFalhaPorSession: jest.fn(),
  reservarEnvioMeuEcoo: jest.fn(),
  marcarEnvioMeuEcooConcluido: jest.fn(),
  marcarFalhaEnvioMeuEcoo: jest.fn(),
}))

jest.mock('../../src/repositories/usersRepository', () => ({
  buscarPorId: jest.fn(),
  buscarPorEmail: jest.fn(),
}))

jest.mock('../../src/services/billing/paymentGateway', () => ({
  createCheckout: jest.fn(),
  expireCheckout: jest.fn(),
  verifyWebhook: jest.fn(),
  isConfigured: jest.fn(() => true),
  getCheckoutSession: jest.fn(),
  listCheckoutSessions: jest.fn(),
}))

jest.mock('../../src/services/mailer', () => ({
  enviarEmailAcessoMeuEcoo: jest.fn(),
}))

const billingRepo = require('../../src/repositories/billingRepository')
const usersRepo = require('../../src/repositories/usersRepository')
const paymentGateway = require('../../src/services/billing/paymentGateway')
const mailer = require('../../src/services/mailer')
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
    meuEcooSelected: false,
    meuEcooAmountCents: 0,
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

  test('adiciona o MeuEcoo opcional ao total do Pro pelo preço com desconto', async () => {
    billingRepo.buscarPorMes.mockResolvedValue(null)
    billingRepo.criarPendente.mockResolvedValue(change({ amountCents: 11550, meuEcooSelected: true, meuEcooAmountCents: 1500 }))
    billingRepo.reservarProcessamento.mockResolvedValue(change({ status: 'processing', amountCents: 11550, meuEcooSelected: true, meuEcooAmountCents: 1500 }))
    billingRepo.anexarCheckout.mockResolvedValue(change({ status: 'pending', amountCents: 11550, meuEcooSelected: true, meuEcooAmountCents: 1500, gatewaySessionId: 'cs_meuecoo', checkoutUrl: 'https://checkout.stripe.test/cs_meuecoo' }))
    paymentGateway.createCheckout.mockResolvedValue({ id: 'cs_meuecoo', url: 'https://checkout.stripe.test/cs_meuecoo' })

    const result = await billingService.requestPlanChange({ user, targetPlan: 'pro', meuEcoo: true, now: new Date('2026-08-17T12:00:00Z') })

    expect(result.charge).toMatchObject({ meuEcooSelected: true, meuEcooAmountCents: 1500 })
    expect(billingRepo.criarPendente).toHaveBeenCalledWith(expect.objectContaining({ amountCents: 11550, meuEcooSelected: true, meuEcooAmountCents: 1500 }))
    expect(paymentGateway.createCheckout).toHaveBeenCalledWith(expect.objectContaining({ amountCents: 11550, planAmountCents: 10050, meuEcooSelected: true, meuEcooAmountCents: 1500 }))
  })

  test('atualiza a composição antes de repetir checkout sem sessão do gateway', async () => {
    const failed = change({ status: 'failed', amountCents: 10050, meuEcooSelected: false, meuEcooAmountCents: 0 })
    const updated = change({ status: 'failed', amountCents: 11550, meuEcooSelected: true, meuEcooAmountCents: 1500 })
    billingRepo.buscarPorMes.mockResolvedValue(failed)
    billingRepo.atualizarItensMeuEcoo.mockResolvedValue(updated)
    billingRepo.reservarProcessamento.mockResolvedValue({ ...updated, status: 'processing' })
    billingRepo.anexarCheckout.mockResolvedValue({ ...updated, status: 'pending', gatewaySessionId: 'cs_retry', checkoutUrl: 'https://checkout.stripe.test/cs_retry' })
    paymentGateway.createCheckout.mockResolvedValue({ id: 'cs_retry', url: 'https://checkout.stripe.test/cs_retry' })

    const result = await billingService.requestPlanChange({ user, targetPlan: 'pro', meuEcoo: true, now: new Date('2026-08-17T12:00:00Z') })

    expect(result.checkoutUrl).toBe('https://checkout.stripe.test/cs_retry')
    expect(billingRepo.atualizarItensMeuEcoo).toHaveBeenCalledWith(12, {
      amountCents: 11550,
      meuEcooSelected: true,
      meuEcooAmountCents: 1500,
    })
    expect(paymentGateway.createCheckout).toHaveBeenCalledWith(expect.objectContaining({ amountCents: 11550, planAmountCents: 10050, meuEcooAmountCents: 1500 }))
  })

  test('rejeita o antigo identificador de plano gratuito', async () => {
    await expect(billingService.requestPlanChange({ user, targetPlan: 'gratuito' }))
      .rejects.toMatchObject({ code: 'invalid_plan', statusCode: 400 })
    expect(paymentGateway.createCheckout).not.toHaveBeenCalled()
  })
})

describe('billingService.handleWebhook', () => {
  test('confirma uma sessão paga por meio do repositório transacional', async () => {
    billingRepo.confirmarPagamento.mockResolvedValue({ id: 12, status: 'paid', toPlan: 'pro', meuEcooSelected: true })
    billingRepo.reservarEnvioMeuEcoo.mockResolvedValue({ id: 12, status: 'paid' })
    mailer.enviarEmailAcessoMeuEcoo.mockResolvedValue(undefined)

    const result = await billingService.handleWebhook({
      type: 'checkout.session.completed',
        data: { object: { id: 'cs_123', payment_status: 'paid', amount_total: 10050, currency: 'brl', payment_intent: 'pi_123', customer_email: 'cliente@allowed.test', metadata: { to_plan: 'pro' } } },
    })

    expect(result).toEqual({ status: 'paid' })
    expect(billingRepo.confirmarPagamento).toHaveBeenCalledWith({
      gatewaySessionId: 'cs_123',
      gatewayPaymentId: 'pi_123',
      amountCents: 10050,
      currency: 'brl',
      toPlan: 'pro',
    })
    expect(mailer.enviarEmailAcessoMeuEcoo).toHaveBeenCalledWith('cliente@allowed.test', expect.objectContaining({
      planName: 'EcooMidia Pro',
      accessUrl: 'https://www.meuecoo.com/',
    }))
    expect(billingRepo.marcarEnvioMeuEcooConcluido).toHaveBeenCalledWith(12)
  })

  test('não envia acesso ao MeuEcoo quando o adicional Pro não foi selecionado', async () => {
    billingRepo.confirmarPagamento.mockResolvedValue({ id: 12, status: 'paid', toPlan: 'pro', meuEcooSelected: false })

    const result = await billingService.handleWebhook({
      type: 'checkout.session.completed',
      data: { object: { id: 'cs_pro_sem_meuecoo', payment_status: 'paid', amount_total: 10050, currency: 'brl', metadata: { to_plan: 'pro' } } },
    })

    expect(result).toEqual({ status: 'paid' })
    expect(mailer.enviarEmailAcessoMeuEcoo).not.toHaveBeenCalled()
    expect(billingRepo.reservarEnvioMeuEcoo).not.toHaveBeenCalled()
  })

  test('não reativa um checkout cancelado depois do downgrade', async () => {
      billingRepo.confirmarPagamento.mockResolvedValue({ id: 12, status: 'cancelled', toPlan: 'pro' })

    const result = await billingService.handleWebhook({
      type: 'checkout.session.completed',
        data: { object: { id: 'cs_cancelled', payment_status: 'paid', amount_total: 10050, currency: 'brl', metadata: { to_plan: 'pro' } } },
    })

    expect(result).toEqual({ status: 'ignored' })
  })

  test('associa um pagamento feito direto por um Payment Link via client_reference_id', async () => {
    usersRepo.buscarPorId.mockResolvedValue({ id: 7, email: 'cliente@allowed.test', plan: 'basico' })
    billingRepo.confirmarPagamentoDireto.mockResolvedValue({ id: 99, userId: 7, status: 'paid', toPlan: 'pro', meuEcooSelected: false })

    const result = await billingService.handleWebhook({
      type: 'checkout.session.completed',
      data: { object: { id: 'cs_direct_link', payment_status: 'paid', amount_total: 10050, currency: 'brl', payment_intent: 'pi_direct', client_reference_id: 'user:7' } },
    })

    expect(result).toEqual({ status: 'paid' })
    expect(usersRepo.buscarPorId).toHaveBeenCalledWith(7)
    expect(billingRepo.confirmarPagamentoDireto).toHaveBeenCalledWith(expect.objectContaining({
      userId: 7,
      toPlan: 'pro',
      amountCents: 10050,
      currency: 'brl',
      gatewaySessionId: 'cs_direct_link',
      gatewayPaymentId: 'pi_direct',
    }))
  })

  test('marca como não vinculado o pagamento por link sem identificação alguma', async () => {
    const result = await billingService.handleWebhook({
      type: 'checkout.session.completed',
      data: { object: { id: 'cs_no_ref', payment_status: 'paid', amount_total: 10050, currency: 'brl' } },
    })

    expect(result).toMatchObject({ status: 'unlinked' })
    expect(billingRepo.confirmarPagamentoDireto).not.toHaveBeenCalled()
    expect(usersRepo.buscarPorId).not.toHaveBeenCalled()
  })

  test('marca como não vinculado quando o valor não corresponde a nenhum plano', async () => {
    const result = await billingService.handleWebhook({
      type: 'checkout.session.completed',
      data: { object: { id: 'cs_bad_amount', payment_status: 'paid', amount_total: 999, currency: 'brl', client_reference_id: 'user:7' } },
    })

    expect(result).toMatchObject({ status: 'unlinked' })
    expect(billingRepo.confirmarPagamentoDireto).not.toHaveBeenCalled()
  })

  test('vincula pelo e-mail do comprador quando o link não traz client_reference_id', async () => {
    usersRepo.buscarPorEmail.mockResolvedValue({ id: 7, email: 'cliente@allowed.test', plan: 'basico' })
    billingRepo.confirmarPagamentoDireto.mockResolvedValue({ id: 99, userId: 7, status: 'paid', toPlan: 'pro', meuEcooSelected: false })

    const result = await billingService.handleWebhook({
      type: 'checkout.session.completed',
      data: { object: { id: 'cs_por_email', payment_status: 'paid', amount_total: 10050, currency: 'brl', customer_details: { email: 'Cliente@Allowed.test' } } },
    })

    expect(result).toEqual({ status: 'paid' })
    // O e-mail é normalizado antes da busca.
    expect(usersRepo.buscarPorEmail).toHaveBeenCalledWith('cliente@allowed.test')
    expect(billingRepo.confirmarPagamentoDireto).toHaveBeenCalledWith(expect.objectContaining({ userId: 7, toPlan: 'pro' }))
  })
})

describe('billingService.getPlanDirectLink', () => {
  test('gera o link do Payment Link com client_reference_id e e-mail pré-preenchido', () => {
    const url = billingService.getPlanDirectLink({ plan: 'pro', userId: 7, email: 'cliente@allowed.test' })

    expect(url).toMatch(/^https:\/\/buy\.stripe\.com\//)
    expect(url).toContain('client_reference_id=user%3A7')
    expect(url).toContain('prefilled_email=cliente%40allowed.test')
  })

  test('rejeita plano inválido', () => {
    expect(() => billingService.getPlanDirectLink({ plan: 'inexistente', userId: 7 }))
      .toThrow(expect.objectContaining({ code: 'invalid_plan' }))
  })
})

function sessaoStripe(overrides = {}) {
  return {
    id: 'cs_stripe_1',
    payment_status: 'paid',
    amount_total: 10050,
    currency: 'brl',
    created: Math.floor(new Date('2026-09-10T12:00:00Z').getTime() / 1000),
    client_reference_id: null,
    customer_email: null,
    customer_details: null,
    payment_intent: 'pi_1',
    ...overrides,
  }
}

describe('billingService.getReconciliationReport', () => {
  test('lista só as sessões pagas sem cobrança correspondente no banco', async () => {
    paymentGateway.listCheckoutSessions.mockResolvedValue({
      sessions: [
        sessaoStripe({ id: 'cs_sem_match', client_reference_id: 'user:7', customer_email: 'cliente@allowed.test' }),
        sessaoStripe({ id: 'cs_com_match' }),
        sessaoStripe({ id: 'cs_nao_pago', payment_status: 'unpaid' }),
      ],
      truncated: false,
    })
    billingRepo.buscarPorGatewaySessions.mockResolvedValue([
      { gatewaySessionId: 'cs_com_match', status: 'paid' },
    ])

    const report = await billingService.getReconciliationReport({ days: 7 })

    expect(report.checked).toBe(2) // só as pagas entram na contagem
    expect(report.unmatched).toHaveLength(1)
    expect(report.unmatched[0]).toMatchObject({
      sessionId: 'cs_sem_match',
      amountCents: 10050,
      currency: 'brl',
      suggestedUserId: 7,
      customerEmail: 'cliente@allowed.test',
      suggestedPlan: 'pro',
    })
  })

  test('uma cobrança não-paga para a mesma sessão não conta como conciliada', async () => {
    paymentGateway.listCheckoutSessions.mockResolvedValue({ sessions: [sessaoStripe({ id: 'cs_1' })], truncated: false })
    billingRepo.buscarPorGatewaySessions.mockResolvedValue([{ gatewaySessionId: 'cs_1', status: 'failed' }])

    const report = await billingService.getReconciliationReport({ days: 7 })

    expect(report.unmatched.map(item => item.sessionId)).toEqual(['cs_1'])
  })

  test('limita os dias entre 1 e 30', async () => {
    paymentGateway.listCheckoutSessions.mockResolvedValue({ sessions: [], truncated: false })

    await billingService.getReconciliationReport({ days: 999 })
    const chamada1 = paymentGateway.listCheckoutSessions.mock.calls[0][0]
    const agora = Math.floor(Date.now() / 1000)
    expect(chamada1.createdGteSeconds).toBeGreaterThanOrEqual(agora - 30 * 86400 - 5)
    expect(chamada1.createdGteSeconds).toBeLessThanOrEqual(agora - 30 * 86400 + 5)

    // days negativo é um número "verdadeiro" em JS (só 0/NaN caem no default),
    // então é o caso real que exercita o piso do clamp em 1.
    await billingService.getReconciliationReport({ days: -5 })
    const chamada2 = paymentGateway.listCheckoutSessions.mock.calls[1][0]
    expect(chamada2.createdGteSeconds).toBeGreaterThanOrEqual(agora - 1 * 86400 - 5)
    expect(chamada2.createdGteSeconds).toBeLessThanOrEqual(agora - 1 * 86400 + 5)

    // days: 0 é falsy em JS (`Number(0) || 7`), então cai no default de 7 —
    // comportamento aceitável (0 não é um período válido), documentado aqui
    // para não virar surpresa se alguém "corrigir" o `||` para `??` depois.
    await billingService.getReconciliationReport({ days: 0 })
    const chamada3 = paymentGateway.listCheckoutSessions.mock.calls[2][0]
    expect(chamada3.createdGteSeconds).toBeGreaterThanOrEqual(agora - 7 * 86400 - 5)
    expect(chamada3.createdGteSeconds).toBeLessThanOrEqual(agora - 7 * 86400 + 5)
  })

  test('repassa o truncated do gateway e não consulta o banco sem sessões pagas', async () => {
    paymentGateway.listCheckoutSessions.mockResolvedValue({ sessions: [sessaoStripe({ payment_status: 'unpaid' })], truncated: true })

    const report = await billingService.getReconciliationReport({ days: 7 })

    expect(report).toEqual({ unmatched: [], checked: 0, truncated: true })
    expect(billingRepo.buscarPorGatewaySessions).not.toHaveBeenCalled()
  })
})

describe('billingService.linkPaymentManually', () => {
  test('vincula a sessão paga ao usuário e plano indicados pelo admin', async () => {
    paymentGateway.getCheckoutSession.mockResolvedValue(sessaoStripe({ id: 'cs_manual', amount_total: 12450 }))
    usersRepo.buscarPorId.mockResolvedValue({ id: 7, email: 'cliente@allowed.test', plan: 'basico' })
    billingRepo.confirmarPagamentoDireto.mockResolvedValue({ id: 50, userId: 7, status: 'paid', toPlan: 'premium', meuEcooSelected: true })
    billingRepo.reservarEnvioMeuEcoo.mockResolvedValue({ id: 50, status: 'paid' })
    mailer.enviarEmailAcessoMeuEcoo.mockResolvedValue(undefined)

    const result = await billingService.linkPaymentManually({ gatewaySessionId: 'cs_manual', userId: 7, toPlan: 'premium', adminId: 1 })

    expect(result).toEqual({ status: 'paid' })
    expect(billingRepo.confirmarPagamentoDireto).toHaveBeenCalledWith(expect.objectContaining({
      userId: 7, toPlan: 'premium', amountCents: 12450, gatewaySessionId: 'cs_manual',
    }))
    expect(mailer.enviarEmailAcessoMeuEcoo).toHaveBeenCalled()
  })

  test('rejeita sessão não paga sem tocar no banco', async () => {
    paymentGateway.getCheckoutSession.mockResolvedValue(sessaoStripe({ payment_status: 'unpaid' }))

    await expect(billingService.linkPaymentManually({ gatewaySessionId: 'cs_1', userId: 7, toPlan: 'pro', adminId: 1 }))
      .rejects.toMatchObject({ code: 'session_not_paid', statusCode: 400 })
    expect(billingRepo.confirmarPagamentoDireto).not.toHaveBeenCalled()
  })

  test('rejeita plano inválido sem consultar a Stripe', async () => {
    await expect(billingService.linkPaymentManually({ gatewaySessionId: 'cs_1', userId: 7, toPlan: 'inexistente', adminId: 1 }))
      .rejects.toMatchObject({ code: 'invalid_plan' })
    expect(paymentGateway.getCheckoutSession).not.toHaveBeenCalled()
  })

  test('rejeita quando falta a sessão do gateway', async () => {
    await expect(billingService.linkPaymentManually({ userId: 7, toPlan: 'pro', adminId: 1 }))
      .rejects.toMatchObject({ code: 'missing_session_id' })
  })

  test('404 quando o usuário informado não existe', async () => {
    paymentGateway.getCheckoutSession.mockResolvedValue(sessaoStripe())
    usersRepo.buscarPorId.mockResolvedValue(null)

    await expect(billingService.linkPaymentManually({ gatewaySessionId: 'cs_1', userId: 999, toPlan: 'pro', adminId: 1 }))
      .rejects.toMatchObject({ code: 'user_not_found', statusCode: 404 })
  })

  test('409 quando já existe cobrança do mês para o usuário', async () => {
    paymentGateway.getCheckoutSession.mockResolvedValue(sessaoStripe())
    usersRepo.buscarPorId.mockResolvedValue({ id: 7, email: 'cliente@allowed.test', plan: 'basico' })
    billingRepo.confirmarPagamentoDireto.mockResolvedValue(null)

    await expect(billingService.linkPaymentManually({ gatewaySessionId: 'cs_1', userId: 7, toPlan: 'pro', adminId: 1 }))
      .rejects.toMatchObject({ code: 'monthly_charge_exists', statusCode: 409 })
  })
})
