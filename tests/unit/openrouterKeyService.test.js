const { createOpenRouterUserKey } = require('../../src/services/openrouterKeyService')

describe('openrouterKeyService', () => {
  const originalManagementKey = process.env.OPENROUTER_MANAGEMENT_API_KEY
  const originalLimit = process.env.OPENROUTER_USER_KEY_LIMIT_USD
  const originalReset = process.env.OPENROUTER_USER_KEY_LIMIT_RESET

  afterEach(() => {
    if (originalManagementKey === undefined) delete process.env.OPENROUTER_MANAGEMENT_API_KEY
    else process.env.OPENROUTER_MANAGEMENT_API_KEY = originalManagementKey
    if (originalLimit === undefined) delete process.env.OPENROUTER_USER_KEY_LIMIT_USD
    else process.env.OPENROUTER_USER_KEY_LIMIT_USD = originalLimit
    if (originalReset === undefined) delete process.env.OPENROUTER_USER_KEY_LIMIT_RESET
    else process.env.OPENROUTER_USER_KEY_LIMIT_RESET = originalReset
  })

  test('cria uma chave comum usando a management key e aplica limite opcional', async () => {
    process.env.OPENROUTER_MANAGEMENT_API_KEY = 'management-secret'
    process.env.OPENROUTER_USER_KEY_LIMIT_USD = '2.5'
    process.env.OPENROUTER_USER_KEY_LIMIT_RESET = 'monthly'
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ key: 'sk-or-v1-user-key', data: { hash: 'hash-1' } }),
    })

    const result = await createOpenRouterUserKey({ userId: 42, fetchImpl })

    expect(result).toEqual({ key: 'sk-or-v1-user-key', hash: 'hash-1', label: null })
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://openrouter.ai/api/v1/keys',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer management-secret' }),
        body: JSON.stringify({ name: 'meu-ecoo-user-42', limit: 2.5, limit_reset: 'monthly' }),
      })
    )
  })

  test('não tenta criar chave quando não existe management key', async () => {
    delete process.env.OPENROUTER_MANAGEMENT_API_KEY
    const fetchImpl = jest.fn()

    await expect(createOpenRouterUserKey({ userId: 42, fetchImpl })).resolves.toBeNull()
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  test('preserva a mensagem de erro do endpoint de gerenciamento', async () => {
    process.env.OPENROUTER_MANAGEMENT_API_KEY = 'management-secret'
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ error: { message: 'Only management keys can perform this operation' } }),
    })

    await expect(createOpenRouterUserKey({ userId: 42, fetchImpl })).rejects.toMatchObject({
      status: 403,
      code: 'openrouter_key_provision_error',
      message: 'Only management keys can perform this operation',
    })
  })
})
