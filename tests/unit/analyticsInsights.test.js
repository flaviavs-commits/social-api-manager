const { buildAnalyticsInsights, inferNiche, periodForHour } = require('../../src/services/ai/analyticsInsights')

describe('analyticsInsights', () => {
  test('identifica nicho e período do dia', () => {
    expect(inferNiche(['Treino de academia para melhorar sua saúde'])).toBe('fitness')
    expect(periodForHour(9)).toBe('manhã')
    expect(periodForHour(20)).toBe('noite')
  })

  test('recomenda horário e compara perfis usando dados reais', () => {
    const insights = buildAnalyticsInsights({
      metrics: [
        { platform: 'instagram', text: 'Treino de academia', metrics: { views: 1000, likes: 80, comments: 20, shares: 10 } },
        { platform: 'youtube', text: 'Aula de treino', metrics: { views: 500, likes: 20, comments: 4, shares: 2 } },
      ],
      accountAnalytics: {
        dateRange: { since: '2026-07-01', until: '2026-07-30' },
        platforms: {
          instagram: [{ localAccountId: 1, accountName: 'Perfil Fitness', totals: { metrics: { reach: { total: 1000 }, likes: { total: 80 }, comments: { total: 20 }, shares: { total: 10 } } } }],
          youtube: [{ localAccountId: 2, accountName: 'Canal Fitness', totals: { metrics: { views: { total: 500 }, likes: { total: 20 }, comments: { total: 4 }, shares: { total: 2 } } } }],
        },
        bestTimeToPost: [{ platform: 'instagram', data: { slots: [{ day_of_week: 2, hour: 19, avg_engagement: 42, post_count: 4 }] } }],
      },
    }, 30)

    expect(insights.bestTime).toMatchObject({ platform: 'instagram', hour: 19, period: 'noite' })
    expect(insights.profileComparison[0].name).toBe('Perfil Fitness')
    expect(insights.nicheComparisons[0].niche).toBe('fitness')
    expect(insights.recommendations.length).toBeGreaterThan(0)
  })

  test('compara visualizações e entrega solução e abordagem alternativa', () => {
    const insights = buildAnalyticsInsights({
      metrics: [
        { postId: 10, platform: 'instagram', text: 'Treino rápido de academia', publishedAt: '2026-07-10T19:00:00.000Z', mediaType: 'video', metrics: { views: 2400, likes: 180, comments: 30, shares: 22 } },
        { postId: 11, platform: 'instagram', text: 'Treino de academia', publishedAt: '2026-07-11T09:00:00.000Z', mediaType: 'image', metrics: { views: 400, likes: 12, comments: 2, shares: 1 } },
      ],
    }, 30, 'instagram')

    const comparison = insights.performanceAnalysis.comparisons[0]
    expect(comparison).toMatchObject({ platform: 'instagram', sampleSize: 2 })
    expect(comparison.topPost.id).toBe(10)
    expect(comparison.lowPost.id).toBe(11)
    expect(comparison.solution).toMatch(/referência|replicar/i)
    expect(comparison.alternativeApproach).toMatch(/teste A\/B/i)
  })
})
