import { filterByPeriod, latestOf, fmtNum, fmtWatchTime } from '../../lib/analytics-format.js'

function sum(arr, fn) { return arr.reduce((acc, item) => acc + (fn(item) || 0), 0) }

function buildCards(net, tab, { metrics, instagramFollowers, tiktokStats, youtubeSubscribers, tiktokVideos }) {
  if (net === 'instagram' && tab === 'posts') {
    return [
      { label: 'Posts Publicados', val: metrics.length, accent: 'accent-yellow' },
      { label: 'Likes', val: fmtNum(sum(metrics, m => m.metrics?.likes)), accent: 'accent-pink' },
      { label: 'Views', val: fmtNum(sum(metrics, m => m.metrics?.views)), accent: 'accent-purple' },
    ]
  }
  if (net === 'instagram') {
    const followers = latestOf(instagramFollowers)?.followerCount
    return [
      { label: 'Seguidores', val: fmtNum(followers), accent: 'accent-purple' },
      { label: 'Likes', val: fmtNum(sum(metrics, m => m.metrics?.likes)), accent: 'accent-pink' },
      { label: 'Comentários', val: fmtNum(sum(metrics, m => m.metrics?.comments)), accent: 'accent-green' },
      { label: 'Posts', val: metrics.length, accent: 'accent-yellow' },
    ]
  }
  if (net === 'facebook') {
    return [
      { label: 'Likes', val: fmtNum(sum(metrics, m => m.metrics?.likes)), accent: 'accent-purple' },
      { label: 'Comentários', val: fmtNum(sum(metrics, m => m.metrics?.comments)), accent: 'accent-green' },
      { label: 'Posts Publicados', val: metrics.length, accent: 'accent-yellow' },
    ]
  }
  if (net === 'youtube') {
    const subscribers = latestOf(youtubeSubscribers)?.subscriberCount
    const watchArr = metrics.filter(m => m.metrics?.watchTimeSeconds != null).map(m => m.metrics.watchTimeSeconds)
    const avgWatch = watchArr.length ? watchArr.reduce((a, b) => a + b, 0) / watchArr.length : null
    return [
      { label: 'Inscritos', val: fmtNum(subscribers), accent: 'accent-purple' },
      { label: 'Views', val: fmtNum(sum(metrics, m => m.metrics?.views)), accent: 'accent-green' },
      { label: 'Likes', val: fmtNum(sum(metrics, m => m.metrics?.likes)), accent: 'accent-pink' },
      { label: 'Watch Time Médio', val: fmtWatchTime(avgWatch), accent: 'accent-green' },
      { label: 'Vídeos Publicados', val: metrics.length, accent: 'accent-yellow' },
    ]
  }
  if (net === 'tiktok') {
    const latest = latestOf(tiktokStats)
    return [
      { label: 'Seguidores', val: fmtNum(latest?.followerCount), accent: 'accent-purple' },
      { label: 'Curtidas Acumuladas', val: fmtNum(latest?.likesCount), accent: 'accent-pink' },
      { label: 'Views Totais', val: fmtNum(sum(tiktokVideos, v => v.viewCount)), accent: 'accent-green' },
      { label: 'Compartilhamentos', val: fmtNum(sum(tiktokVideos, v => v.shareCount)), accent: 'accent-purple' },
      { label: 'Vídeos Publicados', val: tiktokVideos.length, accent: 'accent-yellow' },
    ]
  }
  return []
}

export function AnalyticsCards({ net, tab, data, tiktokVideos, periodDays }) {
  const metrics = filterByPeriod(data.metrics, periodDays).filter(m => m.platform === net)
  const instagramFollowers = filterByPeriod(data.instagramFollowers, periodDays)
  const tiktokStats = filterByPeriod(data.tiktokStats, periodDays)
  const youtubeSubscribers = filterByPeriod(data.youtubeSubscribers, periodDays)

  const cards = buildCards(net, tab, { metrics, instagramFollowers, tiktokStats, youtubeSubscribers, tiktokVideos })

  return (
    <div className="analytics-cards">
      {cards.map(card => (
        <div key={card.label} className={`analytics-card ${card.accent}`}>
          <div className="analytics-card-val">{card.val}</div>
          <div className="analytics-card-label">{card.label}</div>
        </div>
      ))}
    </div>
  )
}
