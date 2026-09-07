// Testes unitários — logsRepository (pool mockado)
jest.mock('../../src/db/pool', () => ({ query: jest.fn() }))

const pool = require('../../src/db/pool')
const repo = require('../../src/repositories/logsRepository')

beforeEach(() => jest.clearAllMocks())

describe('registrarLog', () => {
  test('insere log e retorna a linha criada', async () => {
    const log = { id: 1, type: 'ok', message: 'tudo certo' }
    pool.query.mockResolvedValueOnce({ rows: [log] })
    const result = await repo.registrarLog({ type: 'ok', message: 'tudo certo' })
    expect(result).toEqual(log)
  })

  test('passa platform e conta_id quando fornecidos', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{}] })
    await repo.registrarLog({ type: 'err', message: 'falha', platform: 'instagram', conta_id: 5 })
    const params = pool.query.mock.calls[0][1]
    expect(params[2]).toBe('instagram')
    expect(params[3]).toBe(5)
  })

  test('passa a chave única de notificação quando fornecida', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{}] })
    await repo.registrarLog({ type: 'info', message: 'novo comentário', user_id: 7, notification_key: 'comment:7:10:c1' })
    const sql = pool.query.mock.calls[0][0]
    const params = pool.query.mock.calls[0][1]
    expect(sql).toContain('ON CONFLICT (notification_key)')
    expect(params[5]).toBe('comment:7:10:c1')
  })
})

describe('listarLogs', () => {
  test('admin com userId continua limitado ao próprio histórico', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] })
    await repo.listarLogs(50, 1, true)
    const sql = pool.query.mock.calls[0][0]
    const params = pool.query.mock.calls[0][1]
    expect(sql).toContain('user_id = $2')
    expect(params).toEqual([50, 1])
  })

  test('rotina interna sem userId pode consultar todos', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] })
    await repo.listarLogs(50, null, true)
    const sql = pool.query.mock.calls[0][0]
    expect(sql).not.toContain('user_id = $2')
    expect(pool.query.mock.calls[0][1]).toEqual([50])
  })

  test('usuário comum filtra por user_id', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] })
    await repo.listarLogs(50, 7, false)
    const sql = pool.query.mock.calls[0][0]
    expect(sql).toContain('user_id = $2')
    expect(pool.query.mock.calls[0][1]).toContain(7)
  })
})

describe('listarLogsDesde', () => {
  test('admin com userId filtra por lastId e userId', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] })
    await repo.listarLogsDesde(10, 1, true)
    const params = pool.query.mock.calls[0][1]
    expect(params).toEqual([10, 1])
  })

  test('usuário comum filtra por lastId e userId', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] })
    await repo.listarLogsDesde(10, 3, false)
    const params = pool.query.mock.calls[0][1]
    expect(params).toEqual([10, 3])
  })
})

describe('limparLogs', () => {
  test('admin com userId deleta somente seus logs', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] })
    await repo.limparLogs(1, true)
    const sql = pool.query.mock.calls[0][0]
    expect(sql).toContain('WHERE user_id = $1')
  })

  test('rotina interna sem userId pode limpar todos os logs', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] })
    await repo.limparLogs(null, true)
    expect(pool.query.mock.calls[0][0]).toMatch(/DELETE FROM logs$/)
  })

  test('usuário deleta só seus logs', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] })
    await repo.limparLogs(3, false)
    const sql = pool.query.mock.calls[0][0]
    expect(sql).toContain('WHERE user_id = $1 OR conta_id IN')
  })
})

describe('listarEventosDesde', () => {
  test('admin com userId filtra por lastId e userId', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] })
    await repo.listarEventosDesde(5, 1, true)
    expect(pool.query.mock.calls[0][1]).toEqual([5, 1])
  })

  test('rotina interna sem userId pode consultar todos os eventos', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] })
    await repo.listarEventosDesde(5, null, true)
    expect(pool.query.mock.calls[0][1]).toEqual([5])
  })

  test('usuário filtra por lastId e userId', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] })
    await repo.listarEventosDesde(5, 2, false)
    expect(pool.query.mock.calls[0][1]).toEqual([5, 2])
  })
})

describe('broadcastEvent', () => {
  test('insere evento com nome, payload e userId', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] })
    await repo.broadcastEvent('post_published', { postId: 1 }, 5)
    const params = pool.query.mock.calls[0][1]
    expect(params[0]).toBe('post_published')
    expect(JSON.parse(params[1])).toEqual({ postId: 1 })
    expect(params[2]).toBe(5)
  })
})

describe('limparAntigos', () => {
  test('deleta logs e eventos antigos, retorna contagens', async () => {
    pool.query
      .mockResolvedValueOnce({ rowCount: 10 })
      .mockResolvedValueOnce({ rowCount: 5 })
    const result = await repo.limparAntigos()
    expect(result.logsRemovidos).toBe(10)
    expect(result.eventosRemovidos).toBe(5)
  })
})
