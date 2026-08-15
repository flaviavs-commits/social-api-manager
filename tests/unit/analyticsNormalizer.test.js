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

  test('normaliza aliases de visualização usados pelas redes', () => {
    expect(normalizePostAnalytics({
      post: { platforms: [{ platformPostId: 'tt-1', analytics: { play_count: 42 } }] }
    }, 'tt-1')).toMatchObject({ views: 42 })
  })

  test('lê a resposta oficial por plataforma e preserva atualização e URL', () => {
    const result = normalizePostAnalytics({
      analytics: { views: 900 },
      platformAnalytics: [{
        platform: 'instagram',
        platformPostId: 'ig-99',
        platformPostUrl: 'https://instagram.com/p/ig-99',
        syncStatus: 'synced',
        analytics: {
          impressions: 1200,
          reach: 980,
          likes: 84,
          comments: 11,
          shares: 7,
          saves: 19,
          clicks: 4,
          views: 930,
          engagementRate: 10.4,
          lastUpdated: '2026-08-14T18:00:00.000Z'
        }
      }]
    }, 'ig-99')

    expect(result).toMatchObject({
      impressions: 1200,
      reach: 980,
      likes: 84,
      comments: 11,
      shares: 7,
      saves: 19,
      clicks: 4,
      views: 930,
      engagementRate: 10.4,
      lastUpdated: '2026-08-14T18:00:00.000Z',
      syncStatus: 'synced',
      platformPostId: 'ig-99',
      platformUrl: 'https://instagram.com/p/ig-99'
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
