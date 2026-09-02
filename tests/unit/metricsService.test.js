jest.mock('../../src/infra/social/publisher', () => ({
  buscarContaToken: jest.fn(),
  listarContasToken: jest.fn(),
}))
jest.mock('../../src/repositories/contasRepository', () => ({}))
jest.mock('../../src/repositories/tokensRepository', () => ({}))
jest.mock('../../src/infra/social/zernioClient', () => ({
  getAnalytics: jest.fn(),
}))

const { listarContasToken } = require('../../src/infra/social/publisher')
const zernioClient = require('../../src/infra/social/zernioClient')
const { buscarVideosTiktok } = require('../../src/services/metricsService')

describe('metricsService TikTok catalog', () => {
  beforeEach(() => jest.clearAllMocks())

  it('returns real provider metrics and follows pagination', async () => {
    listarContasToken.mockResolvedValue([{ contaId: 10, accountName: '@creator', zernioAccountId: 'tt-account' }])
    zernioClient.getAnalytics
      .mockResolvedValueOnce({
        posts: [{
          publishedAt: '2026-09-01T12:00:00Z',
          platforms: [{ platform: 'tiktok', accountId: 'tt-account', platformPostId: 'video-1', analytics: { views: 12, likes: 8, comments: 3, shares: 2 } }],
        }],
        pagination: { pages: 2 },
      })
      .mockResolvedValueOnce({
        posts: [{
          publishedAt: '2026-08-30T12:00:00Z',
          platforms: [{ platform: 'tiktok', accountId: 'tt-account', platformPostId: 'video-2', analytics: { views: 7, likes: 4, comments: 1, shares: 0 } }],
        }],
        pagination: { pages: 2 },
      })

    const result = await buscarVideosTiktok(5, false)

    expect(result.errors).toEqual([])
    expect(result.videos.map(video => video.viewCount)).toEqual([12, 7])
    expect(zernioClient.getAnalytics).toHaveBeenNthCalledWith(1, expect.objectContaining({ accountId: 'tt-account', platform: 'tiktok', limit: 100, page: 1 }))
    expect(zernioClient.getAnalytics).toHaveBeenNthCalledWith(2, expect.objectContaining({ accountId: 'tt-account', platform: 'tiktok', limit: 100, page: 2 }))
  })

  it('reports a failed account without fabricating video values', async () => {
    listarContasToken.mockResolvedValue([{ contaId: 10, zernioAccountId: 'tt-account' }])
    zernioClient.getAnalytics.mockRejectedValue(new Error('Tempo esgotado ao acessar https://zernio.com'))

    const result = await buscarVideosTiktok(5, false)

    expect(result.videos).toEqual([])
    expect(result.errors).toEqual([{ message: 'Tempo esgotado ao acessar https://zernio.com' }])
  })
})
