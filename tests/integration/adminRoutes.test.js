// Testes de integração — /api/admin/users (requireAdmin + escopo próprio)
process.env.AUTH_TOKEN_SECRET = 'test-secret-auth-12345'
process.env.SESSION_SECRET = 'test-session-xyz'
process.env.ALLOWED_EMAIL_DOMAINS = 'allowed.test'

const request = require('supertest')

jest.mock('../../src/db/pool', () => ({ query: jest.fn().mockResolvedValue({ rows: [] }) }))
jest.mock('../../src/repositories/usersRepository', () => ({
  buscarPorId: jest.fn(),
  buscarPorEmail: jest.fn(),
  listarTodos: jest.fn(),
  atualizarRole: jest.fn(),
  atualizarAtivo: jest.fn(),
  contarSuperAdmins: jest.fn(),
  buscarPorIdIncluindoInativo: jest.fn(),
}))
jest.mock('../../src/repositories/contasRepository', () => ({
  listarContas: jest.fn(),
}))
jest.mock('../../src/repositories/billingRepository', () => ({
  buscarPorMes: jest.fn(),
  buscarPorGatewaySession: jest.fn(),
  buscarPorGatewaySessions: jest.fn(),
  criarPendente: jest.fn(),
  atualizarItensMeuEcoo: jest.fn(),
  reservarProcessamento: jest.fn(),
  anexarCheckout: jest.fn(),
  marcarFalha: jest.fn(),
  manterProcessando: jest.fn(),
  confirmarPagamento: jest.fn(),
  confirmarPagamentoDireto: jest.fn(),
  marcarFalhaPorSession: jest.fn(),
  reservarEnvioMeuEcoo: jest.fn(),
  marcarEnvioMeuEcooConcluido: jest.fn(),
  marcarFalhaEnvioMeuEcoo: jest.fn(),
}))
jest.mock('../../src/services/billing/paymentGateway', () => ({
  createCheckout: jest.fn(),
  expireCheckout: jest.fn(),
  verifyWebhook: jest.fn(),
  isConfigured: jest.fn(() => true),
  getCheckoutSession: jest.fn(),
  listCheckoutSessions: jest.fn(),
}))
jest.mock('../../src/repositories/logsRepository', () => ({
  registrarLog: jest.fn().mockResolvedValue(undefined),
  listarLogs: jest.fn(),
  listarLogsDesde: jest.fn(),
  limparLogs: jest.fn(),
  broadcastEvent: jest.fn(),
  listarEventosDesde: jest.fn(),
  limparAntigos: jest.fn(),
}))

const usersRepo = require('../../src/repositories/usersRepository')
const logsRepo = require('../../src/repositories/logsRepository')
const billingRepo = require('../../src/repositories/billingRepository')
const paymentGateway = require('../../src/services/billing/paymentGateway')
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

  test('registra auditoria no próprio histórico do admin (histórico de ações administrativas)', async () => {
    usersRepo.buscarPorId.mockResolvedValue(ADMIN)
    usersRepo.atualizarRole.mockResolvedValue({ id: 1, email: ADMIN.email, role: 'user' })
    await request(app)
      .post(`/api/admin/users/${ADMIN.id}/role`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ role: 'user' })
    expect(logsRepo.registrarLog).toHaveBeenCalledWith(expect.objectContaining({ type: 'ok', user_id: ADMIN.id, message: expect.stringContaining('user') }))
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

  test('registra auditoria no próprio histórico do admin ao reativar a própria conta', async () => {
    usersRepo.buscarPorId.mockResolvedValue(ADMIN)
    usersRepo.atualizarAtivo.mockResolvedValue({ id: 1, email: ADMIN.email, ativo: true })
    await request(app)
      .post(`/api/admin/users/${ADMIN.id}/ativo`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ ativo: true })
    expect(logsRepo.registrarLog).toHaveBeenCalledWith(expect.objectContaining({ type: 'ok', user_id: ADMIN.id, message: expect.stringContaining('ativo') }))
  })
})

// ── GET /api/admin/users/search ───────────────────────────────────────────────
// Resolve um e-mail específico para um id, sem listar o diretório completo —
// listUsers devolve só a própria conta do admin, por design (server.js).

describe('GET /api/admin/users/search', () => {
  const CLIENTE = { id: 7, email: 'cliente@allowed.test', fullName: 'Cliente', role: 'user', ativo: true, plan: 'pro' }

  test('401 sem token', async () => {
    const res = await request(app).get('/api/admin/users/search?email=cliente@allowed.test')
    expect(res.status).toBe(401)
  })

  test('403 para user comum', async () => {
    usersRepo.buscarPorId.mockResolvedValue(USER)
    const res = await request(app).get('/api/admin/users/search?email=cliente@allowed.test').set('Authorization', `Bearer ${tokenUser}`)
    expect(res.status).toBe(403)
  })

  test('400 sem e-mail informado', async () => {
    usersRepo.buscarPorId.mockResolvedValue(ADMIN)
    const res = await request(app).get('/api/admin/users/search').set('Authorization', `Bearer ${tokenAdmin}`)
    expect(res.status).toBe(400)
  })

  test('404 quando não encontra ninguém com esse e-mail', async () => {
    usersRepo.buscarPorId.mockResolvedValue(ADMIN)
    usersRepo.buscarPorEmail.mockResolvedValue(null)
    const res = await request(app).get('/api/admin/users/search?email=ninguem@allowed.test').set('Authorization', `Bearer ${tokenAdmin}`)
    expect(res.status).toBe(404)
  })

  test('200: devolve o usuário encontrado e audita a consulta', async () => {
    usersRepo.buscarPorId.mockResolvedValue(ADMIN)
    usersRepo.buscarPorEmail.mockResolvedValue(CLIENTE)

    const res = await request(app).get('/api/admin/users/search?email=cliente@allowed.test').set('Authorization', `Bearer ${tokenAdmin}`)

    expect(res.status).toBe(200)
    expect(res.body.user).toEqual({ id: 7, email: 'cliente@allowed.test', fullName: 'Cliente', plan: 'pro' })
    expect(logsRepo.registrarLog).toHaveBeenCalledWith(expect.objectContaining({ type: 'ok', user_id: ADMIN.id, message: expect.stringContaining('cliente@allowed.test') }))
  })
})

// ── GET /api/admin/users/:id/plan-link/:plan ──────────────────────────────────
// Único ponto do painel admin em que um admin acessa dado de outra conta:
// gera o Payment Link do plano com o client_reference_id do usuário-alvo.
// Decisão registrada na task "definir quem gera o link de pagamento" — Trilha B,
// resposta do usuário: criar tela admin, aberta para qualquer admin.

describe('GET /api/admin/users/:id/plan-link/:plan', () => {
  const CLIENTE = { id: 7, email: 'cliente@allowed.test', role: 'user', ativo: true, plan: 'basico' }

  function porId(id) {
    if (id === ADMIN.id) return ADMIN
    if (id === USER.id) return USER
    if (id === CLIENTE.id) return CLIENTE
    return null
  }

  test('401 sem token', async () => {
    const res = await request(app).get(`/api/admin/users/${CLIENTE.id}/plan-link/pro`)
    expect(res.status).toBe(401)
  })

  test('403 para user comum', async () => {
    usersRepo.buscarPorId.mockResolvedValue(USER)
    const res = await request(app)
      .get(`/api/admin/users/${CLIENTE.id}/plan-link/pro`)
      .set('Authorization', `Bearer ${tokenUser}`)
    expect(res.status).toBe(403)
  })

  test('400 id de usuário inválido', async () => {
    usersRepo.buscarPorId.mockResolvedValue(ADMIN)
    const res = await request(app)
      .get('/api/admin/users/abc/plan-link/pro')
      .set('Authorization', `Bearer ${tokenAdmin}`)
    expect(res.status).toBe(400)
  })

  test('404 quando o usuário-alvo não existe', async () => {
    usersRepo.buscarPorId.mockImplementation(async id => (id === ADMIN.id ? ADMIN : null))
    const res = await request(app)
      .get('/api/admin/users/999/plan-link/pro')
      .set('Authorization', `Bearer ${tokenAdmin}`)
    expect(res.status).toBe(404)
  })

  test('400 plano inválido', async () => {
    usersRepo.buscarPorId.mockImplementation(async id => porId(id))
    const res = await request(app)
      .get(`/api/admin/users/${CLIENTE.id}/plan-link/inexistente`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
    expect(res.status).toBe(400)
    expect(res.body.code).toBe('invalid_plan')
  })

  test('200: gera o link com o client_reference_id do usuário-alvo, não do admin', async () => {
    usersRepo.buscarPorId.mockImplementation(async id => porId(id))
    const res = await request(app)
      .get(`/api/admin/users/${CLIENTE.id}/plan-link/pro`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
    expect(res.status).toBe(200)
    expect(res.body.url).toContain('https://buy.stripe.com/')
    expect(res.body.url).toContain(`client_reference_id=user%3A${CLIENTE.id}`)
    expect(res.body.url).toContain('prefilled_email=cliente%40allowed.test')
    expect(res.body.url).not.toContain(`user%3A${ADMIN.id}`)
  })

  test('200: qualquer admin pode gerar (decisão registrada: não restrito a super_admin)', async () => {
    usersRepo.buscarPorId.mockImplementation(async id => porId(id))
    const res = await request(app)
      .get(`/api/admin/users/${CLIENTE.id}/plan-link/basico`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
    expect(res.status).toBe(200)
  })

  test('registra auditoria no log do admin que gerou o link', async () => {
    usersRepo.buscarPorId.mockImplementation(async id => porId(id))
    await request(app)
      .get(`/api/admin/users/${CLIENTE.id}/plan-link/premium`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
    expect(logsRepo.registrarLog).toHaveBeenCalledWith(expect.objectContaining({
      type: 'ok',
      user_id: ADMIN.id,
      message: expect.stringContaining(CLIENTE.email),
    }))
    expect(logsRepo.registrarLog.mock.calls[0][0].message).toContain('premium')
  })
})

// ── GET /api/admin/billing/reconciliation ─────────────────────────────────────
// ── POST /api/admin/billing/reconciliation/:sessionId/link ───────────────────
// Complemento de "criar reconciliação e alerta para pagamentos não vinculados":
// cruza a Stripe com o banco e permite vincular manualmente, sem acesso direto
// ao banco. Decisão registrada na task — sem destinatário de alerta por
// e-mail nesta entrega (ver task nova sobre painel de admin).

function sessaoStripe(overrides = {}) {
  return {
    id: 'cs_stripe_1',
    payment_status: 'paid',
    amount_total: 10050,
    currency: 'brl',
    created: Math.floor(new Date('2026-09-10T12:00:00Z').getTime() / 1000),
    client_reference_id: null,
    customer_email: null,
    customer_details: null,
    payment_intent: 'pi_1',
    ...overrides,
  }
}

describe('GET /api/admin/billing/reconciliation', () => {
  test('401 sem token', async () => {
    const res = await request(app).get('/api/admin/billing/reconciliation')
    expect(res.status).toBe(401)
  })

  test('403 para user comum', async () => {
    usersRepo.buscarPorId.mockResolvedValue(USER)
    const res = await request(app).get('/api/admin/billing/reconciliation').set('Authorization', `Bearer ${tokenUser}`)
    expect(res.status).toBe(403)
  })

  test('200: devolve as sessões pagas sem cobrança correspondente', async () => {
    usersRepo.buscarPorId.mockResolvedValue(ADMIN)
    paymentGateway.listCheckoutSessions.mockResolvedValue({
      sessions: [sessaoStripe({ id: 'cs_sem_match' }), sessaoStripe({ id: 'cs_com_match' })],
      truncated: false,
    })
    billingRepo.buscarPorGatewaySessions.mockResolvedValue([{ gatewaySessionId: 'cs_com_match', status: 'paid' }])

    const res = await request(app).get('/api/admin/billing/reconciliation?days=15').set('Authorization', `Bearer ${tokenAdmin}`)

    expect(res.status).toBe(200)
    expect(res.body.unmatched).toHaveLength(1)
    expect(res.body.unmatched[0].sessionId).toBe('cs_sem_match')
    expect(paymentGateway.listCheckoutSessions).toHaveBeenCalledWith(expect.objectContaining({ createdGteSeconds: expect.any(Number) }))
  })
})

describe('POST /api/admin/billing/reconciliation/:sessionId/link', () => {
  const CLIENTE = { id: 7, email: 'cliente@allowed.test', role: 'user', ativo: true, plan: 'basico' }

  function porId(id) {
    if (id === ADMIN.id) return ADMIN
    if (id === USER.id) return USER
    if (id === CLIENTE.id) return CLIENTE
    return null
  }

  test('401 sem token', async () => {
    const res = await request(app).post('/api/admin/billing/reconciliation/cs_1/link').send({ userId: 7, plan: 'pro' })
    expect(res.status).toBe(401)
  })

  test('403 para user comum', async () => {
    usersRepo.buscarPorId.mockResolvedValue(USER)
    const res = await request(app)
      .post('/api/admin/billing/reconciliation/cs_1/link')
      .set('Authorization', `Bearer ${tokenUser}`)
      .send({ userId: 7, plan: 'pro' })
    expect(res.status).toBe(403)
  })

  test('200: vincula e registra auditoria no log do admin autor', async () => {
    usersRepo.buscarPorId.mockImplementation(async id => porId(id))
    paymentGateway.getCheckoutSession.mockResolvedValue(sessaoStripe({ id: 'cs_manual', amount_total: 10050 }))
    billingRepo.confirmarPagamentoDireto.mockResolvedValue({ id: 50, userId: 7, status: 'paid', toPlan: 'pro', meuEcooSelected: false })

    const res = await request(app)
      .post(`/api/admin/billing/reconciliation/cs_manual/link`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ userId: CLIENTE.id, plan: 'pro' })

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ status: 'paid' })
    expect(billingRepo.confirmarPagamentoDireto).toHaveBeenCalledWith(expect.objectContaining({ userId: 7, toPlan: 'pro', gatewaySessionId: 'cs_manual' }))
    expect(logsRepo.registrarLog).toHaveBeenCalledWith(expect.objectContaining({ type: 'ok', user_id: ADMIN.id, message: expect.stringContaining(`admin #${ADMIN.id}`) }))
  })

  test('400 quando a sessão não está paga na Stripe', async () => {
    usersRepo.buscarPorId.mockImplementation(async id => porId(id))
    paymentGateway.getCheckoutSession.mockResolvedValue(sessaoStripe({ payment_status: 'unpaid' }))

    const res = await request(app)
      .post('/api/admin/billing/reconciliation/cs_1/link')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ userId: CLIENTE.id, plan: 'pro' })

    expect(res.status).toBe(400)
    expect(res.body.code).toBe('session_not_paid')
    expect(billingRepo.confirmarPagamentoDireto).not.toHaveBeenCalled()
  })
})
