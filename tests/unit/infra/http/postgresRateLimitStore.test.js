const pool = require('../../../../src/db/pool')

jest.mock('../../../../src/db/pool', () => ({ query: jest.fn() }))

describe('PostgresRateLimitStore', () => {
  beforeEach(() => jest.clearAllMocks())

  test('incrementa a chave com prefixo e devolve o reset', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ hits: 3, expires_at: '2026-08-17T12:00:00.000Z' }] })
    const { PostgresRateLimitStore } = require('../../../../src/infra/http/postgresRateLimitStore')
    const store = new PostgresRateLimitStore('login')
    store.init({ windowMs: 60_000 })

    const result = await store.increment('127.0.0.1')

    expect(result.totalHits).toBe(3)
    expect(result.resetTime).toEqual(new Date('2026-08-17T12:00:00.000Z'))
    expect(pool.query.mock.calls[0][1][0]).toBe('login:127.0.0.1')
  })

  test('remove a chave ao resetar', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] })
    const { PostgresRateLimitStore } = require('../../../../src/infra/http/postgresRateLimitStore')
    const store = new PostgresRateLimitStore('api')

    await store.resetKey('user-1')

    expect(pool.query).toHaveBeenCalledWith(
      'DELETE FROM rate_limit_counters WHERE key = $1',
      ['api:user-1']
    )
  })
})
