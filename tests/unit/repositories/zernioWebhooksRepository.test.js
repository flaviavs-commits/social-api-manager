jest.mock('../../../src/db/pool', () => ({ query: jest.fn() }))

const pool = require('../../../src/db/pool')
const repo = require('../../../src/repositories/zernioWebhooksRepository')

beforeEach(() => jest.clearAllMocks())

test('usa o ID único da Zernio para deduplicar eventos', async () => {
  pool.query.mockResolvedValueOnce({ rows: [{ id: 1, eventId: 'evt-1' }] })
  await expect(repo.enfileirar({ eventId: 'evt-1', eventName: 'post.published', payload: { id: 'evt-1' } }))
    .resolves.toEqual({ id: 1, eventId: 'evt-1' })
  expect(pool.query.mock.calls[0][0]).toContain('ON CONFLICT (event_id) DO NOTHING')
})

test('reserva somente eventos pendentes ou abandonados por uma instância', async () => {
  pool.query.mockResolvedValueOnce({ rows: [{ id: 4, eventId: 'evt-4' }] })
  await repo.reservar(4)
  const sql = pool.query.mock.calls[0][0]
  expect(sql).toContain("status = 'pending'")
  expect(sql).toContain("status = 'processing'")
  expect(sql).toContain("attempts = attempts + 1")
})
