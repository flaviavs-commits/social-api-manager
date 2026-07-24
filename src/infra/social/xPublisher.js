// Adapter X (Twitter). Publica um tweet (POST /2/tweets, API v2), com mídia
// enviada via upload.twitter.com/1.1/media/upload (a v2 ainda não tem
// endpoint de upload próprio — é o padrão oficial mesmo em apps novos).
// Custo real por chamada (pay-per-use desde fev/2026): ver Capítulo 8 do
// guia de referência — não há como evitar a cobrança, só reduzi-la.
const { mediaToBlob } = require('./mediaFetch')

async function uploadMidiaX(token, item) {
  const { buffer, filename } = await mediaToBlob(item.path)
  const isVideo = item.type === 'video'

  const form = new FormData()
  form.append('media', new Blob([buffer]), filename)
  form.append('media_category', isVideo ? 'tweet_video' : 'tweet_image')

  const res = await fetch('https://upload.twitter.com/1.1/media/upload.json', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token.accessToken}` },
    body: form
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data?.errors?.[0]?.message || `X respondeu ${res.status} ao enviar mídia`)
  return data.media_id_string
}

async function publicarX(token, post) {
  const items = post.mediaItems?.length ? post.mediaItems.slice(0, 4) // X aceita até 4 mídias por tweet
    : post.mediaPath ? [{ path: post.mediaPath, type: post.mediaType }]
    : []

  const mediaIds = items.length ? await Promise.all(items.map(item => uploadMidiaX(token, item))) : []

  const body = { text: post.text || '' }
  if (mediaIds.length) body.media = { media_ids: mediaIds }

  const res = await fetch('https://api.twitter.com/2/tweets', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token.accessToken}` },
    body: JSON.stringify(body)
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data?.detail || data?.errors?.[0]?.message || `X respondeu ${res.status}`)
  return data.data
}

module.exports = { publicarX }
