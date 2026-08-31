const { buildAnalyticsVerification } = require('../../src/domain/analytics/verifyAnalytics')

describe('buildAnalyticsVerification', () => {
  test('considera zero informado como dado real e calcula a cobertura', () => {
    const result = buildAnalyticsVerification({
      days: 7,
      metrics: [
        { platform: 'instagram', metrics: { views: 0, likes: 0 }, metricsStatus: 'available' },
        { platform: 'instagram', metrics: { views: 10 }, metricsStatus: 'cached' },
      ],
      accountAnalytics: { platforms: {}, errors: [] },
    })

    expect(result.overall.status).toBe('verified')
    expect(result.coverage.content).toMatchObject({ total: 2, withData: 2, withoutData: 0, percent: 100 })
    expect(result.platforms.instagram.content.statusCounts).toEqual({ available: 1, cached: 1 })
  })

  test('marca como parcial o período com publicações sem ID ou consulta sem retorno', () => {
    const result = buildAnalyticsVerification({
      days: 30,
      metrics: [
        { platform: 'youtube', metrics: { views: 40 }, metricsStatus: 'available' },
        { platform: 'youtube', metrics: null, metricsStatus: 'missing_external_id' },
        { platform: 'youtube', metrics: null, metricsStatus: 'unavailable' },
      ],
      accountAnalytics: { platforms: {}, errors: [] },
    })

    expect(result.overall.status).toBe('partial')
    expect(result.platforms.youtube).toMatchObject({
      status: 'partial',
      content: { total: 3, withData: 1, withoutData: 2, coveragePercent: 33 },
      issues: { missingContentMetrics: 2 },
    })
    expect(result.platforms.youtube.description).toMatch(/sem métrica confirmada/i)
  })

  test('não inventa disponibilidade quando a conta conectada não respondeu', () => {
    const result = buildAnalyticsVerification({
      days: 7,
      metrics: [],
      accountAnalytics: {
        platforms: { instagram: [{ localAccountId: 8, errors: [{ scope: 'totals', message: 'sem permissão' }] }] },
        errors: [],
      },
    })

    expect(result.overall.status).toBe('no_data')
    expect(result.platforms.instagram.status).toBe('no_data')
    expect(result.platforms.instagram.description).toMatch(/conta está conectada/i)
  })
})
