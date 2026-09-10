// Testes de integração — checkout de ponta a ponta.
//
// Estes testes exercitam o webhook no nível HTTP: assinam o payload com HMAC
// real (o mesmo algoritmo que a Stripe usa) e batem no endpoint público
// /api/billing/stripe/webhook, passando pelo express.raw() e pela verificação
// de assinatura de verdade. Só o banco e o gateway ficam mockados.
process.env.AUTH_TOKEN_SECRET = 'test-secret-auth-12345'
process.env.SESSION_SECRET = 'test-session-xyz'
process.env.ALLOWED_EMAIL_DOMAINS = 'allowed.test'
process.env.STRIPE_SECRET_KEY = 'sk_test_integration'
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_integration'
process.env.FRONTEND_URL = 'https://app.test'

const crypto = require('crypto')
const request = require('supertest')

jest.mock('../../src/db/pool', () => ({ query: jest.fn().mockResolvedValue({ rows: [] }), connect: jest.fn() }))
jest.mock('../../src/repositories/billingRepository', () => ({
  buscarPorMes: jest.fn(),
  buscarPorGatewaySession: jest.fn(),
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
jest.mock('../../src/repositories/usersRepository', () => ({ buscarPorId: jest.fn(), buscarPorEmail: jest.fn(), listarEmailsAdmins: jest.fn().mockResolvedValue([]) }))
jest.mock('../../src/services/mailer', () => ({ enviarEmailAcessoMeuEcoo: jest.fn(), enviarEmailAlertaPagamentoNaoVinculado: jest.fn().mockResolvedValue(undefined) }))

const billingRepo = require('../../src/repositories/billingRepository')
const usersRepo = require('../../src/repositories/usersRepository')
const mailer = require('../../src/services/mailer')
const { gerarTokenSessao } = require('../../src/utils/authToken')

const app = require('../../src/server')

const CLIENTE = { id: 7, email: 'cliente@allowed.test', role: 'user', plan: 'basico', planActive: false, full_name: 'Cliente', avatar_url: null, totp_enabled: false }

const WEBHOOK_PATH = '/api/billing/stripe/webhook'

function assinar(payload, { secret = process.env.STRIPE_WEBHOOK_SECRET, timestamp = Math.floor(Date.now() / 1000) } = {}) {
  const assinatura = crypto.createHmac('sha256', secret).update(`${timestamp}.${payload}`).digest('hex')
  return `t=${timestamp},v1=${assinatura}`
}

function enviarWebhook(evento, opts = {}) {
  const payload = typeof evento === 'string' ? evento : JSON.stringify(evento)
  const assinatura = opts.signature !== undefined ? opts.signature : assinar(payload, opts)
  return request(app)
    .post(WEBHOOK_PATH)
    .set('Content-Type', 'application/json')
    .set('stripe-signature', assinatura)
    .send(payload)
}

function sessaoPaga(overrides = {}) {
  return {
    id: 'cs_test_default',
    object: 'checkout_session',
    payment_status: 'paid',
    amount_total: 10050,
    currency: 'brl',
    payment_intent: 'pi_test_default',
    ...overrides,
  }
}

function evento(type, object) {
  return { id: `evt_${Math.random().toString(36).slice(2)}`, type, data: { object } }
}

beforeEach(() => {
  jest.clearAllMocks()
})

// ── Verificação de assinatura ────────────────────────────────────────────────

describe('POST /api/billing/stripe/webhook — assinatura', () => {
  test('recusa payload sem cabeçalho de assinatura', async () => {
    const res = await enviarWebhook(evento('checkout.session.completed', sessaoPaga()), { signature: '' })

    expect(res.status).toBe(400)
    expect(res.body).toEqual({ erro: 'Webhook inválido.' })
    expect(billingRepo.confirmarPagamento).not.toHaveBeenCalled()
    expect(billingRepo.confirmarPagamentoDireto).not.toHaveBeenCalled()
  })

  test('recusa assinatura gerada com outro segredo', async () => {
    const res = await enviarWebhook(evento('checkout.session.completed', sessaoPaga()), { secret: 'whsec_segredo_errado' })

    expect(res.status).toBe(400)
    expect(billingRepo.confirmarPagamento).not.toHaveBeenCalled()
  })

  test('recusa evento antigo fora da janela de tolerância (replay)', async () => {
    const timestamp = Math.floor(Date.now() / 1000) - (10 * 60)
    const res = await enviarWebhook(evento('checkout.session.completed', sessaoPaga()), { timestamp })

    expect(res.status).toBe(400)
    expect(billingRepo.confirmarPagamento).not.toHaveBeenCalled()
  })

  test('recusa corpo que não é JSON válido mesmo com assinatura correta', async () => {
    const res = await enviarWebhook('isto-nao-e-json')

    expect(res.status).toBe(400)
    expect(res.body).toEqual({ erro: 'Webhook inválido.' })
  })

  test('aceita assinatura válida e não exige autenticação de usuário', async () => {
    billingRepo.confirmarPagamento.mockResolvedValue({ id: 12, status: 'paid', toPlan: 'basico', meuEcooSelected: false })

    const res = await enviarWebhook(evento('checkout.session.completed', sessaoPaga({
      id: 'cs_assinado',
      amount_total: 5250,
      metadata: { to_plan: 'basico' },
    })))

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ received: true, status: 'paid' })
  })
})

// ── Fluxo dinâmico (checkout criado pelo próprio app) ────────────────────────

describe('checkout dinâmico — confirmação pelo webhook', () => {
  test('confirma o pagamento pela sessão registrada e ativa o plano', async () => {
    billingRepo.confirmarPagamento.mockResolvedValue({ id: 12, userId: 7, status: 'paid', toPlan: 'pro', meuEcooSelected: false })

    const res = await enviarWebhook(evento('checkout.session.completed', sessaoPaga({
      id: 'cs_dinamico',
      payment_intent: 'pi_dinamico',
      client_reference_id: 'billing:12',
      metadata: { to_plan: 'pro', user_id: '7', billing_id: '12' },
    })))

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ received: true, status: 'paid' })
    expect(billingRepo.confirmarPagamento).toHaveBeenCalledWith({
      gatewaySessionId: 'cs_dinamico',
      gatewayPaymentId: 'pi_dinamico',
      amountCents: 10050,
      currency: 'brl',
      toPlan: 'pro',
    })
    // Um checkout do app nunca cai no caminho de link direto.
    expect(billingRepo.confirmarPagamentoDireto).not.toHaveBeenCalled()
  })

  test('não confirma enquanto o pagamento não estiver liquidado', async () => {
    const res = await enviarWebhook(evento('checkout.session.completed', sessaoPaga({
      id: 'cs_pendente',
      payment_status: 'unpaid',
      metadata: { to_plan: 'pro' },
    })))

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ received: true, status: 'pending' })
    expect(billingRepo.confirmarPagamento).not.toHaveBeenCalled()
  })

  test('marca falha quando o checkout expira', async () => {
    billingRepo.marcarFalhaPorSession.mockResolvedValue({ id: 12, status: 'failed' })

    const res = await enviarWebhook(evento('checkout.session.expired', sessaoPaga({ id: 'cs_expirado', payment_status: 'unpaid' })))

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ received: true, status: 'failed' })
    expect(billingRepo.marcarFalhaPorSession).toHaveBeenCalledWith('cs_expirado', expect.objectContaining({ code: 'checkout_expired' }))
  })

  test('marca falha quando o pagamento assíncrono não se confirma', async () => {
    billingRepo.marcarFalhaPorSession.mockResolvedValue({ id: 12, status: 'failed' })

    const res = await enviarWebhook(evento('checkout.session.async_payment_failed', sessaoPaga({ id: 'cs_async_falhou', payment_status: 'unpaid' })))

    expect(res.status).toBe(200)
    expect(billingRepo.marcarFalhaPorSession).toHaveBeenCalledWith('cs_async_falhou', expect.objectContaining({ code: 'async_payment_failed' }))
  })
})

// ── Payment Link estático (pagamento feito fora do app) ──────────────────────

describe('Payment Link direto — vínculo do usuário pelo client_reference_id', () => {
  test('vincula o pagamento à conta e ativa o plano correspondente ao valor pago', async () => {
    usersRepo.buscarPorId.mockResolvedValue({ ...CLIENTE, plan: 'basico' })
    billingRepo.confirmarPagamentoDireto.mockResolvedValue({ id: 99, userId: 7, status: 'paid', toPlan: 'pro', meuEcooSelected: false })

    const res = await enviarWebhook(evento('checkout.session.completed', sessaoPaga({
      id: 'cs_link_pro',
      payment_intent: 'pi_link_pro',
      amount_total: 10050,
      client_reference_id: 'user:7',
      customer_details: { email: 'cliente@allowed.test', name: 'Cliente' },
    })))

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ received: true, status: 'paid' })
    expect(usersRepo.buscarPorId).toHaveBeenCalledWith(7)
    expect(billingRepo.confirmarPagamentoDireto).toHaveBeenCalledWith(expect.objectContaining({
      userId: 7,
      fromPlan: 'basico',
      toPlan: 'pro',
      amountCents: 10050,
      currency: 'brl',
      gatewaySessionId: 'cs_link_pro',
      gatewayPaymentId: 'pi_link_pro',
    }))
  })

  test('identifica o plano Premium pelo valor e libera o MeuEcoo gratuito', async () => {
    usersRepo.buscarPorId.mockResolvedValue({ ...CLIENTE, plan: 'basico' })
    billingRepo.confirmarPagamentoDireto.mockResolvedValue({ id: 100, userId: 7, status: 'paid', toPlan: 'premium', meuEcooSelected: true })
    billingRepo.reservarEnvioMeuEcoo.mockResolvedValue({ id: 100, status: 'paid' })
    mailer.enviarEmailAcessoMeuEcoo.mockResolvedValue(undefined)

    const res = await enviarWebhook(evento('checkout.session.completed', sessaoPaga({
      id: 'cs_link_premium',
      amount_total: 12450,
      client_reference_id: 'user:7',
      customer_details: { email: 'cliente@allowed.test', name: 'Cliente' },
    })))

    expect(res.status).toBe(200)
    expect(billingRepo.confirmarPagamentoDireto).toHaveBeenCalledWith(expect.objectContaining({ toPlan: 'premium' }))
    expect(mailer.enviarEmailAcessoMeuEcoo).toHaveBeenCalledWith('cliente@allowed.test', expect.objectContaining({
      planName: 'EcooMidia Premium',
    }))
  })

  test('identifica o plano Básico pelo valor', async () => {
    usersRepo.buscarPorId.mockResolvedValue({ ...CLIENTE, plan: 'basico' })
    billingRepo.confirmarPagamentoDireto.mockResolvedValue({ id: 101, userId: 7, status: 'paid', toPlan: 'basico', meuEcooSelected: false })

    const res = await enviarWebhook(evento('checkout.session.completed', sessaoPaga({
      id: 'cs_link_basico',
      amount_total: 5250,
      client_reference_id: 'user:7',
    })))

    expect(res.status).toBe(200)
    expect(billingRepo.confirmarPagamentoDireto).toHaveBeenCalledWith(expect.objectContaining({ toPlan: 'basico' }))
    // Básico não concede MeuEcoo.
    expect(mailer.enviarEmailAcessoMeuEcoo).not.toHaveBeenCalled()
  })

  // Rede de segurança para os links que já circulam sem client_reference_id:
  // é este caminho que resolve o caso relatado pelo dono do repositório.
  test('vincula pelo e-mail do comprador quando o link não tem client_reference_id', async () => {
    usersRepo.buscarPorEmail.mockResolvedValue({ ...CLIENTE, plan: 'basico' })
    billingRepo.confirmarPagamentoDireto.mockResolvedValue({ id: 102, userId: 7, status: 'paid', toPlan: 'pro', meuEcooSelected: false })

    const res = await enviarWebhook(evento('checkout.session.completed', sessaoPaga({
      id: 'cs_link_cru',
      amount_total: 10050,
      customer_details: { email: 'cliente@allowed.test', name: 'Cliente' },
    })))

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ received: true, status: 'paid' })
    expect(usersRepo.buscarPorEmail).toHaveBeenCalledWith('cliente@allowed.test')
    expect(billingRepo.confirmarPagamentoDireto).toHaveBeenCalledWith(expect.objectContaining({ userId: 7, toPlan: 'pro' }))
  })

  test('client_reference_id tem prioridade sobre o e-mail do comprador', async () => {
    usersRepo.buscarPorId.mockResolvedValue({ ...CLIENTE, id: 7, plan: 'basico' })
    billingRepo.confirmarPagamentoDireto.mockResolvedValue({ id: 103, userId: 7, status: 'paid', toPlan: 'pro', meuEcooSelected: false })

    const res = await enviarWebhook(evento('checkout.session.completed', sessaoPaga({
      id: 'cs_link_prioridade',
      client_reference_id: 'user:7',
      customer_details: { email: 'outro@allowed.test', name: 'Outro' },
    })))

    expect(res.status).toBe(200)
    expect(usersRepo.buscarPorId).toHaveBeenCalledWith(7)
    expect(usersRepo.buscarPorEmail).not.toHaveBeenCalled()
  })

  // Pix/boleto liquidam depois: a sessão fecha como 'unpaid' e a confirmação
  // chega no async_payment_succeeded.
  test('vincula pagamento assíncrono liquidado depois do fechamento da sessão', async () => {
    usersRepo.buscarPorId.mockResolvedValue({ ...CLIENTE, plan: 'basico' })
    billingRepo.confirmarPagamentoDireto.mockResolvedValue({ id: 104, userId: 7, status: 'paid', toPlan: 'pro', meuEcooSelected: false })

    const sessao = sessaoPaga({ id: 'cs_link_async', client_reference_id: 'user:7', payment_status: 'unpaid' })

    const aoFechar = await enviarWebhook(evento('checkout.session.completed', sessao))
    expect(aoFechar.body).toEqual({ received: true, status: 'pending' })
    expect(billingRepo.confirmarPagamentoDireto).not.toHaveBeenCalled()

    const aoLiquidar = await enviarWebhook(evento('checkout.session.async_payment_succeeded', { ...sessao, payment_status: 'paid' }))
    expect(aoLiquidar.body).toEqual({ received: true, status: 'paid' })
    expect(billingRepo.confirmarPagamentoDireto).toHaveBeenCalledWith(expect.objectContaining({ userId: 7, toPlan: 'pro' }))
  })

  test('sinaliza pagamento sem qualquer identificação em vez de falhar calado', async () => {
    const res = await enviarWebhook(evento('checkout.session.completed', sessaoPaga({ id: 'cs_link_sem_ref' })))

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ received: true, status: 'unlinked' })
    expect(billingRepo.confirmarPagamentoDireto).not.toHaveBeenCalled()
    expect(usersRepo.buscarPorId).not.toHaveBeenCalled()
    expect(usersRepo.buscarPorEmail).not.toHaveBeenCalled()
  })

  test('avisa todo admin ativo por e-mail quando o pagamento fica unlinked, de ponta a ponta pelo webhook HTTP', async () => {
    usersRepo.listarEmailsAdmins.mockResolvedValue(['tiago@vitissouls.com', 'brenoaugusto@vitissouls.com'])

    const res = await enviarWebhook(evento('checkout.session.completed', sessaoPaga({ id: 'cs_link_aviso_admin' })))

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ received: true, status: 'unlinked' })
    expect(mailer.enviarEmailAlertaPagamentoNaoVinculado).toHaveBeenCalledWith(
      ['tiago@vitissouls.com', 'brenoaugusto@vitissouls.com'],
      expect.objectContaining({ sessionId: 'cs_link_aviso_admin' })
    )
  })

  test('sinaliza client_reference_id fora do padrão e sem e-mail conhecido', async () => {
    usersRepo.buscarPorEmail.mockResolvedValue(null)

    const res = await enviarWebhook(evento('checkout.session.completed', sessaoPaga({
      id: 'cs_link_ref_estranha',
      client_reference_id: 'cliente-da-planilha-42',
      customer_details: { email: 'desconhecido@allowed.test' },
    })))

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ received: true, status: 'unlinked' })
    expect(billingRepo.confirmarPagamentoDireto).not.toHaveBeenCalled()
  })

  test('não adivinha o plano quando o valor pago não corresponde a nenhum', async () => {
    const res = await enviarWebhook(evento('checkout.session.completed', sessaoPaga({
      id: 'cs_link_valor_estranho',
      amount_total: 7777,
      client_reference_id: 'user:7',
    })))

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ received: true, status: 'unlinked' })
    expect(billingRepo.confirmarPagamentoDireto).not.toHaveBeenCalled()
    // Nem chega a procurar a conta: sem plano definido não há o que creditar.
    expect(usersRepo.buscarPorId).not.toHaveBeenCalled()
  })

  test('sinaliza quando o usuário referenciado não existe mais', async () => {
    usersRepo.buscarPorId.mockResolvedValue(null)

    const res = await enviarWebhook(evento('checkout.session.completed', sessaoPaga({
      id: 'cs_link_usuario_sumido',
      client_reference_id: 'user:404',
    })))

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ received: true, status: 'unlinked' })
    expect(billingRepo.confirmarPagamentoDireto).not.toHaveBeenCalled()
  })

  test('não credita plano quando a moeda difere da configurada', async () => {
    const res = await enviarWebhook(evento('checkout.session.completed', sessaoPaga({
      id: 'cs_link_moeda',
      amount_total: 10050,
      currency: 'usd',
      client_reference_id: 'user:7',
    })))

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ received: true, status: 'unlinked' })
    expect(billingRepo.confirmarPagamentoDireto).not.toHaveBeenCalled()
  })

  test('reentrega do mesmo evento não gera segunda cobrança (idempotência)', async () => {
    usersRepo.buscarPorId.mockResolvedValue({ ...CLIENTE, plan: 'basico' })
    // A segunda chamada encontra a linha já paga e devolve a mesma cobrança.
    billingRepo.confirmarPagamentoDireto.mockResolvedValue({ id: 99, userId: 7, status: 'paid', toPlan: 'pro', meuEcooSelected: false })

    const payload = evento('checkout.session.completed', sessaoPaga({
      id: 'cs_link_reentrega',
      client_reference_id: 'user:7',
    }))

    const primeira = await enviarWebhook(payload)
    const segunda = await enviarWebhook(payload)

    expect(primeira.body).toEqual({ received: true, status: 'paid' })
    expect(segunda.body).toEqual({ received: true, status: 'paid' })
    expect(billingRepo.confirmarPagamentoDireto).toHaveBeenCalledTimes(2)
    // Ambas as entregas apontam para a mesma sessão: a idempotência é
    // garantida no repositório pela unicidade de gateway_session_id.
    expect(billingRepo.confirmarPagamentoDireto.mock.calls.every(([args]) => args.gatewaySessionId === 'cs_link_reentrega')).toBe(true)
  })

  test('não ativa plano quando já existe cobrança do mês pelo fluxo normal', async () => {
    usersRepo.buscarPorId.mockResolvedValue({ ...CLIENTE, plan: 'basico' })
    billingRepo.confirmarPagamentoDireto.mockResolvedValue(null)

    const res = await enviarWebhook(evento('checkout.session.completed', sessaoPaga({
      id: 'cs_link_conflito',
      client_reference_id: 'user:7',
    })))

    expect(res.status).toBe(200)
    // Sinalizado para reconciliação manual em vez de sobrescrever a cobrança.
    expect(res.body).toEqual({ received: true, status: 'unlinked' })
  })
})

// ── Link de pagamento com o usuário amarrado ─────────────────────────────────

describe('GET /api/billing/plan-link/:plan', () => {
  test('exige autenticação', async () => {
    const res = await request(app).get('/api/billing/plan-link/pro')

    expect(res.status).toBe(401)
  })

  test('devolve o Payment Link com client_reference_id do usuário autenticado', async () => {
    usersRepo.buscarPorId.mockResolvedValue(CLIENTE)

    const res = await request(app)
      .get('/api/billing/plan-link/pro')
      .set('Authorization', `Bearer ${gerarTokenSessao(CLIENTE.id)}`)

    expect(res.status).toBe(200)
    expect(res.body.url).toContain('https://buy.stripe.com/')
    expect(res.body.url).toContain('client_reference_id=user%3A7')
    expect(res.body.url).toContain('prefilled_email=cliente%40allowed.test')
  })

  test('recusa plano inexistente', async () => {
    usersRepo.buscarPorId.mockResolvedValue(CLIENTE)

    const res = await request(app)
      .get('/api/billing/plan-link/plano-fantasma')
      .set('Authorization', `Bearer ${gerarTokenSessao(CLIENTE.id)}`)

    expect(res.status).toBe(400)
    expect(res.body).toMatchObject({ code: 'invalid_plan' })
  })
})
