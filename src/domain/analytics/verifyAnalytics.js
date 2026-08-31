const PLATFORMS = ['facebook', 'instagram', 'youtube', 'tiktok']

function finiteNumber(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function hasMetricValue(value) {
  if (value === null || value === undefined || value === '') return false
  if (typeof value !== 'object') return finiteNumber(value) !== null
  if (finiteNumber(value.total) !== null) return true
  return (value.values || []).some(item => finiteNumber(item?.value) !== null)
    || (value.breakdowns || []).some(item => finiteNumber(item?.value) !== null)
}

function hasProfileData(profile) {
  return Object.values(profile?.totals?.metrics || {}).some(hasMetricValue)
    || Object.values(profile?.timeSeries?.metrics || {}).some(hasMetricValue)
}

function statusLabel(status) {
  return {
    verified: 'Dados verificados',
    partial: 'Dados parciais',
    no_data: 'Sem dados no período',
  }[status] || 'Status não verificado'
}

function statusDescription(status, { contentTotal, withContentData, accounts, errors, missing, cached }) {
  if (status === 'verified') {
    return cached
      ? `Os números foram confirmados, mas ${cached} publicação(ões) usam o último snapshot local identificado.`
      : 'Os números exibidos vieram da rede conectada ou de um registro local identificado.'
  }
  if (status === 'partial') {
    const reasons = []
    if (missing) reasons.push(`${missing} publicação(ões) sem métrica confirmada`)
    if (errors) reasons.push(`${errors} consulta(s) sem resposta`)
    return reasons.length
      ? `O relatório tem dados, mas ${reasons.join(' e ')}. Os campos sem confirmação aparecem como “—”.`
      : 'A rede retornou apenas parte das métricas disponíveis para este período.'
  }
  if (accounts) return 'A conta está conectada, mas ainda não retornou métricas para este período.'
  if (contentTotal) return `Há ${contentTotal} publicação(ões), mas nenhuma tem métrica confirmada.`
  if (withContentData === 0) return 'Conecte uma conta ou publique conteúdo para iniciar a coleta.'
  return 'Nenhuma fonte de dados foi encontrada para esta rede.'
}

function platformVerification(platform, metrics, accountAnalytics, history) {
  const rows = metrics.filter(item => item.platform === platform)
  const withContentData = rows.filter(item => item.metrics != null && Object.keys(item.metrics || {}).some(key => hasMetricValue(item.metrics[key]))).length
  const statusCounts = rows.reduce((counts, item) => {
    const status = item.metricsStatus || (item.metrics ? 'available' : 'unavailable')
    counts[status] = (counts[status] || 0) + 1
    return counts
  }, {})
  const profiles = accountAnalytics?.platforms?.[platform] || []
  const profilesWithData = profiles.filter(hasProfileData).length
  const profileErrors = profiles.reduce((total, profile) => total + (profile.errors || []).length, 0)
  const historyDays = Object.keys(history || {}).length
  const missing = (statusCounts.missing_external_id || 0) + (statusCounts.deferred || 0) + (statusCounts.unavailable || 0)
  const cached = statusCounts.cached || 0
  const errors = profileErrors
    + (accountAnalytics?.errors || []).filter(error => error.platform === platform || error.scope === platform).length
  const hasData = withContentData > 0 || profilesWithData > 0 || historyDays > 0
  const status = !hasData ? 'no_data' : (missing > 0 || errors > 0 ? 'partial' : 'verified')
  const contentTotal = rows.length

  return {
    status,
    label: statusLabel(status),
    description: statusDescription(status, { contentTotal, withContentData, accounts: profiles.length, errors, missing, cached }),
    content: {
      total: contentTotal,
      withData: withContentData,
      withoutData: Math.max(0, contentTotal - withContentData),
      coveragePercent: contentTotal ? Math.round(withContentData / contentTotal * 100) : null,
      statusCounts,
    },
    accounts: { connected: profiles.length, withAnalytics: profilesWithData, historyDays },
    issues: { missingContentMetrics: missing, failedQueries: errors },
  }
}

function overallDescription(status, platforms) {
  if (status === 'verified') return 'Os dados disponíveis foram recebidos de fontes conectadas e estão prontos para leitura.'
  if (status === 'partial') return 'Parte dos dados foi confirmada, mas algumas publicações ou consultas ainda não têm retorno. Nada foi estimado para preencher essas lacunas.'
  if (platforms.some(item => item.accounts.connected)) return 'Há contas conectadas, mas nenhuma métrica foi retornada no período selecionado.'
  return 'Conecte uma rede social e publique conteúdo para começar a receber métricas reais.'
}

function buildAnalyticsVerification({ days, metrics = [], accountAnalytics = {}, instagramFollowers = {}, tiktokStats = {}, youtubeSubscribers = {} }) {
  const histories = { instagram: instagramFollowers, tiktok: tiktokStats, youtube: youtubeSubscribers, facebook: {} }
  const platforms = PLATFORMS.map(platform => platformVerification(platform, metrics, accountAnalytics, histories[platform]))
  const hasPartial = platforms.some(item => item.status === 'partial')
  const hasVerified = platforms.some(item => item.status === 'verified')
  const status = hasPartial ? 'partial' : hasVerified ? 'verified' : 'no_data'
  const totalContent = platforms.reduce((total, item) => total + item.content.total, 0)
  const contentWithData = platforms.reduce((total, item) => total + item.content.withData, 0)
  const dateRange = accountAnalytics?.dateRange || null

  return {
    generatedAt: new Date().toISOString(),
    period: {
      days: Number(days) || null,
      since: dateRange?.since || null,
      until: dateRange?.until || null,
    },
    overall: { status, label: statusLabel(status), description: overallDescription(status, platforms) },
    coverage: {
      content: {
        total: totalContent,
        withData: contentWithData,
        withoutData: Math.max(0, totalContent - contentWithData),
        percent: totalContent ? Math.round(contentWithData / totalContent * 100) : null,
      },
    },
    platforms: Object.fromEntries(PLATFORMS.map((platform, index) => [platform, platforms[index]])),
  }
}

module.exports = { buildAnalyticsVerification }
