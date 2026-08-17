const { requirePlanModule } = require('../../src/config/plans')

function response() {
  return {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this },
    json(body) { this.body = body; return this },
  }
}

describe('requirePlanModule', () => {
  test('bloqueia acesso direto ao módulo fora do plano', () => {
    const res = response()
    const next = jest.fn()

    requirePlanModule('inbox')({ user: { id: 1, role: 'user', plan: 'gratuito' } }, res, next)

    expect(next).not.toHaveBeenCalled()
    expect(res.statusCode).toBe(403)
    expect(res.body).toMatchObject({ code: 'PLAN_REQUIRED', requiredModule: 'inbox' })
  })

  test('permite o módulo quando o plano contém a funcionalidade', () => {
    const res = response()
    const next = jest.fn()

    requirePlanModule('tokens')({ user: { id: 1, role: 'user', plan: 'agencia' } }, res, next)

    expect(next).toHaveBeenCalledTimes(1)
    expect(res.statusCode).toBeNull()
  })

  test('mantém administradores liberados, mas falha fechado sem plano', () => {
    const res = response()
    const next = jest.fn()

    requirePlanModule('inbox')({ user: { id: 1, role: 'admin', plan: 'gratuito' } }, res, next)
    requirePlanModule('inbox')({ user: { id: 2, role: 'user' } }, res, next)

    expect(next).toHaveBeenCalledTimes(1)
    expect(res.statusCode).toBe(403)
    expect(res.body).toMatchObject({ code: 'PLAN_REQUIRED', currentPlan: 'gratuito' })
  })
})
