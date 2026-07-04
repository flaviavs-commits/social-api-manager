// Testes unitários — credentialsRepository (pool mockado)
jest.mock('../../src/db/pool', () => ({ query: jest.fn() }))

const pool = require('../../src/db/pool')
const repo = require('../../src/repositories/credentialsRepository')

beforeEach(() => jest.clearAllMocks())

describe('criar', () => {
  test('executa INSERT com userId e hash', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] })
    await repo.criar(1, 'hash123')
    expect(pool.query).toHaveBeenCalledWith(expect.stringMatching(/INSERT/), [1, 'hash123'])
  })
})

describe('buscarPorUserId', () => {
  test('retorna credencial quando existe', async () => {
    const cred = { user_id: 1, password_hash: 'hash' }
    pool.query.mockResolvedValueOnce({ rows: [cred] })
    expect(await repo.buscarPorUserId(1)).toEqual(cred)
  })

  test('retorna null quando não existe', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] })
    expect(await repo.buscarPorUserId(99)).toBeNull()
  })
})

describe('atualizarSenha', () => {
  test('executa UPDATE com novo hash', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] })
    await repo.atualizarSenha(1, 'novohash')
    const params = pool.query.mock.calls[0][1]
    expect(params[0]).toBe('novohash')
    expect(params[1]).toBe(1)
  })
})

describe('gerarTokenReset', () => {
  test('retorna token hex de 64 chars', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] })
    const token = await repo.gerarTokenReset(1)
    expect(token).toMatch(/^[0-9a-f]{64}$/)
  })

  test('tokens gerados são únicos', async () => {
    pool.query.mockResolvedValue({ rows: [] })
    const t1 = await repo.gerarTokenReset(1)
    const t2 = await repo.gerarTokenReset(1)
    expect(t1).not.toBe(t2)
  })

  test('salva token no banco com expiração futura', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] })
    await repo.gerarTokenReset(1)
    const params = pool.query.mock.calls[0][1]
    const expira = new Date(params[1])
    expect(expira.getTime()).toBeGreaterThan(Date.now())
  })
})

describe('buscarPorResetToken', () => {
  test('retorna credencial quando token válido', async () => {
    const cred = { user_id: 1, email: 'a@b.com' }
    pool.query.mockResolvedValueOnce({ rows: [cred] })
    expect(await repo.buscarPorResetToken('abc')).toEqual(cred)
  })

  test('retorna null quando token inválido', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] })
    expect(await repo.buscarPorResetToken('invalido')).toBeNull()
  })
})

describe('atualizarSenhaPorResetToken', () => {
  test('retorna credencial quando token ainda válido', async () => {
    const cred = { user_id: 1 }
    pool.query.mockResolvedValueOnce({ rows: [cred] })
    expect(await repo.atualizarSenhaPorResetToken('tok', 'novohash')).toEqual(cred)
  })

  test('retorna null quando token expirado', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] })
    expect(await repo.atualizarSenhaPorResetToken('expirado', 'hash')).toBeNull()
  })
})
