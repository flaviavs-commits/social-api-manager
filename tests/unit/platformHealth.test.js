process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-session-secret'

jest.mock('../../src/db/pool', () => ({ query: jest.fn() }))
jest.mock('../../src/repositories/logsRepository', () => ({ registrarLog: jest.fn(), broadcastEvent: jest.fn() }))
jest.mock('../../src/infra/social/zernioClient', () => ({ listAccounts: jest.fn(), getAccountHealth: jest.fn() }))

const pool = require('../../src/db/pool')
const { getStatusMap } = require('../../src/services/platformHealth')

describe('platform health', () => {
  beforeEach(() => jest.clearAllMocks())

  test('não exibe falha global para uma pessoa sem conta na plataforma', async () => {
    pool.query.mockResolvedValue({ rows: [
      { platform: 'youtube', status: 'down', hasAccount: false },
    ] })

    const result = await getStatusMap(42)

    expect(result.youtube).toBe('up')
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('c.user_id = $1'), [42])
  })

  test('mantém a leitura global quando chamada pelo agente interno', async () => {
    pool.query.mockResolvedValue({ rows: [
      { platform: 'youtube', status: 'down', hasAccount: true },
    ] })

    const result = await getStatusMap()

    expect(result.youtube).toBe('down')
    expect(pool.query).toHaveBeenCalledWith(expect.not.stringContaining('c.user_id = $1'), [])
  })
})
