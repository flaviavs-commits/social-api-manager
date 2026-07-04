// Testes de integração — /uploads (token de mídia) e /media-proxy (SSRF guard)
process.env.SESSION_SECRET = 'test-session-xyz'
process.env.AUTH_TOKEN_SECRET = 'test-secret-auth-12345'

const request = require('supertest')

jest.mock('../../src/db/pool', () => ({ query: jest.fn().mockResolvedValue({ rows: [] }) }))

const app = require('../../src/server')
const { gerarTokenMedia } = require('../../src/services/mediaToken')

describe('GET /uploads/:file — token de mídia', () => {
  test('sem token retorna 403', async () => {
    const res = await request(app).get('/uploads/foto.jpg')
    expect(res.status).toBe(403)
  })

  test('token inválido retorna 403', async () => {
    const res = await request(app).get('/uploads/foto.jpg?token=invalido')
    expect(res.status).toBe(403)
  })

  test('token válido para outro arquivo retorna 403', async () => {
    const token = gerarTokenMedia('outro.jpg')
    const res = await request(app).get(`/uploads/foto.jpg?token=${token}`)
    expect(res.status).toBe(403)
  })
})

describe('GET /media-proxy — SSRF guard', () => {
  test('sem token retorna 403', async () => {
    const encoded = Buffer.from('https://blob.vercel-storage.com/img.jpg').toString('base64url')
    const res = await request(app).get(`/media-proxy/tokeninvalido/${encoded}.jpg`)
    expect(res.status).toBe(403)
  })

  test('URL não-HTTPS é bloqueada', async () => {
    const url = 'http://evil.com/malware.exe'
    const encoded = Buffer.from(url).toString('base64url')
    const token = gerarTokenMedia(url)
    const res = await request(app).get(`/media-proxy/${token}/${encoded}.exe`)
    expect(res.status).toBe(403)
  })

  test('URL fora do domínio Vercel Blob é bloqueada (SSRF)', async () => {
    const url = 'https://evil.com/steal-data'
    const encoded = Buffer.from(url).toString('base64url')
    const token = gerarTokenMedia(url)
    const res = await request(app).get(`/media-proxy/${token}/${encoded}.jpg`)
    expect(res.status).toBe(403)
  })

  test('base64 inválido sem token válido retorna 403', async () => {
    const token = gerarTokenMedia('anything')
    const res = await request(app).get(`/media-proxy/${token}/!!!invalido!!!.jpg`)
    // Node Buffer.from silently ignores invalid base64 chars — decoded garbage won't match token → 403
    expect(res.status).toBe(403)
  })
})
