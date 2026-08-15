function asNumber(value) {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function normalizeMetricEntry(entry) {
  if (entry === null || entry === undefined) return { total: null, values: [], breakdowns: [] }
  if (typeof entry === 'number') return { total: entry, values: [], breakdowns: [] }

  return {
    total: asNumber(entry.total),
    values: Array.isArray(entry.values)
      ? entry.values.map(item => ({ date: item.date, value: asNumber(item.value) })).filter(item => item.date)
      : [],
    breakdowns: Array.isArray(entry.breakdowns)
      ? entry.breakdowns.map(item => ({
        dimension: item.dimension ?? item.label ?? item.name,
        value: asNumber(item.value)
      })).filter(item => item.dimension !== undefined)
      : [],
    unit: entry.unit || null,
    currency: entry.currency || null
  }
}

function normalizeMetricMap(metrics) {
  return Object.fromEntries(Object.entries(metrics || {}).map(([name, entry]) => [name, normalizeMetricEntry(entry)]))
}

function normalizeInsight(response, fallbackPlatform = null) {
  return {
    success: response?.success !== false,
    platform: response?.platform || fallbackPlatform,
    accountId: response?.accountId || null,
    dateRange: response?.dateRange || null,
    metricType: response?.metricType || null,
    dataDelay: response?.dataDelay || null,
    provisionalSince: response?.provisionalSince || null,
    metrics: normalizeMetricMap(response?.metrics),
    unavailableMetrics: response?.unavailableMetrics || []
  }
}

function normalizePostAnalytics(response, platformPostId = null) {
  const post = response?.post || response
  // O Zernio usa `platformAnalytics`; versões antigas do adaptador usavam
  // `platforms`/`posts`. Aceitamos os três formatos para não perder métricas
  // reais quando a resposta vem de uma versão diferente do provedor.
  const platforms = Array.isArray(response?.platformAnalytics)
    ? response.platformAnalytics
    : Array.isArray(response?.posts)
      ? response.posts.flatMap(item => item.platforms || item.platformAnalytics || [])
      : (post?.platforms || post?.platformAnalytics || [])
  const platform = platforms.find(item => item.platformPostId === platformPostId)
    || platforms.find(item => item.platform === response?.platform)
    || platforms[0]
    || post
  const analytics = { ...(post?.analytics || {}), ...(platform?.analytics || {}) }

  // Cada rede/provedor usa um nome diferente para a contagem de reproduções.
  // Normalizamos esses aliases aqui para que a lista de publicações possa
  // exibir "Visualizações" de forma consistente sem estimar o valor.
  const views = analytics.views
    ?? analytics.viewCount
    ?? analytics.view_count
    ?? analytics.video_views
    ?? analytics.videoViews
    ?? analytics.media_views
    ?? analytics.mediaViews
    ?? analytics.plays
    ?? analytics.playCount
    ?? analytics.play_count
    ?? null

  return {
    ...analytics,
    impressions: analytics.impressions ?? analytics.impressionCount ?? analytics.impression_count ?? null,
    reach: analytics.reach ?? null,
    likes: analytics.likes ?? analytics.likeCount ?? analytics.like_count ?? null,
    comments: analytics.comments ?? analytics.commentCount ?? analytics.comment_count ?? null,
    shares: analytics.shares ?? analytics.shareCount ?? analytics.share_count ?? null,
    saves: analytics.saves ?? analytics.saveCount ?? analytics.save_count ?? null,
    clicks: analytics.clicks ?? null,
    views,
    follows: analytics.follows ?? null,
    engagementRate: analytics.engagementRate ?? analytics.engagement_rate ?? null,
    igReelsAvgWatchTime: analytics.igReelsAvgWatchTime ?? null,
    igReelsVideoViewTotalTime: analytics.igReelsVideoViewTotalTime ?? null,
    videoDurationSeconds: analytics.videoDurationSeconds ?? null,
    engagedViews: analytics.engagedViews ?? null,
    dislikes: analytics.dislikes ?? null,
    estimatedMinutesWatched: analytics.estimatedMinutesWatched ?? null,
    averageViewDuration: analytics.averageViewDuration ?? null,
    averageViewPercentage: analytics.averageViewPercentage ?? null,
    subscribersGained: analytics.subscribersGained ?? null,
    subscribersLost: analytics.subscribersLost ?? null,
    lastUpdated: analytics.lastUpdated ?? response?.lastUpdated ?? null,
    syncStatus: platform?.syncStatus ?? response?.syncStatus ?? null,
    platformPostId: platform?.platformPostId ?? platformPostId ?? null,
    platformUrl: platform?.platformPostUrl ?? response?.platformPostUrl ?? null
  }
}

function mergeMetricEntries(entries) {
  const totals = entries.reduce((total, entry) => total + (entry.total ?? 0), 0)
  const byDate = new Map()
  const breakdowns = new Map()
  for (const entry of entries) {
    for (const item of entry.values || []) byDate.set(item.date, (byDate.get(item.date) || 0) + (item.value || 0))
    for (const item of entry.breakdowns || []) breakdowns.set(item.dimension, (breakdowns.get(item.dimension) || 0) + (item.value || 0))
  }
  return {
    total: entries.some(entry => entry.total !== null) ? totals : null,
    values: [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, value]) => ({ date, value })),
    breakdowns: [...breakdowns.entries()].map(([dimension, value]) => ({ dimension, value }))
  }
}

module.exports = {
  asNumber, normalizeMetricEntry, normalizeMetricMap, normalizeInsight,
  normalizePostAnalytics, mergeMetricEntries
}
