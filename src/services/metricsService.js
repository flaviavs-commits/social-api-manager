const { buscarContaToken, listarContasToken } = require('./publisher')
const contasRepo = require('../repositories/contasRepository')

// Plataformas com API de métricas acessível com os escopos já usados na conexão.
// TikTok (sem ID público de vídeo) e Kwai (sem API pública) não são suportados.
const PLATAFORMAS_COM_METRICAS = ['facebook', 'instagram', 'youtube']

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

// Facebook não expõe visualizações para posts comuns de feed (foto/texto) no
// Graph API público — só vídeo, via Insights API com a permissão extra
// read_insights, que a conexão atual não solicita. Por isso views fica null
// aqui, em vez de inventar um número.
async function metricsFacebook(token, externalPostId) {
  const url = `https://graph.facebook.com/v19.0/${encodeURIComponent(externalPostId)}?fields=likes.summary(true),comments.summary(true)&access_token=${encodeURIComponent(token.accessToken)}`
  const res = await fetchComTimeout(url)
  const data = await res.json()
  if (!res.ok) throw new Error(data?.error?.message || `Facebook respondeu ${res.status}`)
  return { likes: data.likes?.summary?.total_count ?? null, comments: data.comments?.summary?.total_count ?? null, views: null }
}

// O Instagram descontinuou os campos diretos "impressions"/"plays" no objeto
// da mídia (Graph API v19+ retorna "Tried accessing nonexisting field").
// Visualizações de qualquer tipo de mídia (foto, carrossel, vídeo, Reels)
// agora só ficam disponíveis pelo endpoint de Insights, com a métrica
// "views" — que por sua vez exige o escopo instagram_business_manage_insights
// na conexão OAuth (contas conectadas antes dessa permissão existir
// precisam ser reconectadas; até lá, a chamada abaixo retorna 403 e views
// fica null).
async function metricsInstagram(token, externalPostId) {
  const url = `https://graph.instagram.com/v19.0/${encodeURIComponent(externalPostId)}?fields=like_count,comments_count&access_token=${encodeURIComponent(token.accessToken)}`
  const res = await fetchComTimeout(url)
  const data = await res.json()
  if (!res.ok) throw new Error(data?.error?.message || `Instagram respondeu ${res.status}`)

  let views = null
  try {
    const insightsUrl = `https://graph.instagram.com/v19.0/${encodeURIComponent(externalPostId)}/insights?metric=views&access_token=${encodeURIComponent(token.accessToken)}`
    const insightsRes = await fetchComTimeout(insightsUrl)
    const insightsData = await insightsRes.json()
    if (insightsRes.ok) views = insightsData.data?.[0]?.values?.[0]?.value ?? null
  } catch {
    views = null
  }

  return { likes: data.like_count ?? null, comments: data.comments_count ?? null, views }
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

async function metricsYoutube(token, externalPostId) {
  const url = `https://www.googleapis.com/youtube/v3/videos?part=statistics&id=${encodeURIComponent(externalPostId)}`
  const res = await fetchComTimeout(url, { headers: { Authorization: `Bearer ${token.accessToken}` } })
  const data = await res.json()
  if (!res.ok) throw new Error(data?.error?.message || `YouTube respondeu ${res.status}`)
  const stats = data.items?.[0]?.statistics
  const watchTimeSeconds = await metricsYoutubeWatchTime(token, externalPostId)
  if (!stats) return { likes: null, comments: null, views: null, watchTimeSeconds }
  return {
    likes: Number(stats.likeCount) || 0,
    comments: Number(stats.commentCount) || 0,
    views: Number(stats.viewCount) || 0,
    watchTimeSeconds
  }
}

const METRIC_FETCHERS = {
  facebook: metricsFacebook,
  instagram: metricsInstagram,
  youtube: metricsYoutube
}

// Busca likes/comentários reais de um post já publicado. Retorna null
// (métrica indisponível) se a plataforma não suportar, faltar o ID externo,
// a conta não estiver mais conectada, ou a chamada à API falhar (token
// revogado, post removido na rede, permissão insuficiente, rate limit etc.).
async function buscarMetricasPost(post) {
  if (!post.externalPostId || !post.externalPlatform) return null
  if (!PLATAFORMAS_COM_METRICAS.includes(post.externalPlatform)) return null

  const isSuperAdmin = post.userRole === 'super_admin'
  const token = await buscarContaToken(post.externalPlatform, post.userId, isSuperAdmin, post.accountId)
  if (!token) return null

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

// Busca o número atual de seguidores de cada conta do Instagram do usuário,
// grava um snapshot de hoje para cada uma, e devolve o histórico diário
// somado entre as contas — construído a partir de hoje em diante, já que
// não há acesso ao histórico retroativo da rede social.
async function buscarSeriesSeguidoresInstagram(userId, isAdmin) {
  const tokens = await listarContasToken('instagram', userId, isAdmin)

  await Promise.allSettled(tokens.map(async t => {
    const followerCount = await metricsSeguidoresAtuaisInstagram({ accessToken: t.accessToken })
    if (followerCount != null) await contasRepo.registrarSnapshotSeguidoresInstagram(t.contaId, followerCount)
  }))

  const historico = await contasRepo.buscarHistoricoSeguidoresInstagram(userId, isAdmin)
  return Object.fromEntries(historico.map(h => [h.date.toISOString().slice(0, 10), { followerCount: h.followerCount }]))
}

// Estatísticas atuais de uma conta do TikTok (seguidores, curtidas
// recebidas no total, número de vídeos). Exige o scope user.info.stats —
// contas conectadas antes desse scope existir recebem 403 aqui.
async function metricsStatsAtuaisTiktok(token) {
  const url = 'https://open.tiktokapis.com/v2/user/info/?fields=follower_count,likes_count,video_count'
  const res = await fetchComTimeout(url, { headers: { Authorization: `Bearer ${token.accessToken}` } })
  const data = await res.json()
  if (!res.ok || data.error?.code !== 'ok') throw new Error(data?.error?.message || `TikTok respondeu ${res.status}`)
  const user = data.data?.user || {}
  return { followerCount: user.follower_count ?? null, likesCount: user.likes_count ?? null, videoCount: user.video_count ?? null }
}

// Busca as estatísticas atuais de cada conta do TikTok do usuário, grava um
// snapshot de hoje para cada uma, e devolve o histórico diário somado entre
// as contas — construído a partir de hoje em diante, sem retroativo.
async function buscarSeriesStatsTiktok(userId, isAdmin) {
  const tokens = await listarContasToken('tiktok', userId, isAdmin)

  await Promise.allSettled(tokens.map(async t => {
    const stats = await metricsStatsAtuaisTiktok({ accessToken: t.accessToken })
    await contasRepo.registrarSnapshotStatsTiktok(t.contaId, stats)
  }))

  const historico = await contasRepo.buscarHistoricoStatsTiktok(userId, isAdmin)
  return Object.fromEntries(historico.map(h => [h.date.toISOString().slice(0, 10), { followerCount: h.followerCount, likesCount: h.likesCount }]))
}

module.exports = { buscarMetricasPost, buscarSeriesSeguidoresInstagram, buscarSeriesStatsTiktok, PLATAFORMAS_COM_METRICAS }
