const postsRepo = require('../../infra/db/postsRepository')
const metricsService = require('../../services/metricsService')
const instagramReconcileService = require('../../services/instagramReconcileService')

// Métricas reais só existem para publicações com external_post_id, ou seja,
// feitas a partir desta funcionalidade. Um post pode ter sido publicado em
// várias redes (uma linha por rede em post_publications) — busca métricas de
// CADA rede para que todas apareçam no Analytics, não só uma por post.
// Limita ao total de chamadas (não de posts) para não disparar uma chamada de
// API externa por rede em contas com muito histórico.
const MAX_PUBLICACOES_COM_METRICAS = 30

async function buscarAnalytics({ userId, userRole, isAdmin }) {
  // Tenta recuperar o ID externo de posts antigos do Instagram (publicados
  // antes de existir essa coluna), casando com os posts reais da conta por
  // data/texto. Roda antes de listar para que esses posts já apareçam com
  // métricas nesta mesma chamada. Falha silenciosa: se a API do Instagram
  // estiver fora ou sem permissão, o Analytics continua funcionando
  // normalmente só com os posts que já tinham o ID salvo.
  try {
    await instagramReconcileService.reconciliarPostsInstagram(userId, isAdmin)
  } catch {}

  const posts = await postsRepo.listarPosts({ status: 'published', userId, isAdmin })

  // Série diária por plataforma, a partir da data real de publicação (cai
  // para a data de criação se publishedAt ainda não tiver sido salvo).
  const porDia = {}
  for (const p of posts) {
    const base = p.publishedAt || p.criado_em
    const dia = new Date(base).toISOString().slice(0, 10)
    porDia[dia] = porDia[dia] || {}
    for (const plat of p.platforms) {
      porDia[dia][plat] = (porDia[dia][plat] || 0) + 1
    }
  }

  const postById = new Map(posts.map(p => [p.id, p]))
  const publicacoes = (await postsRepo.listarPublicacoesDosPosts(posts.map(p => p.id)))
    .filter(pub => postById.has(pub.postId))
    .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt))
    .slice(0, MAX_PUBLICACOES_COM_METRICAS)

  const metricsResults = await Promise.allSettled(
    publicacoes.map(pub => {
      const p = postById.get(pub.postId)
      return metricsService.buscarMetricasPost({
        ...p,
        externalPostId: pub.externalPostId,
        externalPlatform: pub.platform,
        userRole
      })
    })
  )

  const metrics = publicacoes.map((pub, i) => {
    const p = postById.get(pub.postId)
    return {
      postId: p.id,
      platform: pub.platform,
      text: p.text,
      publishedAt: pub.publishedAt || p.publishedAt,
      mediaPath: p.mediaPath,
      mediaType: p.mediaType,
      mediaItems: p.mediaItems,
      metrics: metricsResults[i].status === 'fulfilled' ? metricsResults[i].value : null
    }
  })

  // Grava um ponto por dia no histórico de cada (post, rede) (best-effort —
  // não bloqueia a resposta do Analytics se a escrita falhar).
  await Promise.allSettled(
    metrics.filter(m => m.metrics).map(m => postsRepo.registrarSnapshotMetricas(m.postId, m.platform, m.metrics))
  )

  // Saldo de seguidores e alcance do Instagram + TikTok + YouTube em paralelo
  // — métricas de conta, não de post. Falha silenciosa por plataforma.
  const [igResult, ttResult, ytResult] = await Promise.allSettled([
    metricsService.buscarSeriesSeguidoresInstagram(userId, isAdmin),
    metricsService.buscarSeriesStatsTiktok(userId, isAdmin),
    metricsService.buscarSeriesInscritosYoutube(userId, isAdmin),
  ])
  const instagramFollowers = igResult.status === 'fulfilled' ? igResult.value : {}
  const tiktokStats = ttResult.status === 'fulfilled' ? ttResult.value : {}
  const youtubeSubscribers = ytResult.status === 'fulfilled' ? ytResult.value : {}

  return { series: porDia, metrics, instagramFollowers, tiktokStats, youtubeSubscribers }
}

async function buscarMetricsHistory({ id, userId, isAdmin }) {
  const post = await postsRepo.buscarPostPorId(id, userId, isAdmin)
  if (!post) return null
  return postsRepo.buscarHistoricoMetricas(id)
}

module.exports = { buscarAnalytics, buscarMetricsHistory }
