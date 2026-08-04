import { Line, Bar } from 'react-chartjs-2'
import { EngagementTypeBar } from './engagement-type-bar.jsx'
import {
  filterByPeriod, latestOf, fmtNum, formatDiaBR, baseChartOptions, PLAT_LABELS, PLAT_COLORS, NET_ICONS, NETWORK_ORDER,
} from '../../lib/analytics-format.js'

function buildTrend(metrics) {
  const porDia = {}
  for (const m of metrics) {
    if (!m.publishedAt) continue
    const dia = new Date(m.publishedAt).toISOString().slice(0, 10)
    porDia[dia] = porDia[dia] || { engagement: 0, reach: 0 }
    porDia[dia].engagement += (m.metrics?.likes || 0) + (m.metrics?.comments || 0)
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

export function AnalyticsSummary({ data, tiktokVideos, periodDays }) {
  const metrics = filterByPeriod(data.metrics, periodDays)

  const totalViews = metrics.reduce((acc, m) => acc + (m.metrics?.views || 0), 0)
  const totalLikes = metrics.reduce((acc, m) => acc + (m.metrics?.likes || 0), 0)
  const totalComments = metrics.reduce((acc, m) => acc + (m.metrics?.comments || 0), 0)
  const totalShares = metrics.filter(m => m.platform !== 'tiktok').reduce((acc, m) => acc + (Number(m.metrics?.shares) || 0), 0)
    + tiktokVideos.reduce((acc, v) => acc + (Number(v.shareCount) || 0), 0)
  const totalEngagement = totalLikes + totalComments + totalShares
  const engagementRate = totalViews > 0 ? (totalEngagement / totalViews * 100) : 0

  const igFollowers = latestOf(data.instagramFollowers)?.followerCount || 0
  const ttFollowers = latestOf(data.tiktokStats)?.followerCount || 0
  const ytSubscribers = latestOf(data.youtubeSubscribers)?.subscriberCount || 0
  const totalFollowers = igFollowers + ttFollowers + ytSubscribers

  const trend = buildTrend(metrics)
  const platformCounts = buildPlatformCounts(metrics)
  const engMax = Math.max(totalLikes, totalComments, totalShares, 1)
  const platformEngagement = NETWORK_ORDER.map(platform => {
    const platformMetrics = metrics.filter(item => item.platform === platform)
    const shares = platform === 'tiktok'
      ? Math.max(sumMetric(platformMetrics, 'shares'), tiktokVideos.reduce((total, video) => total + (Number(video.shareCount) || 0), 0))
      : sumMetric(platformMetrics, 'shares')
    return {
      platform,
      likes: sumMetric(platformMetrics, 'likes'),
      comments: sumMetric(platformMetrics, 'comments'),
      shares,
    }
  }).filter(item => metrics.some(metric => metric.platform === item.platform) || (item.platform === 'tiktok' && tiktokVideos.length))

  return <>
    <div className="an-summary-stats">
      <div className="an-summary-card"><div className="an-summary-icon" style={{ background: '#3b8ff0' }}>👁</div><div className="an-summary-val">{fmtNum(totalViews)}</div><div className="an-summary-label">Alcance Total</div></div>
      <div className="an-summary-card"><div className="an-summary-icon" style={{ background: '#e94f8a' }}>♥</div><div className="an-summary-val">{fmtNum(totalEngagement)}</div><div className="an-summary-label">Engajamento</div></div>
      <div className="an-summary-card"><div className="an-summary-icon" style={{ background: 'var(--accent)' }}>👥</div><div className="an-summary-val">{fmtNum(totalFollowers)}</div><div className="an-summary-label">Seguidores</div></div>
      <div className="an-summary-card"><div className="an-summary-icon" style={{ background: '#4ade80' }}>📈</div><div className="an-summary-val">{engagementRate.toFixed(1)}%</div><div className="an-summary-label">Taxa de Engaj.</div></div>
    </div>

    <div className="an-summary-section">
      <div className="an-summary-section-title">Tendência Semanal</div>
      <div style={{ position: 'relative', minHeight: 200 }}>
        {trend.length
          ? <Line
              data={{
                labels: trend.map(t => formatDiaBR(t.dia)),
                datasets: [
                  { label: 'Alcance', data: trend.map(t => t.reach), borderColor: '#d1993e', backgroundColor: 'rgba(209,153,62,0.1)', fill: true, tension: 0.35, pointRadius: 4 },
                  { label: 'Engajamento', data: trend.map(t => t.engagement), borderColor: '#e94f8a', backgroundColor: 'rgba(233,79,138,0.08)', fill: true, tension: 0.35, pointRadius: 4 },
                ],
              }}
              options={baseChartOptions()}
            />
          : <p className="empty-state" style={{ textAlign: 'center', padding: '3rem 1rem' }}>Sem dados suficientes.</p>}
      </div>
    </div>

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
            <div style={{ marginBottom: 6, fontWeight: 600 }}>{NET_ICONS[item.platform]} {PLAT_LABELS[item.platform]}</div>
            <EngagementTypeBar icon="♥" label="Curtidas" value={item.likes} max={max}/>
            <EngagementTypeBar icon="💬" label="Comentários" value={item.comments} max={max}/>
            <EngagementTypeBar icon="↗" label="Compartilhamentos" value={item.shares} max={max}/>
          </div>
        })}
      </div>
    </div>
  </>
}
