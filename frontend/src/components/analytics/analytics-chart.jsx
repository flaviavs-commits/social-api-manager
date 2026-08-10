import { Line, Bar } from 'react-chartjs-2'
import { filterByPeriod, formatDiaBR, baseChartOptions, PLAT_COLORS } from '../../lib/analytics-format.js'
import { useTheme } from '../ui/theme-selector.jsx'

function EmptyChart({ message }) {
  return <p className="empty-state" style={{ textAlign: 'center', padding: '3rem 1rem' }}>{message}</p>
}

function GrowthChart({ net, instagramFollowers, tiktokStats, youtubeSubscribers }) {
  if (net === 'instagram') {
    const dias = Object.keys(instagramFollowers).sort()
    if (!dias.length) return <EmptyChart message="Sem dados de seguidores."/>
    return <Line
      data={{ labels: dias.map(formatDiaBR), datasets: [{ label: 'Seguidores', data: dias.map(d => instagramFollowers[d].followerCount), borderColor: '#e94f8a', backgroundColor: 'rgba(233,79,138,0.1)', fill: true, tension: 0.3, pointRadius: 3 }] }}
      options={baseChartOptions()}
    />
  }
  if (net === 'tiktok') {
    const dias = Object.keys(tiktokStats).sort()
    if (!dias.length) return <EmptyChart message="Sem dados do TikTok."/>
    return <Line
      data={{
        labels: dias.map(formatDiaBR),
        datasets: [
          { label: 'Seguidores', data: dias.map(d => tiktokStats[d].followerCount), borderColor: '#a0a0b0', backgroundColor: 'rgba(160,160,176,0.08)', fill: true, tension: 0.3, pointRadius: 3 },
          { label: 'Curtidas Totais', data: dias.map(d => tiktokStats[d].likesCount), borderColor: '#8b8fa3', backgroundColor: 'transparent', fill: false, tension: 0.3, pointRadius: 3 },
        ],
      }}
      options={baseChartOptions()}
    />
  }
  if (net === 'youtube') {
    const dias = Object.keys(youtubeSubscribers).sort()
    if (!dias.length) return <EmptyChart message="Sem dados de inscritos."/>
    return <Line
      data={{ labels: dias.map(formatDiaBR), datasets: [{ label: 'Inscritos', data: dias.map(d => youtubeSubscribers[d].subscriberCount), borderColor: '#ff5c5c', backgroundColor: 'rgba(255,92,92,0.1)', fill: true, tension: 0.3, pointRadius: 3 }] }}
      options={baseChartOptions()}
    />
  }
  return null
}

function PostsBarChart({ net, metrics }) {
  const postsSorted = metrics.filter(m => m.publishedAt && m.metrics).sort((a, b) => new Date(a.publishedAt) - new Date(b.publishedAt))
  if (!postsSorted.length) return <EmptyChart message="Nenhum dado no período."/>

  const labels = postsSorted.map(m => {
    const data = new Date(m.publishedAt)
    const dd = String(data.getDate()).padStart(2, '0')
    const mm = String(data.getMonth() + 1).padStart(2, '0')
    const texto = (m.text || m.youtubeTitle || 'Sem texto').slice(0, 20)
    return `${dd}/${mm} · ${texto}…`
  })

  const hasViews = postsSorted.some(m => m.metrics.views != null)
  const hasLikes = postsSorted.some(m => m.metrics.likes != null)
  const hasComments = postsSorted.some(m => m.metrics.comments != null)

  const datasets = []
  if (hasViews) datasets.push({ label: 'Visualizações', data: postsSorted.map(m => m.metrics.views || 0), backgroundColor: 'rgba(209,153,62,0.8)', borderRadius: 4 })
  if (hasLikes) datasets.push({ label: 'Curtidas', data: postsSorted.map(m => m.metrics.likes || 0), backgroundColor: PLAT_COLORS[net] || '#e94f8a', borderRadius: 4 })
  if (hasComments) datasets.push({ label: 'Comentários', data: postsSorted.map(m => m.metrics.comments || 0), backgroundColor: 'rgba(52,211,153,0.8)', borderRadius: 4 })
  if (!datasets.length) datasets.push({ label: 'Posts', data: postsSorted.map(() => 1), backgroundColor: PLAT_COLORS[net] || '#d1993e', borderRadius: 4 })

  const options = {
    ...baseChartOptions(),
    plugins: {
      ...baseChartOptions().plugins,
      tooltip: { callbacks: { title: items => (postsSorted[items[0].dataIndex].text || postsSorted[items[0].dataIndex].youtubeTitle || 'Sem texto').slice(0, 60) } },
    },
    scales: {
      ...baseChartOptions().scales,
      x: { ...baseChartOptions().scales.x, ticks: { ...baseChartOptions().scales.x.ticks, maxRotation: 35, font: { size: 10 } } },
    },
  }

  return <Bar data={{ labels, datasets }} options={options}/>
}

export function AnalyticsChart({ net, tab, data, periodDays }) {
  useTheme()
  const metrics = filterByPeriod(data.metrics, periodDays).filter(m => m.platform === net)
  const instagramFollowers = filterByPeriod(data.instagramFollowers, periodDays)
  const tiktokStats = filterByPeriod(data.tiktokStats, periodDays)
  const youtubeSubscribers = filterByPeriod(data.youtubeSubscribers, periodDays)

  const isGrowthView = tab === 'growth' || (tab === 'community' && (net === 'instagram' || net === 'tiktok' || net === 'youtube'))

  return (
    <div className="analytics-chart-wrap">
      {isGrowthView
        ? <GrowthChart net={net} instagramFollowers={instagramFollowers} tiktokStats={tiktokStats} youtubeSubscribers={youtubeSubscribers}/>
        : <PostsBarChart net={net} metrics={metrics}/>}
    </div>
  )
}
