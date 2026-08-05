jest.mock('../../src/infra/social/publisher', () => ({
  listarContasToken: jest.fn()
}))

jest.mock('../../src/infra/social/zernioClient', () => ({
  getFacebookPageInsights: jest.fn(),
  getInstagramAccountInsights: jest.fn(),
  getInstagramDemographics: jest.fn(),
  getTiktokAccountInsights: jest.fn(),
  getDailyMetrics: jest.fn(),
  getContentDecay: jest.fn(),
  getFollowerStats: jest.fn()
}))

jest.mock('../../src/services/metricsService', () => ({
  buscarInsightsYoutube: jest.fn()
}))

const { listarContasToken } = require('../../src/infra/social/publisher')
const zernio = require('../../src/infra/social/zernioClient')
const metricsService = require('../../src/services/metricsService')
const { buscarAnalyticsContas } = require('../../src/services/accountAnalyticsService')

describe('accountAnalyticsService', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    listarContasToken.mockImplementation(async platform => platform === 'facebook'
      ? [{ contaId: 11, platform, zernioAccountId: 'fb-1', accountName: 'Página' }]
      : [])
    zernio.getFacebookPageInsights.mockResolvedValue({
      success: true,
      platform: 'facebook',
      accountId: 'fb-1',
      metricType: 'total_value',
      metrics: { page_follows: { total: 20 } }
    })
    zernio.getDailyMetrics.mockResolvedValue({ days: [] })
    zernio.getContentDecay.mockResolvedValue({ buckets: [] })
    zernio.getFollowerStats.mockResolvedValue({ accounts: [], stats: {} })
    metricsService.buscarInsightsYoutube.mockResolvedValue({ accounts: [] })
  })

  test('consulta contas, limita o período e retorna capacidades por plataforma', async () => {
    const result = await buscarAnalyticsContas({ userId: 1, isAdmin: false, days: 999 })

    expect(result.dateRange.until).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(result.platforms.facebook[0]).toMatchObject({
      localAccountId: 11,
      providerAccountId: 'fb-1',
      totals: { metrics: { page_follows: { total: 20 } } }
    })
    expect(result.capabilities.facebook.available).toContain('page_media_view')
    expect(result.capabilities.tiktok.unavailable).toContain('watch_time')
    expect(metricsService.buscarInsightsYoutube).toHaveBeenCalledWith(
      1,
      false,
      expect.objectContaining({ days: 90 })
    )
  })

  test('preserva o restante quando um relatório opcional falha', async () => {
    zernio.getContentDecay.mockRejectedValue(new Error('sem add-on'))

    const result = await buscarAnalyticsContas({ userId: 1, isAdmin: false, days: 7 })

    expect(result.platforms.facebook).toHaveLength(1)
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ scope: 'content_decay', message: 'sem add-on' })
    ]))
  })
})
