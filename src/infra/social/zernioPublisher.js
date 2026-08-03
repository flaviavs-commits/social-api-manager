// Adapter Instagram/Facebook/TikTok via Zernio (docs.zernio.com) — no lugar
// de falar direto com cada Graph API/Content Posting API, delega a
// publicação ao Zernio, que detém o token OAuth real dessas contas.
// token.accessToken aqui NÃO é um token de verdade — é o accountId que o
// Zernio nos devolveu ao conectar a conta (ver src/routes/oauth.js,
// syncZernioAccount). Mesma assinatura dos outros adapters: (token, post) => data.
const { mediaUrl } = require('./mediaFetch')
const zernioClient = require('./zernioClient')

// post.igFormat usa 'post'/'reel'/'story' (domain/posts/post.js,
// INSTAGRAM_FORMATS) — Zernio usa 'feed'/'reel'/'story'.
const IG_CONTENT_TYPE = { post: 'feed', reel: 'reel', story: 'story' }

// post.tiktokPrivacyLevel usa os valores da Content Posting API do TikTok
// (domain/posts/post.js, TIKTOK_PRIVACY_LEVELS) — o mapeamento abaixo para
// os valores do Zernio (public/private/friends, minúsculo) é uma SUPOSIÇÃO
// baseada no resumo da doc pública, não confirmada por teste real com um
// post de TikTok de verdade. Confirmar no primeiro post real de teste desta
// rede e corrigir aqui se necessário.
const TIKTOK_PRIVACY = {
  PUBLIC_TO_EVERYONE: 'public',
  MUTUAL_FOLLOW_FRIENDS: 'friends',
  SELF_ONLY: 'private'
}

function montarMediaItems(post) {
  const items = post.mediaItems?.length ? post.mediaItems : (post.mediaPath ? [{ path: post.mediaPath, type: post.mediaType }] : [])
  return items.map(item => ({
    type: item.type === 'video' ? 'video' : 'image',
    url: mediaUrl(item.path)
  }))
}

async function publicarZernioInstagram(token, post) {
  if (!post.mediaPath && !post.mediaItems?.length) throw new Error('Instagram exige uma imagem ou vídeo para publicar')

  const platformSpecificData = {}
  if (post.igFormat && IG_CONTENT_TYPE[post.igFormat]) platformSpecificData.contentType = IG_CONTENT_TYPE[post.igFormat]
  // O Zernio posta o primeiro comentário nativamente no momento da
  // publicação — não precisa do fluxo separado via cron
  // (post_first_comments/processarPrimeirosComentarios em scheduler.js), que
  // continua existindo só para as redes ainda não migradas.
  if (post.firstComment) platformSpecificData.firstComment = post.firstComment

  const { post: created } = await zernioClient.createPost({
    content: post.text || '',
    publishNow: true,
    mediaItems: montarMediaItems(post),
    platforms: [{
      platform: 'instagram',
      accountId: token.accessToken,
      ...(Object.keys(platformSpecificData).length ? { platformSpecificData } : {})
    }]
  })

  return created
}

async function publicarZernioFacebook(token, post) {
  const platformSpecificData = {}
  if (post.firstComment) platformSpecificData.firstComment = post.firstComment

  const { post: created } = await zernioClient.createPost({
    content: post.text || '',
    publishNow: true,
    mediaItems: montarMediaItems(post),
    platforms: [{
      platform: 'facebook',
      accountId: token.accessToken,
      ...(Object.keys(platformSpecificData).length ? { platformSpecificData } : {})
    }]
  })

  return created
}

async function publicarZernioTiktok(token, post) {
  if (!post.mediaPath && !post.mediaItems?.length) throw new Error('TikTok exige um vídeo ou imagem para publicar')

  // Exigência das Content Sharing Guidelines do TikTok (mesma regra de
  // domain/posts/post.js/validarCriacaoPost): a privacidade não pode ter um
  // default silencioso escolhido pelo backend.
  if (!post.tiktokPrivacyLevel) throw new Error('Escolha quem pode ver o vídeo no TikTok antes de publicar.')

  const platformSpecificData = {
    videoTitle: post.text || '',
    disableComment: !!post.tiktokDisableComment,
    disableDuet: !!post.tiktokDisableDuet,
    disableStitch: !!post.tiktokDisableStitch,
    privacy: TIKTOK_PRIVACY[post.tiktokPrivacyLevel] || 'public'
  }

  const { post: created } = await zernioClient.createPost({
    content: post.text || '',
    publishNow: true,
    mediaItems: montarMediaItems(post),
    platforms: [{ platform: 'tiktok', accountId: token.accessToken, platformSpecificData }]
  })

  return created
}

module.exports = { publicarZernioInstagram, publicarZernioFacebook, publicarZernioTiktok }
