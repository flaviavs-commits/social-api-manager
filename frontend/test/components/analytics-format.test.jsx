import { filterTikTokVideosByPeriod, fmtNum, formatDataBR, formatDataDelay, labelForMetric } from '../../src/lib/analytics-format.js'

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

  it('limits metric values to one decimal without exposing floating-point noise', () => {
    expect(fmtNum(2.666666666666665)).toBe('2.6')
    expect(fmtNum(28)).toBe('28')
    expect(fmtNum(2666.6666666666665)).toBe('2.6k')
  })

  it('translates profile metrics and formats report dates in Brazilian Portuguese', () => {
    expect(labelForMetric('total_interactions')).toBe('Interações totais')
    expect(labelForMetric('accounts_engaged')).toBe('Contas engajadas')
    expect(labelForMetric('profile_links_taps')).toBe('Cliques em links do perfil')
    expect(formatDataBR('2026-08-31')).toBe('31/08/2026')
    expect(formatDataDelay('Data may be delayed up to 48 hours')).toBe('Os dados podem atrasar até 48 horas')
  })
})
