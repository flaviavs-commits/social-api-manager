// Testes unitários — subscriptionsRepository (pool mockado)
//
// Acesso a dados puro para a tabela `subscriptions` (ver
// src/db/migrations/077_subscriptions.sql). Sem lógica de negócio aqui —
// isso é escopo das tasks "checkout em modo assinatura" e "webhook de ciclo
// de vida", que ainda vão usar este repositório.
jest.mock('../../../src/db/pool', () => ({ query: jest.fn() }))

const pool = require('../../../src/db/pool')
const repo = require('../../../src/repositories/subscriptionsRepository')

function linha(overrides = {}) {
  return {
    id: 1,
    userId: 7,
    stripeSubscriptionId: 'sub_123',
    stripePriceId: 'price_123',
    plan: 'pro',
    status: 'active',
    currentPeriodEnd: '2026-10-10T00:00:00.000Z',
    cancelAtPeriodEnd: false,
    ...overrides,
  }
}

beforeEach(() => jest.clearAllMocks())

describe('buscarPorUserId', () => {
  test('devolve a assinatura mais recente do usuário', async () => {
    pool.query.mockResolvedValueOnce({ rows: [linha()] })

    const result = await repo.buscarPorUserId(7)

    expect(result).toEqual(linha())
    const [sql, params] = pool.query.mock.calls[0]
    expect(sql).toContain('ORDER BY created_at DESC')
    expect(sql).toContain('LIMIT 1')
    expect(params).toEqual([7])
  })

  test('devolve null quando o usuário não tem assinatura', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] })
    expect(await repo.buscarPorUserId(7)).toBeNull()
  })
})

describe('buscarPorStripeSubscriptionId', () => {
  test('devolve a assinatura pelo id da Stripe', async () => {
    pool.query.mockResolvedValueOnce({ rows: [linha()] })
    expect(await repo.buscarPorStripeSubscriptionId('sub_123')).toEqual(linha())
    expect(pool.query).toHaveBeenCalledWith(expect.any(String), ['sub_123'])
  })

  test('devolve null quando não encontra', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] })
    expect(await repo.buscarPorStripeSubscriptionId('sub_inexistente')).toBeNull()
  })
})

describe('criar', () => {
  test('insere com os valores informados', async () => {
    pool.query.mockResolvedValueOnce({ rows: [linha()] })

    const result = await repo.criar({
      userId: 7,
      stripeSubscriptionId: 'sub_123',
      stripePriceId: 'price_123',
      plan: 'pro',
      status: 'active',
      currentPeriodEnd: '2026-10-10T00:00:00.000Z',
      cancelAtPeriodEnd: false,
    })

    expect(result).toEqual(linha())
    const [sql, params] = pool.query.mock.calls[0]
    expect(sql).toContain('INSERT INTO subscriptions')
    expect(sql).toContain('ON CONFLICT (stripe_subscription_id) DO NOTHING')
    expect(params).toEqual([7, 'sub_123', 'price_123', 'pro', 'active', '2026-10-10T00:00:00.000Z', false])
  })

  test('usa status incomplete e cancelAtPeriodEnd false como padrão', async () => {
    pool.query.mockResolvedValueOnce({ rows: [linha({ status: 'incomplete' })] })

    await repo.criar({ userId: 7, stripeSubscriptionId: 'sub_novo', stripePriceId: 'price_123', plan: 'pro' })

    const [, params] = pool.query.mock.calls[0]
    expect(params).toEqual([7, 'sub_novo', 'price_123', 'pro', 'incomplete', null, false])
  })

  test('reenvio do mesmo stripe_subscription_id não duplica (ON CONFLICT DO NOTHING não retorna linha)', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] })
    expect(await repo.criar({ userId: 7, stripeSubscriptionId: 'sub_123', stripePriceId: 'price_123', plan: 'pro' })).toBeNull()
  })
})

describe('atualizarPorStripeSubscriptionId', () => {
  test('atualiza só os campos informados (COALESCE preserva o resto)', async () => {
    pool.query.mockResolvedValueOnce({ rows: [linha({ status: 'past_due' })] })

    const result = await repo.atualizarPorStripeSubscriptionId('sub_123', { status: 'past_due' })

    expect(result).toEqual(linha({ status: 'past_due' }))
    const [sql, params] = pool.query.mock.calls[0]
    expect(sql).toContain('COALESCE($2, status)')
    expect(params).toEqual(['sub_123', 'past_due', undefined, undefined, undefined, undefined])
  })

  test('devolve null quando a assinatura não existe', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] })
    expect(await repo.atualizarPorStripeSubscriptionId('sub_inexistente', { status: 'canceled' })).toBeNull()
  })
})
