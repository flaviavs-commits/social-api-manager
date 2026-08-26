const { listarContasToken } = require('../infra/social/publisher')
const zernioClient = require('../infra/social/zernioClient')
const metricsService = require('./metricsService')
const {
  ACCOUNT_METRICS, UNAVAILABLE_METRICS, DEFAULT_ANALYTICS_DAYS, MAX_ANALYTICS_DAYS
} = require('../domain/analytics/analyticsCatalog')
const { normalizeInsight } = require('../domain/analytics/normalizeAnalytics')

const ZERNIO_PLATFORMS = ['facebook', 'instagram', 'tiktok', 'youtube']
const MAX_DAYS = MAX_ANALYTICS_DAYS
const ZERNIO_INSIGHT_MAX_DAYS = { facebook: 89, instagram: 90, tiktok: 89, youtube: 89 }
const ACCOUNT_ANALYTICS_CONCURRENCY = 2

function dateOnly(date) {
  return new Date(date).toISOString().slice(0, 10)
}

function buildDateRange(days = DEFAULT_ANALYTICS_DAYS) {
  const requestedDays = Number(days)
  const boundedDays = Math.min(Math.max(Number.isFinite(requestedDays) ? requestedDays : DEFAULT_ANALYTICS_DAYS, 1), MAX_DAYS)
  const until = new Date()
  const since = new Date(until.getTime() - (boundedDays - 1) * 86400000)
  return { since: dateOnly(since), until: dateOnly(until), days: boundedDays }
}

function safeError(error) {
  const message = error?.message || 'Não foi possível consultar este relatório'
  return {
    code: error?.code || null,
    status: error?.status || null,
    message: /API_KEY|access.?token|refresh.?token|secret|zernio/i.test(message)
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

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = Array(items.length)
  let nextIndex = 0
  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex++
      results[index] = await mapper(items[index], index)
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker))
  return results
}

function insightMethod(platform) {
  return {
    facebook: zernioClient.getFacebookPageInsights,
    instagram: zernioClient.getInstagramAccountInsights,
    tiktok: zernioClient.getTiktokAccountInsights,
    youtube: zernioClient.getYoutubeChannelInsights
  }[platform]
}

function timeSeriesMetrics(platform) {
  // O endpoint de Insights do Instagram só permite série temporal para
  // reach. Os demais valores ficam corretamente no relatório total_value.
  if (platform === 'instagram') return ['reach']
  return ACCOUNT_METRICS[platform]
}

async function collectAccount(token, range) {
  const insightRange = buildDateRange(Math.min(
    range.days,
    ZERNIO_INSIGHT_MAX_DAYS[token.platform] || MAX_DAYS
  ))
  const base = {
    localAccountId: token.contaId,
    providerAccountId: token.zernioAccountId,
    accountName: token.accountName || token.handle || null,
    platform: token.platform,
    dateRange: { since: insightRange.since, until: insightRange.until },
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
      since: insightRange.since,
      until: insightRange.until,
      metricType: 'total_value'
    })),
    settledCall(() => method({
      accountId: token.zernioAccountId,
      metrics: timeSeriesMetrics(token.platform).join(','),
      since: insightRange.since,
      until: insightRange.until,
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

  if (token.platform === 'youtube') {
    const demographics = await settledCall(() => zernioClient.getYoutubeDemographics({
      accountId: token.zernioAccountId,
      fromDate: range.since,
      toDate: range.until
    }))
    base.demographics = demographics.data?.demographics || demographics.data || null
    if (demographics.error) base.errors.push({ scope: 'demographics', ...demographics.error })
  }

  return base
}

async function buscarAnalyticsContas({ userId, isAdmin, days = DEFAULT_ANALYTICS_DAYS }) {
  const range = buildDateRange(days)
  const tokens = (await Promise.all(
    ZERNIO_PLATFORMS.map(platform => listarContasToken(platform, userId, isAdmin))
  )).flat()

  const accounts = await mapWithConcurrency(tokens, ACCOUNT_ANALYTICS_CONCURRENCY, token => collectAccount(token, range))
  const providerIds = accounts.map(account => account.providerAccountId).filter(Boolean)
  const providerAccounts = accounts.filter(account => account.providerAccountId)

  const [dailyResults, decayResults, followerResult, youtubeResult] = await Promise.all([
    mapWithConcurrency(providerAccounts, ACCOUNT_ANALYTICS_CONCURRENCY, account => settledCall(async () => ({
      ...account,
      data: await zernioClient.getDailyMetrics({ accountId: account.providerAccountId, fromDate: range.since, toDate: range.until })
    }))),
    mapWithConcurrency(providerAccounts, ACCOUNT_ANALYTICS_CONCURRENCY, account => settledCall(async () => ({
      ...account,
      data: await zernioClient.getContentDecay({ accountId: account.providerAccountId })
    }))),
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

  const bestTimeResults = await mapWithConcurrency(providerAccounts, ACCOUNT_ANALYTICS_CONCURRENCY, account => settledCall(async () => ({
    ...account,
    data: await zernioClient.getBestTimeToPost({ accountId: account.providerAccountId, platform: account.platform })
  })))

  const byPlatform = Object.fromEntries(ZERNIO_PLATFORMS.map(platform => [
    platform,
    accounts.filter(account => account.platform === platform)
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
    bestTimeToPost: bestTimeResults.filter(result => result.data).map(result => result.data),
    followerStats: followerResult.data || null,
    youtube: youtubeResult.data || null,
    errors: [
      ...dailyResults.filter(result => result.error).map(result => ({ scope: 'daily_metrics', ...result.error })),
      ...decayResults.filter(result => result.error).map(result => ({ scope: 'content_decay', ...result.error })),
      ...bestTimeResults.filter(result => result.error).map(result => ({ scope: 'best_time', ...result.error })),
      ...(followerResult.error ? [{ scope: 'follower_stats', ...followerResult.error }] : []),
      ...(youtubeResult.error ? [{ scope: 'youtube', ...youtubeResult.error }] : [])
    ]
  }
}

module.exports = { buscarAnalyticsContas, buildDateRange, MAX_DAYS }
