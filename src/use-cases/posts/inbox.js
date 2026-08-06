const pool = require('../../db/pool')
const postsRepo = require('../../infra/db/postsRepository')
const commentsService = require('../../services/commentsService')

// GET /api/posts/inbox — lista posts publicados com suporte a comentários
// (retorna metadados; comentários são carregados por demanda em /:id/comments)
async function listarInbox({ userId, isAdmin, platform = null }) {
  const all = await postsRepo.listarPosts({ status: 'published', userId, isAdmin })
  const plats = commentsService.PLATAFORMAS_COM_COMENTARIOS
  return all
    .filter(p => p.externalPostId && plats.includes(p.externalPlatform))
    .filter(p => !platform || p.externalPlatform === platform)
    .sort((a, b) => new Date(b.publishedAt || b.scheduledAt) - new Date(a.publishedAt || a.scheduledAt))
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
      const newCount = (comments || []).filter(c => !seen.has(c.id)).length
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
  try {
    const result = await commentsService.listarComentariosPost(post)
    comments = result.comments || []
    replySupported = result.replySupported ?? replySupported
  } catch (error) {
    commentsError = error.message
  }

  const midiaRemota = await commentsService.buscarMidiaPost(post)

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

module.exports = { listarInbox, contarNaoLidos, marcarComentariosVistos, marcarVariosComentariosVistos, listarComentarios, responderComentario }
