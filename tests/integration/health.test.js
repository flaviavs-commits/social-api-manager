process.env.AUTH_TOKEN_SECRET = 'test-secret-auth-12345'
process.env.SESSION_SECRET = 'test-session-xyz'

const request = require('supertest')
const app = require('../../src/server')

describe('GET /health', () => {
  test('retorna o status operacional sem autenticação', async () => {
    const res = await request(app).get('/health')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ status: 'ok', service: 'social-api-manager' })
  })

  test('não transforma rota API desconhecida em HTML', async () => {
    const res = await request(app).get('/api/does-not-exist')
    expect(res.status).toBe(401)
    expect(res.headers['content-type']).toMatch(/json/)
  })

  test('retorna 404 para página pública inexistente', async () => {
    const res = await request(app).get('/pagina-que-nao-existe')
    expect(res.status).toBe(404)
    expect(res.headers['content-type']).toMatch(/html/)
    expect(res.text).toContain('404')
  })

  test('retorna 404 para módulo inexistente da SPA', async () => {
    const res = await request(app).get('/app/modulo-que-nao-existe')
    expect(res.status).toBe(404)
    expect(res.headers['content-type']).toMatch(/html/)
  })
})
