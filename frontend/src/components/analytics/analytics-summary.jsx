import { Line, Bar } from 'react-chartjs-2'
import { EngagementTypeBar } from './engagement-type-bar.jsx'
import {
  filterByPeriod, filterByPeriodOffset, filterTikTokVideosByPeriod, filterTikTokVideosByPeriodOffset, latestOf, fmtNum, formatDiaBR, baseChartOptions, PLAT_LABELS, PLAT_COLORS, NETWORK_ORDER, ANALYTICS_PERIODS,
} from '../../lib/analytics-format.js'
import { PlatformIcon } from '../ui/platform-icon.jsx'
import { useTheme } from '../ui/theme-selector.jsx'

function buildTrend(metrics) {
  const porDia = {}
  for (const m of metrics) {
    if (!m.publishedAt) continue
    const dia = new Date(m.publishedAt).toISOString().slice(0, 10)
    porDia[dia] = porDia[dia] || { engagement: 0, reach: 0 }
    porDia[dia].engagement += (m.metrics?.likes || 0) + (m.metrics?.comments || 0) + (m.metrics?.shares || 0)
    porDia[dia].reach += (m.metrics?.views || 0)
  }
  return Object.keys(porDia).sort().slice(-7).map(dia => ({ dia, ...porDia[dia] }))
}

function buildPlatformCounts(metrics) {
  const porPlataforma = {}
  for (const m of metrics) porPlataforma[m.platform] = (porPlataforma[m.platform] || 0) + 1
  return Object.entries(porPlataforma)
}

function sumMetric(metrics, key) {
  return metrics.reduce((total, item) => total + (Number(item.metrics?.[key]) || 0), 0)
}

function comparisonLabel(current, previous, enabled) {
  if (!enabled) return null
  if (!previous) return 'Sem base anterior'
  const change = ((current - previous) / previous) * 100
  return `${change >= 0 ? '+' : ''}${change.toFixed(1)}% vs. período anterior`
}

export function AnalyticsSummary({ data, tiktokVideos, periodDays, onSelectPeriod = () => {}, comparePeriod = false, onToggleCompare = () => {} }) {
  useTheme()
  const metrics = filterByPeriod(data.metrics, periodDays)
  const videos = filterTikTokVideosByPeriod(tiktokVideos, periodDays)
  const previousMetrics = filterByPeriodOffset(data.metrics, periodDays, 1)
  const previousVideos = filterTikTokVideosByPeriodOffset(tiktokVideos, periodDays, 1)

  const totalViews = metrics.reduce((acc, m) => acc + (m.metrics?.views || 0), 0)
  const totalLikes = metrics.reduce((acc, m) => acc + (m.metrics?.likes || 0), 0)
  const totalComments = metrics.reduce((acc, m) => acc + (m.metrics?.comments || 0), 0)
  const totalShares = metrics.filter(m => m.platform !== 'tiktok').reduce((acc, m) => acc + (Number(m.metrics?.shares) || 0), 0)
    + videos.reduce((acc, v) => acc + (Number(v.shareCount) || 0), 0)
  const totalEngagement = totalLikes + totalComments + totalShares
  const engagementRate = totalViews > 0 ? (totalEngagement / totalViews * 100) : 0
  const recommendation = totalViews === 0
    ? 'Publique um novo conteúdo para começar a construir uma base de comparação.'
    : engagementRate < 2
      ? 'Teste uma chamada mais direta e formatos diferentes para estimular comentários e compartilhamentos.'
      : 'Mantenha o formato que está funcionando e replique os temas com maior interação.'
  const previousViews = sumMetric(previousMetrics, 'views')
  const previousEngagement = sumMetric(previousMetrics, 'likes') + sumMetric(previousMetrics, 'comments') + previousMetrics.filter(m => m.platform !== 'tiktok').reduce((total, item) => total + (Number(item.metrics?.shares) || 0), 0) + previousVideos.reduce((total, video) => total + (Number(video.shareCount) || 0), 0)
  const previousEngagementRate = previousViews > 0 ? (previousEngagement / previousViews * 100) : 0

  const igFollowers = latestOf(data.instagramFollowers)?.followerCount || 0
  const ttFollowers = latestOf(data.tiktokStats)?.followerCount || 0
  const ytSubscribers = latestOf(data.youtubeSubscribers)?.subscriberCount || 0
  const totalFollowers = igFollowers + ttFollowers + ytSubscribers
  const previousFollowers = (latestOf(filterByPeriodOffset(data.instagramFollowers, periodDays, 1))?.followerCount || 0)
    + (latestOf(filterByPeriodOffset(data.tiktokStats, periodDays, 1))?.followerCount || 0)
    + (latestOf(filterByPeriodOffset(data.youtubeSubscribers, periodDays, 1))?.subscriberCount || 0)

  const trend = buildTrend(metrics)
  const platformCounts = buildPlatformCounts(metrics)
  const topPlatform = [...platformCounts].sort(([, a], [, b]) => b - a)[0]
  const platformEngagement = NETWORK_ORDER.map(platform => {
    const platformMetrics = metrics.filter(item => item.platform === platform)
    const shares = platform === 'tiktok'
      ? Math.max(sumMetric(platformMetrics, 'shares'), videos.reduce((total, video) => total + (Number(video.shareCount) || 0), 0))
      : sumMetric(platformMetrics, 'shares')
    return {
      platform,
      likes: sumMetric(platformMetrics, 'likes'),
      comments: sumMetric(platformMetrics, 'comments'),
      shares,
    }
  }).filter(item => metrics.some(metric => metric.platform === item.platform) || (item.platform === 'tiktok' && videos.length))

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
          <p>Quantas vezes suas publicações foram vistas.</p>
          {comparisonLabel(totalViews, previousViews, comparePeriod) && <span className="analytics-comparison">{comparisonLabel(totalViews, previousViews, comparePeriod)}</span>}
        </div>
        <div className="an-summary-card">
          <div className="an-summary-icon" style={{ background: '#e94f8a' }} aria-hidden="true">♥</div>
          <div className="an-summary-val">{fmtNum(totalEngagement)}</div>
          <div className="an-summary-label">Interações</div>
          <p>Curtidas, comentários e compartilhamentos.</p>
          {comparisonLabel(totalEngagement, previousEngagement, comparePeriod) && <span className="analytics-comparison">{comparisonLabel(totalEngagement, previousEngagement, comparePeriod)}</span>}
        </div>
        <div className="an-summary-card">
          <div className="an-summary-icon" style={{ background: 'var(--accent)' }} aria-hidden="true">👥</div>
          <div className="an-summary-val">{fmtNum(totalFollowers)}</div>
          <div className="an-summary-label">Seguidores e inscritos</div>
          <p>Total atual somado entre as redes com histórico.</p>
          {comparisonLabel(totalFollowers, previousFollowers, comparePeriod) && <span className="analytics-comparison">{comparisonLabel(totalFollowers, previousFollowers, comparePeriod)}</span>}
        </div>
        <div className="an-summary-card">
          <div className="an-summary-icon" style={{ background: '#4ade80' }} aria-hidden="true">📈</div>
          <div className="an-summary-val">{engagementRate.toFixed(1)}%</div>
          <div className="an-summary-label">Taxa de interação</div>
          <p>Interações em relação às visualizações.</p>
          {comparisonLabel(engagementRate, previousEngagementRate, comparePeriod) && <span className="analytics-comparison">{comparisonLabel(engagementRate, previousEngagementRate, comparePeriod)}</span>}
        </div>
      </div>
      <p className="analytics-summary-note"><strong>Como ler:</strong> uma taxa maior indica que, além de assistir, a audiência está reagindo ao conteúdo. Seguidores e inscritos são somados por rede e não representam pessoas únicas.</p>
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
