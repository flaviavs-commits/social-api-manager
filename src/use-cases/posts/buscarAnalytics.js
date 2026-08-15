const postsRepo = require('../../infra/db/postsRepository')
const metricsService = require('../../services/metricsService')
const accountAnalyticsService = require('../../services/accountAnalyticsService')
const instagramReconcileService = require('../../services/instagramReconcileService')

// Métricas reais só existem para publicações com external_post_id, ou seja,
// feitas a partir desta funcionalidade. Um post pode ter sido publicado em
// várias redes (uma linha por rede em post_publications) — busca métricas de
// CADA rede para que todas apareçam no Analytics, não só uma por post.
// As chamadas são feitas em pequenos grupos. Assim cada publicação do período
// recebe uma consulta real sem abrir dezenas de conexões externas de uma vez.
const METRICAS_CONCORRENCIA = 6

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = Array(items.length)
  let nextIndex = 0

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex++
      try {
        results[index] = { status: 'fulfilled', value: await mapper(items[index], index) }
      } catch (reason) {
        results[index] = { status: 'rejected', reason }
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker())
  )
  return results
}

async function buscarAnalytics({ userId, userRole, isAdmin, days = 30 }) {
  // Tenta recuperar o ID externo de posts antigos do Instagram (publicados
  // antes de existir essa coluna), casando com os posts reais da conta por
  // data/texto. Roda antes de listar para que esses posts já apareçam com
  // métricas nesta mesma chamada. Falha silenciosa: se a API do Instagram
  // estiver fora ou sem permissão, o Analytics continua funcionando
  // normalmente só com os posts que já tinham o ID salvo.
  try {
    await instagramReconcileService.reconciliarPostsInstagram(userId, isAdmin)
  } catch {}

  const allPosts = await postsRepo.listarPosts({ status: 'published', userId, isAdmin })
  const cutoff = Date.now() - Math.max(1, Number(days) || 30) * 24 * 60 * 60 * 1000
  const posts = allPosts.filter(post => {
    const publishedAt = new Date(post.publishedAt || post.criado_em).getTime()
    return Number.isFinite(publishedAt) && publishedAt >= cutoff
  })

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
  const publicacoesRegistradas = (await postsRepo.listarPublicacoesDosPosts(posts.map(p => p.id)))
    .filter(pub => postById.has(pub.postId))
    .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt))
  const plataformasRegistradas = new Set(publicacoesRegistradas.map(pub => `${pub.postId}:${pub.platform}`))
  const publicacoes = [
    ...publicacoesRegistradas,
    ...posts.flatMap(post => (post.platforms || [])
      .filter(platform => !plataformasRegistradas.has(`${post.id}:${platform}`))
      .map(platform => ({
        postId: post.id,
        platform,
        accountId: post.accountId || null,
        externalPostId: null,
        publishedAt: post.publishedAt || post.criado_em
      })))
  ].sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt))

  const metricsResults = await mapWithConcurrency(
    publicacoes,
    METRICAS_CONCORRENCIA,
    pub => {
      const p = postById.get(pub.postId)
      return metricsService.buscarMetricasPost({
        ...p,
        accountId: pub.accountId || p.accountId,
        externalPostId: pub.externalPostId,
        externalPlatform: pub.platform,
        userRole
      })
    }
  )

  const metrics = publicacoes.map((pub, i) => {
    const p = postById.get(pub.postId)
    return {
      postId: p.id,
      platform: pub.platform,
      text: p.textByPlatform?.[pub.platform] ?? p.text,
      youtubeTitle: p.titleByPlatform?.[pub.platform] ?? p.youtubeTitle,
      publishedAt: pub.publishedAt || p.publishedAt,
      mediaPath: p.mediaPath,
      mediaType: p.mediaType,
      mediaItems: p.mediaItems,
      metrics: metricsResults[i].status === 'fulfilled' ? metricsResults[i].value : null,
      metricsStatus: pub.externalPostId ? 'unavailable' : 'missing_external_id'
    }
  })

  // Grava um ponto por dia no histórico de cada (post, rede) (best-effort —
  // não bloqueia a resposta do Analytics se a escrita falhar).
  await Promise.allSettled(
    metrics.filter(m => m.metrics).map(m => postsRepo.registrarSnapshotMetricas(m.postId, m.platform, m.metrics))
  )

  // Saldo de seguidores e alcance do Instagram + TikTok + YouTube em paralelo
  // — métricas de conta, não de post. Falha silenciosa por plataforma.
  const [igResult, ttResult, ytResult, igDemoResult, ytDemoResult, accountAnalyticsResult] = await Promise.allSettled([
    metricsService.buscarSeriesSeguidoresInstagram(userId, isAdmin),
    metricsService.buscarSeriesStatsTiktok(userId, isAdmin),
    metricsService.buscarSeriesInscritosYoutube(userId, isAdmin),
    metricsService.buscarDemografiaInstagram(userId, isAdmin),
    metricsService.buscarDemografiaYoutube(userId, isAdmin),
    accountAnalyticsService.buscarAnalyticsContas({ userId, isAdmin, days }),
  ])
  const instagramFollowers = igResult.status === 'fulfilled' ? igResult.value : {}
  const tiktokStats = ttResult.status === 'fulfilled' ? ttResult.value : {}
  const youtubeSubscribers = ytResult.status === 'fulfilled' ? ytResult.value : {}
  const instagramDemographics = igDemoResult.status === 'fulfilled' ? igDemoResult.value : null
  const youtubeDemographics = ytDemoResult.status === 'fulfilled' ? ytDemoResult.value : null
  const accountAnalytics = accountAnalyticsResult.status === 'fulfilled'
    ? accountAnalyticsResult.value
    : { dateRange: null, capabilities: {}, platforms: {}, dailyMetrics: [], contentDecay: [], bestTimeToPost: [], followerStats: null, errors: [{ scope: 'account_analytics', message: 'Não foi possível carregar os relatórios completos.' }] }

  return { series: porDia, metrics, instagramFollowers, tiktokStats, youtubeSubscribers, instagramDemographics, youtubeDemographics, accountAnalytics }
}

async function buscarMetricsHistory({ id, userId, isAdmin }) {
  const post = await postsRepo.buscarPostPorId(id, userId, isAdmin)
  if (!post) return null
  const [history, publications] = await Promise.all([
    postsRepo.buscarHistoricoMetricas(id),
    postsRepo.listarPublicacoesDosPosts([id])
  ])
  const providerTimelines = await metricsService.buscarHistoricoPostZernio(publications, userId, isAdmin)
  return { history, providerTimelines }
}

module.exports = { buscarAnalytics, buscarMetricsHistory }
