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

function viewMetric(row) {
  const candidates = [
    ['views', 'visualizações'],
    ['video_views', 'visualizações'],
    ['videoViews', 'visualizações'],
    ['reach', 'alcance'],
    ['impressions', 'impressões'],
  ]
  for (const [name, label] of candidates) {
    const value = metricValue(row.metrics, [name])
    if (value > 0) return { value, label }
  }
  return { value: 0, label: 'visualizações' }
}

function median(values) {
  const ordered = [...values].sort((a, b) => a - b)
  if (!ordered.length) return 0
  const middle = Math.floor(ordered.length / 2)
  return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2
}

function percentageChange(from, to) {
  if (!from) return null
  return Number(((to - from) / from * 100).toFixed(1))
}

function postForAnalysis(row) {
  const views = viewMetric(row)
  const interactions = interactionValue(row.metrics, row.platform)
  const publishedAt = row.publishedAt ? new Date(row.publishedAt) : null
  const validDate = publishedAt && !Number.isNaN(publishedAt.getTime()) ? publishedAt : null
  const text = row.text || row.caption || ''
  return {
    id: row.postId,
    platform: row.platform,
    platformLabel: PLATFORM_LABELS[row.platform] || row.platform,
    text: String(text),
    preview: String(text || 'Publicação sem texto').replace(/\s+/g, ' ').trim().slice(0, 90),
    views: views.value,
    viewsMetric: views.label,
    interactions,
    engagementRate: views.value > 0 ? Number((interactions / views.value * 100).toFixed(2)) : 0,
    mediaType: row.mediaType || 'não identificado',
    niche: inferNiche([text]),
    publishedAt: validDate ? validDate.toISOString() : null,
    hour: validDate ? validDate.getHours() : null,
    day: validDate ? WEEK_DAYS[validDate.getDay()] : null,
  }
}

function summarizePerformanceGroup(rows, platform) {
  const posts = rows.map(postForAnalysis).filter(post => post.views > 0).sort((a, b) => b.views - a.views)
  const label = PLATFORM_LABELS[platform] || platform
  if (posts.length < 2) {
    return {
      platform,
      platformLabel: label,
      sampleSize: posts.length,
      confidence: 'insuficiente',
      diagnosis: `Ainda não há publicações suficientes com visualizações registradas no ${label} para comparar um post bom com outro fraco.`,
      signals: [],
      topPost: posts[0] || null,
      lowPost: null,
      solution: 'Publique pelo menos mais duas variações no mesmo tema e acompanhe as visualizações antes de tirar uma conclusão.',
      alternativeApproach: 'Faça um teste controlado: mantenha o tema e a mídia, mas altere apenas o gancho da primeira frase.',
    }
  }

  const topPost = posts[0]
  const lowPost = posts[posts.length - 1]
  const averageViews = Number((posts.reduce((total, post) => total + post.views, 0) / posts.length).toFixed(1))
  const medianViews = median(posts.map(post => post.views))
  const hours = new Map()
  for (const post of posts) {
    if (post.hour === null) continue
    const bucket = hours.get(post.hour) || { hour: post.hour, total: 0, count: 0 }
    bucket.total += post.views
    bucket.count += 1
    hours.set(post.hour, bucket)
  }
  const bestHour = [...hours.values()].sort((a, b) => (b.total / b.count) - (a.total / a.count))[0]
  const signals = []
  if (topPost.hour !== null && bestHour && topPost.hour === bestHour.hour) {
    signals.push(`o post com mais visualizações saiu às ${String(topPost.hour).padStart(2, '0')}h, que também foi o melhor horário observado`)
  } else if (topPost.hour !== null) {
    signals.push(`o post com mais visualizações saiu às ${String(topPost.hour).padStart(2, '0')}h`)
  }
  if (topPost.mediaType !== 'não identificado') signals.push(`o formato do melhor post foi ${topPost.mediaType}`)
  if (topPost.niche !== 'não identificado') signals.push(`o tema identificado no melhor post foi ${topPost.niche}`)
  if (topPost.engagementRate > lowPost.engagementRate) {
    signals.push(`ele também gerou uma taxa de interação maior (${topPost.engagementRate}% contra ${lowPost.engagementRate}%)`)
  }
  if (!signals.length) signals.push('os dados disponíveis não mostram um fator de conteúdo confiável')

  const gap = percentageChange(lowPost.views, topPost.views)
  const confidence = posts.length >= 8 ? 'moderada' : 'baixa'
  return {
    platform,
    platformLabel: label,
    sampleSize: posts.length,
    confidence,
    averageViews,
    medianViews,
    topPost,
    lowPost,
    viewGap: gap,
    bestHour: bestHour ? { hour: bestHour.hour, averageViews: Number((bestHour.total / bestHour.count).toFixed(1)), postCount: bestHour.count } : null,
    signals,
    diagnosis: `No ${label}, o post #${topPost.id || 'mais forte'} teve ${topPost.views} ${topPost.viewsMetric}, enquanto o post #${lowPost.id || 'mais fraco'} teve ${lowPost.views}. Isso representa ${gap === null ? 'uma diferença relevante' : `${Math.abs(gap)}% de diferença`}. Os sinais observados foram: ${signals.join('; ')}. Isso indica associação, não prova de causalidade.`,
    solution: `Use o post #${topPost.id || 'mais forte'} como referência: replique seu gancho, tema, formato e faixa de horário, mas crie uma nova versão original. Mantenha uma chamada clara para comentar, salvar ou compartilhar e compare o resultado com a mediana de ${medianViews} visualizações.`,
    alternativeApproach: `Faça um teste A/B em duas publicações: mantenha o tema e o formato, altere somente o gancho inicial e o horário. Publique uma versão às ${topPost.hour === null ? 'um horário definido' : `${String(topPost.hour).padStart(2, '0')}h`} e outra fora desse horário; compare visualizações e interações após o mesmo período de coleta.`,
  }
}

function buildPerformanceAnalysis(data, focusPlatform = null) {
  const rows = (data?.metrics || []).filter(row => row.metrics && (!focusPlatform || row.platform === focusPlatform))
  const groups = new Map()
  for (const row of rows) {
    if (!groups.has(row.platform)) groups.set(row.platform, [])
    groups.get(row.platform).push(row)
  }
  const comparisons = [...groups.entries()].map(([platform, platformRows]) => summarizePerformanceGroup(platformRows, platform))
  const usablePosts = comparisons.reduce((total, item) => total + item.sampleSize, 0)
  return {
    comparisons,
    usablePosts,
    hasEnoughData: comparisons.some(item => item.sampleSize >= 2),
    summary: comparisons.length
      ? comparisons.map(item => item.diagnosis).join(' ')
      : 'Não há métricas de visualização suficientes para comparar publicações.',
  }
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

function bestTimeSlots(data, focusPlatform = null) {
  const slots = []
  for (const item of data?.accountAnalytics?.bestTimeToPost || []) {
    if (focusPlatform && item.platform !== focusPlatform) continue
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

function buildAnalyticsInsights(data, days = 30, focusPlatform = null) {
  const profiles = profileStats(data)
  const slots = bestTimeSlots(data, focusPlatform)
  const performanceAnalysis = buildPerformanceAnalysis(data, focusPlatform)
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
    performanceAnalysis,
    recommendations,
    dataQuality: {
      publications: rows.length,
      timeSlots: slots.length,
      profiles: profiles.length,
      hasEnoughData: rows.length >= 3 || profiles.some(profile => profile.interactions > 0),
    },
  }
}

module.exports = { buildAnalyticsInsights, buildPerformanceAnalysis, inferNiche, periodForHour }
