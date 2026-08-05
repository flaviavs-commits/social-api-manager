const { listarContasToken } = require('../infra/social/publisher')
const zernioClient = require('../infra/social/zernioClient')
const metricsService = require('./metricsService')
const { ACCOUNT_METRICS, UNAVAILABLE_METRICS } = require('../domain/analytics/analyticsCatalog')
const { normalizeInsight } = require('../domain/analytics/normalizeAnalytics')

const ZERNIO_PLATFORMS = ['facebook', 'instagram', 'tiktok']
const MAX_DAYS = 90

function dateOnly(date) {
  return new Date(date).toISOString().slice(0, 10)
}

function buildDateRange(days = 30) {
  const boundedDays = Math.min(Math.max(Number(days) || 30, 1), MAX_DAYS)
  const until = new Date()
  const since = new Date(until.getTime() - (boundedDays - 1) * 86400000)
  return { since: dateOnly(since), until: dateOnly(until), days: boundedDays }
}

function safeError(error) {
  const message = error?.message || 'Não foi possível consultar este relatório'
  return {
    code: error?.code || null,
    status: error?.status || null,
    message: /API_KEY|access.?token|refresh.?token|secret/i.test(message)
      ? 'Relatório indisponível para esta conexão.'
      : message
  }
}

async function settledCall(fn) {
  try {
    return { data: await fn() }
  } catch (error) {
    return { error: safeError(error) }
  }
}

function insightMethod(platform) {
  return {
    facebook: zernioClient.getFacebookPageInsights,
    instagram: zernioClient.getInstagramAccountInsights,
    tiktok: zernioClient.getTiktokAccountInsights
  }[platform]
}

function timeSeriesMetrics(platform) {
  // O endpoint de Insights do Instagram só permite série temporal para
  // reach. Os demais valores ficam corretamente no relatório total_value.
  if (platform === 'instagram') return ['reach']
  return ACCOUNT_METRICS[platform]
}

async function collectAccount(token, range) {
  const base = {
    localAccountId: token.contaId,
    providerAccountId: token.zernioAccountId,
    accountName: token.accountName || token.handle || null,
    platform: token.platform,
    dateRange: { since: range.since, until: range.until },
    totals: null,
    timeSeries: null,
    demographics: null,
    unavailableMetrics: UNAVAILABLE_METRICS[token.platform] || [],
    errors: []
  }

  if (!token.zernioAccountId || !ZERNIO_PLATFORMS.includes(token.platform)) {
    base.errors.push({ scope: 'provider', message: 'Esta conta não usa o provedor de analytics conectado.' })
    return base
  }

  const method = insightMethod(token.platform)
  const [totalResult, seriesResult] = await Promise.all([
    settledCall(() => method({
      accountId: token.zernioAccountId,
      metrics: ACCOUNT_METRICS[token.platform].join(','),
      since: range.since,
      until: range.until,
      metricType: 'total_value'
    })),
    settledCall(() => method({
      accountId: token.zernioAccountId,
      metrics: timeSeriesMetrics(token.platform).join(','),
      since: range.since,
      until: range.until,
      metricType: 'time_series'
    }))
  ])

  if (totalResult.data) base.totals = normalizeInsight(totalResult.data, token.platform)
  else base.errors.push({ scope: 'totals', ...totalResult.error })
  if (seriesResult.data) base.timeSeries = normalizeInsight(seriesResult.data, token.platform)
  else base.errors.push({ scope: 'time_series', ...seriesResult.error })

  if (token.platform === 'instagram') {
    const [followers, engaged] = await Promise.all([
      settledCall(() => zernioClient.getInstagramDemographics({
        accountId: token.zernioAccountId,
        metric: 'follower_demographics',
        breakdown: 'age,city,country,gender',
        timeframe: 'this_month'
      })),
      settledCall(() => zernioClient.getInstagramDemographics({
        accountId: token.zernioAccountId,
        metric: 'engaged_audience_demographics',
        breakdown: 'age,city,country,gender',
        timeframe: 'this_month'
      }))
    ])
    base.demographics = {
      followers: followers.data?.demographics || null,
      engagedAudience: engaged.data?.demographics || null
    }
    if (followers.error) base.errors.push({ scope: 'follower_demographics', ...followers.error })
    if (engaged.error) base.errors.push({ scope: 'engaged_audience_demographics', ...engaged.error })
  }

  return base
}

async function buscarAnalyticsContas({ userId, isAdmin, days = 30 }) {
  const range = buildDateRange(days)
  const tokens = (await Promise.all(
    ZERNIO_PLATFORMS.map(platform => listarContasToken(platform, userId, isAdmin))
  )).flat()

  const accounts = await Promise.all(tokens.map(token => collectAccount(token, range)))
  const providerIds = accounts.map(account => account.providerAccountId).filter(Boolean)

  const [dailyResults, decayResults, followerResult, youtubeResult] = await Promise.all([
    Promise.all(accounts.filter(account => account.providerAccountId).map(account => settledCall(() => zernioClient.getDailyMetrics({
      accountId: account.providerAccountId,
      fromDate: range.since,
      toDate: range.until
    }).then(data => ({ ...account, data }))))),
    Promise.all(accounts.filter(account => account.providerAccountId).map(account => settledCall(() => zernioClient.getContentDecay({
      accountId: account.providerAccountId,
      fromDate: range.since,
      toDate: range.until
    }).then(data => ({ ...account, data }))))),
    providerIds.length
      ? settledCall(() => zernioClient.getFollowerStats({
        accountIds: providerIds.join(','),
        fromDate: range.since,
        toDate: range.until,
        granularity: 'daily'
      }))
      : Promise.resolve({ data: null }),
    settledCall(() => metricsService.buscarInsightsYoutube(userId, isAdmin, range))
  ])

  const byPlatform = Object.fromEntries([...ZERNIO_PLATFORMS, 'youtube'].map(platform => [
    platform,
    platform === 'youtube' ? (youtubeResult.data?.accounts || []) : accounts.filter(account => account.platform === platform)
  ]))

  return {
    dateRange: { since: range.since, until: range.until },
    capabilities: Object.fromEntries(Object.entries(ACCOUNT_METRICS).map(([platform, metrics]) => [
      platform,
      { available: metrics, unavailable: UNAVAILABLE_METRICS[platform] || [] }
    ])),
    platforms: byPlatform,
    dailyMetrics: dailyResults.filter(result => result.data).map(result => result.data),
    contentDecay: decayResults.filter(result => result.data).map(result => result.data),
    followerStats: followerResult.data || null,
    youtube: youtubeResult.data || null,
    errors: [
      ...dailyResults.filter(result => result.error).map(result => ({ scope: 'daily_metrics', ...result.error })),
      ...decayResults.filter(result => result.error).map(result => ({ scope: 'content_decay', ...result.error })),
      ...(followerResult.error ? [{ scope: 'follower_stats', ...followerResult.error }] : []),
      ...(youtubeResult.error ? [{ scope: 'youtube', ...youtubeResult.error }] : [])
    ]
  }
}

module.exports = { buscarAnalyticsContas, buildDateRange, MAX_DAYS }
