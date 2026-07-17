// Adapter TikTok (Content Posting API v2).
const { mediaToBlob, mediaUrlTiktok } = require('./mediaFetch')

// Consulta o status real do processamento depois do upload — o /init/ só
// confirma que o TikTok aceitou o envio, não que o vídeo já foi publicado de
// fato. Poucas tentativas com delay curto: o suficiente pro caso comum
// (alguns segundos), sem bloquear a resposta por muito tempo se demorar mais.
async function aguardarStatusPublicacaoTiktok(publishId, accessToken) {
  for (let tentativa = 0; tentativa < 3; tentativa++) {
    await new Promise(r => setTimeout(r, 2000))
    const res = await fetch('https://open.tiktokapis.com/v2/post/publish/status/fetch/', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ publish_id: publishId })
    })
    const data = await res.json()
    const status = data?.data?.status
    if (status && status !== 'PROCESSING_UPLOAD' && status !== 'PROCESSING_DOWNLOAD')
      return { status, failReason: data?.data?.fail_reason || null }
  }
  return { status: 'PROCESSING', failReason: null }
}

async function publicarTiktok(token, post) {
  const items = post.mediaItems?.length ? post.mediaItems : (post.mediaPath ? [{ path: post.mediaPath, type: post.mediaType }] : [])
  if (!items.length) throw new Error('TikTok exige ao menos uma mídia para publicar')

  const isVideo = items.length === 1 && items[0].type === 'video'

  // ── Vídeo ──
  if (isVideo) {
    const { buffer } = await mediaToBlob(items[0].path)
    const initRes = await fetch('https://open.tiktokapis.com/v2/post/publish/video/init/', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        // disable_duet/disable_comment/disable_stitch são obrigatórios pelas
        // diretrizes de integração do TikTok para apps não auditados — sem
        // eles, o post/publish/video/init/ responde "Please review our
        // integration guidelines".
        post_info: {
          title: post.text || '',
          privacy_level: 'SELF_ONLY',
          disable_duet: false,
          disable_comment: false,
          disable_stitch: false
        },
        source_info: { source: 'FILE_UPLOAD', video_size: buffer.length, chunk_size: buffer.length, total_chunk_count: 1 }
      })
    })
    const initData = await initRes.json()
    if (!initRes.ok || initData?.error?.code !== 'ok')
      throw new Error(`[${initData?.error?.code || initRes.status}] ${initData?.error?.message || 'Erro desconhecido'}`)

    const uploadRes = await fetch(initData.data.upload_url, {
      method: 'PUT',
      headers: { 'Content-Type': 'video/mp4', 'Content-Range': `bytes 0-${buffer.length - 1}/${buffer.length}` },
      body: buffer
    })
    if (!uploadRes.ok) throw new Error(`Falha no upload do vídeo para o TikTok (${uploadRes.status})`)

    const { status, failReason } = await aguardarStatusPublicacaoTiktok(initData.data.publish_id, token.accessToken)
    if (status === 'FAILED') throw new Error(`TikTok rejeitou o vídeo após o upload (publish_id: ${initData.data.publish_id}, motivo: ${failReason || 'não informado'})`)

    return { ...initData.data, status }
  }

  // ── Foto única ou Carrossel ──
  // Usa o endpoint de Content Posting API dedicado a fotos (media_type: PHOTO),
  // que aceita as imagens por URL pública (PULL_FROM_URL) em vez de upload binário.
  const photoImages = items.map(item => mediaUrlTiktok(item.path))

  const initRes = await fetch('https://open.tiktokapis.com/v2/post/publish/content/init/', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token.accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      post_info: {
        title: post.text || '',
        privacy_level: 'SELF_ONLY',
        disable_comment: false,
        // disable_duet/disable_stitch só fazem sentido para vídeo, mas o
        // TikTok também exige presença desses campos no media_type: PHOTO.
        disable_duet: false,
        disable_stitch: false
      },
      source_info: {
        source: 'PULL_FROM_URL',
        photo_cover_index: 0,
        photo_images: photoImages
      },
      post_mode: 'DIRECT_POST',
      media_type: 'PHOTO'
    })
  })
  const initData = await initRes.json()
  if (!initRes.ok || initData?.error?.code !== 'ok')
    throw new Error(`[${initData?.error?.code || initRes.status}] ${initData?.error?.message || 'Erro desconhecido'}`)

  const { status, failReason } = await aguardarStatusPublicacaoTiktok(initData.data.publish_id, token.accessToken)
  if (status === 'FAILED') throw new Error(`TikTok rejeitou a foto após o envio (publish_id: ${initData.data.publish_id}, motivo: ${failReason || 'não informado'})`)

  return { ...initData.data, status }
}

module.exports = { publicarTiktok }
