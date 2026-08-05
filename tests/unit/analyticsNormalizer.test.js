const {
  normalizeInsight,
  normalizePostAnalytics,
  mergeMetricEntries
} = require('../../src/domain/analytics/normalizeAnalytics')

describe('analytics normalizer', () => {
  test('normaliza totais, séries e quebras do envelope do provedor', () => {
    const result = normalizeInsight({
      success: true,
      platform: 'instagram',
      metrics: {
        reach: {
          total: 120,
          values: [{ date: '2026-08-01', value: '40' }],
          breakdowns: [{ dimension: 'feed', value: 80 }]
        }
      }
    })

    expect(result.metrics.reach).toEqual({
      total: 120,
      values: [{ date: '2026-08-01', value: 40 }],
      breakdowns: [{ dimension: 'feed', value: 80 }],
      unit: null,
      currency: null
    })
  })

  test('aceita resposta de post única e mantém todas as métricas disponíveis', () => {
    const result = normalizePostAnalytics({
      post: {
        analytics: { impressions: 10, saves: 3 },
        platforms: [{ platformPostId: 'ig-1', analytics: { likes: 7, shares: 2 } }]
      }
    }, 'ig-1')

    expect(result).toMatchObject({
      impressions: 10,
      saves: 3,
      likes: 7,
      shares: 2,
      comments: null,
      views: null
    })
  })

  test('soma séries e quebras de contas diferentes sem perder datas', () => {
    expect(mergeMetricEntries([
      { total: 10, values: [{ date: '2026-08-01', value: 4 }], breakdowns: [{ dimension: 'A', value: 2 }] },
      { total: 5, values: [{ date: '2026-08-01', value: 6 }, { date: '2026-08-02', value: 1 }], breakdowns: [{ dimension: 'A', value: 3 }] }
    ])).toEqual({
      total: 15,
      values: [{ date: '2026-08-01', value: 10 }, { date: '2026-08-02', value: 1 }],
      breakdowns: [{ dimension: 'A', value: 5 }]
    })
  })
})
