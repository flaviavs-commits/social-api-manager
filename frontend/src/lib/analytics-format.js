export const PLAT_LABELS = { facebook: 'Facebook', instagram: 'Instagram', youtube: 'YouTube', tiktok: 'TikTok' }
export const PLAT_COLORS = { facebook: '#5b8def', instagram: '#e94f8a', youtube: '#ff5c5c', tiktok: '#a0a0b0' }
export const NET_ICONS = { instagram: '📸', facebook: '📘', youtube: '▶️', tiktok: '🎵' }
export const DEMO_COLORS = ['#d1993e', '#e94f8a', '#34d399', '#fbbf24', '#5b8def', '#f97316', '#a78bfa', '#22d3ee']
export const GENDER_COLORS = { M: '#5b8def', F: '#e94f8a', U: '#8b8fa3', male: '#5b8def', female: '#e94f8a' }
export const NETWORK_ORDER = ['instagram', 'facebook', 'youtube', 'tiktok']
export const DEFAULT_ANALYTICS_PERIOD = 7
export const ANALYTICS_PERIODS = [DEFAULT_ANALYTICS_PERIOD, 30, 90]

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

// Converte o catálogo separado de vídeos do TikTok para o formato usado pelos gráficos.
export function tiktokVideoToMetric(video) {
  const publishedAt = video.publishedAt || (video.createTime != null && Number.isFinite(Number(video.createTime))
    ? new Date(Number(video.createTime) * 1000).toISOString()
    : null)
  return {
    platform: 'tiktok',
    publishedAt,
    text: video.title || '',
    metrics: {
      views: video.viewCount,
      likes: video.likeCount,
      comments: video.commentCount,
      shares: video.shareCount,
    },
  }
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

function readAccountMetrics(profile, names) {
  let found = false
  let value = 0
  for (const name of names) {
    const entry = profile?.totals?.metrics?.[name] ?? profile?.metrics?.[name]
    const number = Number(entry?.total ?? entry)
    if (Number.isFinite(number)) {
      found = true
      value += number
    }
  }
  return { value, hasData: found }
}

function firstAccountMetric(profile, names) {
  for (const name of names) {
    const result = readAccountMetrics(profile, [name])
    if (result.hasData) return result
  }
  return { value: 0, hasData: false }
}

// Totais agregados do provedor por rede. O frontend usa estes valores antes
// dos snapshots por publicação; quando uma rede não oferece determinado
// indicador, o chamador continua usando o fallback local daquela rede.
export function accountAnalyticsPlatformTotals(accountAnalytics) {
  const result = {}
  for (const [platform, profiles] of Object.entries(accountAnalytics?.platforms || {})) {
    if (!Array.isArray(profiles)) continue
    const totals = profiles.reduce((acc, profile) => {
      const views = platform === 'facebook'
        ? readAccountMetrics(profile, ['page_media_view', 'page_video_views'])
        : firstAccountMetric(profile, platform === 'instagram' ? ['views', 'reach'] : ['views'])
      const likes = platform === 'instagram' || platform === 'youtube'
        ? firstAccountMetric(profile, ['likes'])
        : { value: 0, hasData: false }
      const comments = platform === 'instagram' || platform === 'youtube'
        ? firstAccountMetric(profile, ['comments'])
        : { value: 0, hasData: false }
      const shares = platform === 'instagram' || platform === 'youtube'
        ? firstAccountMetric(profile, ['shares'])
        : { value: 0, hasData: false }
      const engagement = platform === 'facebook'
        ? firstAccountMetric(profile, ['page_post_engagements'])
        : platform === 'instagram'
          ? firstAccountMetric(profile, ['total_interactions'])
          : platform === 'youtube'
            ? { value: likes.value + comments.value + shares.value, hasData: likes.hasData || comments.hasData || shares.hasData }
            : { value: 0, hasData: false }
      for (const key of ['views', 'likes', 'comments', 'shares', 'engagement']) {
        acc[key].value += totalsFor(key, { views, likes, comments, shares, engagement }).value
        acc[key].hasData = acc[key].hasData || totalsFor(key, { views, likes, comments, shares, engagement }).hasData
      }
      return acc
    }, {
      views: { value: 0, hasData: false }, likes: { value: 0, hasData: false },
      comments: { value: 0, hasData: false }, shares: { value: 0, hasData: false },
      engagement: { value: 0, hasData: false },
    })
    result[platform] = totals
  }
  return result
}

function totalsFor(key, values) {
  return values[key]
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

export function chartThemeColors() {
  const isLightTheme = typeof document !== 'undefined' && document.documentElement.dataset.theme === 'light'
  return {
    tick: isLightTheme ? '#667085' : CHART_TICK_COLOR,
    grid: isLightTheme ? 'rgba(29,39,51,0.1)' : CHART_GRID_COLOR,
  }
}

export function baseChartOptions() {
  const { tick: tickColor, grid: gridColor } = chartThemeColors()
  return {
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      y: { beginAtZero: true, ticks: { precision: 0, color: tickColor }, grid: { color: gridColor } },
      x: { ticks: { color: tickColor }, grid: { display: false } },
    },
    plugins: { legend: { position: 'bottom', labels: { color: tickColor, boxWidth: 12 } } },
  }
}
