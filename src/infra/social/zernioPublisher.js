// Adapter Instagram/Facebook/TikTok via Zernio (docs.zernio.com) — no lugar
// de falar direto com cada Graph API/Content Posting API, delega a
// publicação ao Zernio, que detém o token OAuth real dessas contas.
// token.accessToken aqui NÃO é um token de verdade — é o accountId que o
// Zernio nos devolveu ao conectar a conta (ver src/routes/oauth.js,
// syncZernioAccount). Mesma assinatura dos outros adapters: (token, post) => data.
const { mediaUrl } = require('./mediaFetch')
const zernioClient = require('./zernioClient')

// post.igFormat usa 'post'/'reel'/'story' (domain/posts/post.js,
// INSTAGRAM_FORMATS). Na API da Zernio, feed é o default e não deve ser
// enviado como contentType. O único contentType explícito é story; um vídeo
// único é detectado pelo item type=video e publicado como Reel.
const IG_CONTENT_TYPE = { story: 'story' }

function montarMediaItems(post, { includeThumbnail = false } = {}) {
  const items = post.mediaItems?.length ? post.mediaItems : (post.mediaPath ? [{ path: post.mediaPath, type: post.mediaType }] : [])
  return items.map(item => ({
    type: item.type === 'video' ? 'video' : 'image',
    url: mediaUrl(item.path),
    ...(includeThumbnail && item.type === 'video' && post.coverPath ? { thumbnail: mediaUrl(post.coverPath) } : {})
  }))
}

// O post devolvido por POST /v1/posts tem um "_id" próprio (o post no
// Zernio, que pode agrupar várias plataformas), mas o ID que precisamos
// para métricas depois (extrairExternalId em publisher.js) é o
// platformPostId — o ID real do post/vídeo NA REDE SOCIAL, dentro de
// platforms[]. Confundir os dois faz o post.externalPostId salvo nunca
// bater com nada em GET /v1/analytics (que indexa por platformPostId),
// deixando toda métrica por-post null para sempre.
//
// POST /v1/posts NÃO é síncrono apesar do publishNow:true e da mensagem
// "Post published successfully" — confirmado em teste real (2026-08-03):
// a resposta imediata pode vir com platforms[].status "processing" e sem
// platformPostId (o TikTok em particular demora mais, por causa de
// upload/compressão de vídeo). Quando isso acontece, sinaliza pending do
// mesmo jeito que o Instagram direto sinalizava (data.pending) — quem
// chama (publisher.js/publicarNaConta) já sabe tratar esse contrato.
function extrairDadosDaPlataforma(created, platform) {
  const entrada = created.platforms?.find(p => p.platform === platform)
  if (!entrada?.platformPostId) {
    return { pending: true, provider: 'zernio', zernioPostId: created._id, platform }
  }
  return { ...created, platformPostId: entrada.platformPostId, platformPostUrl: entrada.platformPostUrl || null }
}

function postDaResposta(response) {
  // Em uma repetição com o mesmo X-Request-Id, o Zernio pode devolver o post
  // original em `existingPost` em vez de criar outro registro.
  const created = response?.post || response?.existingPost
  if (!created) throw new Error('O Zernio não retornou o post criado.')
  return created
}

function metadataDaPublicacao(metadata) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null
  return Object.keys(metadata).length ? metadata : null
}

async function publicarZernioInstagram(token, post, { requestId, metadata } = {}) {
  if (!post.mediaPath && !post.mediaItems?.length) throw new Error('Instagram exige uma imagem ou vídeo para publicar')

  const items = post.mediaItems?.length ? post.mediaItems : [{ path: post.mediaPath, type: post.mediaType }]
  const videoUnico = items.length === 1 && items[0].type === 'video'
  const platformSpecificData = {}
  if (post.igFormat && IG_CONTENT_TYPE[post.igFormat]) platformSpecificData.contentType = IG_CONTENT_TYPE[post.igFormat]
  // A Zernio transforma vídeo único em Reel. Mantemos a exibição no feed,
  // salvo quando o usuário escolheu Story, sem mandar contentType=feed (valor
  // que a API não reconhece como tipo explícito).
  if (videoUnico && post.igFormat !== 'story') platformSpecificData.shareToFeed = true
  // O Zernio posta o primeiro comentário nativamente no momento da
  // publicação — não precisa do fluxo separado via cron
  // (post_first_comments/processarPrimeirosComentarios em scheduler.js), que
  // continua existindo só para as redes ainda não migradas.
  if (post.firstComment) platformSpecificData.firstComment = post.firstComment
  if (videoUnico && post.coverPath) platformSpecificData.instagramThumbnail = mediaUrl(post.coverPath)

  const response = await zernioClient.createPost({
    content: post.text || '',
    publishNow: true,
    mediaItems: montarMediaItems({ ...post, mediaItems: items }),
    ...(metadataDaPublicacao(metadata) ? { metadata: metadataDaPublicacao(metadata) } : {}),
    platforms: [{
      platform: 'instagram',
      accountId: token.accessToken,
      ...(Object.keys(platformSpecificData).length ? { platformSpecificData } : {})
    }]
  }, { requestId })
  const created = postDaResposta(response)

  return extrairDadosDaPlataforma(created, 'instagram')
}

async function publicarZernioFacebook(token, post, { requestId, metadata } = {}) {
  const platformSpecificData = {}
  if (post.facebookFormat === 'reel') platformSpecificData.contentType = 'reel'
  if (post.firstComment) platformSpecificData.firstComment = post.firstComment

  const response = await zernioClient.createPost({
    content: post.text || '',
    publishNow: true,
    mediaItems: montarMediaItems(post),
    ...(metadataDaPublicacao(metadata) ? { metadata: metadataDaPublicacao(metadata) } : {}),
    platforms: [{
      platform: 'facebook',
      accountId: token.accessToken,
      ...(Object.keys(platformSpecificData).length ? { platformSpecificData } : {})
    }]
  }, { requestId })
  const created = postDaResposta(response)

  return extrairDadosDaPlataforma(created, 'facebook')
}

async function publicarZernioYoutube(token, post, { requestId, metadata } = {}) {
  const items = post.mediaItems?.length
    ? post.mediaItems
    : (post.mediaPath ? [{ path: post.mediaPath, type: post.mediaType }] : [])
  const videos = items.filter(item => item.type === 'video')
  if (videos.length !== 1 || items.length !== 1) throw new Error('YouTube exige exatamente um vídeo para publicar')

  const platformSpecificData = {
    title: (post.youtubeTitle || post.text || 'Novo vídeo').slice(0, 100),
    visibility: post.youtubeVisibility || 'public',
    madeForKids: post.youtubeMadeForKids === true
  }
  if (post.youtubeCategoryId) platformSpecificData.categoryId = post.youtubeCategoryId
  if (post.firstComment) platformSpecificData.firstComment = post.firstComment

  const response = await zernioClient.createPost({
    content: post.text || '',
    publishNow: true,
    mediaItems: [{ type: 'video', url: mediaUrl(videos[0].path) }],
    ...(metadataDaPublicacao(metadata) ? { metadata: metadataDaPublicacao(metadata) } : {}),
    platforms: [{
      platform: 'youtube',
      accountId: token.accessToken,
      platformSpecificData
    }]
  }, { requestId })

  const created = postDaResposta(response)
  return extrairDadosDaPlataforma(created, 'youtube')
}

async function publicarZernioTiktok(token, post, { requestId, metadata } = {}) {
  const items = post.mediaItems?.length ? post.mediaItems : (post.mediaPath ? [{ path: post.mediaPath, type: post.mediaType }] : [])
  if (!items.length) throw new Error('TikTok exige uma imagem ou vídeo para publicar.')

  const temVideo = items.some(item => item.type === 'video')
  if (temVideo && (items.length !== 1 || items[0].type !== 'video')) {
    throw new Error('O TikTok aceita um vídeo sozinho ou um carrossel somente de fotos.')
  }
  if (!temVideo && (!items.every(item => item.type === 'image') || items.length > 35)) {
    throw new Error('O TikTok aceita até 35 imagens em um carrossel.')
  }

  // Exigência das Content Sharing Guidelines do TikTok (mesma regra de
  // domain/posts/post.js/validarCriacaoPost): a privacidade não pode ter um
  // default silencioso escolhido pelo backend.
  if (!post.tiktokPrivacyLevel) throw new Error('Escolha quem pode ver a publicação no TikTok antes de publicar.')

  const tiktokDescription = post.textByPlatform?.tiktokDescription || post.textByPlatform?.tiktok || post.text || ''
  const tiktokSettings = {
    privacy_level: post.tiktokPrivacyLevel,
    allow_comment: !post.tiktokDisableComment,
    content_preview_confirmed: true,
    express_consent_given: true,
    ...(temVideo
      ? {
          allow_duet: !post.tiktokDisableDuet,
          allow_stitch: !post.tiktokDisableStitch,
          ...(post.coverPath ? { video_cover_image_url: mediaUrl(post.coverPath) } : {})
        }
      : {
          media_type: 'photo',
          photo_cover_index: 0,
          ...(tiktokDescription ? { description: tiktokDescription.slice(0, 4000) } : {})
        })
  }
  const content = temVideo
    ? tiktokDescription.slice(0, 2200)
    : (post.titleByPlatform?.tiktok || tiktokDescription || post.text || '').slice(0, 90)

  const response = await zernioClient.createPost({
    content,
    publishNow: true,
    mediaItems: montarMediaItems({ ...post, mediaItems: items }, { includeThumbnail: post.youtubeIsShort !== true }),
    ...(metadataDaPublicacao(metadata) ? { metadata: metadataDaPublicacao(metadata) } : {}),
    platforms: [{ platform: 'tiktok', accountId: token.accessToken }],
    tiktokSettings
  }, { requestId })
  const created = postDaResposta(response)

  return extrairDadosDaPlataforma(created, 'tiktok')
}

module.exports = { publicarZernioInstagram, publicarZernioFacebook, publicarZernioYoutube, publicarZernioTiktok }
