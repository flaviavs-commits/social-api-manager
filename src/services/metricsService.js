const { buscarContaToken, listarContasToken } = require('../infra/social/publisher')
const contasRepo = require('../repositories/contasRepository')
const tokensRepo = require('../repositories/tokensRepository')
const zernioClient = require('../infra/social/zernioClient')
const { normalizePostAnalytics } = require('../domain/analytics/normalizeAnalytics')

// Access tokens do Google (YouTube) expiram em ~1h. Se o token estiver
// expirado (ou prestes a expirar) na hora de buscar métricas, a Data API e a
// Analytics API respondem 401 e o post fica "sem métricas" no Analytics. Uma
// margem de segurança evita usar um token que expira no meio da chamada.
const TOKEN_EXPIRY_MARGIN_MS = 2 * 60 * 1000

// Plataformas com API de métricas acessível com os escopos já usados na
// conexão. Facebook/Instagram/TikTok publicam via Zernio agora — o Zernio
// também é quem tem os dados de analytics dessas contas (nosso token direto
// não é mais válido para chamar a Graph API/Content Posting API). TikTok
// passou a ser suportado (antes não tinha ID público de post/vídeo; o
// Zernio devolve um platformPostId real).
const PLATAFORMAS_COM_METRICAS = ['facebook', 'instagram', 'tiktok', 'youtube']

// Sem timeout, um fetch a uma API externa lenta ou travada bloqueia
// indefinidamente a tela de Analytics inteira (Promise.allSettled só resolve
// quando todas as chamadas terminam). 4s é o suficiente para uma resposta
// normal das APIs e mantém o total bem abaixo de 1s na maioria dos casos
// (chamadas saudáveis respondem em <300ms).
const METRICS_FETCH_TIMEOUT_MS = 4000

async function fetchComTimeout(url, opts = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), METRICS_FETCH_TIMEOUT_MS)
  try {
    return await fetch(url, { ...opts, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

// Facebook/Instagram/TikTok publicam via Zernio agora — as métricas também
// vêm de lá. O endpoint aceita postId/accountId, então a consulta é limitada
// ao conteúdo solicitado e não precisa carregar o catálogo inteiro.
async function metricsZernio(token, externalPostId) {
  const result = await zernioClient.getAnalytics({
    postId: externalPostId,
    ...(token.zernioAccountId ? { accountId: token.zernioAccountId } : {})
  })
  const metrics = normalizePostAnalytics(result, externalPostId)

  const resultPlatforms = result?.post?.platforms || result?.platforms || []
  const resultPlatform = result?.platform || resultPlatforms.find(item => item.platformPostId === externalPostId)?.platform
  if (token.zernioAccountId && resultPlatform === 'facebook') {
    try {
      const reactions = await zernioClient.getFacebookPostReactions(token.zernioAccountId, { postId: externalPostId })
      metrics.reactionBreakdown = reactions.breakdown || {}
      metrics.reactionTotal = reactions.total ?? null
    } catch {
      // Reações por tipo são opcionais; as métricas agregadas continuam.
    }
  }
  return metrics
}

// Tempo médio de visualização (em segundos) de um vídeo específico, via
// YouTube Analytics API — diferente da Data API v3 usada para estatísticas
// básicas (likes/views), exige o scope yt-analytics.readonly. Contas
// conectadas antes desse scope existir não têm permissão e a chamada
// retorna 403; nesse caso watchTimeSeconds fica null em vez de quebrar
// o restante das métricas do post.
async function metricsYoutubeWatchTime(token, videoId) {
  try {
    const url = `https://youtubeanalytics.googleapis.com/v2/reports` +
      `?ids=channel==MINE&startDate=2005-01-01&endDate=${new Date().toISOString().slice(0, 10)}` +
      `&metrics=averageViewDuration&filters=video==${encodeURIComponent(videoId)}`
    const res = await fetchComTimeout(url, { headers: { Authorization: `Bearer ${token.accessToken}` } })
    const data = await res.json()
    if (!res.ok) return null
    return data.rows?.[0]?.[0] ?? null
  } catch {
    return null
  }
}

// Relatório completo de um vídeo. O Data API continua sendo a fonte dos
// contadores instantâneos; o Analytics API complementa com watch time,
// retenção, compartilhamentos e conversão em inscritos. Cada campo é
// best-effort porque alguns canais não têm dados suficientes ou monetização.
async function metricsYoutubeVideoAnalytics(token, videoId) {
  const metrics = [
    'views', 'engagedViews', 'likes', 'comments', 'shares', 'dislikes',
    'estimatedMinutesWatched', 'averageViewDuration', 'averageViewPercentage',
    'subscribersGained', 'subscribersLost'
  ]
  try {
    const params = new URLSearchParams({
      ids: 'channel==MINE',
      startDate: '2005-01-01',
      endDate: new Date().toISOString().slice(0, 10),
      metrics: metrics.join(','),
      filters: `video==${videoId}`
    })
    const res = await fetchComTimeout(`https://youtubeanalytics.googleapis.com/v2/reports?${params}`, {
      headers: { Authorization: `Bearer ${token.accessToken}` }
    })
    const data = await res.json()
    if (!res.ok || !data.rows?.[0]) return { watchTimeSeconds: await metricsYoutubeWatchTime(token, videoId) }
    const headers = data.columnHeaders || []
    const values = Object.fromEntries(headers.map((header, index) => [header.name, data.rows[0][index]]))
    return {
      views: Number(values.views) || null,
      engagedViews: Number(values.engagedViews) || null,
      likes: Number(values.likes) || null,
      comments: Number(values.comments) || null,
      shares: Number(values.shares) || null,
      dislikes: Number(values.dislikes) || null,
      estimatedMinutesWatched: Number(values.estimatedMinutesWatched) || null,
      watchTimeSeconds: values.averageViewDuration == null ? null : Number(values.averageViewDuration),
      averageViewPercentage: values.averageViewPercentage == null ? null : Number(values.averageViewPercentage),
      subscribersGained: Number(values.subscribersGained) || null,
      subscribersLost: Number(values.subscribersLost) || null
    }
  } catch {
    return { watchTimeSeconds: await metricsYoutubeWatchTime(token, videoId) }
  }
}

async function metricsYoutube(token, externalPostId) {
  const url = `https://www.googleapis.com/youtube/v3/videos?part=statistics&id=${encodeURIComponent(externalPostId)}`

  // Estatísticas básicas (Data API) e tempo médio de visualização (Analytics API)
  // são chamadas a APIs distintas e independentes — busca em paralelo.
  const [res, advancedMetrics] = await Promise.all([
    fetchComTimeout(url, { headers: { Authorization: `Bearer ${token.accessToken}` } }),
    metricsYoutubeVideoAnalytics(token, externalPostId)
  ])
  const data = await res.json()
  if (!res.ok) throw new Error(data?.error?.message || `YouTube respondeu ${res.status}`)
  const stats = data.items?.[0]?.statistics
  if (!stats) return { likes: null, comments: null, views: null, ...advancedMetrics }
  return {
    likes: Number(stats.likeCount) || 0,
    comments: Number(stats.commentCount) || 0,
    views: Number(stats.viewCount) || 0,
    ...advancedMetrics
  }
}

const METRIC_FETCHERS = {
  facebook: metricsZernio,
  instagram: metricsZernio,
  tiktok: metricsZernio,
  youtube: (token, externalPostId) => token.zernioAccountId
    ? metricsZernio(token, externalPostId)
    : metricsYoutube(token, externalPostId)
}

// Busca likes/comentários reais de um post já publicado. Retorna null
// (métrica indisponível) se a plataforma não suportar, faltar o ID externo,
// a conta não estiver mais conectada, ou a chamada à API falhar (token
// revogado, post removido na rede, permissão insuficiente, rate limit etc.).
async function buscarMetricasPost(post) {
  if (!post.externalPostId || !post.externalPlatform) return null
  if (!PLATAFORMAS_COM_METRICAS.includes(post.externalPlatform)) return null

  const isSuperAdmin = post.userRole === 'super_admin'
  let token = await buscarContaToken(post.externalPlatform, post.userId, isSuperAdmin, post.accountId)
  if (!token) return null

  // O access_token pode ter expirado desde a última renovação proativa (o cron
  // roda só a cada 6h; o do Google dura ~1h). Renova sob demanda antes de
  // chamar a API de métricas e recarrega o token já atualizado do banco — sem
  // isso, vídeos vistos mais de 1h após a conexão apareceriam "sem métricas"
  // por causa do 401. Best-effort: se a renovação falhar, segue com o token
  // atual (a chamada pode ainda funcionar, ou simplesmente cair no catch).
  const expiraEmBreve = token.expiresAt && new Date(token.expiresAt).getTime() - Date.now() < TOKEN_EXPIRY_MARGIN_MS
  if (expiraEmBreve && token.refreshToken) {
    try {
      const renewal = await tokensRepo.renovarToken(token.token_id, post.userId, isSuperAdmin)
      if (renewal?.success) {
        token = await buscarContaToken(post.externalPlatform, post.userId, isSuperAdmin, post.accountId) || token
      }
    } catch {}
  }

  try {
    return await METRIC_FETCHERS[post.externalPlatform](token, post.externalPostId)
  } catch {
    return null
  }
}

// Número atual de seguidores de uma conta do Instagram. A API de Insights
// que daria o histórico direto (metric=follower_count) responde
// "Application does not have permission for this action" — exige uma
// permissão extra da Meta que este app não tem aprovada. O campo básico
// followers_count funciona com o escopo já concedido (instagram_business_basic).
async function metricsSeguidoresAtuaisInstagram(token) {
  const url = `https://graph.instagram.com/v19.0/me?fields=followers_count&access_token=${encodeURIComponent(token.accessToken)}`
  const res = await fetchComTimeout(url)
  const data = await res.json()
  if (!res.ok) throw new Error(data?.error?.message || `Instagram respondeu ${res.status}`)
  return data.followers_count ?? null
}

// Mesmo dado, mas para contas migradas para o Zernio (docs.zernio.com) —
// token.accessToken deixa de ser um access_token real assim que a conta
// migra, então busca via GET /v1/accounts, que já traz followersCount pronto.
async function metricsSeguidoresAtuaisInstagramZernio(zernioAccountId) {
  const { accounts } = await zernioClient.listAccounts()
  const conta = accounts.find(a => a._id === zernioAccountId)
  if (!conta) throw new Error('Conta Instagram não encontrada no Zernio')
  return conta.followersCount ?? conta.metadata?.profileData?.followersCount ?? null
}

// Busca o número atual de seguidores de cada conta do Instagram do usuário,
// grava um snapshot de hoje para cada uma, e devolve o histórico diário
// somado entre as contas — construído a partir de hoje em diante, já que
// não há acesso ao histórico retroativo da rede social.
async function buscarSeriesSeguidoresInstagram(userId, isAdmin) {
  const tokens = await listarContasToken('instagram', userId, isAdmin)

  await Promise.allSettled(tokens.map(async t => {
    const followerCount = t.zernioAccountId
      ? await metricsSeguidoresAtuaisInstagramZernio(t.zernioAccountId)
      : await metricsSeguidoresAtuaisInstagram({ accessToken: t.accessToken })
    if (followerCount != null) await contasRepo.registrarSnapshotSeguidoresInstagram(t.contaId, followerCount)
  }))

  const historico = await contasRepo.buscarHistoricoSeguidoresInstagram(userId, isAdmin)
  return Object.fromEntries(historico.map(h => [h.date.toISOString().slice(0, 10), { followerCount: h.followerCount }]))
}

// Demografia atual dos seguidores do Instagram (não é série histórica — a
// API só devolve a "foto" de agora, sem retroativo). A métrica
// follower_demographics exige metric_type=total_value + um único breakdown
// por chamada, então busca gender/age, country e city em paralelo. Requer o
// escopo instagram_business_manage_insights (já pedido no OAuth, ver
// src/routes/oauth.js) — contas conectadas antes desse escopo existir
// recebem 403/"nonexisting field" aqui, e a demografia fica vazia.
async function metricsDemografiaBreakdownInstagram(token, breakdown) {
  const url = `https://graph.instagram.com/v19.0/me/insights?metric=follower_demographics&period=lifetime&metric_type=total_value&breakdown=${breakdown}&access_token=${encodeURIComponent(token.accessToken)}`
  const res = await fetchComTimeout(url)
  const data = await res.json()
  if (!res.ok) return []
  const results = data.data?.[0]?.total_value?.breakdowns?.[0]?.results || []
  return results.map(r => ({ dimensionValues: r.dimension_values, value: r.value }))
}

async function metricsDemografiaAtualInstagram(token) {
  const [ageGender, country, city] = await Promise.all([
    metricsDemografiaBreakdownInstagram(token, 'age,gender'),
    metricsDemografiaBreakdownInstagram(token, 'country'),
    metricsDemografiaBreakdownInstagram(token, 'city'),
  ])
  return {
    ageGender: ageGender.map(r => ({ age: r.dimensionValues[0], gender: r.dimensionValues[1], value: r.value })),
    country: country.map(r => ({ country: r.dimensionValues[0], value: r.value })),
    city: city.map(r => ({ city: r.dimensionValues[0], value: r.value })),
  }
}

// Demografia combinada de todas as contas do Instagram do usuário — soma os
// valores de cada dimensão entre contas (mesmo padrão de soma usado nas
// séries de seguidores). Falha silenciosa por conta (token sem o escopo,
// revogado etc.) — o resultado só reflete as contas que responderam.
// Contas migradas para o Zernio sempre falham aqui (accessToken não é mais
// um token real da Graph API) e o Zernio não expõe demografia de seguidores
// no objeto de conta — fica sem essa métrica até o Zernio adicionar suporte
// equivalente. Não é crítico: a tela já trata ausência de demografia como
// estado normal.
async function buscarDemografiaInstagram(userId, isAdmin) {
  const tokens = await listarContasToken('instagram', userId, isAdmin)
  const resultados = await Promise.allSettled(
    tokens.map(t => metricsDemografiaAtualInstagram({ accessToken: t.accessToken }))
  )
  const sucesso = resultados.filter(r => r.status === 'fulfilled').map(r => r.value)
  if (!sucesso.length) return null

  function somarPorDimensao(campo, chaves) {
    const acc = new Map()
    for (const d of sucesso) {
      for (const item of d[campo]) {
        const key = chaves.map(k => item[k]).join('|')
        acc.set(key, (acc.get(key) || 0) + item.value)
      }
    }
    return [...acc.entries()].map(([key, value]) => {
      const partes = key.split('|')
      return { ...Object.fromEntries(chaves.map((k, i) => [k, partes[i]])), value }
    })
  }

  return {
    ageGender: somarPorDimensao('ageGender', ['age', 'gender']),
    country: somarPorDimensao('country', ['country']),
    city: somarPorDimensao('city', ['city']),
  }
}

// Estatísticas atuais de uma conta do TikTok (seguidores, curtidas
// recebidas no total, número de vídeos). Contas migradas para o Zernio
// (docs.zernio.com) não têm mais um access_token real da Content Posting
// API — token.accessToken é o accountId do Zernio — então busca via
// GET /v1/accounts, que já traz followersCount/likesCount/videoCount
// prontos (sem precisar de scope user.info.stats próprio). Contas ainda na
// integração direta (não reconectadas) continuam pela Content Posting API.
async function metricsStatsAtuaisTiktokZernio(zernioAccountId) {
  const { accounts } = await zernioClient.listAccounts()
  const conta = accounts.find(a => a._id === zernioAccountId)
  if (!conta) throw new Error('Conta TikTok não encontrada no Zernio')
  const extra = conta.metadata?.profileData?.extraData || {}
  return {
    followerCount: conta.followersCount ?? conta.metadata?.profileData?.followersCount ?? null,
    likesCount: extra.likesCount ?? null,
    videoCount: extra.videoCount ?? null
  }
}

async function metricsStatsAtuaisTiktok(token) {
  const url = 'https://open.tiktokapis.com/v2/user/info/?fields=follower_count,likes_count,video_count'
  const res = await fetchComTimeout(url, { headers: { Authorization: `Bearer ${token.accessToken}` } })
  const data = await res.json()
  if (!res.ok || data.error?.code !== 'ok') throw new Error(data?.error?.message || `TikTok respondeu ${res.status}`)
  const user = data.data?.user || {}
  return { followerCount: user.follower_count ?? null, likesCount: user.likes_count ?? null, videoCount: user.video_count ?? null }
}

// Número atual de inscritos de um canal do YouTube (Data API v3,
// channels?part=statistics). Usa o mesmo scope youtube.readonly já
// concedido pelas contas conectadas — não exige novo consentimento.
async function metricsInscritosAtuaisYoutube(token) {
  const url = 'https://www.googleapis.com/youtube/v3/channels?part=statistics&mine=true'
  const res = await fetchComTimeout(url, { headers: { Authorization: `Bearer ${token.accessToken}` } })
  const data = await res.json()
  if (!res.ok) throw new Error(data?.error?.message || `YouTube respondeu ${res.status}`)
  const stats = data.items?.[0]?.statistics
  return stats?.subscriberCount != null ? Number(stats.subscriberCount) : null
}

async function metricsInscritosAtuaisYoutubeZernio(zernioAccountId) {
  const { accounts } = await zernioClient.listAccounts()
  const conta = accounts.find(a => a._id === zernioAccountId)
  if (!conta) throw new Error('Canal YouTube não encontrado no Zernio')
  return conta.subscriberCount
    ?? conta.subscribersCount
    ?? conta.followersCount
    ?? conta.metadata?.profileData?.subscriberCount
    ?? conta.metadata?.profileData?.subscribersCount
    ?? null
}

async function youtubeReport(token, { metrics, dimensions, filters, since, until }) {
  const params = new URLSearchParams({
    ids: 'channel==MINE',
    startDate: since,
    endDate: until,
    metrics: metrics.join(',')
  })
  if (dimensions) params.set('dimensions', dimensions)
  if (filters) params.set('filters', filters)

  const res = await fetchComTimeout(`https://youtubeanalytics.googleapis.com/v2/reports?${params}`, {
    headers: { Authorization: `Bearer ${token.accessToken}` }
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data?.error?.message || `YouTube Analytics respondeu ${res.status}`)
  return data
}

function reportRows(data) {
  const headers = data?.columnHeaders || []
  return (data?.rows || []).map(row => Object.fromEntries(headers.map((header, index) => [header.name, row[index]])))
}

function reportMetricMap(data, dateDimension = null) {
  const headers = data?.columnHeaders || []
  const metricNames = headers.filter(header => header.columnType === 'METRIC').map(header => header.name)
  const rows = reportRows(data)
  return Object.fromEntries(metricNames.map(name => {
    const values = dateDimension
      ? rows.map(row => ({ date: row[dateDimension], value: Number(row[name]) || 0 })).filter(item => item.date)
      : []
    const total = rows.reduce((sum, row) => sum + (Number(row[name]) || 0), 0)
    return [name, { total, values }]
  }))
}

// O YouTube Analytics API permite consultar várias famílias de relatório
// usando a mesma credencial. Relatórios opcionais falham isoladamente para
// que falta de monetização/dados demográficos não esconda os números básicos.
async function buscarInsightsYoutube(userId, isAdmin, { since, until }) {
  const tokens = await listarContasToken('youtube', userId, isAdmin)
  const accounts = await Promise.all(tokens.map(async token => {
    const base = {
      localAccountId: token.contaId,
      accountName: token.accountName || token.handle || null,
      platform: 'youtube',
      dateRange: { since, until },
      metrics: {},
      reports: {},
      errors: []
    }

    const reports = {
      daily: { metrics: ['views', 'engagedViews', 'likes', 'comments', 'shares', 'dislikes', 'estimatedMinutesWatched', 'averageViewDuration', 'averageViewPercentage', 'subscribersGained', 'subscribersLost'], dimensions: 'day', dateDimension: 'day' },
      demographics: { metrics: ['viewerPercentage'], dimensions: 'ageGroup,gender' },
      countries: { metrics: ['views', 'viewerPercentage'], dimensions: 'country' },
      trafficSources: { metrics: ['views', 'estimatedMinutesWatched'], dimensions: 'insightTrafficSourceType' },
      playbackLocations: { metrics: ['views', 'estimatedMinutesWatched'], dimensions: 'insightPlaybackLocationType' },
      subscribedStatus: { metrics: ['views', 'estimatedMinutesWatched'], dimensions: 'subscribedStatus' },
      contentTypes: { metrics: ['views', 'estimatedMinutesWatched'], dimensions: 'creatorContentType' },
      revenue: { metrics: ['estimatedRevenue', 'grossRevenue', 'estimatedAdRevenue', 'monetizedPlaybacks', 'cpm', 'playbackBasedCpm'] }
    }

    await Promise.all(Object.entries(reports).map(async ([name, config]) => {
      try {
        if (token.zernioAccountId) return
        const result = await youtubeReport(token, { ...config, since, until })
        base.reports[name] = { headers: result.columnHeaders || [], rows: reportRows(result) }
        const metricMap = reportMetricMap(result, config.dateDimension)
        if (name === 'daily') base.metrics = metricMap
        else if (Object.keys(metricMap).length) base.reports[name].metrics = metricMap
      } catch (error) {
        base.errors.push({ scope: name, message: error.message })
      }
    }))

    return base
  }))

  return {
    dateRange: { since, until },
    capabilities: {
      available: [
        'views', 'engagedViews', 'likes', 'comments', 'shares', 'dislikes',
        'estimatedMinutesWatched', 'averageViewDuration', 'averageViewPercentage',
        'subscribersGained', 'subscribersLost', 'viewerPercentage',
        'trafficSources', 'playbackLocations', 'subscribedStatus', 'contentTypes',
        'estimatedRevenue', 'grossRevenue', 'estimatedAdRevenue', 'monetizedPlaybacks',
        'cpm', 'playbackBasedCpm'
      ],
      unavailable: ['impressions', 'impressionsClickThroughRate']
    },
    accounts
  }
}

// Demografia dos últimos 28 dias de audiência do canal (viewerPercentage) —
// a Analytics API não expõe demografia de INSCRITOS, só de espectadores dos
// vídeos, então isto é "quem assistiu", não "quem seguiu" (mesma limitação
// que o próprio YouTube Studio expõe). Usa o scope yt-analytics.readonly já
// concedido (ver src/routes/oauth.js) — sem escopo novo.
async function metricsDemografiaYoutube(token) {
  const endDate = new Date().toISOString().slice(0, 10)
  const startDate = new Date(Date.now() - 28 * 86400000).toISOString().slice(0, 10)
  const headers = { Authorization: `Bearer ${token.accessToken}` }

  async function relatorio(dimensions) {
    const url = `https://youtubeanalytics.googleapis.com/v2/reports` +
      `?ids=channel==MINE&startDate=${startDate}&endDate=${endDate}` +
      `&metrics=viewerPercentage&dimensions=${dimensions}&sort=-viewerPercentage`
    const res = await fetchComTimeout(url, { headers })
    const data = await res.json()
    if (!res.ok) return []
    return data.rows || []
  }

  const [ageGenderRows, countryRows] = await Promise.all([
    relatorio('ageGroup,gender'),
    relatorio('country'),
  ])

  return {
    ageGender: ageGenderRows.map(([age, gender, value]) => ({ age, gender, value })),
    country: countryRows.map(([country, value]) => ({ country, value })),
  }
}

// Demografia combinada de todos os canais do usuário — soma os percentuais
// (aproximação: pondera igual entre canais; suficiente para exibição, não
// para análise estatística fina). Falha silenciosa por canal.
async function buscarDemografiaYoutube(userId, isAdmin) {
  const tokens = await listarContasToken('youtube', userId, isAdmin)
  const resultados = await Promise.allSettled(
    tokens.map(t => metricsDemografiaYoutube({ accessToken: t.accessToken }))
  )
  const sucesso = resultados.filter(r => r.status === 'fulfilled').map(r => r.value)
  if (!sucesso.length) return null

  function somarPorDimensao(campo, chaves) {
    const acc = new Map()
    for (const d of sucesso) {
      for (const item of d[campo]) {
        const key = chaves.map(k => item[k]).join('|')
        acc.set(key, (acc.get(key) || 0) + item.value)
      }
    }
    return [...acc.entries()].map(([key, value]) => {
      const partes = key.split('|')
      return { ...Object.fromEntries(chaves.map((k, i) => [k, partes[i]])), value }
    })
  }

  return {
    ageGender: somarPorDimensao('ageGender', ['age', 'gender']),
    country: somarPorDimensao('country', ['country']),
  }
}

// Busca o número atual de inscritos de cada canal do YouTube do usuário,
// grava um snapshot de hoje para cada um, e devolve o histórico diário
// somado entre as contas — construído a partir de hoje em diante, sem
// retroativo (mesmo padrão do Instagram/TikTok).
async function buscarSeriesInscritosYoutube(userId, isAdmin) {
  const tokens = await listarContasToken('youtube', userId, isAdmin)

  await Promise.allSettled(tokens.map(async t => {
    const subscriberCount = t.zernioAccountId
      ? await metricsInscritosAtuaisYoutubeZernio(t.zernioAccountId)
      : await metricsInscritosAtuaisYoutube({ accessToken: t.accessToken })
    if (subscriberCount != null) await contasRepo.registrarSnapshotSeguidoresYoutube(t.contaId, subscriberCount)
  }))

  const historico = await contasRepo.buscarHistoricoSeguidoresYoutube(userId, isAdmin)
  return Object.fromEntries(historico.map(h => [h.date.toISOString().slice(0, 10), { subscriberCount: h.subscriberCount }]))
}

// Busca as estatísticas atuais de cada conta do TikTok do usuário, grava um
// snapshot de hoje para cada uma, e devolve o histórico diário somado entre
// as contas — construído a partir de hoje em diante, sem retroativo.
async function buscarSeriesStatsTiktok(userId, isAdmin) {
  const tokens = await listarContasToken('tiktok', userId, isAdmin)

  await Promise.allSettled(tokens.map(async t => {
    const stats = t.zernioAccountId
      ? await metricsStatsAtuaisTiktokZernio(t.zernioAccountId)
      : await metricsStatsAtuaisTiktok({ accessToken: t.accessToken })
    await contasRepo.registrarSnapshotStatsTiktok(t.contaId, stats)
  }))

  const historico = await contasRepo.buscarHistoricoStatsTiktok(userId, isAdmin)
  return Object.fromEntries(historico.map(h => [h.date.toISOString().slice(0, 10), { followerCount: h.followerCount, likesCount: h.likesCount }]))
}

// Mesma lista de vídeos, mas para contas migradas para o Zernio — via
// GET /v1/analytics, devolvendo o catálogo que o Zernio já sincronizou para
// a conta. O filtro local continua necessário porque a tela exibe várias
// contas e a API pode retornar posts de mais de uma publicação.
async function metricsVideosTiktokZernio(zernioAccountId) {
  const { posts } = await zernioClient.getAnalytics()
  const videos = []
  for (const post of posts) {
    const plataforma = post.platforms?.find(p => p.platform === 'tiktok' && p.accountId === zernioAccountId)
    if (!plataforma) continue
    const a = plataforma.analytics || {}
    videos.push({
      id: plataforma.platformPostId,
      title: post.content || '',
      coverImageUrl: post.thumbnailUrl || null,
      shareUrl: plataforma.platformPostUrl || null,
      createTime: post.publishedAt ? Math.floor(new Date(post.publishedAt).getTime() / 1000) : null,
      viewCount: a.views ?? null,
      likeCount: a.likes ?? null,
      commentCount: a.comments ?? null,
      shareCount: a.shares ?? null
    })
  }
  return { videos, cursor: null, hasMore: false }
}

// Lista os vídeos publicados na conta do TikTok (mais recentes primeiro),
// usado para exibir o histórico de posts diretamente no nosso painel sem
// precisar abrir o app do TikTok. Exige o scope video.list.
async function metricsVideosTiktok(token, cursor) {
  const url = 'https://open.tiktokapis.com/v2/video/list/?fields=id,title,cover_image_url,share_url,create_time,view_count,like_count,comment_count,share_count'
  const res = await fetchComTimeout(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token.accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ max_count: 20, ...(cursor ? { cursor } : {}) })
  })
  const data = await res.json()
  if (!res.ok || data.error?.code !== 'ok') throw new Error(data?.error?.message || `TikTok respondeu ${res.status}`)
  return {
    videos: (data.data?.videos || []).map(v => ({
      id: v.id,
      title: v.title,
      coverImageUrl: v.cover_image_url,
      shareUrl: v.share_url,
      createTime: v.create_time,
      viewCount: v.view_count,
      likeCount: v.like_count,
      commentCount: v.comment_count,
      shareCount: v.share_count
    })),
    cursor: data.data?.cursor ?? null,
    hasMore: data.data?.has_more ?? false
  }
}

// Busca os vídeos publicados em cada conta do TikTok do usuário e devolve a
// lista combinada (mais recentes primeiro), com o nome da conta de origem.
async function buscarVideosTiktok(userId, isAdmin) {
  const tokens = await listarContasToken('tiktok', userId, isAdmin)

  const resultados = await Promise.allSettled(
    tokens.map(async t => {
      const { videos } = t.zernioAccountId
        ? await metricsVideosTiktokZernio(t.zernioAccountId)
        : await metricsVideosTiktok({ accessToken: t.accessToken })
      return videos.map(v => ({ ...v, accountId: t.contaId, accountName: t.accountName }))
    })
  )

  return resultados
    .filter(r => r.status === 'fulfilled')
    .flatMap(r => r.value)
    .sort((a, b) => b.createTime - a.createTime)
}

// Histórico fornecido pelo provedor para a tela de detalhe do post. O
// snapshot local continua sendo retornado junto, pois cobre posts antigos e
// redes que não usam Zernio.
async function buscarHistoricoPostZernio(publications, userId, isAdmin) {
  const results = await Promise.allSettled(publications.map(async publication => {
    if (!['facebook', 'instagram', 'tiktok', 'youtube'].includes(publication.platform)) return null
    const token = await buscarContaToken(publication.platform, userId, isAdmin, publication.accountId)
    if (!token?.zernioAccountId) return null
    const timeline = await zernioClient.getPostTimeline({
      postId: publication.externalPostId
    })
    return {
      platform: publication.platform,
      externalPostId: publication.externalPostId,
      accountId: publication.accountId,
      timeline
    }
  }))
  return results.filter(result => result.status === 'fulfilled' && result.value).map(result => result.value)
}

module.exports = {
  buscarMetricasPost, buscarSeriesSeguidoresInstagram, buscarSeriesStatsTiktok, buscarVideosTiktok, buscarSeriesInscritosYoutube,
  buscarDemografiaInstagram, buscarDemografiaYoutube, buscarInsightsYoutube, buscarHistoricoPostZernio, PLATAFORMAS_COM_METRICAS
}
