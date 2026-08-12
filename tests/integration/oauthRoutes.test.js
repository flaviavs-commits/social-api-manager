process.env.AUTH_TOKEN_SECRET = 'test-secret-auth-12345'
process.env.SESSION_SECRET = 'test-session-xyz'
process.env.ZERNIO_API_KEY = 'test-zernio-key'
process.env.ZERNIO_PROFILE_ID = 'test-profile'

const request = require('supertest')

jest.mock('../../src/db/pool', () => ({ query: jest.fn().mockResolvedValue({ rows: [] }) }))
jest.mock('../../src/repositories/usersRepository', () => {
  const actual = jest.requireActual('../../src/repositories/usersRepository')
  return { ...actual, buscarPorId: jest.fn() }
})
jest.mock('../../src/infra/social/zernioClient', () => {
  const actual = jest.requireActual('../../src/infra/social/zernioClient')
  return { ...actual, connectUrl: jest.fn() }
})

const { gerarTokenSessao } = require('../../src/utils/authToken')
const usersRepo = require('../../src/repositories/usersRepository')
const zernioClient = require('../../src/infra/social/zernioClient')
const app = require('../../src/server')

test('exibe a orientação do limite do Zernio ao adicionar uma conta', async () => {
  usersRepo.buscarPorId.mockResolvedValue({ id: 7, email: 'user@test.com', role: 'user' })
  zernioClient.connectUrl.mockRejectedValue(Object.assign(new Error('Add a payment method to connect more than 2 accounts.'), { status: 402 }))

  const response = await request(app)
    .get('/auth/meta?accountName=Minha%20p%C3%A1gina')
    .set('Authorization', `Bearer ${gerarTokenSessao(7)}`)

  expect(response.status).toBe(402)
  expect(response.body.error).toMatch(/método de pagamento/i)
  expect(response.body.detail).toMatch(/nenhuma conta foi adicionada/i)
})

test('usa o host atual no retorno do Facebook durante o desenvolvimento', async () => {
  usersRepo.buscarPorId.mockResolvedValue({ id: 7, email: 'user@test.com', role: 'user' })
  zernioClient.connectUrl.mockResolvedValue({ authUrl: 'https://www.facebook.com/oauth' })
  process.env.NODE_ENV = 'development'

  const response = await request(app)
    .get('/auth/meta')
    .set('Authorization', `Bearer ${gerarTokenSessao(7)}`)

  expect(response.status).toBe(200)
  const [, , redirectUrl, options] = zernioClient.connectUrl.mock.calls.at(-1)
  expect(options).toEqual({ headless: true })
  const parsedRedirect = new URL(redirectUrl)
  expect(parsedRedirect.hostname).toBe('127.0.0.1')
  expect(parsedRedirect.pathname).toBe('/auth/meta/zernio-return')
  const state = parsedRedirect.searchParams.get('state')
  expect(state).toBeTruthy()
  const statePayload = JSON.parse(Buffer.from(state, 'base64').toString())
  expect(statePayload.returnTo).toBeUndefined()
})

test('preserva a página de integrações no retorno do OAuth', async () => {
  usersRepo.buscarPorId.mockResolvedValue({ id: 7, email: 'user@test.com', role: 'user' })
  zernioClient.connectUrl.mockResolvedValue({ authUrl: 'https://www.instagram.com/oauth' })

  const response = await request(app)
    .get('/auth/instagram?returnTo=%2Fapp%2Fintegracoes')
    .set('Authorization', `Bearer ${gerarTokenSessao(7)}`)

  const [, , redirectUrl] = zernioClient.connectUrl.mock.calls.at(-1)
  const state = JSON.parse(Buffer.from(new URL(redirectUrl).searchParams.get('state'), 'base64').toString())
  expect(state.returnTo).toBe('/app/integracoes')
  expect(response.status).toBe(200)
})

test('orienta quando a etapa interna de seleção do Facebook é aberta diretamente', async () => {
  const response = await request(app).get('/auth/meta/zernio-select')

  expect(response.status).toBe(400)
  expect(response.text).toMatch(/etapa interna do OAuth/i)
})

test('aceita o POST da etapa de seleção após o redirect OAuth', async () => {
  const response = await request(app)
    .post('/auth/meta/zernio-select')
    .set('Host', 'railway.test')
    .set('Origin', 'https://zernio.com')
    .type('form')
    .send({ pendingId: 'inexistente', pageId: 'inexistente' })

  expect(response.status).toBe(200)
})
