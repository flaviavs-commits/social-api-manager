const { requirePlanModule } = require('../../src/config/plans')
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
    expect(PLANS.basico.modules).toEqual(expect.arrayContaining(['analytics', 'ai', 'equipe', 'relatorios']))
  })

  test('bloqueia acesso direto ao módulo fora do plano', () => {
    const res = response()
    const next = jest.fn()

    requirePlanModule('inbox')({ user: { id: 1, role: 'user', plan: 'basico' } }, res, next)

    expect(next).not.toHaveBeenCalled()
    expect(res.statusCode).toBe(403)
    expect(res.body).toMatchObject({ code: 'PLAN_REQUIRED', requiredModule: 'inbox' })
  })

  test('mantém no Pro os módulos anunciados de equipe e relatórios', () => {
    expect(PLANS.pro).toMatchObject({
      id: 'pro',
      name: 'EcooMidia Pro',
      priceCents: 10050,
      checkoutUrl: 'https://buy.stripe.com/eVq6oHbRJ8Rcej1e7V2VG02',
    })
    expect(PLANS.pro.features).toEqual(expect.arrayContaining([
      'Espaços de trabalho e aprovações',
      'Relatórios e automações',
      'Analise de métricas',
    ]))
    expect(PLANS.pro.modules).toEqual(expect.arrayContaining(['equipe', 'relatorios']))
  })

  test('permite o módulo quando o plano contém a funcionalidade', () => {
    const res = response()
    const next = jest.fn()

    requirePlanModule('tokens')({ user: { id: 1, role: 'user', plan: 'premium' } }, res, next)

    expect(next).toHaveBeenCalledTimes(1)
    expect(res.statusCode).toBeNull()
  })

  test('mantém administradores liberados, mas falha fechado sem plano', () => {
    const res = response()
    const next = jest.fn()

    requirePlanModule('inbox')({ user: { id: 1, role: 'admin', plan: 'basico' } }, res, next)
    requirePlanModule('inbox')({ user: { id: 2, role: 'user' } }, res, next)

    expect(next).toHaveBeenCalledTimes(1)
    expect(res.statusCode).toBe(403)
    expect(res.body).toMatchObject({ code: 'PLAN_REQUIRED', currentPlan: 'basico' })
  })
})
