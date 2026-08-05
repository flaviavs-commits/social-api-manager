export const PLAT_LABELS = { facebook: 'Facebook', instagram: 'Instagram', youtube: 'YouTube', tiktok: 'TikTok' }
export const PLAT_COLORS = { facebook: '#5b8def', instagram: '#e94f8a', youtube: '#ff5c5c', tiktok: '#a0a0b0' }
export const NET_ICONS = { instagram: '📸', facebook: '📘', youtube: '▶️', tiktok: '🎵' }
export const DEMO_COLORS = ['#d1993e', '#e94f8a', '#34d399', '#fbbf24', '#5b8def', '#f97316', '#a78bfa', '#22d3ee']
export const GENDER_COLORS = { M: '#5b8def', F: '#e94f8a', U: '#8b8fa3', male: '#5b8def', female: '#e94f8a' }
export const NETWORK_ORDER = ['instagram', 'facebook', 'youtube', 'tiktok']
export const ANALYTICS_PERIODS = [7, 30, 90]

export const TAB_HELP = {
  community: 'Resumo das interações e do desempenho da sua comunidade.',
  posts: 'Compare as publicações e descubra quais geraram mais resultado.',
  videos: 'Compare os vídeos publicados e suas principais reações.',
  growth: 'Acompanhe a evolução da audiência ao longo do tempo.',
}

const METRIC_LABELS = {
  views: 'Visualizações',
  reach: 'Pessoas alcançadas',
  impressions: 'Impressões',
  likes: 'Curtidas',
  comments: 'Comentários',
  shares: 'Compartilhamentos',
  saves: 'Salvamentos',
  page_follows: 'Novos seguidores',
  followers: 'Seguidores',
  followerCount: 'Seguidores',
  likesCount: 'Curtidas acumuladas',
  subscriberCount: 'Inscritos',
  subscribersGained: 'Inscritos ganhos',
  subscribersLost: 'Inscritos perdidos',
  watchTimeSeconds: 'Tempo médio assistido',
  averageViewDuration: 'Duração média assistida',
  averageViewPercentage: 'Percentual médio assistido',
  estimatedMinutesWatched: 'Minutos assistidos',
  engagedViews: 'Visualizações engajadas',
}

export function labelForMetric(name) {
  if (METRIC_LABELS[name]) return METRIC_LABELS[name]
  return String(name)
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replaceAll('_', ' ')
    .replace(/^page /, 'Página ')
    .replace(/\b\w/g, letter => letter.toUpperCase())
}

export const METRIC_HELP = {
  views: 'Quantidade de vezes que o conteúdo foi visualizado.',
  likes: 'Reações de “curtir” recebidas pelo conteúdo.',
  comments: 'Comentários deixados pela audiência.',
  shares: 'Vezes em que o conteúdo foi compartilhado.',
  saves: 'Vezes em que o conteúdo foi salvo para ver depois.',
  page_follows: 'Novas pessoas que começaram a seguir a página no período.',
  followerCount: 'Total atual de seguidores registrado pela rede.',
  subscriberCount: 'Total atual de inscritos registrado pelo YouTube.',
  watchTimeSeconds: 'Tempo médio que as pessoas assistiram a cada vídeo.',
}

export const NET_TABS = {
  instagram: [{ key: 'community', label: 'Comunidade' }, { key: 'posts', label: 'Posts Publicados' }, { key: 'growth', label: 'Crescimento' }],
  facebook: [{ key: 'community', label: 'Comunidade' }, { key: 'posts', label: 'Posts Publicados' }],
  youtube: [{ key: 'community', label: 'Comunidade' }, { key: 'videos', label: 'Vídeos Publicados' }, { key: 'growth', label: 'Crescimento' }],
  tiktok: [{ key: 'community', label: 'Comunidade' }, { key: 'videos', label: 'Vídeos Publicados' }],
}

export function fmtNum(n) {
  if (n == null) return '—'
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, '') + 'k'
  return String(n)
}

export function fmtWatchTime(seconds) {
  if (seconds == null) return '—'
  const m = Math.floor(seconds / 60)
  const s = Math.round(seconds % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

export function formatDiaBR(iso) {
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

export function filterByPeriod(data, periodDays) {
  return filterByPeriodOffset(data, periodDays, 0)
}

export function filterByPeriodOffset(data, periodDays, offsetDays = 0) {
  const ate = new Date()
  const offset = offsetDays * periodDays * 86400000
  const de = new Date(ate.getTime() - (periodDays * 86400000 + offset))
  const ateOffset = new Date(ate.getTime() - offset)
  const deStr = de.toISOString().slice(0, 10)
  const ateStr = ateOffset.toISOString().slice(0, 10)

  if (Array.isArray(data)) {
    return data.filter(item => {
      if (!item.publishedAt) return false
      const dia = new Date(item.publishedAt).toISOString().slice(0, 10)
      return dia >= deStr && dia <= ateStr
    })
  }
  return Object.fromEntries(Object.entries(data).filter(([dia]) => dia >= deStr && dia <= ateStr))
}

export function filterTikTokVideosByPeriod(videos, periodDays) {
  return filterTikTokVideosByPeriodOffset(videos, periodDays, 0)
}

export function filterTikTokVideosByPeriodOffset(videos, periodDays, offsetDays = 0) {
  const ate = new Date()
  const offset = offsetDays * periodDays * 86400000
  const de = new Date(ate.getTime() - (periodDays * 86400000 + offset))
  const ateOffset = new Date(ate.getTime() - offset)
  return videos.filter(video => {
    const timestamp = video.createTime ? Number(video.createTime) * 1000 : Date.parse(video.publishedAt || '')
    if (!Number.isFinite(timestamp)) return false
    const date = new Date(timestamp)
    return date >= de && date <= ateOffset
  })
}

export function topN(itens, n) {
  const ordenado = [...itens].sort((a, b) => b.value - a.value)
  if (ordenado.length <= n) return ordenado
  const top = ordenado.slice(0, n - 1)
  const outrosValue = ordenado.slice(n - 1).reduce((acc, i) => acc + i.value, 0)
  return [...top, { label: 'Outros', value: outrosValue }]
}

export function latestOf(obj) {
  const dias = Object.keys(obj).sort()
  return dias.length ? obj[dias.at(-1)] : null
}

export function detectNetworks({ metrics = [], instagramFollowers = {}, tiktokStats = {}, youtubeSubscribers = {}, tiktokVideos = [], accountAnalytics }) {
  const nets = new Set()
  for (const m of metrics) if (m.platform) nets.add(m.platform)
  if (Object.keys(instagramFollowers).length) nets.add('instagram')
  if (Object.keys(tiktokStats).length) nets.add('tiktok')
  if (tiktokVideos.length) nets.add('tiktok')
  if (Object.keys(youtubeSubscribers).length) nets.add('youtube')
  for (const [platform, accounts] of Object.entries(accountAnalytics?.platforms || {})) {
    if (Array.isArray(accounts) && accounts.length) nets.add(platform)
  }
  return NETWORK_ORDER.filter(n => nets.has(n))
}

export const CHART_TICK_COLOR = '#8b8fa3'
export const CHART_GRID_COLOR = 'rgba(255,255,255,0.05)'

export function baseChartOptions() {
  return {
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      y: { beginAtZero: true, ticks: { precision: 0, color: CHART_TICK_COLOR }, grid: { color: CHART_GRID_COLOR } },
      x: { ticks: { color: CHART_TICK_COLOR }, grid: { display: false } },
    },
    plugins: { legend: { position: 'bottom', labels: { color: CHART_TICK_COLOR, boxWidth: 12 } } },
  }
}
