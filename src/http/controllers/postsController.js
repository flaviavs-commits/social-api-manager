// Controller HTTP do módulo posts — só traduz req/res para os use-cases,
// sem regra de negócio nem acesso a dados aqui.
const { parseId, serverError, isAdminRole } = require('../../utils/http')
const { ValidationError } = require('../../domain/posts/errors')

const { gerarUploadUrl } = require('../../use-cases/posts/gerarUploadUrl')
const { listarInbox, contarNaoLidos, marcarComentariosVistos, listarComentarios, responderComentario } = require('../../use-cases/posts/inbox')
const { listarPosts, listarPostsCalendario } = require('../../use-cases/posts/listarPosts')
const { buscarAnalytics, buscarMetricsHistory } = require('../../use-cases/posts/buscarAnalytics')
const { listarTiktokVideos } = require('../../use-cases/posts/listarTiktokVideos')
const { criarPost } = require('../../use-cases/posts/criarPost')
const { reagendarPost } = require('../../use-cases/posts/reagendarPost')
const { deletarPost } = require('../../use-cases/posts/deletarPost')

function ctx(req) {
  return { userId: req.user.id, userRole: req.user.role, isAdmin: isAdminRole(req.user.role) }
}

async function postUploadUrl(req, res) {
  try {
    const { uploadUrl, mimetype } = await gerarUploadUrl(req.body || {})
    res.json({ uploadUrl, mimetype })
  } catch (e) {
    if (e instanceof ValidationError) return res.status(400).json({ erro: e.message })
    serverError(res, e, 'Não foi possível gerar a URL de upload')
  }
}

async function getInboxUnread(req, res) {
  try {
    const unread = await contarNaoLidos(ctx(req))
    res.json({ unread })
  } catch (e) {
    serverError(res, e)
  }
}

async function postCommentSeen(req, res) {
  try {
    const id = parseId(req.params.id)
    if (id === null) return res.status(400).json({ erro: 'id inválido' })
    await marcarComentariosVistos({ userId: req.user.id, postId: id, commentIds: req.body.commentIds || [] })
    res.status(204).send()
  } catch (e) {
    serverError(res, e)
  }
}

async function getInbox(req, res) {
  try {
    const posts = await listarInbox({ ...ctx(req), platform: req.query.platform || null })
    res.json({ posts })
  } catch (e) {
    serverError(res, e)
  }
}

async function getCalendar(req, res) {
  try {
    const year = parseInt(req.query.year, 10)
    const month = parseInt(req.query.month, 10)
    if (!year || !month || month < 1 || month > 12)
      return res.status(400).json({ erro: 'year e month são obrigatórios (month: 1-12)' })

    const posts = await listarPostsCalendario({ year, month, ...ctx(req) })
    res.json({ posts })
  } catch (e) {
    serverError(res, e, 'Erro ao carregar calendário')
  }
}

async function getPosts(req, res) {
  try {
    const { status } = req.query
    if (status !== undefined && !['scheduled', 'published', 'partial', 'error', 'cancelled'].includes(status))
      return res.status(400).json({ erro: 'status inválido' })

    const posts = await listarPosts({ status, ...ctx(req) })
    res.json({ posts })
  } catch (e) {
    serverError(res, e)
  }
}

async function getAnalytics(req, res) {
  try {
    const data = await buscarAnalytics(ctx(req))
    res.json(data)
  } catch (e) {
    serverError(res, e)
  }
}

async function getTiktokVideos(req, res) {
  try {
    const videos = await listarTiktokVideos(ctx(req))
    res.json({ videos })
  } catch (e) {
    serverError(res, e)
  }
}

async function getMetricsHistory(req, res) {
  try {
    const id = parseId(req.params.id)
    if (id === null) return res.status(400).json({ erro: 'id inválido' })

    const history = await buscarMetricsHistory({ id, ...ctx(req) })
    if (history === null) return res.status(404).json({ erro: 'Post não encontrado' })
    res.json({ history })
  } catch (e) {
    serverError(res, e)
  }
}

async function postCreate(req, res) {
  try {
    const { post, status } = await criarPost({ body: req.body, ...ctx(req) })
    res.status(status).json(post)
  } catch (e) {
    if (e instanceof ValidationError) return res.status(400).json({ erro: e.message })
    serverError(res, e, 'Não foi possível agendar o post')
  }
}

async function getComments(req, res) {
  try {
    const id = parseId(req.params.id)
    if (id === null) return res.status(400).json({ erro: 'id inválido' })

    const result = await listarComentarios({ id, ...ctx(req) })
    if (!result) return res.status(404).json({ erro: 'Post não encontrado' })
    res.json(result)
  } catch (e) {
    res.status(400).json({ erro: e.message })
  }
}

async function postCommentReply(req, res) {
  try {
    const id = parseId(req.params.id)
    if (id === null) return res.status(400).json({ erro: 'id inválido' })

    const text = (req.body.text || '').trim()
    if (!text) return res.status(400).json({ erro: 'Escreva uma resposta antes de enviar' })
    if (text.length > 2000) return res.status(400).json({ erro: 'Resposta muito longa (máximo 2000 caracteres)' })

    const reply = await responderComentario({ id, ...ctx(req), commentId: req.params.commentId, text })
    if (!reply) return res.status(404).json({ erro: 'Post não encontrado' })
    res.status(201).json({ reply })
  } catch (e) {
    res.status(400).json({ erro: e.message })
  }
}

async function patchPost(req, res) {
  try {
    const id = parseId(req.params.id)
    if (id === null) return res.status(400).json({ erro: 'id inválido' })
    const { scheduledAt } = req.body
    if (!scheduledAt || isNaN(Date.parse(scheduledAt)))
      return res.status(400).json({ erro: 'scheduledAt inválido' })

    const updated = await reagendarPost({ id, scheduledAt, ...ctx(req) })
    if (!updated) return res.status(404).json({ erro: 'Post não encontrado ou não agendado' })
    res.json({ ok: true })
  } catch (e) {
    serverError(res, e)
  }
}

async function deletePost(req, res) {
  try {
    const id = parseId(req.params.id)
    if (id === null) return res.status(400).json({ erro: 'id inválido' })

    const ok = await deletarPost({ id, ...ctx(req) })
    if (!ok) return res.status(404).json({ erro: 'Post não encontrado ou já publicado' })
    res.status(204).send()
  } catch (e) {
    serverError(res, e)
  }
}

module.exports = {
  postUploadUrl, getInboxUnread, postCommentSeen, getInbox, getCalendar, getPosts,
  getAnalytics, getTiktokVideos, getMetricsHistory, postCreate, getComments,
  postCommentReply, patchPost, deletePost
}
