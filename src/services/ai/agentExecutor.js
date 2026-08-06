const pool = require('../../db/pool')
const accountsRepo = require('../../repositories/contasRepository')
const tokensRepo = require('../../repositories/tokensRepository')
const { listarPosts, listarPostsCalendario } = require('../../use-cases/posts/listarPosts')
const { buscarAnalytics, buscarMetricsHistory } = require('../../use-cases/posts/buscarAnalytics')
const { listarInbox, contarNaoLidos, marcarComentariosVistos, listarComentarios, responderComentario } = require('../../use-cases/posts/inbox')
const { listarTiktokVideos } = require('../../use-cases/posts/listarTiktokVideos')
const { buscarTiktokCreatorInfo } = require('../../use-cases/posts/buscarTiktokCreatorInfo')
const { reagendarPost } = require('../../use-cases/posts/reagendarPost')
const { deletarPost } = require('../../use-cases/posts/deletarPost')
const logsRepo = require('../../repositories/logsRepository')
const { getStatusMap } = require('../platformHealth')
const { isAdminRole, PLATFORMS } = require('../../utils/http')
const { getPublicCapabilities } = require('./agentCatalog')

const POST_STATUSES = ['scheduled', 'published', 'partial', 'error', 'cancelled']
const TOKEN_STATUSES = ['valid', 'expiring', 'expired', 'error']

function context(user) {
  return { userId: user.id, userRole: user.role, isAdmin: isAdminRole(user.role) }
}

function textPreview(value, length = 100) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, length)
}

async function executeAgentAction({ actionId, arguments: args = {}, user, generatePosts, generateImage, generateText }) {
  const ctx = context(user)
  switch (actionId) {
    case 'show_capabilities':
      return { message: 'Posso consultar dados, gerar conteúdo, abrir módulos e executar ações confirmadas.', data: { capabilities: getPublicCapabilities() } }
    case 'conversation':
      return { message: String(args.response || args.answer || 'Posso ajudar com estratégia, conteúdo e uso da aplicação.'), data: { conversational: true }, navigation: 'ai' }
    case 'navigate':
    case 'connect_account':
    case 'open_scheduler':
      return { message: 'Módulo aberto.', data: {}, navigation: args.page || (actionId === 'connect_account' ? 'integracoes' : 'agendador') }
    case 'generate_posts': {
      if (typeof generatePosts !== 'function') throw Object.assign(new Error('Gerador de conteúdo indisponível.'), { status: 503 })
      const result = await generatePosts({
        instruction: String(args.instruction || '').trim(), platforms: (Array.isArray(args.platforms) ? args.platforms : []).filter(platform => PLATFORMS.includes(platform)),
        quantity: Math.min(Math.max(Number(args.quantity) || 1, 1), 5), tone: String(args.tone || 'casual'),
      })
      return { message: 'Conteúdo gerado. Revise o texto antes de publicar.', data: result, navigation: 'ai' }
    }
    case 'create_image': {
      if (typeof generateImage !== 'function') throw Object.assign(new Error('Gerador de imagens indisponível.'), { status: 503 })
      const description = String(args.description || '').trim()
      if (!description) throw Object.assign(new Error('Descreva a imagem que deseja criar.'), { status: 400 })
      const result = await generateImage({
        description: description.slice(0, 4000),
        model: String(args.model || 'auto'),
      })
      if (!result?.image) throw Object.assign(new Error('O provedor não retornou uma imagem válida.'), { status: 502 })
      return { message: `Imagem criada com ${result.modelo || 'um modelo disponível'}.`, data: result, navigation: 'ai' }
    }
    case 'list_posts': {
      const status = args.status || undefined
      if (status && !POST_STATUSES.includes(status)) throw Object.assign(new Error('Status de publicação inválido.'), { status: 400 })
      const posts = await listarPosts({ status, ...ctx })
      return { message: posts.length ? `Encontrei ${posts.length} publicação(ões).` : 'Não encontrei publicações para esse filtro.', data: { posts: posts.slice(0, 50) }, navigation: 'calendario' }
    }
    case 'dashboard_summary': {
      const summary = await accountsRepo.getDashboardStats(user.id, false)
      return { message: 'Resumo do painel carregado.', data: summary, navigation: 'dashboard' }
    }
    case 'post_details': {
      const postId = Number(args.postId)
      if (!Number.isInteger(postId) || postId <= 0) throw Object.assign(new Error('ID de post inválido.'), { status: 400 })
      const post = await require('../../infra/db/postsRepository').buscarPostPorId(postId, ...[user.id, ctx.isAdmin])
      if (!post) throw Object.assign(new Error('Post não encontrado.'), { status: 404 })
      return { message: `Detalhes do post #${postId} carregados.`, data: { post }, navigation: 'calendario' }
    }
    case 'metrics_history': {
      const postId = Number(args.postId)
      if (!Number.isInteger(postId) || postId <= 0) throw Object.assign(new Error('ID de post inválido.'), { status: 400 })
      const history = await buscarMetricsHistory({ id: postId, ...ctx })
      if (!history) throw Object.assign(new Error('Post não encontrado.'), { status: 404 })
      return { message: `Histórico de métricas do post #${postId} carregado.`, data: history, navigation: 'analytics' }
    }
    case 'reschedule_post': {
      const postId = Number(args.postId)
      const scheduledAt = new Date(args.scheduledAt)
      if (!Number.isInteger(postId) || postId <= 0 || Number.isNaN(scheduledAt.getTime())) throw Object.assign(new Error('Post e horário válidos são obrigatórios.'), { status: 400 })
      if (scheduledAt.getTime() <= Date.now()) throw Object.assign(new Error('O novo horário precisa estar no futuro.'), { status: 400 })
      const updated = await reagendarPost({ id: postId, scheduledAt, ...ctx })
      if (!updated) throw Object.assign(new Error('Post não encontrado ou não está agendado.'), { status: 404 })
      return { message: `Post #${postId} reagendado para ${scheduledAt.toLocaleString('pt-BR')}.`, data: { postId, scheduledAt: scheduledAt.toISOString() }, navigation: 'calendario' }
    }
    case 'cancel_post': {
      const postId = Number(args.postId)
      if (!Number.isInteger(postId) || postId <= 0) throw Object.assign(new Error('ID de post inválido.'), { status: 400 })
      const cancelled = await deletarPost({ id: postId, ...ctx })
      if (!cancelled) throw Object.assign(new Error('Post não encontrado ou já publicado.'), { status: 404 })
      return { message: `Post #${postId} cancelado.`, data: { cancelled: true, postId }, navigation: 'calendario' }
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
      const platform = args.platform && PLATFORMS.includes(args.platform) ? args.platform : null
      return { message: platform ? `Relatórios de ${platform} carregados.` : 'Relatórios carregados.', data: { ...data, focusPlatform: platform }, navigation: 'analytics' }
    }
    case 'analytics_insight': {
      const data = await buscarAnalytics(ctx)
      const platform = args.platform && PLATFORMS.includes(args.platform) ? args.platform : null
      let insight = ''
      if (typeof generateText === 'function') {
        const prompt = `Você é um estrategista de conteúdo. Analise SOMENTE os dados reais abaixo e responda em português do Brasil.
Não invente números nem atribua causalidade que os dados não comprovem. Aponte até três observações, até três ações práticas priorizadas e uma pergunta que ajudaria a aprofundar a análise. Se houver pouca amostra, diga isso claramente.${platform ? ` Dê prioridade à plataforma ${platform}.` : ''}

DADOS REAIS DO USUÁRIO:
${JSON.stringify(data).slice(0, 16000)}

Responda em texto simples, com títulos curtos e bullets. Não use JSON.`
        insight = String(await generateText(prompt) || '').trim().slice(0, 4000)
      }
      return {
        message: insight || 'Carreguei os dados. Para receber recomendações personalizadas, habilite um modelo de IA disponível.',
        data: { ...data, insight: insight || null },
        navigation: 'analytics',
      }
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
    case 'unread_inbox': {
      const unread = await contarNaoLidos(ctx)
      const total = Object.values(unread).reduce((sum, value) => sum + Number(value || 0), 0)
      return { message: total ? `Há ${total} comentário(s) não lido(s).` : 'Você não tem comentários não lidos.', data: { unread, total }, navigation: 'inbox' }
    }
    case 'mark_comments_seen': {
      const postId = Number(args.postId)
      if (!Number.isInteger(postId) || postId <= 0) throw Object.assign(new Error('ID de post inválido.'), { status: 400 })
      let commentIds = Array.isArray(args.commentIds) ? args.commentIds.map(String).filter(Boolean).slice(0, 200) : []
      if (!commentIds.length) {
        const result = await listarComentarios({ id: postId, ...ctx })
        if (!result) throw Object.assign(new Error('Post não encontrado.'), { status: 404 })
        commentIds = (result.comments || []).map(comment => String(comment.id)).filter(Boolean).slice(0, 200)
      }
      await marcarComentariosVistos({ userId: user.id, postId, commentIds })
      return { message: `${commentIds.length} comentário(s) marcado(s) como visto(s).`, data: { postId, commentIds }, navigation: 'inbox' }
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
    case 'tiktok_videos': {
      const videos = await listarTiktokVideos(ctx)
      return { message: videos.length ? `Encontrei ${videos.length} vídeo(s) do TikTok.` : 'Não encontrei vídeos recentes no TikTok.', data: { videos: videos.slice(0, 100) }, navigation: 'analytics' }
    }
    case 'tiktok_creator_info': {
      const accountId = args.accountId ? Number(args.accountId) : null
      if (args.accountId && (!Number.isInteger(accountId) || accountId <= 0)) throw Object.assign(new Error('ID de conta TikTok inválido.'), { status: 400 })
      const info = await buscarTiktokCreatorInfo({ contaId: accountId, ...ctx })
      return { message: 'Opções de publicação do TikTok carregadas.', data: info, navigation: 'agendador' }
    }
    case 'list_saved_texts': {
      const { rows } = await pool.query('SELECT id, title, body, criado_em FROM saved_texts WHERE user_id=$1 ORDER BY criado_em DESC LIMIT 100', [user.id])
      return { message: rows.length ? `Encontrei ${rows.length} texto(s) salvo(s).` : 'Você ainda não tem textos salvos.', data: { savedTexts: rows }, navigation: 'agendador' }
    }
    case 'save_text': {
      const body = String(args.body || '').trim()
      if (!body) throw Object.assign(new Error('O texto é obrigatório.'), { status: 400 })
      if (body.length > 20000) throw Object.assign(new Error('O texto é muito longo.'), { status: 400 })
      const { rows } = await pool.query('INSERT INTO saved_texts (user_id, title, body) VALUES ($1,$2,$3) RETURNING id,title,body,criado_em', [user.id, String(args.title || 'Texto salvo').slice(0, 200), body])
      return { message: `Texto salvo #${rows[0].id}.`, data: { savedText: rows[0] }, navigation: 'agendador' }
    }
    case 'delete_saved_text': {
      const id = Number(args.id)
      if (!Number.isInteger(id) || id <= 0) throw Object.assign(new Error('ID de texto salvo inválido.'), { status: 400 })
      const result = await pool.query('DELETE FROM saved_texts WHERE id=$1 AND user_id=$2', [id, user.id])
      if (!result.rowCount) throw Object.assign(new Error('Texto salvo não encontrado.'), { status: 404 })
      return { message: `Texto salvo #${id} excluído.`, data: { deleted: true, id }, navigation: 'agendador' }
    }
    case 'list_presets': {
      const platform = args.platform && PLATFORMS.includes(args.platform) ? args.platform : null
      const params = [user.id]
      const filter = platform ? ' AND platform=$2' : ''
      if (platform) params.push(platform)
      const { rows } = await pool.query(`SELECT id, platform, name, config, criado_em FROM platform_presets WHERE user_id=$1${filter} ORDER BY criado_em DESC LIMIT 100`, params)
      return { message: rows.length ? `Encontrei ${rows.length} preset(s).` : 'Você ainda não tem presets salvos.', data: { presets: rows }, navigation: 'agendador' }
    }
    case 'save_preset': {
      const platform = String(args.platform || '').toLowerCase()
      const name = String(args.name || '').trim()
      if (!PLATFORMS.includes(platform) || !name) throw Object.assign(new Error('Rede e nome do preset são obrigatórios.'), { status: 400 })
      const config = args.config && typeof args.config === 'object' && !Array.isArray(args.config) ? args.config : {}
      const { rows } = await pool.query('INSERT INTO platform_presets (user_id, platform, name, config) VALUES ($1,$2,$3,$4) RETURNING id,platform,name,config,criado_em', [user.id, platform, name.slice(0, 200), JSON.stringify(config)])
      return { message: `Preset "${rows[0].name}" salvo.`, data: { preset: rows[0] }, navigation: 'agendador' }
    }
    case 'delete_preset': {
      const id = Number(args.id)
      if (!Number.isInteger(id) || id <= 0) throw Object.assign(new Error('ID de preset inválido.'), { status: 400 })
      const result = await pool.query('DELETE FROM platform_presets WHERE id=$1 AND user_id=$2', [id, user.id])
      if (!result.rowCount) throw Object.assign(new Error('Preset não encontrado.'), { status: 404 })
      return { message: `Preset #${id} excluído.`, data: { deleted: true, id }, navigation: 'agendador' }
    }
    case 'platform_health': {
      const status = await getStatusMap()
      return { message: 'Status das plataformas carregado.', data: { status }, navigation: 'integracoes' }
    }
    case 'list_logs': {
      const requested = Number(args.limit)
      const limit = Number.isInteger(requested) && requested > 0 ? Math.min(requested, 200) : 50
      const logs = await logsRepo.listarLogs(limit, user.id, ctx.isAdmin)
      return { message: logs.length ? `Encontrei ${logs.length} atividade(s) recentes.` : 'Não há atividades recentes.', data: { logs }, navigation: 'dashboard' }
    }
    case 'list_memories': {
      const model = String(args.model || 'gemini').slice(0, 80)
      const { rows } = await pool.query('SELECT id, tipo, conteudo, criado_em, lembrar_em FROM ai_memory WHERE user_id=$1 AND model=$2 AND resolvido=FALSE ORDER BY criado_em DESC LIMIT 30', [user.id, model])
      return { message: rows.length ? `Encontrei ${rows.length} memória(s) ativas.` : 'Não há memórias ativas para a IA.', data: { memories: rows }, navigation: 'ai' }
    }
    case 'save_memory': {
      const content = String(args.content || '').trim()
      if (!content) throw Object.assign(new Error('O conteúdo da memória é obrigatório.'), { status: 400 })
      if (content.length > 1000) throw Object.assign(new Error('A memória deve ter no máximo 1000 caracteres.'), { status: 400 })
      const model = String(args.model || 'gemini').slice(0, 80)
      const type = String(args.type || 'nota').slice(0, 40)
      const { rows } = await pool.query('INSERT INTO ai_memory (user_id, model, tipo, conteudo) VALUES ($1,$2,$3,$4) RETURNING id,tipo,conteudo,criado_em', [user.id, model, type, content])
      return { message: 'Memória salva para a IA.', data: { memory: rows[0] }, navigation: 'ai' }
    }
    case 'resolve_memory': {
      const id = Number(args.id)
      if (!Number.isInteger(id) || id <= 0) throw Object.assign(new Error('ID de memória inválido.'), { status: 400 })
      const result = await pool.query('UPDATE ai_memory SET resolvido=TRUE WHERE id=$1 AND user_id=$2 AND resolvido=FALSE', [id, user.id])
      if (!result.rowCount) throw Object.assign(new Error('Memória não encontrada.'), { status: 404 })
      return { message: `Memória #${id} marcada como resolvida.`, data: { resolved: true, id }, navigation: 'ai' }
    }
    default:
      throw Object.assign(new Error('Ação não disponível.'), { status: 400 })
  }
}

module.exports = { executeAgentAction, textPreview }
