const { getMeuEcooPricing, requirePlanModule, requirePaidPlan } = require('../../src/config/plans')
const { PLANS } = require('../../src/config/plans')

function response() {
  return {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this },
    json(body) { this.body = body; return this },
  }
}

describe('requirePlanModule', () => {
  test('registra o EcooMidia Básico como tier 1 pago com análise de métricas', () => {
    expect(PLANS.basico).toMatchObject({
      id: 'basico',
      name: 'EcooMidia Básico',
      priceCents: 5250,
      checkoutUrl: 'https://buy.stripe.com/8x27sLg7Z3wS0sb5Bp2VG03',
    })
    expect(PLANS.basico.features).toContain('Analise de métricas')
    expect(PLANS.basico.modules).toEqual(expect.arrayContaining(['analytics', 'ai', 'equipe', 'relatorios', 'inbox', 'tokens', 'biblioteca']))
  })

  test('libera todos os módulos depois que o plano Básico está ativo', () => {
    const res = response()
    const next = jest.fn()

    requirePlanModule('inbox')({ user: { id: 1, role: 'user', plan: 'basico', planActive: true } }, res, next)

    expect(next).toHaveBeenCalledTimes(1)
    expect(res.statusCode).toBeNull()
  })

  test('mantém no Pro os módulos de equipe e relatórios sem anunciar equipe', () => {
    expect(PLANS.pro).toMatchObject({
      id: 'pro',
      name: 'EcooMidia Pro',
      priceCents: 10050,
      checkoutUrl: 'https://buy.stripe.com/eVq6oHbRJ8Rcej1e7V2VG02',
    })
    expect(PLANS.pro.features).not.toContain('Espaços de trabalho e aprovações')
    expect(PLANS.pro.features).toEqual(expect.arrayContaining([
      'Relatórios e automações',
      'Analise de métricas',
    ]))
    expect(PLANS.pro.modules).toEqual(expect.arrayContaining(['equipe', 'relatorios', 'inbox', 'tokens', 'biblioteca']))
  })

  test('calcula o benefício do MeuEcoo Pro em centavos', () => {
    expect(getMeuEcooPricing('pro')).toMatchObject({
      basePriceCents: 10050,
      discountPercent: 40,
      discountCents: 4020,
      finalPriceCents: 6030,
    })
  })

  test('permite o módulo quando o plano contém a funcionalidade', () => {
    const res = response()
    const next = jest.fn()

    requirePlanModule('tokens')({ user: { id: 1, role: 'user', plan: 'premium', planActive: true } }, res, next)

    expect(next).toHaveBeenCalledTimes(1)
    expect(res.statusCode).toBeNull()
  })

  test('mantém administradores liberados', () => {
    const res = response()
    const next = jest.fn()

    requirePlanModule('inbox')({ user: { id: 1, role: 'admin', plan: 'basico' } }, res, next)

    expect(next).toHaveBeenCalledTimes(1)
    expect(res.statusCode).toBeNull()
  })

  test('bloqueia qualquer módulo se o pagamento está pendente', () => {
    const res = response()
    const next = jest.fn()

    requirePlanModule('inbox')({ user: { id: 2, role: 'user', plan: 'pro', planActive: false } }, res, next)

    expect(next).not.toHaveBeenCalled()
    expect(res.statusCode).toBe(402)
    expect(res.body).toMatchObject({ code: 'PAYMENT_REQUIRED', currentPlan: 'pro' })
  })

  test('falha fechado sem plano', () => {
    const res = response()
    const next = jest.fn()

    requirePlanModule('inbox')({ user: { id: 3, role: 'user', planActive: false } }, res, next)

    expect(next).not.toHaveBeenCalled()
    expect(res.statusCode).toBe(402)
    expect(res.body).toMatchObject({ code: 'PAYMENT_REQUIRED', currentPlan: 'basico' })
  })
})

describe('requirePaidPlan', () => {
  test('bloqueia usuário cujo primeiro pagamento ainda não foi confirmado', () => {
    const res = response()
    const next = jest.fn()

    requirePaidPlan({ user: { id: 1, role: 'user', plan: 'basico', planActive: false } }, res, next)

    expect(next).not.toHaveBeenCalled()
    expect(res.statusCode).toBe(402)
    expect(res.body).toMatchObject({ code: 'PAYMENT_REQUIRED', currentPlan: 'basico' })
  })

  test('permite qualquer plano pago após confirmação', () => {
    const res = response()
    const next = jest.fn()

    requirePaidPlan({ user: { id: 1, role: 'user', plan: 'pro', planActive: true } }, res, next)

    expect(next).toHaveBeenCalledTimes(1)
    expect(res.statusCode).toBeNull()
  })
})
