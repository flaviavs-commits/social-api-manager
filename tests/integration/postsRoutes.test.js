// Testes de integração — GET/DELETE /api/posts, /calendar, /metrics-history, /comments, PATCH /:id
process.env.AUTH_TOKEN_SECRET = 'test-secret-auth-12345'
process.env.SESSION_SECRET = 'test-session-xyz'
process.env.ALLOWED_EMAIL_DOMAINS = 'allowed.test'

const request = require('supertest')

jest.mock('../../src/db/pool', () => ({ query: jest.fn().mockResolvedValue({ rows: [] }) }))
jest.mock('../../src/repositories/usersRepository', () => ({ buscarPorId: jest.fn() }))
jest.mock('../../src/infra/db/postsRepository', () => ({
  listarPosts: jest.fn(),
  buscarPostPorId: jest.fn(),
  deletarPost: jest.fn(),
  listarPostsCalendario: jest.fn(),
  buscarHistoricoMetricas: jest.fn(),
  reagendarPost: jest.fn(),
  registrarSnapshotMetricas: jest.fn(),
  salvarInstagramPending: jest.fn(),
  listarPostsPublicadosSemExternalId: jest.fn(),
  listarPublicacoesDosPosts: jest.fn().mockResolvedValue([]),
}))
jest.mock('../../src/repositories/contasRepository', () => ({ buscarContaPorId: jest.fn() }))
jest.mock('../../src/services/commentsService', () => ({
  PLATAFORMAS_COM_COMENTARIOS: ['instagram', 'facebook', 'youtube'],
  listarComentariosPost: jest.fn(),
  buscarMidiaPost: jest.fn(),
  responderComentario: jest.fn(),
}))
jest.mock('../../src/services/metricsService', () => ({
  buscarMetricasPost: jest.fn(),
  buscarSeriesSeguidoresInstagram: jest.fn().mockResolvedValue({}),
  buscarSeriesStatsTiktok: jest.fn().mockResolvedValue({}),
  buscarSeriesInscritosYoutube: jest.fn().mockResolvedValue({}),
  buscarDemografiaInstagram: jest.fn().mockResolvedValue(null),
  buscarDemografiaYoutube: jest.fn().mockResolvedValue(null),
  buscarHistoricoPostZernio: jest.fn().mockResolvedValue([]),
  buscarVideosTiktok: jest.fn().mockResolvedValue([]),
}))
jest.mock('../../src/services/accountAnalyticsService', () => ({
  buscarAnalyticsContas: jest.fn().mockResolvedValue({
    dateRange: null, capabilities: {}, platforms: {}, dailyMetrics: [],
    contentDecay: [], followerStats: null, errors: []
  })
}))
jest.mock('../../src/services/instagramReconcileService', () => ({
  reconciliarPostsInstagram: jest.fn().mockResolvedValue(undefined),
}))
jest.mock('../../src/infra/social/publisher', () => ({ publishPost: jest.fn() }))

const usersRepo = require('../../src/repositories/usersRepository')
const postsRepo = require('../../src/infra/db/postsRepository')
const commentsService = require('../../src/services/commentsService')
const metricsService = require('../../src/services/metricsService')
const accountAnalyticsService = require('../../src/services/accountAnalyticsService')
const { gerarTokenSessao } = require('../../src/utils/authToken')

const app = require('../../src/server')

const USER = { id: 1, email: 'u@allowed.test', role: 'user', plan: 'premium', full_name: 'U', avatar_url: null, totp_enabled: false }
let token

beforeEach(() => {
  jest.clearAllMocks()
  usersRepo.buscarPorId.mockResolvedValue(USER)
  token = gerarTokenSessao(USER.id)
})

const POST = {
  id: 1, text: 'Oi', platforms: ['instagram'], scheduledAt: new Date().toISOString(),
  status: 'published', userId: 1, mediaPath: null, mediaType: null, mediaItems: null,
  externalPostId: 'abc', externalPlatform: 'instagram', publishedAt: new Date().toISOString(),
}

// ── GET /api/posts ────────────────────────────────────────────────────────────

describe('GET /api/posts', () => {
  test('401 sem token', async () => {
    const res = await request(app).get('/api/posts')
    expect(res.status).toBe(401)
  })

  test('200 retorna lista de posts', async () => {
    postsRepo.listarPosts.mockResolvedValue([POST])
    const res = await request(app).get('/api/posts').set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(res.body.posts).toHaveLength(1)
  })

  test('400 status inválido', async () => {
    const res = await request(app).get('/api/posts?status=invalido').set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(400)
  })

  test('200 com filtro de status válido', async () => {
    postsRepo.listarPosts.mockResolvedValue([])
    const res = await request(app).get('/api/posts?status=scheduled').set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
  })
})

describe('GET /api/posts/analytics', () => {
  test('usa 7 dias por padrão', async () => {
    const res = await request(app).get('/api/posts/analytics').set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(accountAnalyticsService.buscarAnalyticsContas).toHaveBeenCalledWith(expect.objectContaining({ days: 7 }))
  })

  test('400 quando o período excede o limite da API de insights', async () => {
    const res = await request(app).get('/api/posts/analytics?days=91').set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(400)
    expect(accountAnalyticsService.buscarAnalyticsContas).not.toHaveBeenCalled()
  })

  test('200 preserva o contrato legado e inclui analytics completos', async () => {
    const res = await request(app).get('/api/posts/analytics?days=30').set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(res.body).toEqual(expect.objectContaining({
      series: expect.any(Object),
      metrics: expect.any(Array),
      accountAnalytics: expect.any(Object)
    }))
    expect(accountAnalyticsService.buscarAnalyticsContas).toHaveBeenCalledWith(expect.objectContaining({ days: 30 }))
  })

  test('marca como disponível uma métrica retornada pela rede', async () => {
    postsRepo.listarPosts.mockResolvedValue([POST])
    postsRepo.listarPublicacoesDosPosts.mockResolvedValueOnce([{
      postId: POST.id,
      platform: 'instagram',
      accountId: null,
      externalPostId: POST.externalPostId,
      publishedAt: POST.publishedAt
    }])
    metricsService.buscarMetricasPost.mockResolvedValueOnce({ views: 42, likes: 7 })

    const res = await request(app).get('/api/posts/analytics?days=30').set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.metrics[0]).toEqual(expect.objectContaining({
      metrics: { views: 42, likes: 7 },
      metricsStatus: 'available'
    }))
  })
})

// ── GET /api/posts/calendar ───────────────────────────────────────────────────

describe('GET /api/posts/calendar', () => {
  test('400 sem year e month', async () => {
    const res = await request(app).get('/api/posts/calendar').set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(400)
  })

  test('400 month fora do range', async () => {
    const res = await request(app).get('/api/posts/calendar?year=2026&month=13').set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(400)
  })

  test('200 retorna posts do calendário', async () => {
    postsRepo.listarPostsCalendario.mockResolvedValue([POST])
    const res = await request(app).get('/api/posts/calendar?year=2026&month=7').set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(res.body.posts).toHaveLength(1)
  })
})

// ── DELETE /api/posts/:id ─────────────────────────────────────────────────────

describe('DELETE /api/posts/:id', () => {
  test('200 cancela publicação agendada ou com falha', async () => {
    postsRepo.deletarPost.mockResolvedValue(true)
    const res = await request(app).delete('/api/posts/1').set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true })
  })

  test('404 quando a publicação não pode ser excluída', async () => {
    postsRepo.deletarPost.mockResolvedValue(false)
    const res = await request(app).delete('/api/posts/1').set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(404)
    expect(res.body.erro).toMatch(/não pode ser excluída/i)
  })
})

// ── GET /api/posts/:id/metrics-history ───────────────────────────────────────

describe('GET /api/posts/:id/metrics-history', () => {
  test('400 id inválido', async () => {
    const res = await request(app).get('/api/posts/abc/metrics-history').set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(400)
  })

  test('404 post não encontrado', async () => {
    postsRepo.buscarPostPorId.mockResolvedValue(null)
    const res = await request(app).get('/api/posts/99/metrics-history').set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(404)
  })

  test('200 retorna histórico de métricas', async () => {
    postsRepo.buscarPostPorId.mockResolvedValue(POST)
    postsRepo.buscarHistoricoMetricas.mockResolvedValue([{ date: '2026-07-01', likes: 10 }])
    const res = await request(app).get('/api/posts/1/metrics-history').set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(res.body.history).toHaveLength(1)
  })
})

// ── PATCH /api/posts/:id ──────────────────────────────────────────────────────

describe('PATCH /api/posts/:id', () => {
  test('400 id inválido', async () => {
    const res = await request(app).patch('/api/posts/abc').set('Authorization', `Bearer ${token}`).send({ scheduledAt: '2026-07-10T12:00:00Z' })
    expect(res.status).toBe(400)
  })

  test('400 scheduledAt inválido', async () => {
    const res = await request(app).patch('/api/posts/1').set('Authorization', `Bearer ${token}`).send({ scheduledAt: 'naoé data' })
    expect(res.status).toBe(400)
  })

  test('404 post não encontrado', async () => {
    postsRepo.reagendarPost.mockResolvedValue(null)
    const res = await request(app).patch('/api/posts/99').set('Authorization', `Bearer ${token}`).send({ scheduledAt: '2026-07-10T12:00:00Z' })
    expect(res.status).toBe(404)
  })

  test('200 reagenda post', async () => {
    postsRepo.reagendarPost.mockResolvedValue({ id: 1 })
    const res = await request(app).patch('/api/posts/1').set('Authorization', `Bearer ${token}`).send({ scheduledAt: '2026-07-10T12:00:00Z' })
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
  })
})

// ── GET /api/posts/:id/comments ───────────────────────────────────────────────

describe('GET /api/posts/:id/comments', () => {
  test('400 id inválido', async () => {
    const res = await request(app).get('/api/posts/abc/comments').set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(400)
  })

  test('404 post não encontrado', async () => {
    postsRepo.buscarPostPorId.mockResolvedValue(null)
    const res = await request(app).get('/api/posts/99/comments').set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(404)
  })

  test('200 retorna comentários do post', async () => {
    postsRepo.buscarPostPorId.mockResolvedValue(POST)
    commentsService.listarComentariosPost.mockResolvedValue({ comments: [{ id: 'c1', text: 'Legal!' }] })
    commentsService.buscarMidiaPost.mockResolvedValue(null)
    const res = await request(app).get('/api/posts/1/comments').set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(res.body.comments).toHaveLength(1)
  })
})

// ── POST /api/posts — validações de input ────────────────────────────────────

describe('POST /api/posts — validações', () => {
  test('400 sem platforms', async () => {
    const res = await request(app).post('/api/posts').set('Authorization', `Bearer ${token}`).send({
      text: 'oi', scheduledAt: '2026-08-01T12:00', platforms: '[]'
    })
    expect(res.status).toBe(400)
  })

  test('400 platform inválida', async () => {
    const res = await request(app).post('/api/posts').set('Authorization', `Bearer ${token}`).send({
      text: 'oi', scheduledAt: '2026-08-01T12:00', platforms: JSON.stringify(['redequeexiste'])
    })
    expect(res.status).toBe(400)
  })

  test('400 youtubeVisibility inválido', async () => {
    const res = await request(app).post('/api/posts').set('Authorization', `Bearer ${token}`).send({
      text: 'oi', scheduledAt: '2026-08-01T12:00', platforms: JSON.stringify(['youtube']),
      youtubeVisibility: 'secreto', media: '[]'
    })
    expect(res.status).toBe(400)
  })

  test('400 scheduledAt ausente', async () => {
    const res = await request(app).post('/api/posts').set('Authorization', `Bearer ${token}`).send({
      text: 'oi', platforms: JSON.stringify(['instagram']), media: '[]'
    })
    expect(res.status).toBe(400)
  })

  test('400 scheduledAt inválido', async () => {
    const res = await request(app).post('/api/posts').set('Authorization', `Bearer ${token}`).send({
      text: 'oi', platforms: JSON.stringify(['instagram']), scheduledAt: 'naoé data', media: '[]'
    })
    expect(res.status).toBe(400)
  })

  test('400 media sem url', async () => {
    const res = await request(app).post('/api/posts').set('Authorization', `Bearer ${token}`).send({
      text: 'oi', platforms: JSON.stringify(['instagram']), scheduledAt: '2026-08-01T12:00',
      media: JSON.stringify([{ mimetype: 'image/jpeg' }])
    })
    expect(res.status).toBe(400)
  })

  test('400 texto excede 5000 chars', async () => {
    const res = await request(app).post('/api/posts').set('Authorization', `Bearer ${token}`).send({
      text: 'x'.repeat(5001), platforms: JSON.stringify(['instagram']), scheduledAt: '2026-08-01T12:00', media: '[]'
    })
    expect(res.status).toBe(400)
  })

  test('400 repeat inválido', async () => {
    const res = await request(app).post('/api/posts').set('Authorization', `Bearer ${token}`).send({
      text: 'oi', platforms: JSON.stringify(['instagram']), scheduledAt: '2026-08-01T12:00', media: '[]', repeat: 'sempre'
    })
    expect(res.status).toBe(400)
  })
})

// ── POST /api/posts/:id/comments/:commentId/reply ─────────────────────────────

describe('POST /api/posts/:id/comments/:commentId/reply', () => {
  test('400 id inválido', async () => {
    const res = await request(app).post('/api/posts/abc/comments/c1/reply').set('Authorization', `Bearer ${token}`).send({ text: 'Oi' })
    expect(res.status).toBe(400)
  })

  test('400 texto vazio', async () => {
    postsRepo.buscarPostPorId.mockResolvedValue(POST)
    const res = await request(app).post('/api/posts/1/comments/c1/reply').set('Authorization', `Bearer ${token}`).send({ text: '' })
    expect(res.status).toBe(400)
  })

  test('201 resposta enviada', async () => {
    postsRepo.buscarPostPorId.mockResolvedValue(POST)
    commentsService.responderComentario.mockResolvedValue({ id: 'r1', text: 'Obrigado!' })
    const res = await request(app).post('/api/posts/1/comments/c1/reply').set('Authorization', `Bearer ${token}`).send({ text: 'Obrigado!' })
    expect(res.status).toBe(201)
  })
})
