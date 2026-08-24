const { autenticarViaMeuEcoo, sincronizarCredencial } = require('../../src/services/meuEcoo')

const original = {
  url: process.env.MEU_ECOO_API_URL,
  login: process.env.MEU_ECOO_SERVICE_TOKEN,
  sync: process.env.MEU_ECOO_CREDENTIAL_SYNC_TOKEN,
}

beforeEach(() => {
  process.env.MEU_ECOO_API_URL = 'https://api.example.com'
  process.env.MEU_ECOO_SERVICE_TOKEN = 'token-login'
  process.env.MEU_ECOO_CREDENTIAL_SYNC_TOKEN = 'token-sync'
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ data: { tokens: { access: 'jwt' } } }) })
})

afterEach(() => {
  process.env.MEU_ECOO_API_URL = original.url
  process.env.MEU_ECOO_SERVICE_TOKEN = original.login
  process.env.MEU_ECOO_CREDENTIAL_SYNC_TOKEN = original.sync
  delete global.fetch
})

describe('integração de identidade MeuEcoo', () => {
  it('usa o token exclusivo de escrita para sincronizar credencial', async () => {
    await sincronizarCredencial('ana@exemplo.com', 'senha', 'Ana')

    expect(fetch).toHaveBeenCalledWith(
      'https://api.example.com/api/partner/auth/sync-credential',
      expect.objectContaining({
        headers: expect.objectContaining({ 'X-Service-Token': 'token-sync' }),
        body: JSON.stringify({ email: 'ana@exemplo.com', password: 'senha', nome: 'Ana' }),
      }),
    )
  })

  it('não envia senha quando o token exclusivo de escrita está ausente', async () => {
    delete process.env.MEU_ECOO_CREDENTIAL_SYNC_TOKEN

    await sincronizarCredencial('ana@exemplo.com', 'senha', 'Ana')

    expect(fetch).not.toHaveBeenCalled()
  })

  it('mantém o token de login fora da rota de sincronização', async () => {
    await autenticarViaMeuEcoo('ana@exemplo.com', 'senha')

    expect(fetch).toHaveBeenCalledWith(
      'https://api.example.com/api/partner/auth/login',
      expect.objectContaining({ headers: expect.objectContaining({ 'X-Service-Token': 'token-login' }) }),
    )
  })
})
