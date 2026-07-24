const { buscarContaToken, listarContasToken } = require('../infra/social/publisher')
const contasRepo = require('../repositories/contasRepository')
const tokensRepo = require('../repositories/tokensRepository')

// Access tokens do Google (YouTube) expiram em ~1h. Se o token estiver
// expirado (ou prestes a expirar) na hora de buscar métricas, a Data API e a
// Analytics API respondem 401 e o post fica "sem métricas" no Analytics. Uma
// margem de segurança evita usar um token que expira no meio da chamada.
const TOKEN_EXPIRY_MARGIN_MS = 2 * 60 * 1000

// Plataformas com API de métricas acessível com os escopos já usados na conexão.
// TikTok (sem ID público de vídeo) não é suportado. LinkedIn de perfil pessoal
// também não — analytics de post individual não é exposto na API aberta para
// apps comuns (só Company Pages, fora de escopo — ver guia de referência Cap. 5.4).
const PLATAFORMAS_COM_METRICAS = ['facebook', 'instagram', 'youtube', 'threads', 'pinterest', 'x']

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
  const insightsUrl = `https://graph.instagram.com/v19.0/${encodeURIComponent(externalPostId)}/insights?metric=views&access_token=${encodeURIComponent(token.accessToken)}`

  // likes/comments e views são endpoints independentes — busca em paralelo em vez
  // de sequencial, já que um não depende do resultado do outro.
  const [res, viewsResult] = await Promise.all([
    fetchComTimeout(url),
    fetchComTimeout(insightsUrl).then(async r => ({ ok: r.ok, data: await r.json() })).catch(() => null)
  ])
  const data = await res.json()
  if (!res.ok) throw new Error(data?.error?.message || `Instagram respondeu ${res.status}`)

  const views = viewsResult?.ok ? (viewsResult.data.data?.[0]?.values?.[0]?.value ?? null) : null

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

  // Estatísticas básicas (Data API) e tempo médio de visualização (Analytics API)
  // são chamadas a APIs distintas e independentes — busca em paralelo.
  const [res, watchTimeSeconds] = await Promise.all([
    fetchComTimeout(url, { headers: { Authorization: `Bearer ${token.accessToken}` } }),
    metricsYoutubeWatchTime(token, externalPostId)
  ])
  const data = await res.json()
  if (!res.ok) throw new Error(data?.error?.message || `YouTube respondeu ${res.status}`)
  const stats = data.items?.[0]?.statistics
  if (!stats) return { likes: null, comments: null, views: null, watchTimeSeconds }
  return {
    likes: Number(stats.likeCount) || 0,
    comments: Number(stats.commentCount) || 0,
    views: Number(stats.viewCount) || 0,
    watchTimeSeconds
  }
}

// Threads Insights — views, likes, replies, reposts, quotes por post. Exige o
// escopo threads_manage_insights (pedido no OAuth, ver src/routes/oauth.js).
async function metricsThreads(token, externalPostId) {
  const url = `https://graph.threads.net/v1.0/${encodeURIComponent(externalPostId)}/insights` +
    `?metric=views,likes,replies,reposts,quotes&access_token=${encodeURIComponent(token.accessToken)}`
  const res = await fetchComTimeout(url)
  const data = await res.json()
  if (!res.ok) throw new Error(data?.error?.message || `Threads respondeu ${res.status}`)

  const valores = Object.fromEntries((data.data || []).map(m => [m.name, m.values?.[0]?.value ?? m.total_value?.value ?? null]))
  return { likes: valores.likes ?? null, comments: valores.replies ?? null, views: valores.views ?? null }
}

// Pinterest Pin Analytics — impressões, saves, cliques dos últimos 30 dias
// (a API v5 exige um intervalo de datas explícito, não devolve "total").
async function metricsPinterest(token, externalPostId) {
  const endDate = new Date().toISOString().slice(0, 10)
  const startDate = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)
  const url = `https://api.pinterest.com/v5/pins/${encodeURIComponent(externalPostId)}/analytics` +
    `?start_date=${startDate}&end_date=${endDate}&metric_types=IMPRESSION,SAVE,PIN_CLICK`
  const res = await fetchComTimeout(url, { headers: { Authorization: `Bearer ${token.accessToken}` } })
  const data = await res.json()
  if (!res.ok) throw new Error(data?.message || `Pinterest respondeu ${res.status}`)

  const totais = data.all?.summary_metrics || {}
  // Pinterest não tem conceito de "curtida"/"comentário" no mesmo sentido das
  // outras redes — mapeia saves→likes (métrica de engajamento mais próxima)
  // e cliques como "views" (aproximação, documentada aqui para não confundir
  // com visualizações de vídeo de outras redes).
  return { likes: totais.SAVE ?? null, comments: null, views: totais.IMPRESSION ?? null, clicks: totais.PIN_CLICK ?? null }
}

// X: leitura de métricas é paga (non_public_metrics exige o mesmo billing do
// pay-per-use, ver guia de referência Cap. 8) — usado com moderação, só
// quando o usuário abre o Analytics de um post específico.
async function metricsX(token, externalPostId) {
  const url = `https://api.twitter.com/2/tweets/${encodeURIComponent(externalPostId)}?tweet.fields=public_metrics`
  const res = await fetchComTimeout(url, { headers: { Authorization: `Bearer ${token.accessToken}` } })
  const data = await res.json()
  if (!res.ok) throw new Error(data?.detail || `X respondeu ${res.status}`)

  const m = data.data?.public_metrics || {}
  return { likes: m.like_count ?? null, comments: m.reply_count ?? null, views: m.impression_count ?? null }
}

const METRIC_FETCHERS = {
  facebook: metricsFacebook,
  instagram: metricsInstagram,
  youtube: metricsYoutube,
  threads: metricsThreads,
  pinterest: metricsPinterest,
  x: metricsX
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
    const subscriberCount = await metricsInscritosAtuaisYoutube({ accessToken: t.accessToken })
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
    const stats = await metricsStatsAtuaisTiktok({ accessToken: t.accessToken })
    await contasRepo.registrarSnapshotStatsTiktok(t.contaId, stats)
  }))

  const historico = await contasRepo.buscarHistoricoStatsTiktok(userId, isAdmin)
  return Object.fromEntries(historico.map(h => [h.date.toISOString().slice(0, 10), { followerCount: h.followerCount, likesCount: h.likesCount }]))
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
      const { videos } = await metricsVideosTiktok({ accessToken: t.accessToken })
      return videos.map(v => ({ ...v, accountId: t.contaId, accountName: t.accountName }))
    })
  )

  return resultados
    .filter(r => r.status === 'fulfilled')
    .flatMap(r => r.value)
    .sort((a, b) => b.createTime - a.createTime)
}

module.exports = {
  buscarMetricasPost, buscarSeriesSeguidoresInstagram, buscarSeriesStatsTiktok, buscarVideosTiktok, buscarSeriesInscritosYoutube,
  buscarDemografiaInstagram, buscarDemografiaYoutube, PLATAFORMAS_COM_METRICAS
}
