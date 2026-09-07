const pool = require('../../db/pool')
const postsRepo = require('../../infra/db/postsRepository')
const contasRepo = require('../../repositories/contasRepository')
const commentsService = require('../../services/commentsService')
const { registrarLog } = require('../../repositories/logsRepository')

const PLATFORM_LABELS = { instagram: 'Instagram', facebook: 'Facebook', youtube: 'YouTube', linkedin: 'LinkedIn', threads: 'Threads', reddit: 'Reddit', bluesky: 'Bluesky', x: 'X', twitter: 'X' }

function remotePostKey(post) {
  return `${post.externalPlatform}:${post.externalPostId}`
}

function remotePostIdentity(account, platform, externalPostId) {
  return {
    id: `remote:${platform}:${account.zernioAccountId}:${externalPostId}`,
    remote: true,
    externalPostId: String(externalPostId),
    externalPlatform: platform,
    accountId: account.id,
    zernioAccountId: String(account.zernioAccountId),
    handle: account.handle || '',
    avatarUrl: account.avatarUrl || null,
    platform,
    replySupported: commentsService.PLATAFORMAS_COM_RESPOSTA.includes(platform)
  }
}

// GET /api/posts/inbox — lista posts publicados com suporte a comentários
// (retorna metadados; comentários são carregados por demanda em /:id/comments)
async function listarInbox({ userId, isAdmin, platform = null }) {
  const all = await postsRepo.listarPosts({ status: 'published', userId, isAdmin })
  const plats = commentsService.PLATAFORMAS_COM_COMENTARIOS
  const locais = all
    .filter(p => p.externalPostId && plats.includes(p.externalPlatform))
    .filter(p => !platform || p.externalPlatform === platform)
  let remotos = []
  try {
    remotos = await commentsService.listarPostsRemotos({ userId, platform })
  } catch {
    remotos = []
  }
  const chavesLocais = new Set(locais.map(remotePostKey))
  return [...locais, ...remotos.filter(post => !chavesLocais.has(remotePostKey(post)))]
    .sort((a, b) => new Date(b.publishedAt || b.scheduledAt || 0) - new Date(a.publishedAt || a.scheduledAt || 0))
    .slice(0, 100)
}

// GET /api/posts/inbox/unread — quantos comentários novos (não vistos) cada post tem.
// Faz chamadas às APIs das redes sociais só para os posts do inbox.
async function contarNaoLidos({ userId, isAdmin }) {
  const all = await postsRepo.listarPosts({ status: 'published', userId, isAdmin })
  const plats = commentsService.PLATAFORMAS_COM_COMENTARIOS
  const posts = all
    .filter(p => p.externalPostId && plats.includes(p.externalPlatform))
    .slice(0, 30) // limita para não sobrecarregar as APIs

  const postIds = posts.map(p => p.id)
  if (!postIds.length) return {}

  const { rows: seenRows } = await pool.query(
    `SELECT post_id, seen_ids FROM inbox_seen_comments WHERE user_id=$1 AND post_id=ANY($2)`,
    [userId, postIds]
  )
  const seenMap = {}
  for (const r of seenRows) seenMap[r.post_id] = new Set(r.seen_ids || [])

  const results = await Promise.allSettled(
    posts.map(async p => {
      const { comments } = await commentsService.listarComentariosPost(p)
      const seen = seenMap[p.id] || new Set()
      const newComments = (comments || []).filter(c => !seen.has(c.id))
      await Promise.all(newComments.map(async comment => {
        const author = String(comment.author || 'alguém').replace(/^@/, '')
        const snippet = String(comment.text || '').replace(/\s+/g, ' ').trim().slice(0, 90)
        const platform = p.externalPlatform || 'rede social'
        const postLabel = String(p.textByPlatform?.[platform] || p.text || p.title || `post #${p.id}`).replace(/\s+/g, ' ').trim().slice(0, 70)
        const message = `Novo comentário de @${author} no ${PLATFORM_LABELS[platform] || platform}: ${postLabel}${snippet ? ` — “${snippet}${String(comment.text || '').length > 90 ? '…' : ''}”` : ''}`
        try {
          await registrarLog({
            type: 'info',
            message,
            platform,
            user_id: userId,
            notification_key: `comment:${userId}:${p.id}:${comment.id}`
          })
        } catch {
          // A notificação não pode impedir a contagem do Inbox.
        }
      }))
      const newCount = newComments.length
      return { postId: p.id, newCount }
    })
  )

  const unread = {}
  for (const r of results) {
    if (r.status === 'fulfilled' && r.value.newCount > 0) unread[r.value.postId] = r.value.newCount
  }
  return unread
}

async function marcarComentariosVistos({ userId, postId, commentIds }) {
  if (!commentIds.length) return
  await pool.query(
    `INSERT INTO inbox_seen_comments (user_id, post_id, seen_ids, atualizado_em)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (user_id, post_id) DO UPDATE
       SET seen_ids = (
         SELECT ARRAY(SELECT DISTINCT unnest(inbox_seen_comments.seen_ids || $3::TEXT[]))
       ),
       atualizado_em = NOW()`,
    [userId, postId, commentIds]
  )
}

async function marcarVariosComentariosVistos({ userId, postIds, isAdmin }) {
  const ids = [...new Set((postIds || []).map(Number).filter(Number.isInteger))]
  if (!ids.length) return 0
  const posts = await postsRepo.listarPosts({ status: 'published', userId, isAdmin })
  const elegiveis = posts.filter(post => ids.includes(Number(post.id)) && post.externalPostId && commentsService.PLATAFORMAS_COM_COMENTARIOS.includes(post.externalPlatform))
  const results = await Promise.allSettled(elegiveis.map(async post => {
    const { comments = [] } = await commentsService.listarComentariosPost(post)
    await marcarComentariosVistos({ userId, postId: post.id, commentIds: comments.map(comment => comment.id) })
  }))
  return results.filter(result => result.status === 'fulfilled').length
}

// GET /api/posts/:id/comments
async function listarComentarios({ id, userId, isAdmin }) {
  const post = await postsRepo.buscarPostPorId(id, userId, isAdmin)
  if (!post) return null

  const platform = post.externalPlatform || post.platforms?.[0] || 'instagram'
  const account = (post.accounts || []).find(item => item.platform === platform) || (post.accounts || [])[0] || {}
  const text = post.textByPlatform?.[platform] || post.text || ''
  const replyPlatforms = commentsService.PLATAFORMAS_COM_RESPOSTA || ['instagram']
  const preview = {
    id: post.id,
    platform,
    handle: account.handle || '',
    avatarUrl: account.avatarUrl || null,
    publishedAt: post.publishedAt || post.scheduledAt || null,
    youtubeTitle: post.titleByPlatform?.youtube || post.youtubeTitle || '',
    replySupported: replyPlatforms.includes(platform),
    text
  }

  let comments = []
  let replySupported = preview.replySupported
  let commentsError = null
  // Comentários e preview são independentes. Antes eram buscados em série,
  // então a tela esperava a rede social responder comentários para só depois
  // começar a buscar a mídia. Em uma troca de post isso duplicava o tempo de
  // espera percebido no Inbox.
  const [commentsResult, midiaResult] = await Promise.all([
    commentsService.listarComentariosPost(post).catch(error => ({ error })),
    commentsService.buscarMidiaPost(post)
  ])
  if (commentsResult.error) {
    commentsError = commentsResult.error.message
  } else {
    comments = commentsResult.comments || []
    replySupported = commentsResult.replySupported ?? replySupported
  }
  const midiaRemota = midiaResult

  return {
    comments,
    error: commentsError,
    post: midiaRemota
      ? { ...preview, replySupported, text: midiaRemota.caption || text, mediaItems: midiaRemota.itens }
      : { ...preview, replySupported, mediaPath: post.mediaPath, mediaType: post.mediaType, mediaItems: account.mediaItems || post.mediaItems }
  }
}

async function responderComentario({ id, userId, isAdmin, commentId, text }) {
  const post = await postsRepo.buscarPostPorId(id, userId, isAdmin)
  if (!post) return null
  return commentsService.responderComentario(post, commentId, text)
}

async function buscarPostRemoto({ userId, platform, zernioAccountId, externalPostId }) {
  if (!commentsService.PLATAFORMAS_COM_COMENTARIOS.includes(platform)) return null
  if (!zernioAccountId || !externalPostId) return null
  const account = await contasRepo.buscarContaZernioDoUsuario({ userId, platform, zernioAccountId })
  return account ? remotePostIdentity(account, platform, externalPostId) : null
}

async function listarComentariosRemotos({ userId, platform, zernioAccountId, externalPostId }) {
  const post = await buscarPostRemoto({ userId, platform, zernioAccountId, externalPostId })
  if (!post) return null
  const result = await commentsService.listarComentariosPost({ ...post, userId, userRole: 'user' })
  return {
    comments: result.comments || [],
    error: null,
    post: { ...post, replySupported: result.replySupported ?? post.replySupported }
  }
}

async function responderComentarioRemoto({ userId, platform, zernioAccountId, externalPostId, commentId, text }) {
  const post = await buscarPostRemoto({ userId, platform, zernioAccountId, externalPostId })
  if (!post) return null
  return commentsService.responderComentario({ ...post, userId, userRole: 'user' }, commentId, text)
}

module.exports = {
  listarInbox, contarNaoLidos, marcarComentariosVistos, marcarVariosComentariosVistos,
  listarComentarios, listarComentariosRemotos, responderComentario, responderComentarioRemoto
}
