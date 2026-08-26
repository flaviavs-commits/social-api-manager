jest.mock('../../src/db/pool', () => ({ connect: jest.fn() }))
jest.mock('../../src/infra/social/zernioClient', () => ({
  createProfile: jest.fn(),
  listProfiles: jest.fn()
}))

const pool = require('../../src/db/pool')
const zernioClient = require('../../src/infra/social/zernioClient')
const service = require('../../src/services/zernioProfileService')

function mockConnection() {
  return {
    query: jest.fn(),
    release: jest.fn()
  }
}

beforeEach(() => jest.clearAllMocks())

test('reutiliza o perfil já salvo no cliente', async () => {
  const client = mockConnection()
  client.query
    .mockResolvedValueOnce({})
    .mockResolvedValueOnce({ rows: [{ id: 7, email: 'cliente@example.com', zernioProfileId: 'profile-7' }] })
    .mockResolvedValueOnce({})
  pool.connect.mockResolvedValueOnce(client)

  await expect(service.ensureZernioProfile(7)).resolves.toBe('profile-7')

  expect(zernioClient.createProfile).not.toHaveBeenCalled()
  expect(client.query).toHaveBeenCalledWith('COMMIT')
  expect(client.release).toHaveBeenCalled()
})

test('cria e salva um perfil determinístico para o cliente', async () => {
  const client = mockConnection()
  client.query
    .mockResolvedValueOnce({})
    .mockResolvedValueOnce({ rows: [{ id: 7, email: 'cliente@example.com', zernioProfileId: null }] })
    .mockResolvedValueOnce({ rows: [{ zernioProfileId: 'profile-7' }] })
    .mockResolvedValueOnce({})
  pool.connect.mockResolvedValueOnce(client)
  zernioClient.createProfile.mockResolvedValueOnce({ profile: { _id: 'profile-7' } })

  await expect(service.ensureZernioProfile(7)).resolves.toBe('profile-7')

  expect(zernioClient.createProfile).toHaveBeenCalledWith({
    name: 'customer_7',
    description: 'cliente@example.com'
  })
  expect(client.query).toHaveBeenCalledWith(expect.stringContaining('UPDATE users'), ['profile-7', 7])
  expect(client.release).toHaveBeenCalled()
})

test('recupera perfil após timeout na resposta de criação', async () => {
  const client = mockConnection()
  client.query
    .mockResolvedValueOnce({})
    .mockResolvedValueOnce({ rows: [{ id: 7, email: 'cliente@example.com', zernioProfileId: null }] })
    .mockResolvedValueOnce({ rows: [{ zernioProfileId: 'profile-7' }] })
    .mockResolvedValueOnce({})
  pool.connect.mockResolvedValueOnce(client)
  zernioClient.createProfile.mockRejectedValueOnce(new Error('timeout'))
  zernioClient.listProfiles.mockResolvedValueOnce({ profiles: [{ name: 'customer_7', _id: 'profile-7' }] })

  await expect(service.ensureZernioProfile(7)).resolves.toBe('profile-7')
  expect(zernioClient.listProfiles).toHaveBeenCalled()
})
