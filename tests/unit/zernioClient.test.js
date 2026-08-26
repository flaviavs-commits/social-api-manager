jest.mock('../../src/infra/http/requestJson', () => ({
  HttpClientError: class HttpClientError extends Error {
    constructor(message, options = {}) {
      super(message)
      this.name = 'HttpClientError'
      Object.assign(this, options)
    }
  },
  requestJson: jest.fn()
}))

const { requestJson, HttpClientError } = require('../../src/infra/http/requestJson')
const { createPost, createWebhookSettings, ZernioError } = require('../../src/infra/social/zernioClient')

beforeEach(() => {
  jest.clearAllMocks()
  process.env.ZERNIO_API_KEY = 'test-key'
})

test('envia o mesmo requestId lógico ao criar um post', async () => {
  requestJson.mockResolvedValue({ post: { _id: 'z-post' } })

  await createPost({ content: 'teste' }, { requestId: 'request-123' })

  expect(requestJson).toHaveBeenCalledWith(expect.any(URL), expect.objectContaining({
    method: 'POST',
    headers: expect.objectContaining({
      Authorization: 'Bearer test-key',
      'X-Request-Id': 'request-123'
    })
  }))
})

test('preserva status e detalhes do duplicate retornado pelo Zernio', async () => {
  requestJson.mockRejectedValue(new HttpClientError('conteúdo duplicado', {
    status: 409,
    data: { error: 'conteúdo duplicado', details: { existingPostId: 'existing-1' } }
  }))

  await expect(createPost({ content: 'teste' })).rejects.toMatchObject({
    constructor: ZernioError,
    status: 409,
    details: { details: { existingPostId: 'existing-1' } }
  })
})

test('cadastra webhook com segredo e eventos de publicação', async () => {
  requestJson.mockResolvedValue({ webhook: { _id: 'wh-1' } })

  await createWebhookSettings({
    name: 'Social API Manager',
    url: 'https://app.example/webhooks/zernio',
    secret: 'secret-1',
    events: ['post.published']
  })

  expect(requestJson).toHaveBeenCalledWith(expect.any(URL), expect.objectContaining({
    method: 'POST',
    body: {
      name: 'Social API Manager',
      url: 'https://app.example/webhooks/zernio',
      secret: 'secret-1',
      events: ['post.published'],
      isActive: true
    }
  }))
})
