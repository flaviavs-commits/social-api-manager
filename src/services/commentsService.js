const { buscarContaToken } = require('../infra/social/publisher')
const tokensRepo = require('../repositories/tokensRepository')
const zernioClient = require('../infra/social/zernioClient')

// Redes onde já é possível listar comentários reais com o escopo OAuth que
// a conexão atual já solicita. TikTok (Content Posting API) não expõe
// leitura de comentários de terceiros — fica de fora por agora.
const PLATAFORMAS_COM_COMENTARIOS = ['instagram', 'facebook', 'youtube', 'tiktok']

// Todas as redes que entram no Inbox têm um caminho de resposta. Quando a
// conta foi conectada pelo Zernio usamos o endpoint unificado dele; contas
// legadas continuam usando a API oficial da própria rede.
const PLATAFORMAS_COM_RESPOSTA = ['instagram', 'facebook', 'youtube', 'tiktok']

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

// A Meta responde "Object with ID ... does not exist, cannot be loaded due to
// missing permissions..." (code 100) quando o post foi removido na rede, ou
// quando o token atual não tem acesso a ele (ex: conta reconectada, post de
// antes da conexão atual). Traduz para uma mensagem amigável, em vez de expor
// o texto técnico cru da API ao usuário.
function traduzirErroOAuth(error, rede) {
  const message = error?.message || ''
  if (/invalid oauth access token|cannot parse access token|oauth access token/i.test(message)) {
    return `A conexão do ${rede} expirou ou foi revogada. Reconecte essa conta em Integrações para carregar os comentários.`
  }
  if (/unsupported get request|does not exist|cannot be loaded|missing permissions/i.test(message)) {
    return 'Não foi possível carregar os comentários: o post pode ter sido removido na rede social, ou esta conta não tem mais acesso a ele. Tente reconectar a conta.'
  }
  return null
}

function traduzirErroMeta(data, status, rede) {
  const erro = data?.error
  const oauthMessage = traduzirErroOAuth(erro, rede)
  if (oauthMessage) return oauthMessage
  if (erro?.code === 100 || /does not exist|cannot be loaded|missing permissions/i.test(erro?.message || '')) {
    return 'Não foi possível carregar os comentários: o post pode ter sido removido na rede social, ou esta conta não tem mais acesso a ele. Tente reconectar a conta.'
  }
  return erro?.message || `${rede} respondeu ${status}`
}

async function listarComentariosInstagram(token, externalPostId) {
  const url = `https://graph.instagram.com/v19.0/${encodeURIComponent(externalPostId)}/comments?fields=id,text,username,timestamp&access_token=${encodeURIComponent(token.accessToken)}`
  const res = await fetchComTimeout(url)
  const data = await res.json()
  if (!res.ok) throw new Error(traduzirErroMeta(data, res.status, 'Instagram'))

  return (data.data || []).map(c => ({
    id: c.id,
    author: c.username || 'desconhecido',
    text: c.text || '',
    createdAt: c.timestamp || null
  }))
}


async function listarComentariosFacebook(token, externalPostId) {
  const url = `https://graph.facebook.com/v19.0/${encodeURIComponent(externalPostId)}/comments?fields=id,message,from{name,username},created_time&access_token=${encodeURIComponent(token.accessToken)}`
  const res = await fetchComTimeout(url)
  const data = await res.json()
  if (!res.ok) throw new Error(traduzirErroMeta(data, res.status, 'Facebook'))

  return (data.data || []).map(c => ({
    id: c.id,
    author: c.from?.username || c.from?.name || 'desconhecido',
    text: c.message || '',
    createdAt: c.created_time || null
  }))
}

async function listarComentariosYoutube(token, externalPostId) {
  const url = `https://www.googleapis.com/youtube/v3/commentThreads?part=snippet&videoId=${encodeURIComponent(externalPostId)}&access_token=${encodeURIComponent(token.accessToken)}`
  const res = await fetchComTimeout(url)
  const data = await res.json()
  if (!res.ok) throw new Error(data?.error?.message || `YouTube respondeu ${res.status}`)

  return (data.items || []).map(item => {
    const snippet = item.snippet?.topLevelComment?.snippet
    return {
      id: item.id,
      author: snippet?.authorDisplayName || 'desconhecido',
      text: snippet?.textDisplay || '',
      createdAt: snippet?.publishedAt || null
    }
  })
}

async function responderComentarioInstagram(token, commentId, text) {
  const url = `https://graph.instagram.com/v19.0/${encodeURIComponent(commentId)}/replies`
  const res = await fetchComTimeout(url, {
    method: 'POST',
    body: new URLSearchParams({ message: text, access_token: token.accessToken })
  })
  const data = await res.json()
  if (!res.ok) throw new Error(traduzirErroMeta(data, res.status, 'Instagram'))
  return data
}

async function responderComentarioFacebook(token, commentId, text) {
  const url = `https://graph.facebook.com/v19.0/${encodeURIComponent(commentId)}/comments`
  const res = await fetchComTimeout(url, {
    method: 'POST',
    body: new URLSearchParams({ message: text, access_token: token.accessToken })
  })
  const data = await res.json()
  if (!res.ok) throw new Error(traduzirErroMeta(data, res.status, 'Facebook'))
  return data
}

async function listarComentariosZernio(token, externalPostId) {
  const data = await zernioClient.getPostComments(externalPostId, {
    accountId: token.zernioAccountId,
    limit: 100
  }, {
    // O Inbox é uma interação em tempo real. Uma consulta lenta não deve
    // prender a troca de publicação por até três tentativas de 10s.
    timeoutMs: 5000,
    retries: 0
  })

  return (data.comments || []).map(c => ({
    // O Zernio usa `id` para o identificador que deve ser enviado ao endpoint
    // de resposta e também expõe `cid` em algumas plataformas.
    id: c.id || c.cid,
    author: c.from?.username || c.from?.name || c.author?.username || c.author?.name || c.username || 'desconhecido',
    ...(c.from?.profilePicture || c.from?.profile_picture || c.from?.avatarUrl || c.author?.profilePicture || c.author?.avatarUrl || c.profilePicture || c.avatarUrl
      ? { authorAvatarUrl: c.from?.profilePicture || c.from?.profile_picture || c.from?.avatarUrl || c.author?.profilePicture || c.author?.avatarUrl || c.profilePicture || c.avatarUrl }
      : {}),
    text: c.message || c.text || '',
    createdAt: c.createdTime || c.created_at || null
  }))
}

function remoteMediaItems(row) {
  const media = row.mediaItems || row.media || row.media_items || []
  if (Array.isArray(media) && media.length) return media.map(item => ({
    path: item.path || item.url || item.mediaUrl || item.media_url || item.thumbnail || item.thumbnailUrl,
    url: item.url || item.mediaUrl || item.media_url || item.path || null,
    thumbnail: item.thumbnail || item.thumbnailUrl || item.thumbnail_url || item.poster || null,
    type: String(item.type || item.mediaType || item.media_type || '').toLowerCase().includes('video') ? 'video' : 'image'
  })).filter(item => item.path)
  const image = row.picture || row.image || row.thumbnail || row.thumbnailUrl || row.thumbnail_url || row.mediaUrl || row.media_url
  return image ? [{ path: image, url: image, thumbnail: row.thumbnail || row.thumbnailUrl || row.thumbnail_url || image, type: String(row.mediaType || row.media_type || row.type || '').toLowerCase().includes('video') ? 'video' : 'image' }] : []
}

function remotePostId(row) {
  return row.platformPostId || row.platform_post_id || row.externalPostId || row.external_post_id || row.postId || row.id || row._id
}

function normalizarPostRemoto(row, conta, fallbackPlatform = null) {
  const externalPostId = remotePostId(row)
  if (!externalPostId) return null
  const platform = String(row.platform || row.network || fallbackPlatform || conta.platform || '').toLowerCase()
  if (!platform || !PLATAFORMAS_COM_COMENTARIOS.includes(platform)) return null
  const zernioAccountId = row.accountId || row.account_id || conta.zernioAccountId
  const text = row.content || row.caption || row.text || row.message || ''
  return {
    id: `remote:${platform}:${zernioAccountId}:${externalPostId}`,
    remote: true,
    externalPostId: String(externalPostId),
    externalPlatform: platform,
    accountId: conta.id,
    zernioAccountId: String(zernioAccountId),
    handle: row.accountUsername || row.account_username || row.username || conta.handle || '',
    avatarUrl: row.accountAvatarUrl || row.account_avatar_url || row.avatarUrl || conta.avatarUrl || null,
    publishedAt: row.createdTime || row.created_time || row.publishedAt || row.published_at || row.createdAt || null,
    text,
    title: row.title || row.name || '',
    youtubeTitle: row.title || '',
    permalink: row.permalink || row.platformPostUrl || row.platform_post_url || row.url || null,
    commentCount: Number(row.commentCount ?? row.comment_count ?? 0),
    likeCount: Number(row.likeCount ?? row.like_count ?? 0),
    replySupported: PLATAFORMAS_COM_RESPOSTA.includes(platform),
    mediaItems: remoteMediaItems(row)
  }
}

// Carrega o histórico remoto por perfil. O endpoint de posts traz também
// publicações sem comentário; o endpoint do Inbox complementa a resposta com
// contagem, avatar e preview que algumas contas só expõem nessa rota.
async function listarPostsRemotos({ userId, platform = null }) {
  const contasRepo = require('../repositories/contasRepository')
  const contas = await contasRepo.listarContasZernioDoUsuario({ userId, platform })
  if (!contas.length) return []

  const porPerfil = new Map()
  for (const conta of contas) {
    const chave = `${conta.zernioProfileId || `account:${conta.zernioAccountId}`}::${conta.platform}`
    if (!porPerfil.has(chave)) porPerfil.set(chave, { conta, contas: [] })
    porPerfil.get(chave).contas.push(conta)
  }

  const resultados = await Promise.allSettled([...porPerfil.values()].map(async grupo => {
    const { conta, contas: grupoContas } = grupo
    const baseQuery = {
      ...(conta.zernioProfileId ? { profileId: conta.zernioProfileId } : { accountId: conta.zernioAccountId }),
      ...(platform ? { platform } : {}),
      limit: 100
    }
    const [postsResult, inboxResult] = await Promise.allSettled([
      zernioClient.listPosts({ ...baseQuery, source: 'external', status: 'published' }, { timeoutMs: 8000, retries: 0 }),
      zernioClient.listInboxComments({ ...baseQuery, sortBy: 'date', sortOrder: 'desc' }, { timeoutMs: 8000, retries: 0 })
    ])
    const rows = []
    const append = value => {
      const list = value?.posts || value?.data || value?.items || []
      if (Array.isArray(list)) rows.push(...list)
    }
    if (postsResult.status === 'fulfilled') append(postsResult.value)
    if (inboxResult.status === 'fulfilled') append(inboxResult.value)

    return rows.map(row => {
      const accountId = row.accountId || row.account_id
      const rowConta = grupoContas.find(item => String(item.zernioAccountId) === String(accountId)) || grupoContas[0]
      return normalizarPostRemoto(row, rowConta, platform)
    }).filter(Boolean)
  }))

  const unique = new Map()
  for (const result of resultados) {
    if (result.status !== 'fulfilled') continue
    for (const post of result.value) {
      const key = `${post.externalPlatform}:${post.externalPostId}:${post.zernioAccountId}`
      const current = unique.get(key)
      unique.set(key, current ? { ...current, ...post, mediaItems: post.mediaItems.length ? post.mediaItems : current.mediaItems } : post)
    }
  }
  return [...unique.values()].sort((a, b) => new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0)).slice(0, 100)
}

async function responderComentarioYoutube(token, commentId, text) {
  const res = await fetchComTimeout('https://www.googleapis.com/youtube/v3/comments?part=snippet', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token.accessToken}` },
    body: JSON.stringify({ snippet: { parentId: commentId, textOriginal: text } })
  })
  const data = await res.json()
  if (!res.ok) throw new Error(traduzirErroOAuth(data?.error, 'YouTube') || data?.error?.message || `YouTube respondeu ${res.status}`)
  return data
}

async function responderComentarioZernio(token, postId, commentId, text) {
  return zernioClient.replyToComment(postId, {
    accountId: token.zernioAccountId,
    commentId,
    message: text
  })
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
    // Para vídeo, `media_url` é o arquivo reproduzível e `thumbnail_url` é
    // apenas o poster. Manter os dois evita que o navegador tente tocar uma
    // imagem como vídeo e ainda conserva a prévia quando o vídeo expira.
    path: i.media_url || i.thumbnail_url,
    url: i.media_url || null,
    thumbnail: i.thumbnail_url || null,
    type: i.media_type === 'VIDEO' ? 'video' : 'image'
  }))

  return { caption: data.caption || '', itens }
}

const LISTERS = {
  instagram: listarComentariosInstagram,
  facebook: listarComentariosFacebook,
  youtube: listarComentariosYoutube
}
const REPLIERS = { instagram: responderComentarioInstagram, facebook: responderComentarioFacebook, youtube: responderComentarioYoutube }
const MIDIA_FETCHERS = { instagram: buscarMidiaInstagram }

async function buscarTokenPost(post) {
  if (!PLATAFORMAS_COM_COMENTARIOS.includes(post.externalPlatform)) {
    throw new Error(`Comentários ainda não disponíveis para ${post.externalPlatform}`)
  }
  if (!post.externalPostId) throw new Error('Este post não tem um ID externo salvo (publicado antes desta funcionalidade)')

  const isSuperAdmin = post.userRole === 'super_admin'
  let token = await buscarContaToken(post.externalPlatform, post.userId, isSuperAdmin, post.accountId)
  if (!token) throw new Error('Conta não está mais conectada')

  const expiraEmBreve = token.expiresAt && new Date(token.expiresAt).getTime() - Date.now() < 2 * 60 * 1000
  if (!token.zernioAccountId && (token.status !== 'valid' || expiraEmBreve)) {
    const renewal = await tokensRepo.renovarToken(token.token_id, post.userId, isSuperAdmin)
    if (renewal?.success) token = await buscarContaToken(post.externalPlatform, post.userId, isSuperAdmin, post.accountId) || token
  }
  return token
}

// Lista comentários reais de um post já publicado. Lança erro com mensagem
// amigável quando a plataforma não suportar, faltar o ID externo, ou a
// conta não estiver mais conectada — diferente de buscarMetricasPost, aqui
// o chamador (rota) decide como exibir o erro, em vez de esconder como null.
async function listarComentariosPost(post) {
  const token = await buscarTokenPost(post)
  try {
    if (token.zernioAccountId && PLATAFORMAS_COM_COMENTARIOS.includes(post.externalPlatform)) {
      const comments = await listarComentariosZernio(token, post.externalPostId)
      return { comments, replySupported: true }
    }
    const comments = await LISTERS[post.externalPlatform](token, post.externalPostId)
    return { comments, replySupported: PLATAFORMAS_COM_RESPOSTA.includes(post.externalPlatform) }
  } catch (error) {
    const oauthMessage = traduzirErroOAuth(error, post.externalPlatform)
    if (oauthMessage) throw new Error(oauthMessage)
    throw error
  }
}

// Busca a mídia real do post na rede social, para exibir no preview do
// modal de comentários. Falha silenciosa: se a chamada não der (post
// removido, token sem permissão), retorna null e o front-end cai de volta
// para a mídia local salva no upload original (se ainda existir).
async function buscarMidiaPost(post) {
  try {
    const token = await buscarTokenPost(post)
    // O identificador salvo para contas Zernio não é um token da Meta.
    if (token.zernioAccountId && ['facebook', 'instagram'].includes(post.externalPlatform)) return null
    return await MIDIA_FETCHERS[post.externalPlatform](token, post.externalPostId)
  } catch {
    return null
  }
}

async function responderComentario(post, commentId, text) {
  const token = await buscarTokenPost(post)

  try {
    if (token.zernioAccountId && PLATAFORMAS_COM_COMENTARIOS.includes(post.externalPlatform)) {
      return await responderComentarioZernio(token, post.externalPostId, commentId, text)
    }

    if (!PLATAFORMAS_COM_RESPOSTA.includes(post.externalPlatform)) {
      throw new Error(`Responder comentários ainda não disponível para ${post.externalPlatform}`)
    }

    return await REPLIERS[post.externalPlatform](token, commentId, text)
  } catch (error) {
    const oauthMessage = traduzirErroOAuth(error, post.externalPlatform)
    if (oauthMessage) throw new Error(oauthMessage)
    throw error
  }
}

module.exports = { listarComentariosPost, responderComentario, buscarMidiaPost, listarPostsRemotos, PLATAFORMAS_COM_COMENTARIOS, PLATAFORMAS_COM_RESPOSTA }
