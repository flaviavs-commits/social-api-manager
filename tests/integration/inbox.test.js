// Testes de integração — /api/posts/inbox e /api/posts/inbox/unread
process.env.AUTH_TOKEN_SECRET = 'test-secret-auth-12345'
process.env.SESSION_SECRET = 'test-session-xyz'
process.env.ALLOWED_EMAIL_DOMAINS = 'allowed.test'

const request = require('supertest')

jest.mock('../../src/db/pool', () => ({ query: jest.fn().mockResolvedValue({ rows: [] }) }))
jest.mock('../../src/repositories/usersRepository', () => ({
  buscarPorId: jest.fn(),
}))
jest.mock('../../src/infra/db/postsRepository', () => ({
  listarPosts: jest.fn(),
  buscarPostPorId: jest.fn(),
  salvarInstagramPending: jest.fn(),
}))
jest.mock('../../src/services/commentsService', () => ({
  PLATAFORMAS_COM_COMENTARIOS: ['instagram', 'facebook', 'youtube'],
  PLATAFORMAS_COM_RESPOSTA: ['instagram', 'youtube'],
  listarComentariosPost: jest.fn(),
  buscarMidiaPost: jest.fn(),
  responderComentario: jest.fn(),
}))

const pool            = require('../../src/db/pool')
const usersRepo       = require('../../src/repositories/usersRepository')
const postsRepo       = require('../../src/infra/db/postsRepository')
const commentsService = require('../../src/services/commentsService')
const { gerarTokenSessao } = require('../../src/utils/authToken')

const app = require('../../src/server')

const USER = { id: 1, email: 'u@allowed.test', role: 'user', plan: 'premium', full_name: 'U', avatar_url: null, totp_enabled: false }
let token

beforeEach(() => {
  jest.clearAllMocks()
  pool.query.mockResolvedValue({ rows: [] })
  usersRepo.buscarPorId.mockResolvedValue(USER)
  token = gerarTokenSessao(USER.id)
})

const POST_INSTAGRAM = {
  id: 10, externalPostId: 'abc123', externalPlatform: 'instagram',
  text: 'Post de teste', publishedAt: new Date().toISOString(),
  mediaPath: null, mediaType: null, mediaItems: null,
}

describe('GET /api/posts/inbox', () => {
  test('retorna só posts com externalPostId em plataformas suportadas', async () => {
    postsRepo.listarPosts.mockResolvedValue([
      POST_INSTAGRAM,
      { ...POST_INSTAGRAM, id: 11, externalPostId: null }, // sem id externo — não deve aparecer
      { ...POST_INSTAGRAM, id: 12, externalPlatform: 'tiktok' }, // tiktok não suporta comentários
    ])
    const res = await request(app).get('/api/posts/inbox').set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(res.body.posts).toHaveLength(1)
    expect(res.body.posts[0].id).toBe(10)
  })

  test('retorna lista vazia quando não há posts publicados', async () => {
    postsRepo.listarPosts.mockResolvedValue([])
    const res = await request(app).get('/api/posts/inbox').set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(res.body.posts).toEqual([])
  })
})

describe('GET /api/posts/inbox/unread', () => {
  test('retorna unread vazio quando não há posts', async () => {
    postsRepo.listarPosts.mockResolvedValue([])
    const res = await request(app).get('/api/posts/inbox/unread').set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(res.body.unread).toEqual({})
  })

  test('conta comentários novos corretamente', async () => {
    postsRepo.listarPosts.mockResolvedValue([POST_INSTAGRAM])
    // Sem seen_ids no banco
    pool.query.mockResolvedValue({ rows: [] })
    commentsService.listarComentariosPost.mockResolvedValue({
      comments: [
        { id: 'c1', author: 'user1', text: 'Ótimo!', createdAt: new Date().toISOString() },
        { id: 'c2', author: 'user2', text: 'Legal!', createdAt: new Date().toISOString() },
      ]
    })
    const res = await request(app).get('/api/posts/inbox/unread').set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(res.body.unread[10]).toBe(2)
  })

  test('não conta comentários já vistos', async () => {
    postsRepo.listarPosts.mockResolvedValue([POST_INSTAGRAM])
    // c1 já foi visto
    pool.query.mockResolvedValue({ rows: [{ post_id: 10, seen_ids: ['c1'] }] })
    commentsService.listarComentariosPost.mockResolvedValue({
      comments: [
        { id: 'c1', author: 'user1', text: 'Ótimo!' },
        { id: 'c2', author: 'user2', text: 'Novo!' },
      ]
    })
    const res = await request(app).get('/api/posts/inbox/unread').set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(res.body.unread[10]).toBe(1) // só c2 é novo
  })

  test('post sem comentários novos não aparece no unread', async () => {
    postsRepo.listarPosts.mockResolvedValue([POST_INSTAGRAM])
    pool.query.mockResolvedValue({ rows: [{ post_id: 10, seen_ids: ['c1'] }] })
    commentsService.listarComentariosPost.mockResolvedValue({
      comments: [{ id: 'c1', author: 'user1', text: 'Ótimo!' }]
    })
    const res = await request(app).get('/api/posts/inbox/unread').set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(res.body.unread[10]).toBeUndefined()
  })

  test('erro na API da rede social não quebra os outros posts', async () => {
    postsRepo.listarPosts.mockResolvedValue([
      POST_INSTAGRAM,
      { ...POST_INSTAGRAM, id: 20, externalPostId: 'xyz' },
    ])
    pool.query.mockResolvedValue({ rows: [] })
    commentsService.listarComentariosPost
      .mockRejectedValueOnce(new Error('API Instagram fora do ar'))
      .mockResolvedValueOnce({ comments: [{ id: 'c1', author: 'u', text: 'ok' }] })

    const res = await request(app).get('/api/posts/inbox/unread').set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(res.body.unread[10]).toBeUndefined() // falhou, sem contar
    expect(res.body.unread[20]).toBe(1)          // ok
  })
})

describe('GET /api/posts/:id/comments', () => {
  test('mantém o preview publicado quando o OAuth está inválido', async () => {
    postsRepo.buscarPostPorId.mockResolvedValue({
      ...POST_INSTAGRAM,
      accounts: [{ platform: 'instagram', handle: 'minhaconta', avatarUrl: null }]
    })
    commentsService.listarComentariosPost.mockRejectedValue(new Error('A conexão do instagram expirou ou foi revogada.'))
    commentsService.buscarMidiaPost.mockResolvedValue(null)

    const res = await request(app).get('/api/posts/10/comments').set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.comments).toEqual([])
    expect(res.body.error).toContain('expirou')
    expect(res.body.post.text).toBe('Post de teste')
  })
})

describe('POST /api/posts/:id/comments/seen', () => {
  test('marca comentários como vistos retorna 204', async () => {
    pool.query.mockResolvedValue({ rows: [] })
    const res = await request(app)
      .post('/api/posts/10/comments/seen')
      .set('Authorization', `Bearer ${token}`)
      .send({ commentIds: ['c1', 'c2'] })
    expect(res.status).toBe(204)
  })

  test('lista vazia retorna 204 sem query no banco', async () => {
    pool.query.mockResolvedValue({ rows: [] })
    const res = await request(app)
      .post('/api/posts/10/comments/seen')
      .set('Authorization', `Bearer ${token}`)
      .send({ commentIds: [] })
    expect(res.status).toBe(204)
  })

  test('id inválido retorna 400', async () => {
    const res = await request(app)
      .post('/api/posts/nao-e-numero/comments/seen')
      .set('Authorization', `Bearer ${token}`)
      .send({ commentIds: ['c1'] })
    expect(res.status).toBe(400)
  })
})
