import { Line, Bar } from 'react-chartjs-2'
import { EngagementTypeBar } from './engagement-type-bar.jsx'
import {
  filterByPeriod, filterByPeriodOffset, filterTikTokVideosByPeriod, filterTikTokVideosByPeriodOffset, tiktokVideoToMetric, latestOf, fmtNum, formatDiaBR, baseChartOptions, PLAT_LABELS, PLAT_COLORS, NETWORK_ORDER, ANALYTICS_PERIODS,
  accountAnalyticsPlatformTotals,
} from '../../lib/analytics-format.js'
import { PlatformIcon } from '../ui/platform-icon.jsx'
import { useTheme } from '../ui/theme-selector.jsx'

function buildTrend(metrics) {
  const porDia = {}
  for (const m of metrics) {
    if (!m.publishedAt || !m.metrics) continue
    const dia = new Date(m.publishedAt).toISOString().slice(0, 10)
    porDia[dia] = porDia[dia] || { engagement: null, reach: null }
    const engagement = ['likes', 'comments', 'shares'].map(key => Number(m.metrics?.[key])).filter(Number.isFinite)
    if (engagement.length) porDia[dia].engagement = (porDia[dia].engagement || 0) + engagement.reduce((total, value) => total + value, 0)
    const views = Number(m.metrics?.views)
    if (Number.isFinite(views)) porDia[dia].reach = (porDia[dia].reach || 0) + views
  }
  return Object.keys(porDia).sort().slice(-7).map(dia => ({ dia, ...porDia[dia] }))
}

function buildPlatformCounts(metrics, tiktokVideos = []) {
  const porPlataforma = {}
  for (const m of metrics) porPlataforma[m.platform] = (porPlataforma[m.platform] || 0) + 1
  if (tiktokVideos.length) porPlataforma.tiktok = Math.max(porPlataforma.tiktok || 0, tiktokVideos.length)
  return Object.entries(porPlataforma)
}

function sumMetric(metrics, key) {
  const values = metrics.map(item => Number(item.metrics?.[key])).filter(Number.isFinite)
  return values.length ? values.reduce((total, value) => total + value, 0) : null
}

function sumKnown(values) {
  const known = values.filter(value => value != null && Number.isFinite(Number(value)))
  return known.length ? known.reduce((total, value) => total + Number(value), 0) : null
}

function comparisonLabel(current, previous, enabled) {
  if (!enabled) return null
  if (current == null || previous == null || previous === 0) return 'Sem base anterior'
  const change = ((current - previous) / previous) * 100
  return `${change >= 0 ? '+' : ''}${change.toFixed(1)}% vs. período anterior`
}

export function AnalyticsSummary({ data, tiktokVideos, periodDays, activeNet = null, onSelectPeriod = () => {}, comparePeriod = false, onToggleCompare = () => {} }) {
  useTheme()
  const scopeNetworks = activeNet ? [activeNet] : NETWORK_ORDER
  const metrics = filterByPeriod(data.metrics, periodDays).filter(item => scopeNetworks.includes(item.platform))
  const videos = filterTikTokVideosByPeriod(tiktokVideos, periodDays).filter(video => !activeNet || activeNet === 'tiktok')
  const tiktokMetrics = metrics.filter(item => item.platform === 'tiktok' && item.metrics)
  const tiktokRows = tiktokMetrics.length ? tiktokMetrics : videos.map(tiktokVideoToMetric)
  const summaryMetrics = [...metrics.filter(item => item.platform !== 'tiktok'), ...tiktokRows]
  const previousMetrics = filterByPeriodOffset(data.metrics, periodDays, 1).filter(item => scopeNetworks.includes(item.platform))
  const previousVideos = filterTikTokVideosByPeriodOffset(tiktokVideos, periodDays, 1).filter(() => !activeNet || activeNet === 'tiktok')
  const accountTotals = accountAnalyticsPlatformTotals(data.accountAnalytics)

  function platformRows(platform) {
    return platform === 'tiktok' ? tiktokRows : metrics.filter(item => item.platform === platform)
  }

  function mergedPlatformTotal(platform, key) {
    const accountValue = accountTotals[platform]?.[key]
    if (accountValue?.hasData) return accountValue.value
    return sumMetric(platformRows(platform), key)
  }

  const totalViews = sumKnown(scopeNetworks.map(platform => mergedPlatformTotal(platform, 'views')))
  const totalLikes = sumKnown(scopeNetworks.map(platform => mergedPlatformTotal(platform, 'likes')))
  const totalComments = sumKnown(scopeNetworks.map(platform => mergedPlatformTotal(platform, 'comments')))
  const totalShares = sumKnown(scopeNetworks.map(platform => mergedPlatformTotal(platform, 'shares')))
  const totalEngagement = sumKnown(scopeNetworks.map(platform => {
    const accountValue = accountTotals[platform]?.engagement
    if (accountValue?.hasData) return accountValue.value
    return sumKnown([mergedPlatformTotal(platform, 'likes'), mergedPlatformTotal(platform, 'comments'), mergedPlatformTotal(platform, 'shares')])
  }))
  const engagementRate = totalViews > 0 && totalEngagement != null ? (totalEngagement / totalViews * 100) : null
  const recommendation = totalViews == null
    ? 'Publique um novo conteúdo para começar a construir uma base de comparação.'
    : engagementRate != null && engagementRate < 2
      ? 'Teste uma chamada mais direta e formatos diferentes para estimular comentários e compartilhamentos.'
      : 'Mantenha o formato que está funcionando e replique os temas com maior interação.'
  const previousViews = sumMetric(previousMetrics, 'views')
  const previousEngagement = sumKnown([
    sumMetric(previousMetrics, 'likes'),
    sumMetric(previousMetrics, 'comments'),
    sumMetric(previousMetrics.filter(m => m.platform !== 'tiktok'), 'shares'),
    sumKnown(previousVideos.map(video => Number(video.shareCount)).filter(Number.isFinite)),
  ])
  const previousEngagementRate = previousViews > 0 && previousEngagement != null ? (previousEngagement / previousViews * 100) : null

  const igFollowers = latestOf(data.instagramFollowers)?.followerCount
  const ttFollowers = latestOf(data.tiktokStats)?.followerCount
  const ytSubscribers = latestOf(data.youtubeSubscribers)?.subscriberCount
  const totalFollowers = sumKnown([igFollowers, ttFollowers, ytSubscribers])
  const previousFollowers = sumKnown([
    latestOf(filterByPeriodOffset(data.instagramFollowers, periodDays, 1))?.followerCount,
    latestOf(filterByPeriodOffset(data.tiktokStats, periodDays, 1))?.followerCount,
    latestOf(filterByPeriodOffset(data.youtubeSubscribers, periodDays, 1))?.subscriberCount,
  ])
  const scopeLabel = activeNet ? PLAT_LABELS[activeNet] : 'todas as redes'
  const audienceLabel = activeNet === 'youtube' ? 'Inscritos' : activeNet ? 'Seguidores' : 'Seguidores e inscritos'
  const audienceHelp = activeNet
    ? `Total atual registrado pelo ${scopeLabel}.`
    : 'Soma dos totais atuais registrados nas redes com histórico; não representa pessoas únicas.'

  const trend = buildTrend(summaryMetrics)
  const platformCounts = buildPlatformCounts(metrics, videos)
  const topPlatform = [...platformCounts].sort(([, a], [, b]) => b - a)[0]
  const platformEngagement = scopeNetworks.map(platform => {
    return {
      platform,
      likes: mergedPlatformTotal(platform, 'likes'),
      comments: mergedPlatformTotal(platform, 'comments'),
      shares: mergedPlatformTotal(platform, 'shares'),
    }
  }).filter(item => metrics.some(metric => metric.platform === item.platform) || (item.platform === 'tiktok' && videos.length) || accountTotals[item.platform])

  return <>
    <section className="an-summary-section an-summary-overview" aria-labelledby="analytics-overview-title">
      <div className="an-summary-heading">
        <div>
          <p className="analytics-kicker">RESUMO DO PERÍODO</p>
          <h3 id="analytics-overview-title">Visão geral</h3>
          <p>Um panorama rápido para você saber se o conteúdo está sendo visto e provocando reações.</p>
        </div>
        <div className="analytics-period-control" role="group" aria-label="Período das métricas">
          <span>Período</span>
          <div className="analytics-period-btns">
            {ANALYTICS_PERIODS.map(days => (
              <button
                key={days}
                type="button"
                className={`analytics-period-btn${days === periodDays ? ' active' : ''}`}
                aria-pressed={days === periodDays}
                onClick={() => onSelectPeriod(days)}
              >{days} dias</button>
            ))}
          </div>
          <label className={`analytics-compare-toggle${periodDays > 30 ? ' is-disabled' : ''}`} title={periodDays > 30 ? 'A comparação está disponível para períodos de até 30 dias.' : undefined}><input type="checkbox" checked={comparePeriod} disabled={periodDays > 30} onChange={event => onToggleCompare(event.target.checked)}/> Comparar período anterior</label>
        </div>
      </div>

      <div className="an-summary-stats">
        <div className="an-summary-card">
          <div className="an-summary-icon" style={{ background: '#3b8ff0' }} aria-hidden="true">👁</div>
          <div className="an-summary-val">{fmtNum(totalViews)}</div>
          <div className="an-summary-label">Visualizações</div>
          <p>Quantidade de vezes que o conteúdo foi visto. A mesma pessoa pode gerar mais de uma visualização.</p>
          {comparisonLabel(totalViews, previousViews, comparePeriod) && <span className="analytics-comparison">{comparisonLabel(totalViews, previousViews, comparePeriod)}</span>}
        </div>
        <div className="an-summary-card">
          <div className="an-summary-icon" style={{ background: '#e94f8a' }} aria-hidden="true">♥</div>
          <div className="an-summary-val">{fmtNum(totalEngagement)}</div>
          <div className="an-summary-label">Interações</div>
          <p>Soma das reações confirmadas: curtidas, comentários e compartilhamentos.</p>
          {comparisonLabel(totalEngagement, previousEngagement, comparePeriod) && <span className="analytics-comparison">{comparisonLabel(totalEngagement, previousEngagement, comparePeriod)}</span>}
        </div>
        <div className="an-summary-card">
          <div className="an-summary-icon" style={{ background: 'var(--accent)' }} aria-hidden="true">👥</div>
          <div className="an-summary-val">{fmtNum(totalFollowers)}</div>
          <div className="an-summary-label">{audienceLabel}</div>
          <p>{audienceHelp}</p>
          {comparisonLabel(totalFollowers, previousFollowers, comparePeriod) && <span className="analytics-comparison">{comparisonLabel(totalFollowers, previousFollowers, comparePeriod)}</span>}
        </div>
        <div className="an-summary-card">
          <div className="an-summary-icon" style={{ background: '#4ade80' }} aria-hidden="true">📈</div>
          <div className="an-summary-val">{engagementRate == null ? '—' : `${engagementRate.toFixed(1)}%`}</div>
          <div className="an-summary-label">Taxa de interação</div>
          <p>Interações divididas pelas visualizações confirmadas no período.</p>
          {comparisonLabel(engagementRate, previousEngagementRate, comparePeriod) && <span className="analytics-comparison">{comparisonLabel(engagementRate, previousEngagementRate, comparePeriod)}</span>}
        </div>
      </div>
      <section className="analytics-summary-explanation" aria-label="Explicação dos indicadores">
        <div className="analytics-summary-explanation-heading"><strong>Como interpretar este resumo</strong><span>Período: últimos {periodDays} dias · Escopo: {scopeLabel}</span></div>
        <div className="analytics-summary-explanation-grid">
          <div><strong>Visualizações</strong><p>Reproduções do conteúdo. Não são necessariamente pessoas diferentes.</p></div>
          <div><strong>Interações</strong><p>Reações que mostram participação: curtidas, comentários e compartilhamentos.</p></div>
          <div><strong>Taxa de interação</strong><p>Mostra a proporção de interações em relação às visualizações. Uma taxa maior indica maior reação proporcional ao conteúdo visto.</p></div>
          <div><strong>{audienceLabel}</strong><p>{audienceHelp}</p></div>
        </div>
      </section>
      {topPlatform && <div className="analytics-report-insight">
        <span className="analytics-report-insight-mark" aria-hidden="true">✦</span>
        <p><strong>Leitura rápida:</strong> {PLAT_LABELS[topPlatform[0]] || topPlatform[0]} concentrou mais publicações no período, com {topPlatform[1]} {topPlatform[1] === 1 ? 'conteúdo publicado' : 'conteúdos publicados'}.</p>
      </div>}
      <div className="analytics-next-action"><span aria-hidden="true">→</span><p><strong>Próxima ação:</strong> {recommendation}</p></div>
    </section>

    <section className="an-summary-section" aria-labelledby="analytics-trend-title">
      <div className="analytics-section-heading">
        <div>
          <h3 id="analytics-trend-title">Evolução recente</h3>
          <p>Compare visualizações e interações dia a dia no período selecionado.</p>
        </div>
        <span className="analytics-chart-legend-hint">Passe o mouse no gráfico para ver os valores</span>
      </div>
      <div style={{ position: 'relative', minHeight: 200 }}>
        {trend.length
          ? <Line
              data={{
                labels: trend.map(t => formatDiaBR(t.dia)),
                datasets: [
                  { label: 'Visualizações', data: trend.map(t => t.reach), borderColor: '#d1993e', backgroundColor: 'rgba(209,153,62,0.1)', fill: true, tension: 0.35, pointRadius: 4 },
                  { label: 'Interações', data: trend.map(t => t.engagement), borderColor: '#e94f8a', backgroundColor: 'rgba(233,79,138,0.08)', fill: true, tension: 0.35, pointRadius: 4 },
                ],
              }}
              options={baseChartOptions()}
            />
          : <p className="empty-state" style={{ textAlign: 'center', padding: '3rem 1rem' }}>Sem dados suficientes.</p>}
      </div>
    </section>

    <div className="an-summary-row">
      <div className="an-summary-section">
        <div className="an-summary-section-title">Posts por Plataforma</div>
        <div style={{ position: 'relative', minHeight: 200 }}>
          {platformCounts.length
            ? <Bar
                data={{
                  labels: platformCounts.map(([p]) => PLAT_LABELS[p] || p),
                  datasets: [{ data: platformCounts.map(([, count]) => count), backgroundColor: platformCounts.map(([p]) => PLAT_COLORS[p] || '#d1993e'), borderRadius: 6, maxBarThickness: 56 }],
                }}
                options={{ ...baseChartOptions(), plugins: { legend: { display: false } } }}
              />
            : <p className="empty-state" style={{ textAlign: 'center', padding: '3rem 1rem' }}>Nenhum post publicado no período.</p>}
        </div>
      </div>
      <div className="an-summary-section">
        <div className="an-summary-section-title">Tipo de Engajamento</div>
        {platformEngagement.map(item => {
          const max = Math.max(item.likes, item.comments, item.shares, 1)
          return <div key={item.platform} style={{ marginBottom: 16 }}>
            <div className="analytics-engagement-platform">
              <span className={`analytics-engagement-platform-icon analytics-engagement-platform-icon-${item.platform}`} aria-hidden="true">
                <PlatformIcon platform={item.platform} className="h-3.5 w-3.5" />
              </span>
              <span>{PLAT_LABELS[item.platform]}</span>
            </div>
            <EngagementTypeBar icon="♥" label="Curtidas" value={item.likes} max={max}/>
            <EngagementTypeBar icon="💬" label="Comentários" value={item.comments} max={max}/>
            <EngagementTypeBar icon="↗" label="Compartilhamentos" value={item.shares} max={max}/>
          </div>
        })}
      </div>
    </div>
  </>
}
