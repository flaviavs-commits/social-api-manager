// Adapter Facebook (Graph API) — publica o post já resolvido (mídia + texto)
// na página conectada. Sem regra de negócio aqui, só a chamada à API.
const { mediaToBlob } = require('./mediaFetch')

async function publicarFacebook(token, post) {
  const pageId = token.handle || token.accountName
  if (!pageId) throw new Error('Conta Facebook sem ID/página configurado')

  if (!post.mediaPath && !post.mediaItems?.length) {
    const body = new URLSearchParams({ message: post.text || '', access_token: token.accessToken })
    if (post.locationId) body.append('place', post.locationId)
    const res = await fetch(`https://graph.facebook.com/v19.0/${encodeURIComponent(pageId)}/feed`, { method: 'POST', body })
    const data = await res.json()
    if (!res.ok) throw new Error(data?.error?.message || `Facebook respondeu ${res.status}`)
    return data
  }

  // ── Várias imagens/vídeos: publica cada um sem divulgar (published=false) e
  // depois cria um post no feed referenciando todos como attached_media ──
  if (post.mediaItems?.length > 1) {
    // Cada item é enviado para um endpoint independente (published=false), sem
    // dependência entre eles — paraleliza para reduzir o tempo total do carrossel.
    const attachedMedia = await Promise.all(post.mediaItems.map(async item => {
      const isVideoItem = item.type === 'video'
      const endpointItem = isVideoItem ? 'videos' : 'photos'
      const { buffer, filename } = await mediaToBlob(item.path)

      const form = new FormData()
      form.append('access_token', token.accessToken)
      form.append('published', 'false')
      form.append('source', new Blob([buffer]), filename)

      const res = await fetch(`https://graph.facebook.com/v19.0/${encodeURIComponent(pageId)}/${endpointItem}`, { method: 'POST', body: form })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error?.message || `Facebook respondeu ${res.status} ao enviar item do carrossel`)
      return { media_fbid: data.id }
    }))

    const body = new URLSearchParams({ access_token: token.accessToken })
    if (post.text) body.append('message', post.text)
    if (post.locationId) body.append('place', post.locationId)
    attachedMedia.forEach((m, i) => body.append(`attached_media[${i}]`, JSON.stringify(m)))

    const res = await fetch(`https://graph.facebook.com/v19.0/${encodeURIComponent(pageId)}/feed`, { method: 'POST', body })
    const data = await res.json()
    if (!res.ok) throw new Error(data?.error?.message || `Facebook respondeu ${res.status}`)
    return data
  }

  const isVideo = post.mediaType === 'video'
  const endpoint = isVideo ? 'videos' : 'photos'
  const { buffer, filename } = await mediaToBlob(post.mediaPath)

  const form = new FormData()
  form.append('access_token', token.accessToken)
  if (post.text) form.append(isVideo ? 'description' : 'caption', post.text)
  if (post.locationId) form.append('place', post.locationId)
  form.append('source', new Blob([buffer]), filename)

  const res = await fetch(`https://graph.facebook.com/v19.0/${encodeURIComponent(pageId)}/${endpoint}`, { method: 'POST', body: form })
  const data = await res.json()
  if (!res.ok) throw new Error(data?.error?.message || `Facebook respondeu ${res.status}`)
  return data
}

// Primeiro comentário automático — comenta no post já publicado. Requer a
// permissão pages_manage_engagement (além das básicas de publicação).
async function comentarFacebook(token, externalPostId, texto) {
  const res = await fetch(`https://graph.facebook.com/v19.0/${encodeURIComponent(externalPostId)}/comments`, {
    method: 'POST',
    body: new URLSearchParams({ message: texto, access_token: token.accessToken })
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data?.error?.message || `Facebook respondeu ${res.status} ao comentar`)
  return data
}

module.exports = { publicarFacebook, comentarFacebook }
