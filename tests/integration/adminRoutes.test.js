// Testes de integração — /api/admin/users (requireAdmin + escopo próprio)
process.env.AUTH_TOKEN_SECRET = 'test-secret-auth-12345'
process.env.SESSION_SECRET = 'test-session-xyz'
process.env.ALLOWED_EMAIL_DOMAINS = 'allowed.test'

const request = require('supertest')

jest.mock('../../src/db/pool', () => ({ query: jest.fn().mockResolvedValue({ rows: [] }) }))
jest.mock('../../src/repositories/usersRepository', () => ({
  buscarPorId: jest.fn(),
  listarTodos: jest.fn(),
  atualizarRole: jest.fn(),
  atualizarAtivo: jest.fn(),
  contarSuperAdmins: jest.fn(),
  buscarPorIdIncluindoInativo: jest.fn(),
}))
jest.mock('../../src/repositories/contasRepository', () => ({
  listarContas: jest.fn(),
}))

const usersRepo = require('../../src/repositories/usersRepository')
const { gerarTokenSessao } = require('../../src/utils/authToken')

const app = require('../../src/server')

const ADMIN = { id: 1, email: 'admin@allowed.test', role: 'admin', full_name: 'Admin', avatar_url: null, totp_enabled: false }
const SUPER = { id: 2, email: 'super@allowed.test', role: 'super_admin', full_name: 'Super', avatar_url: null, totp_enabled: false }
const USER  = { id: 3, email: 'user@allowed.test',  role: 'user',        full_name: 'User',  avatar_url: null, totp_enabled: false }

let tokenAdmin, tokenSuper, tokenUser

beforeEach(() => {
  jest.clearAllMocks()
  tokenAdmin = gerarTokenSessao(ADMIN.id)
  tokenSuper = gerarTokenSessao(SUPER.id)
  tokenUser  = gerarTokenSessao(USER.id)
})

// ── GET /api/admin/users ──────────────────────────────────────────────────────

describe('GET /api/admin/users', () => {
  test('401 sem token', async () => {
    const res = await request(app).get('/api/admin/users')
    expect(res.status).toBe(401)
  })

  test('403 para user comum', async () => {
    usersRepo.buscarPorId.mockResolvedValue(USER)
    const res = await request(app).get('/api/admin/users').set('Authorization', `Bearer ${tokenUser}`)
    expect(res.status).toBe(403)
  })

  test('200 para admin, mas somente com a própria conta', async () => {
    usersRepo.buscarPorId.mockResolvedValue(ADMIN)
    usersRepo.listarTodos.mockResolvedValue([ADMIN])
    const res = await request(app).get('/api/admin/users').set('Authorization', `Bearer ${tokenAdmin}`)
    expect(res.status).toBe(200)
    expect(res.body.data).toEqual([ADMIN])
    expect(usersRepo.listarTodos).toHaveBeenCalledWith(ADMIN.id)
  })
})

// ── POST /api/admin/users/:id/role ────────────────────────────────────────────

describe('POST /api/admin/users/:id/role', () => {
  test('403 para admin ao alterar outra conta', async () => {
    usersRepo.buscarPorId.mockResolvedValue(ADMIN)
    const res = await request(app)
      .post('/api/admin/users/3/role')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ role: 'admin' })
    expect(res.status).toBe(403)
  })

  test('400 role inválido', async () => {
    usersRepo.buscarPorId.mockResolvedValue(ADMIN)
    const res = await request(app)
      .post(`/api/admin/users/${ADMIN.id}/role`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ role: 'super_admin' })
    expect(res.status).toBe(400)
  })

  test('400 id inválido', async () => {
    usersRepo.buscarPorId.mockResolvedValue(ADMIN)
    const res = await request(app)
      .post('/api/admin/users/abc/role')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ role: 'admin' })
    expect(res.status).toBe(400)
  })

  test('200 admin pode alterar somente o próprio papel', async () => {
    usersRepo.buscarPorId.mockResolvedValue(ADMIN)
    usersRepo.atualizarRole.mockResolvedValue({ id: 1, email: ADMIN.email, role: 'user' })
    const res = await request(app)
      .post(`/api/admin/users/${ADMIN.id}/role`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ role: 'user' })
    expect(res.status).toBe(200)
    expect(res.body.user.role).toBe('user')
  })
})

// ── POST /api/admin/users/:id/ativo ───────────────────────────────────────────

describe('POST /api/admin/users/:id/ativo', () => {
  test('403 para admin comum antes da validação', async () => {
    usersRepo.buscarPorId.mockResolvedValue(ADMIN)
    const res = await request(app)
      .post('/api/admin/users/3/ativo')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ ativo: 'sim' })
    expect(res.status).toBe(403)
  })

  test('400 admin não pode desativar a si mesmo', async () => {
    usersRepo.buscarPorId.mockResolvedValue(ADMIN)
    const res = await request(app)
      .post(`/api/admin/users/${ADMIN.id}/ativo`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ ativo: false })
    expect(res.status).toBe(400)
  })

  test('403 admin não pode desativar usuário comum', async () => {
    usersRepo.buscarPorId.mockResolvedValue(ADMIN)
    const res = await request(app)
      .post('/api/admin/users/3/ativo')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ ativo: false })
    expect(res.status).toBe(403)
  })
})
