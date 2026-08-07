jest.mock('../../src/infra/social/publisher', () => ({ buscarContaToken: jest.fn() }))
jest.mock('../../src/repositories/tokensRepository', () => ({ renovarToken: jest.fn() }))
jest.mock('../../src/infra/social/zernioClient', () => ({
  getPostComments: jest.fn(),
  replyToComment: jest.fn()
}))

const { buscarContaToken } = require('../../src/infra/social/publisher')
const zernioClient = require('../../src/infra/social/zernioClient')
const service = require('../../src/services/commentsService')

describe('commentsService', () => {
  beforeEach(() => jest.clearAllMocks())

  test('usa Zernio para comentários de Facebook/Instagram', async () => {
    buscarContaToken.mockResolvedValue({ accessToken: 'account-id', zernioAccountId: 'zernio-account' })
    zernioClient.getPostComments.mockResolvedValue({ comments: [{ id: 'comment-1', message: 'Olá', from: { name: 'Ana' }, createdTime: '2026-01-01T00:00:00Z' }] })

    await expect(service.listarComentariosPost({ externalPlatform: 'facebook', externalPostId: 'post-1', userId: 1 }))
      .resolves.toEqual({ comments: [{ id: 'comment-1', author: 'Ana', text: 'Olá', createdAt: '2026-01-01T00:00:00Z' }], replySupported: true })
    expect(zernioClient.getPostComments).toHaveBeenCalledWith(
      'post-1',
      { accountId: 'zernio-account', limit: 100 },
      { timeoutMs: 5000, retries: 0 }
    )
  })

  test('mantém suporte a token direto legado', async () => {
    buscarContaToken.mockResolvedValue({ accessToken: 'meta-token' })
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, status: 200, json: jest.fn().mockResolvedValue({ data: [{ id: 'c1', message: 'Oi', from: { name: 'Bia' } }] }) })

    await expect(service.listarComentariosPost({ externalPlatform: 'facebook', externalPostId: 'post-1', userId: 1 }))
      .resolves.toMatchObject({ comments: [{ id: 'c1', author: 'Bia', text: 'Oi' }] })
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('access_token=meta-token'), expect.anything())
    fetchMock.mockRestore()
  })

  test('responde comentário pelo endpoint do Zernio', async () => {
    buscarContaToken.mockResolvedValue({ zernioAccountId: 'zernio-account' })
    zernioClient.replyToComment.mockResolvedValue({ success: true })

    await expect(service.responderComentario({ externalPlatform: 'instagram', externalPostId: 'post-1', userId: 1 }, 'c1', 'Obrigado!'))
      .resolves.toEqual({ success: true })
    expect(zernioClient.replyToComment).toHaveBeenCalledWith('post-1', { accountId: 'zernio-account', commentId: 'c1', message: 'Obrigado!' })
  })

  test('responde comentário do Facebook pela Graph API em conta legada', async () => {
    buscarContaToken.mockResolvedValue({ accessToken: 'meta-token', status: 'valid' })
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue({ id: 'reply-1' })
    })

    await expect(service.responderComentario({ externalPlatform: 'facebook', externalPostId: 'post-1', userId: 1 }, 'c1', 'Obrigado!'))
      .resolves.toEqual({ id: 'reply-1' })
    expect(fetchMock).toHaveBeenCalledWith('https://graph.facebook.com/v19.0/c1/comments', expect.objectContaining({ method: 'POST' }))
    fetchMock.mockRestore()
  })
})
