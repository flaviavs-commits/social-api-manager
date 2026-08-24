// Testes de integração — middleware requireAuth + rotas protegidas
process.env.AUTH_TOKEN_SECRET = 'test-secret-auth-12345'
process.env.SESSION_SECRET = 'test-session-xyz'
process.env.ALLOWED_EMAIL_DOMAINS = 'allowed.test'

const request = require('supertest')

jest.mock('../../src/db/pool', () => ({ query: jest.fn().mockResolvedValue({ rows: [] }) }))

const pool = require('../../src/db/pool')
const { gerarTokenSessao } = require('../../src/utils/authToken')

// Mocka usersRepository para não bater no banco
jest.mock('../../src/repositories/usersRepository', () => ({
  buscarPorId: jest.fn(),
}))
const usersRepo = require('../../src/repositories/usersRepository')

const app = require('../../src/server')

beforeEach(() => {
  jest.clearAllMocks()
  pool.query.mockResolvedValue({ rows: [] })
})

describe('requireAuth middleware', () => {
  test('sem Authorization header retorna 401', async () => {
    const res = await request(app).get('/api/drafts')
    expect(res.status).toBe(401)
    expect(res.body.erro).toMatch(/sessão/i)
  })

  test('token malformado retorna 401', async () => {
    const res = await request(app)
      .get('/api/drafts')
      .set('Authorization', 'Bearer nao-e-um-token-valido')
    expect(res.status).toBe(401)
  })

  test('token válido mas usuário não encontrado no banco retorna 401', async () => {
    usersRepo.buscarPorId.mockResolvedValue(null)
    const token = gerarTokenSessao(999)
    const res = await request(app)
      .get('/api/drafts')
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(401)
  })

  test('token válido com usuário existente passa o middleware', async () => {
    usersRepo.buscarPorId.mockResolvedValue({
      id: 1, email: 'u@allowed.test', role: 'user',
        full_name: 'Teste', avatar_url: null, totp_enabled: false, plan: 'premium'
    })
    pool.query.mockResolvedValue({ rows: [] })
    const token = gerarTokenSessao(1)
    const res = await request(app)
      .get('/api/drafts')
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
  })
})

describe('GET /api/me', () => {
  test('retorna dados do usuário autenticado', async () => {
    usersRepo.buscarPorId.mockResolvedValue({
      id: 5, email: 'me@allowed.test', role: 'admin',
      full_name: 'Usuário Admin', avatar_url: 'https://img', totp_enabled: true
    })
    const token = gerarTokenSessao(5)
    const res = await request(app)
      .get('/api/me')
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(res.body.email).toBe('me@allowed.test')
    expect(res.body.role).toBe('admin')
    // Nunca expõe senha
    expect(res.body.password).toBeUndefined()
    expect(res.body.passwordHash).toBeUndefined()
  })
})
