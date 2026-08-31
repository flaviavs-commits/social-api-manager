import { buildPerformanceReport, performanceReportActions } from '../../src/components/analytics/analytics-performance-report.jsx'

function metric(platform, text, metrics) {
  return { platform, text, publishedAt: new Date().toISOString(), metrics }
}

describe('AnalyticsPerformanceReport', () => {
  it('mantém todas as redes visíveis e escolhe o melhor conteúdo dentro de cada rede', () => {
    const report = buildPerformanceReport({
      metrics: [
        metric('instagram', 'Post com mais reações', { views: 120, likes: 4, comments: 3, shares: 2 }),
        metric('instagram', 'Post com mais alcance', { views: 500, likes: 1, comments: 0, shares: 0 }),
      ],
      accountAnalytics: {},
    }, [], 7)

    expect(report.platforms.map(item => item.platform)).toEqual(['instagram', 'facebook', 'youtube', 'tiktok'])
    expect(report.platforms.find(item => item.platform === 'instagram').bestContent.text).toBe('Post com mais reações')
    expect(report.platforms.find(item => item.platform === 'facebook').bestContent).toBeNull()
    expect(report.platforms.find(item => item.platform === 'youtube').bestContent).toBeNull()
    expect(report.platforms.find(item => item.platform === 'tiktok').bestContent).toBeNull()
  })

  it('aplica o filtro quando uma única rede é selecionada', () => {
    const report = buildPerformanceReport({ metrics: [], accountAnalytics: {} }, [], 7, 'youtube')

    expect(report.platforms.map(item => item.platform)).toEqual(['youtube'])
    expect(report.platforms[0].bestContent).toBeNull()
  })

  it('explica qual conteúdo deve ser replicado e como as interações foram somadas', () => {
    const report = buildPerformanceReport({
      metrics: [metric('instagram', 'No comando do futuro!', { views: 16, likes: 1, comments: 1, shares: 0, saves: 0 })],
      accountAnalytics: {},
    }, [], 7)

    expect(performanceReportActions(report).join(' ')).toMatch(/No comando do futuro!/)
    expect(performanceReportActions(report).join(' ')).toMatch(/1 curtidas \+ 1 comentários \+ 0 compartilhamentos \+ 0 salvamentos/)
  })
})
