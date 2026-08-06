const PLATFORM_LABELS = {
  facebook: 'Facebook',
  instagram: 'Instagram',
  youtube: 'YouTube',
  tiktok: 'TikTok',
}

const WEEK_DAYS = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado']
const PERIODS = [
  { label: 'madrugada', from: 0, to: 5 },
  { label: 'manhã', from: 6, to: 11 },
  { label: 'tarde', from: 12, to: 17 },
  { label: 'noite', from: 18, to: 23 },
]

const NICHE_KEYWORDS = {
  beleza: ['beleza', 'maquiagem', 'make', 'skincare', 'cabelo', 'cosmético', 'cosmetico'],
  educação: ['educação', 'educacao', 'curso', 'aula', 'estudo', 'aprenda', 'conhecimento'],
  finanças: ['finança', 'financa', 'investimento', 'dinheiro', 'renda', 'economia', 'negócio', 'negocio'],
  fitness: ['fitness', 'treino', 'academia', 'saúde', 'saude', 'exercício', 'exercicio', 'corrida'],
  gastronomia: ['receita', 'comida', 'gastronomia', 'cozinha', 'restaurante', 'sabor'],
  tecnologia: ['tecnologia', 'software', 'aplicativo', 'app', 'inteligência artificial', 'inteligencia artificial', 'digital'],
  viagens: ['viagem', 'turismo', 'destino', 'hotel', 'praia', 'passeio'],
  moda: ['moda', 'look', 'estilo', 'roupa', 'tendência', 'tendencia'],
  pets: ['pet', 'cachorro', 'gato', 'animal', 'veterinário', 'veterinario'],
}

function numberValue(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : 0
}

function metricValue(metrics, names) {
  for (const name of names) {
    const raw = metrics?.[name]
    const value = numberValue(raw && typeof raw === 'object' ? raw.total : raw)
    if (value) return value
  }
  return 0
}

function periodForHour(hour) {
  const found = PERIODS.find(period => hour >= period.from && hour <= period.to)
  return found?.label || 'horário não identificado'
}

function inferNiche(texts) {
  const source = texts.filter(Boolean).join(' ').toLowerCase()
  if (!source) return 'não identificado'
  const scores = Object.entries(NICHE_KEYWORDS)
    .map(([niche, keywords]) => [niche, keywords.reduce((score, keyword) => score + (source.includes(keyword) ? 1 : 0), 0)])
    .sort(([, a], [, b]) => b - a)
  return scores[0]?.[1] ? scores[0][0] : 'não identificado'
}

function postRows(data, platform) {
  return (data?.metrics || []).filter(row => row.platform === platform && row.metrics)
}

function interactionNamesFor(platform) {
  if (platform === 'facebook') return ['page_post_engagements', 'post_engagements']
  if (platform === 'instagram') return ['total_interactions', 'interactions']
  return ['likes', 'comments', 'shares', 'saves']
}

function interactionValue(metrics, platform) {
  const preferred = metricValue(metrics, interactionNamesFor(platform))
  if (preferred) return preferred
  return ['likes', 'comments', 'shares', 'saves'].reduce((total, name) => total + metricValue(metrics, [name]), 0)
}

function profileStats(data) {
  const rowsByPlatform = new Map()
  for (const row of data?.metrics || []) {
    if (!rowsByPlatform.has(row.platform)) rowsByPlatform.set(row.platform, [])
    rowsByPlatform.get(row.platform).push(row)
  }

  const result = []
  for (const [platform, profiles] of Object.entries(data?.accountAnalytics?.platforms || {})) {
    for (const profile of Array.isArray(profiles) ? profiles : []) {
      const metrics = profile.totals?.metrics || profile.metrics || {}
      const rows = rowsByPlatform.get(platform) || []
      const reach = metricValue(metrics, platform === 'facebook' ? ['page_media_view', 'page_video_views'] : ['reach', 'views'])
      const interactions = interactionValue(metrics, platform)
      result.push({
        id: profile.localAccountId || profile.providerAccountId || `${platform}-${result.length}`,
        platform,
        platformLabel: PLATFORM_LABELS[platform] || platform,
        name: profile.accountName || profile.handle || `Perfil ${PLATFORM_LABELS[platform] || platform}`,
        niche: inferNiche(rows.map(row => row.text)),
        contentCount: rows.length,
        reach,
        interactions,
        engagementRate: reach > 0 ? Number((interactions / reach * 100).toFixed(2)) : 0,
      })
    }
  }

  // Mesmo sem o relatório detalhado de conta, os posts publicados ainda
  // permitem uma comparação honesta entre redes no período.
  if (!result.length) {
    for (const platform of new Set((data?.metrics || []).map(row => row.platform))) {
      const rows = rowsByPlatform.get(platform) || []
      const reach = rows.reduce((total, row) => total + metricValue(row.metrics, ['reach', 'views']), 0)
      const interactions = rows.reduce((total, row) => total + ['likes', 'comments', 'shares', 'saves'].reduce((sum, name) => sum + metricValue(row.metrics, [name]), 0), 0)
      result.push({
        id: platform,
        platform,
        platformLabel: PLATFORM_LABELS[platform] || platform,
        name: `Perfil ${PLATFORM_LABELS[platform] || platform}`,
        niche: inferNiche(rows.map(row => row.text)),
        contentCount: rows.length,
        reach,
        interactions,
        engagementRate: reach > 0 ? Number((interactions / reach * 100).toFixed(2)) : 0,
      })
    }
  }
  return result.sort((a, b) => b.engagementRate - a.engagementRate || b.interactions - a.interactions)
}

function bestTimeSlots(data) {
  const slots = []
  for (const item of data?.accountAnalytics?.bestTimeToPost || []) {
    for (const slot of item.data?.slots || []) {
      const hour = numberValue(slot.hour)
      slots.push({
        platform: item.platform,
        platformLabel: PLATFORM_LABELS[item.platform] || item.platform,
        day: WEEK_DAYS[numberValue(slot.day_of_week)] || `dia ${slot.day_of_week}`,
        hour,
        period: periodForHour(hour),
        averageInteractions: numberValue(slot.avg_engagement || slot.average_engagement),
        postCount: numberValue(slot.post_count),
      })
    }
  }
  return slots.sort((a, b) => b.averageInteractions - a.averageInteractions || b.postCount - a.postCount)
}

function buildNicheComparisons(profiles) {
  const groups = new Map()
  for (const profile of profiles.filter(item => item.niche !== 'não identificado')) {
    if (!groups.has(profile.niche)) groups.set(profile.niche, [])
    groups.get(profile.niche).push(profile)
  }
  return [...groups.entries()].map(([niche, items]) => {
    const ordered = [...items].sort((a, b) => b.engagementRate - a.engagementRate || b.interactions - a.interactions)
    return {
      niche,
      profiles: ordered,
      winner: ordered[0] || null,
    }
  })
}

function buildAnalyticsInsights(data, days = 30) {
  const profiles = profileStats(data)
  const slots = bestTimeSlots(data)
  const bestTime = slots[0] || null
  const bestProfile = profiles[0] || null
  const rows = data?.metrics || []
  const summary = rows.length
    ? `${rows.length} publicação(ões) foram analisadas nos últimos ${days} dias. ${bestProfile ? `${bestProfile.name} (${bestProfile.platformLabel}) apresenta o melhor desempenho relativo, com ${bestProfile.engagementRate.toFixed(2)}% de interação sobre alcance.` : 'Ainda faltam dados detalhados de perfil para apontar um vencedor.'}`
    : `Ainda não há publicações com métricas suficientes nos últimos ${days} dias para gerar uma análise confiável.`

  const recommendations = []
  if (bestTime) recommendations.push(`Priorize ${bestTime.platformLabel} às ${String(bestTime.hour).padStart(2, '0')}h, no período da ${bestTime.period}, especialmente às ${bestTime.day}.`)
  else recommendations.push('Publique em horários diferentes e acumule dados; ainda não há histórico confiável de melhores horários.')
  if (bestProfile) recommendations.push(`Use ${bestProfile.name} como referência: o perfil está com ${bestProfile.engagementRate.toFixed(2)}% de interação e ${bestProfile.interactions} interações no período.`)
  if (!profiles.some(profile => profile.niche !== 'não identificado')) recommendations.push('O nicho não pôde ser identificado com segurança; use textos e hashtags mais descritivos para melhorar a comparação.')

  return {
    period: { days, since: data?.accountAnalytics?.dateRange?.since || null, until: data?.accountAnalytics?.dateRange?.until || null },
    summary,
    bestTime,
    bestPeriod: bestTime?.period || null,
    profileComparison: profiles,
    nicheComparisons: buildNicheComparisons(profiles),
    recommendations,
    dataQuality: {
      publications: rows.length,
      timeSlots: slots.length,
      profiles: profiles.length,
      hasEnoughData: rows.length >= 3 || profiles.some(profile => profile.interactions > 0),
    },
  }
}

module.exports = { buildAnalyticsInsights, inferNiche, periodForHour }
