export const PLAT_LABELS = { facebook: 'Facebook', instagram: 'Instagram', youtube: 'YouTube', tiktok: 'TikTok' }
export const PLAT_COLORS = { facebook: '#5b8def', instagram: '#e94f8a', youtube: '#ff5c5c', tiktok: '#a0a0b0' }
export const NET_ICONS = { instagram: '📸', facebook: '📘', youtube: '▶️', tiktok: '🎵' }
export const DEMO_COLORS = ['#d1993e', '#e94f8a', '#34d399', '#fbbf24', '#5b8def', '#f97316', '#a78bfa', '#22d3ee']
export const GENDER_COLORS = { M: '#5b8def', F: '#e94f8a', U: '#8b8fa3', male: '#5b8def', female: '#e94f8a' }
export const NETWORK_ORDER = ['instagram', 'facebook', 'youtube', 'tiktok']

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
  const ate = new Date()
  const de = new Date(ate.getTime() - periodDays * 86400000)
  const deStr = de.toISOString().slice(0, 10)
  const ateStr = ate.toISOString().slice(0, 10)

  if (Array.isArray(data)) {
    return data.filter(item => {
      if (!item.publishedAt) return false
      const dia = new Date(item.publishedAt).toISOString().slice(0, 10)
      return dia >= deStr && dia <= ateStr
    })
  }
  return Object.fromEntries(Object.entries(data).filter(([dia]) => dia >= deStr && dia <= ateStr))
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

export function detectNetworks({ metrics, instagramFollowers, tiktokStats, youtubeSubscribers, tiktokVideos }) {
  const nets = new Set()
  for (const m of metrics) if (m.platform) nets.add(m.platform)
  if (Object.keys(instagramFollowers).length) nets.add('instagram')
  if (Object.keys(tiktokStats).length) nets.add('tiktok')
  if (tiktokVideos.length) nets.add('tiktok')
  if (Object.keys(youtubeSubscribers).length) nets.add('youtube')
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
