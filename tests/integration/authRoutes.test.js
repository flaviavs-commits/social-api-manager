// Testes de integração — rotas de autenticação
// Montadas em /auth/login/* no server.js (app.use('/auth/login', authRoutes))
process.env.AUTH_TOKEN_SECRET = 'test-secret-auth-12345'
process.env.SESSION_SECRET = 'test-session-xyz'

const request = require('supertest')

jest.mock('../../src/db/pool', () => ({ query: jest.fn().mockResolvedValue({ rows: [] }) }))
jest.mock('express-rate-limit', () => () => (req, res, next) => next())
jest.mock('../../src/repositories/usersRepository', () => ({
  buscarPorEmail: jest.fn(),
  buscarPorId: jest.fn(),
  buscarPorGoogleId: jest.fn(),
  criar: jest.fn(),
  buscarTotp: jest.fn(),
}))
jest.mock('../../src/repositories/credentialsRepository', () => ({
  buscarPorUserId: jest.fn(),
  criar: jest.fn(),
  gerarTokenReset: jest.fn(),
  buscarPorResetToken: jest.fn(),
  atualizarSenha: jest.fn(),
  atualizarSenhaPorResetToken: jest.fn(),
}))
jest.mock('../../src/services/mailer', () => ({ enviarEmailRedefinicaoSenha: jest.fn().mockResolvedValue(true) }))
jest.mock('../../src/services/meuEcoo', () => ({
  sincronizarCredencial: jest.fn().mockResolvedValue(undefined),
  autenticarViaMeuEcoo: jest.fn().mockResolvedValue(false),
}))

const usersRepo = require('../../src/repositories/usersRepository')
const credRepo  = require('../../src/repositories/credentialsRepository')
const bcrypt    = require('bcrypt')
const { gerarTokenPending2fa } = require('../../src/utils/authToken')
const { gerarSegredo, gerarCodigo } = require('../../src/services/totp')
const meuEcoo = require('../../src/services/meuEcoo')

const app = require('../../src/server')
const BASE = '/auth/login'

beforeEach(() => {
  jest.clearAllMocks()
  meuEcoo.autenticarViaMeuEcoo.mockResolvedValue(false)
  meuEcoo.sincronizarCredencial.mockResolvedValue(undefined)
})

// ── /login ────────────────────────────────────────────────────────────────────

describe('POST /auth/login/login', () => {
  test('400 sem body', async () => {
    const res = await request(app).post(`${BASE}/login`).send({})
    expect(res.status).toBe(400)
  })

  test('400 email inválido', async () => {
    const res = await request(app).post(`${BASE}/login`).send({ email: 'naoemail', password: '123' })
    expect(res.status).toBe(400)
  })

  test('401 usuário não existe', async () => {
    usersRepo.buscarPorEmail.mockResolvedValue(null)
    const res = await request(app).post(`${BASE}/login`).send({ email: 'a@b.com', password: 'Senha#1' })
    expect(res.status).toBe(401)
  })

  test('401 usuário sem senha local (conta Google)', async () => {
    usersRepo.buscarPorEmail.mockResolvedValue({ id: 1, email: 'a@b.com', totp_enabled: false })
    credRepo.buscarPorUserId.mockResolvedValue(null)
    const res = await request(app).post(`${BASE}/login`).send({ email: 'a@b.com', password: 'X' })
    expect(res.status).toBe(401)
  })

  test('401 senha errada (e o Meu Ecoo também não confirma)', async () => {
    usersRepo.buscarPorEmail.mockResolvedValue({ id: 1, email: 'a@b.com', totp_enabled: false })
    credRepo.buscarPorUserId.mockResolvedValue({ password_hash: await bcrypt.hash('correta', 1) })
    const res = await request(app).post(`${BASE}/login`).send({ email: 'a@b.com', password: 'errada' })
    expect(res.status).toBe(401)
    expect(credRepo.atualizarSenha).not.toHaveBeenCalled()
  })

  test('200 login bem-sucedido retorna token e sincroniza credencial com o Meu Ecoo', async () => {
    usersRepo.buscarPorEmail.mockResolvedValue({ id: 1, email: 'a@b.com', full_name: 'Ana', totp_enabled: false })
    credRepo.buscarPorUserId.mockResolvedValue({ password_hash: await bcrypt.hash('Senha#1', 1) })
    const res = await request(app).post(`${BASE}/login`).send({ email: 'a@b.com', password: 'Senha#1' })
    expect(res.status).toBe(200)
    expect(res.body.token).toBeTruthy()
    expect(meuEcoo.sincronizarCredencial).toHaveBeenCalledWith('a@b.com', 'Senha#1', 'Ana')
  })

  test('senha local errada cai no fallback do Meu Ecoo e re-hasheia com bcrypt', async () => {
    usersRepo.buscarPorEmail.mockResolvedValue({ id: 1, email: 'a@b.com', full_name: 'Ana', totp_enabled: false })
    credRepo.buscarPorUserId.mockResolvedValue({ password_hash: await bcrypt.hash('senha-antiga', 1) })
    meuEcoo.autenticarViaMeuEcoo.mockResolvedValueOnce(true)

    const res = await request(app).post(`${BASE}/login`).send({ email: 'a@b.com', password: 'senha-nova-so-no-meu-ecoo' })

    expect(res.status).toBe(200)
    expect(res.body.token).toBeTruthy()
    expect(meuEcoo.autenticarViaMeuEcoo).toHaveBeenCalledWith('a@b.com', 'senha-nova-so-no-meu-ecoo')
    expect(credRepo.atualizarSenha).toHaveBeenCalledWith(1, expect.any(String))
  })

  test('200 com 2FA ativo retorna pendingToken', async () => {
    usersRepo.buscarPorEmail.mockResolvedValue({ id: 1, email: 'a@b.com', totp_enabled: true })
    credRepo.buscarPorUserId.mockResolvedValue({ password_hash: await bcrypt.hash('Senha#1', 1) })
    const res = await request(app).post(`${BASE}/login`).send({ email: 'a@b.com', password: 'Senha#1' })
    expect(res.status).toBe(200)
    expect(res.body.requires2fa).toBe(true)
    expect(res.body.pendingToken).toBeTruthy()
  })
})

// ── /register ─────────────────────────────────────────────────────────────────

describe('POST /auth/login/register', () => {
  test('400 sem campos obrigatórios', async () => {
    const res = await request(app).post(`${BASE}/register`).send({})
    expect(res.status).toBe(400)
  })

  test('400 email inválido', async () => {
    const res = await request(app).post(`${BASE}/register`).send({ email: 'ruim', password: 'Abc@1234' })
    expect(res.status).toBe(400)
  })

  test('400 senha fraca', async () => {
    const res = await request(app).post(`${BASE}/register`).send({ email: 'a@b.com', password: '123' })
    expect(res.status).toBe(400)
  })

  test('409 email já cadastrado', async () => {
    usersRepo.buscarPorEmail.mockResolvedValue({ id: 1 })
    const res = await request(app).post(`${BASE}/register`).send({ email: 'a@b.com', password: 'Abc@1234' })
    expect(res.status).toBe(409)
  })

  test('200 cria conta e retorna token', async () => {
    usersRepo.buscarPorEmail.mockResolvedValue(null)
    usersRepo.criar.mockResolvedValue({ id: 5, email: 'novo@x.com' })
    credRepo.criar.mockResolvedValue(undefined)
    const res = await request(app).post(`${BASE}/register`).send({ email: 'novo@x.com', password: 'Abc@1234' })
    expect(res.status).toBe(200)
    expect(res.body.token).toBeTruthy()
  })
})

// ── /logout ───────────────────────────────────────────────────────────────────

describe('POST /auth/login/logout', () => {
  test('200 sempre', async () => {
    const res = await request(app).post(`${BASE}/logout`)
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
  })
})

// ── /verify-2fa ───────────────────────────────────────────────────────────────

describe('POST /auth/login/verify-2fa', () => {
  test('400 sem pendingToken', async () => {
    const res = await request(app).post(`${BASE}/verify-2fa`).send({ code: '123456' })
    expect(res.status).toBe(400)
  })

  test('400 código inválido', async () => {
    const pendingToken = gerarTokenPending2fa(1)
    const segredo = gerarSegredo()
    usersRepo.buscarTotp.mockResolvedValue({ enabled: true, secret: segredo })
    const res = await request(app).post(`${BASE}/verify-2fa`).send({ code: '000000', pendingToken })
    expect(res.status).toBe(400)
  })

  test('200 código correto retorna token de sessão', async () => {
    const segredo = gerarSegredo()
    const pendingToken = gerarTokenPending2fa(1)
    const codigo = gerarCodigo(segredo)
    usersRepo.buscarTotp.mockResolvedValue({ enabled: true, secret: segredo })
    const res = await request(app).post(`${BASE}/verify-2fa`).send({ code: codigo, pendingToken })
    expect(res.status).toBe(200)
    expect(res.body.token).toBeTruthy()
  })
})

// ── /forgot-password ──────────────────────────────────────────────────────────

describe('POST /auth/login/forgot-password', () => {
  test('400 sem email', async () => {
    const res = await request(app).post(`${BASE}/forgot-password`).send({})
    expect(res.status).toBe(400)
  })

  test('400 email inválido', async () => {
    const res = await request(app).post(`${BASE}/forgot-password`).send({ email: 'ruim' })
    expect(res.status).toBe(400)
  })

  test('200 mesmo quando email não existe (anti-enumeração)', async () => {
    usersRepo.buscarPorEmail.mockResolvedValue(null)
    const res = await request(app).post(`${BASE}/forgot-password`).send({ email: 'naocadastrado@x.com' })
    expect(res.status).toBe(200)
  })

  test('200 envia e-mail quando conta existe', async () => {
    usersRepo.buscarPorEmail.mockResolvedValue({ id: 1, email: 'a@b.com' })
    credRepo.buscarPorUserId.mockResolvedValue({ user_id: 1 })
    credRepo.gerarTokenReset.mockResolvedValue('tokenreset123')
    const res = await request(app).post(`${BASE}/forgot-password`).send({ email: 'a@b.com' })
    expect(res.status).toBe(200)
    expect(require('../../src/services/mailer').enviarEmailRedefinicaoSenha).toHaveBeenCalled()
  })
})

// ── /reset-password/validar ───────────────────────────────────────────────────

describe('GET /auth/login/reset-password/validar', () => {
  test('retorna valido: false sem token', async () => {
    const res = await request(app).get(`${BASE}/reset-password/validar`)
    expect(res.status).toBe(200)
    expect(res.body.valido).toBe(false)
  })

  test('retorna valido: true quando token existe', async () => {
    credRepo.buscarPorResetToken.mockResolvedValue({ user_id: 1 })
    const res = await request(app).get(`${BASE}/reset-password/validar?token=tok123`)
    expect(res.status).toBe(200)
    expect(res.body.valido).toBe(true)
  })

  test('retorna valido: false quando token não existe', async () => {
    credRepo.buscarPorResetToken.mockResolvedValue(null)
    const res = await request(app).get(`${BASE}/reset-password/validar?token=expirado`)
    expect(res.status).toBe(200)
    expect(res.body.valido).toBe(false)
  })
})

// ── /reset-password ───────────────────────────────────────────────────────────

describe('POST /auth/login/reset-password', () => {
  test('400 sem campos', async () => {
    const res = await request(app).post(`${BASE}/reset-password`).send({})
    expect(res.status).toBe(400)
  })

  test('400 senha fraca', async () => {
    const res = await request(app).post(`${BASE}/reset-password`).send({ token: 'abc', password: '123' })
    expect(res.status).toBe(400)
  })

  test('400 token inválido/expirado', async () => {
    credRepo.atualizarSenhaPorResetToken.mockResolvedValue(null)
    const res = await request(app).post(`${BASE}/reset-password`).send({ token: 'expirado', password: 'Abc@1234' })
    expect(res.status).toBe(400)
  })

  test('200 redefine senha com token válido', async () => {
    credRepo.atualizarSenhaPorResetToken.mockResolvedValue({ user_id: 1 })
    const res = await request(app).post(`${BASE}/reset-password`).send({ token: 'valido', password: 'Abc@1234' })
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
  })
})
