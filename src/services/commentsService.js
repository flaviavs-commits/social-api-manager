const { buscarContaToken } = require('./publisher')

// Redes onde já é possível listar e responder comentários reais com o
// escopo OAuth que a conexão atual já solicita. Facebook tem leitura mas
// falta a permissão pages_manage_engagement para responder; YouTube e
// TikTok/Kwai não têm suporte confirmado — ficam de fora por agora.
const PLATAFORMAS_COM_COMENTARIOS = ['instagram']

const COMMENTS_FETCH_TIMEOUT_MS = 4000

async function fetchComTimeout(url, opts = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), COMMENTS_FETCH_TIMEOUT_MS)
  try {
    return await fetch(url, { ...opts, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

async function listarComentariosInstagram(token, externalPostId) {
  const url = `https://graph.instagram.com/v19.0/${encodeURIComponent(externalPostId)}/comments?fields=id,text,username,timestamp&access_token=${encodeURIComponent(token.accessToken)}`
  const res = await fetchComTimeout(url)
  const data = await res.json()
  if (!res.ok) throw new Error(data?.error?.message || `Instagram respondeu ${res.status}`)

  return (data.data || []).map(c => ({
    id: c.id,
    author: c.username || 'desconhecido',
    text: c.text || '',
    createdAt: c.timestamp || null
  }))
}

async function responderComentarioInstagram(token, commentId, text) {
  const url = `https://graph.instagram.com/v19.0/${encodeURIComponent(commentId)}/replies`
  const res = await fetchComTimeout(url, {
    method: 'POST',
    body: new URLSearchParams({ message: text, access_token: token.accessToken })
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data?.error?.message || `Instagram respondeu ${res.status}`)
  return data
}

const LISTERS = { instagram: listarComentariosInstagram }
const REPLIERS = { instagram: responderComentarioInstagram }

// Lista comentários reais de um post já publicado. Lança erro com mensagem
// amigável quando a plataforma não suportar, faltar o ID externo, ou a
// conta não estiver mais conectada — diferente de buscarMetricasPost, aqui
// o chamador (rota) decide como exibir o erro, em vez de esconder como null.
async function listarComentariosPost(post) {
  if (!PLATAFORMAS_COM_COMENTARIOS.includes(post.externalPlatform)) {
    throw new Error(`Comentários ainda não disponíveis para ${post.externalPlatform}`)
  }
  if (!post.externalPostId) throw new Error('Este post não tem um ID externo salvo (publicado antes desta funcionalidade)')

  const isSuperAdmin = post.userRole === 'super_admin'
  const token = await buscarContaToken(post.externalPlatform, post.userId, isSuperAdmin, post.accountId)
  if (!token) throw new Error('Conta não está mais conectada')

  return LISTERS[post.externalPlatform](token, post.externalPostId)
}

async function responderComentario(post, commentId, text) {
  if (!PLATAFORMAS_COM_COMENTARIOS.includes(post.externalPlatform)) {
    throw new Error(`Responder comentários ainda não disponível para ${post.externalPlatform}`)
  }

  const isSuperAdmin = post.userRole === 'super_admin'
  const token = await buscarContaToken(post.externalPlatform, post.userId, isSuperAdmin, post.accountId)
  if (!token) throw new Error('Conta não está mais conectada')

  return REPLIERS[post.externalPlatform](token, commentId, text)
}

module.exports = { listarComentariosPost, responderComentario, PLATAFORMAS_COM_COMENTARIOS }
