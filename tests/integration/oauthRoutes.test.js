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
