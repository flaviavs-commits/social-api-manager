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

module.exports = { publicarZernioInstagram }
