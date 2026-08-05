import { filterTikTokVideosByPeriod, labelForMetric } from '../../src/lib/analytics-format.js'

describe('analytics formatting helpers', () => {
  it('uses labels that explain common provider metrics', () => {
    expect(labelForMetric('views')).toBe('Visualizações')
    expect(labelForMetric('page_follows')).toBe('Novos seguidores')
    expect(labelForMetric('watchTimeSeconds')).toBe('Tempo médio assistido')
  })

  it('filters TikTok videos using the selected period', () => {
    const now = Math.floor(Date.now() / 1000)
    const recent = { createTime: now, title: 'Recente' }
    const old = { createTime: now - (10 * 86400), title: 'Antigo' }

    expect(filterTikTokVideosByPeriod([recent, old], 7)).toEqual([recent])
  })
})
