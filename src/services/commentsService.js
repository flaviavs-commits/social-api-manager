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

// Mídia real do post direto da rede social — usado como preview no modal de
// comentários porque o arquivo local enviado no upload (public/uploads) é
// efêmero e pode não existir mais no disco (ex: depois de um redeploy),
// enquanto a mídia publicada continua disponível na própria rede.
async function buscarMidiaInstagram(token, externalPostId) {
  const url = `https://graph.instagram.com/v19.0/${encodeURIComponent(externalPostId)}` +
    `?fields=caption,media_type,media_url,thumbnail_url,children{media_type,media_url,thumbnail_url}` +
    `&access_token=${encodeURIComponent(token.accessToken)}`
  const res = await fetchComTimeout(url)
  const data = await res.json()
  if (!res.ok) throw new Error(data?.error?.message || `Instagram respondeu ${res.status}`)

  const itensFonte = data.children?.data?.length ? data.children.data : [data]
  const itens = itensFonte.map(i => ({
    path: i.media_type === 'VIDEO' ? (i.thumbnail_url || i.media_url) : i.media_url,
    type: i.media_type === 'VIDEO' ? 'video' : 'image'
  }))

  return { caption: data.caption || '', itens }
}

const LISTERS = { instagram: listarComentariosInstagram }
const REPLIERS = { instagram: responderComentarioInstagram }
const MIDIA_FETCHERS = { instagram: buscarMidiaInstagram }

async function buscarTokenPost(post) {
  if (!PLATAFORMAS_COM_COMENTARIOS.includes(post.externalPlatform)) {
    throw new Error(`Comentários ainda não disponíveis para ${post.externalPlatform}`)
  }
  if (!post.externalPostId) throw new Error('Este post não tem um ID externo salvo (publicado antes desta funcionalidade)')

  const isSuperAdmin = post.userRole === 'super_admin'
  const token = await buscarContaToken(post.externalPlatform, post.userId, isSuperAdmin, post.accountId)
  if (!token) throw new Error('Conta não está mais conectada')
  return token
}

// Lista comentários reais de um post já publicado. Lança erro com mensagem
// amigável quando a plataforma não suportar, faltar o ID externo, ou a
// conta não estiver mais conectada — diferente de buscarMetricasPost, aqui
// o chamador (rota) decide como exibir o erro, em vez de esconder como null.
async function listarComentariosPost(post) {
  const token = await buscarTokenPost(post)
  const comments = await LISTERS[post.externalPlatform](token, post.externalPostId)
  return { comments }
}

// Busca a mídia real do post na rede social, para exibir no preview do
// modal de comentários. Falha silenciosa: se a chamada não der (post
// removido, token sem permissão), retorna null e o front-end cai de volta
// para a mídia local salva no upload original (se ainda existir).
async function buscarMidiaPost(post) {
  try {
    const token = await buscarTokenPost(post)
    return await MIDIA_FETCHERS[post.externalPlatform](token, post.externalPostId)
  } catch {
    return null
  }
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

module.exports = { listarComentariosPost, responderComentario, buscarMidiaPost, PLATAFORMAS_COM_COMENTARIOS }
