const pool = require('../../db/pool')
const accountsRepo = require('../../repositories/contasRepository')
const tokensRepo = require('../../repositories/tokensRepository')
const { listarPosts, listarPostsCalendario } = require('../../use-cases/posts/listarPosts')
const { buscarAnalytics } = require('../../use-cases/posts/buscarAnalytics')
const { listarInbox, listarComentarios, responderComentario } = require('../../use-cases/posts/inbox')
const { isAdminRole, PLATFORMS } = require('../../utils/http')
const { getPublicCapabilities } = require('./agentCatalog')

const POST_STATUSES = ['scheduled', 'published', 'partial', 'error', 'cancelled']
const TOKEN_STATUSES = ['valid', 'expiring', 'expired', 'error']

function context(user) {
  return { userId: user.id, isAdmin: isAdminRole(user.role) }
}

function textPreview(value, length = 100) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, length)
}

async function executeAgentAction({ actionId, arguments: args = {}, user, generatePosts }) {
  const ctx = context(user)
  switch (actionId) {
    case 'show_capabilities':
      return { message: 'Posso consultar dados, gerar conteúdo, abrir módulos e executar ações confirmadas.', data: { capabilities: getPublicCapabilities() } }
    case 'navigate':
    case 'connect_account':
    case 'open_scheduler':
      return { message: 'Módulo aberto.', data: {}, navigation: args.page || (actionId === 'connect_account' ? 'integracoes' : 'agendador') }
    case 'generate_posts': {
      if (typeof generatePosts !== 'function') throw Object.assign(new Error('Gerador de conteúdo indisponível.'), { status: 503 })
      const result = generatePosts({
        instruction: String(args.instruction || '').trim(), platforms: (Array.isArray(args.platforms) ? args.platforms : []).filter(platform => PLATFORMS.includes(platform)),
        quantity: Math.min(Math.max(Number(args.quantity) || 1, 1), 5), tone: String(args.tone || 'casual'),
      })
      return { message: 'Conteúdo gerado. Revise o texto antes de publicar.', data: result, navigation: 'ai' }
    }
    case 'list_posts': {
      const status = args.status || undefined
      if (status && !POST_STATUSES.includes(status)) throw Object.assign(new Error('Status de publicação inválido.'), { status: 400 })
      const posts = await listarPosts({ status, ...ctx })
      return { message: posts.length ? `Encontrei ${posts.length} publicação(ões).` : 'Não encontrei publicações para esse filtro.', data: { posts: posts.slice(0, 50) }, navigation: 'calendario' }
    }
    case 'calendar': {
      const year = Number(args.year)
      const month = Number(args.month)
      if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) throw Object.assign(new Error('Informe um mês e ano válidos.'), { status: 400 })
      const posts = await listarPostsCalendario({ year, month, ...ctx })
      return { message: posts.length ? `Há ${posts.length} publicação(ões) no período.` : 'Não há publicações no período.', data: { year, month, posts }, navigation: 'calendario' }
    }
    case 'analytics': {
      const data = await buscarAnalytics(ctx)
      return { message: 'Relatórios carregados.', data, navigation: 'analytics' }
    }
    case 'list_drafts': {
      const { rows } = await pool.query('SELECT id, title, text, platforms, criado_em FROM drafts WHERE user_id=$1 ORDER BY criado_em DESC LIMIT 100', [user.id])
      return { message: rows.length ? `Encontrei ${rows.length} rascunho(s).` : 'Você ainda não tem rascunhos salvos.', data: { drafts: rows }, navigation: 'rascunhos' }
    }
    case 'create_draft': {
      const text = String(args.text || '').trim()
      if (!text) throw Object.assign(new Error('O texto do rascunho é obrigatório.'), { status: 400 })
      if (text.length > 20000) throw Object.assign(new Error('O texto do rascunho é muito longo.'), { status: 400 })
      const platforms = Array.isArray(args.platforms) ? args.platforms.filter(platform => PLATFORMS.includes(platform)) : []
      const { rows } = await pool.query('INSERT INTO drafts (user_id,title,text,platforms) VALUES ($1,$2,$3,$4) RETURNING id,title,text,platforms,criado_em', [user.id, String(args.title || 'Rascunho').slice(0, 200), text, platforms])
      return { message: `Rascunho #${rows[0].id} salvo.`, data: { draft: rows[0] }, navigation: 'rascunhos' }
    }
    case 'delete_draft': {
      const id = Number(args.id)
      if (!Number.isInteger(id) || id <= 0) throw Object.assign(new Error('ID de rascunho inválido.'), { status: 400 })
      const result = await pool.query('DELETE FROM drafts WHERE id=$1 AND user_id=$2', [id, user.id])
      if (!result.rowCount) throw Object.assign(new Error('Rascunho não encontrado.'), { status: 404 })
      return { message: `Rascunho #${id} excluído.`, data: { deleted: true, id }, navigation: 'rascunhos' }
    }
    case 'list_inbox': {
      const platform = args.platform && PLATFORMS.includes(args.platform) ? args.platform : null
      const posts = await listarInbox({ ...ctx, platform })
      return { message: posts.length ? `Encontrei ${posts.length} publicação(ões) no inbox.` : 'Não há publicações com interações disponíveis.', data: { posts }, navigation: 'inbox' }
    }
    case 'list_comments': {
      const postId = Number(args.postId)
      if (!Number.isInteger(postId) || postId <= 0) throw Object.assign(new Error('ID de post inválido.'), { status: 400 })
      const result = await listarComentarios({ id: postId, ...ctx })
      if (!result) throw Object.assign(new Error('Post não encontrado.'), { status: 404 })
      return { message: `Comentários do post #${postId} carregados.`, data: result, navigation: 'inbox' }
    }
    case 'reply_comment': {
      const postId = Number(args.postId)
      const commentId = String(args.commentId || '').trim()
      const text = String(args.text || '').trim()
      if (!Number.isInteger(postId) || postId <= 0 || !commentId || !text) throw Object.assign(new Error('Post, comentário e texto são obrigatórios.'), { status: 400 })
      const reply = await responderComentario({ id: postId, ...ctx, commentId, text })
      if (!reply) throw Object.assign(new Error('Post não encontrado.'), { status: 404 })
      return { message: 'Resposta publicada no comentário.', data: { reply }, navigation: 'inbox' }
    }
    case 'list_accounts': {
      const platform = args.platform && PLATFORMS.includes(args.platform) ? args.platform : null
      const accounts = await accountsRepo.listarContas({ platform, userId: user.id, isAdmin: false })
      return { message: accounts.length ? `Encontrei ${accounts.length} conta(s) conectada(s).` : 'Nenhuma conta conectada.', data: { accounts }, navigation: 'integracoes' }
    }
    case 'disconnect_account': {
      const id = Number(args.id)
      if (!Number.isInteger(id) || id <= 0) throw Object.assign(new Error('ID de conta inválido.'), { status: 400 })
      const deleted = await accountsRepo.deletarConta(id, user.id, false)
      if (!deleted) throw Object.assign(new Error('Conta não encontrada.'), { status: 404 })
      return { message: `Conta #${id} desconectada.`, data: { deleted: true, id }, navigation: 'integracoes' }
    }
    case 'list_tokens': {
      const platform = args.platform && PLATFORMS.includes(args.platform) ? args.platform : undefined
      const status = args.status && TOKEN_STATUSES.includes(args.status) ? args.status : undefined
      const tokens = await tokensRepo.listarTokens({ platform, status, userId: user.id, isAdmin: false })
      return { message: tokens.length ? `Encontrei ${tokens.length} token(s).` : 'Nenhum token encontrado.', data: { tokens }, navigation: 'tokens' }
    }
    case 'renew_tokens': {
      const result = await tokensRepo.renovarTodos(user.id, false)
      return { message: 'Solicitação de renovação concluída.', data: result, navigation: 'tokens' }
    }
    case 'requirements': {
      const all = {
        instagram: { media: 'obrigatória', formatos: 'imagem ou vídeo', observação: 'não publica somente texto' },
        facebook: { media: 'opcional', formatos: 'imagem ou vídeo', observação: 'aceita somente texto' },
        youtube: { media: 'obrigatória', formatos: 'vídeo', observação: 'exige título e indicação de conteúdo infantil' },
        tiktok: { media: 'obrigatória', formatos: 'imagem ou vídeo', observação: 'texto curto e proporção compatível' },
      }
      const platforms = (Array.isArray(args.platforms) ? args.platforms : []).filter(platform => all[platform])
      return { message: 'Requisitos de publicação carregados.', data: { requirements: platforms.length ? Object.fromEntries(platforms.map(platform => [platform, all[platform]])) : all }, navigation: 'agendador' }
    }
    default:
      throw Object.assign(new Error('Ação não disponível.'), { status: 400 })
  }
}

module.exports = { executeAgentAction, textPreview }
