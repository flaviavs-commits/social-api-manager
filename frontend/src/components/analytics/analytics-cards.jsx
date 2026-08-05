import { filterByPeriod, filterTikTokVideosByPeriod, latestOf, fmtNum, fmtWatchTime } from '../../lib/analytics-format.js'

function sum(arr, fn) { return arr.reduce((acc, item) => acc + (fn(item) || 0), 0) }

function buildCards(net, tab, { metrics, instagramFollowers, tiktokStats, youtubeSubscribers, tiktokVideos }) {
  if (net === 'instagram' && tab === 'posts') {
    return [
      { label: 'Posts publicados', val: metrics.length, help: 'Quantidade de posts publicados no período.', accent: 'accent-yellow' },
      { label: 'Curtidas', val: fmtNum(sum(metrics, m => m.metrics?.likes)), help: 'Reações recebidas pelos posts.', accent: 'accent-pink' },
      { label: 'Visualizações', val: fmtNum(sum(metrics, m => m.metrics?.views)), help: 'Quantidade de vezes que os posts foram vistos.', accent: 'accent-purple' },
    ]
  }
  if (net === 'instagram') {
    const followers = latestOf(instagramFollowers)?.followerCount
    return [
      { label: 'Seguidores', val: fmtNum(followers), help: 'Total atual de seguidores registrado pelo Instagram.', accent: 'accent-purple' },
      { label: 'Curtidas', val: fmtNum(sum(metrics, m => m.metrics?.likes)), help: 'Reações recebidas pelos posts no período.', accent: 'accent-pink' },
      { label: 'Comentários', val: fmtNum(sum(metrics, m => m.metrics?.comments)), help: 'Comentários recebidos pelos posts no período.', accent: 'accent-green' },
      { label: 'Posts publicados', val: metrics.length, help: 'Quantidade de posts publicados no período.', accent: 'accent-yellow' },
    ]
  }
  if (net === 'facebook') {
    return [
      { label: 'Curtidas', val: fmtNum(sum(metrics, m => m.metrics?.likes)), help: 'Reações recebidas pelos posts no período.', accent: 'accent-purple' },
      { label: 'Comentários', val: fmtNum(sum(metrics, m => m.metrics?.comments)), help: 'Comentários recebidos pelos posts no período.', accent: 'accent-green' },
      { label: 'Posts publicados', val: metrics.length, help: 'Quantidade de posts publicados no período.', accent: 'accent-yellow' },
    ]
  }
  if (net === 'youtube') {
    const subscribers = latestOf(youtubeSubscribers)?.subscriberCount
    const watchArr = metrics.filter(m => m.metrics?.watchTimeSeconds != null).map(m => m.metrics.watchTimeSeconds)
    const avgWatch = watchArr.length ? watchArr.reduce((a, b) => a + b, 0) / watchArr.length : null
    return [
      { label: 'Inscritos', val: fmtNum(subscribers), help: 'Total atual de inscritos registrado pelo YouTube.', accent: 'accent-purple' },
      { label: 'Visualizações', val: fmtNum(sum(metrics, m => m.metrics?.views)), help: 'Quantidade de vezes que os vídeos foram vistos.', accent: 'accent-green' },
      { label: 'Curtidas', val: fmtNum(sum(metrics, m => m.metrics?.likes)), help: 'Reações recebidas pelos vídeos.', accent: 'accent-pink' },
      { label: 'Tempo médio assistido', val: fmtWatchTime(avgWatch), help: 'Tempo médio que as pessoas assistiram aos vídeos.', accent: 'accent-green' },
      { label: 'Vídeos publicados', val: metrics.length, help: 'Quantidade de vídeos publicados no período.', accent: 'accent-yellow' },
    ]
  }
  if (net === 'tiktok') {
    const latest = latestOf(tiktokStats)
    return [
      { label: 'Seguidores', val: fmtNum(latest?.followerCount), help: 'Total atual de seguidores registrado pelo TikTok.', accent: 'accent-purple' },
      { label: 'Curtidas acumuladas', val: fmtNum(latest?.likesCount), help: 'Total de curtidas acumuladas no perfil.', accent: 'accent-pink' },
      { label: 'Visualizações', val: fmtNum(sum(tiktokVideos, v => v.viewCount)), help: 'Visualizações dos vídeos no período.', accent: 'accent-green' },
      { label: 'Compartilhamentos', val: fmtNum(sum(tiktokVideos, v => v.shareCount)), help: 'Vezes em que os vídeos foram compartilhados.', accent: 'accent-purple' },
      { label: 'Vídeos publicados', val: tiktokVideos.length, help: 'Quantidade de vídeos publicados no período.', accent: 'accent-yellow' },
    ]
  }
  return []
}

export function AnalyticsCards({ net, tab, data, tiktokVideos, periodDays }) {
  const metrics = filterByPeriod(data.metrics, periodDays).filter(m => m.platform === net)
  const instagramFollowers = filterByPeriod(data.instagramFollowers, periodDays)
  const tiktokStats = filterByPeriod(data.tiktokStats, periodDays)
  const youtubeSubscribers = filterByPeriod(data.youtubeSubscribers, periodDays)
  const videos = filterTikTokVideosByPeriod(tiktokVideos, periodDays)

  const cards = buildCards(net, tab, { metrics, instagramFollowers, tiktokStats, youtubeSubscribers, tiktokVideos: videos })

  return (
    <div className="analytics-cards">
      {cards.map(card => (
        <div key={card.label} className={`analytics-card ${card.accent}`} title={card.help}>
          <div className="analytics-card-val">{card.val}</div>
          <div className="analytics-card-label">{card.label}</div>
          <p>{card.help}</p>
        </div>
      ))}
    </div>
  )
}
