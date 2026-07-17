// Adapter TikTok (Content Posting API v2).
const { mediaToBlob, mediaUrlTiktok } = require('./mediaFetch')
const { fetchComRateLimit } = require('./rateLimitedFetch')

// A Content Posting API exige consultar as opções de privacidade permitidas
// para a conta antes de publicar (ex: contas de menores de idade não podem
// postar público) — publicar direto com PUBLIC_TO_EVERYONE sem checar falha
// com privacy_level_option_mismatch mesmo em apps aprovados.
//
// Importante: essa lista reflete o que a CONTA do usuário permite, não o que
// o APP está autorizado a usar de fato. Um app que ainda não passou pelo
// audit de conteúdo do TikTok (https://developers.tiktok.com/doc/content-sharing-guidelines/)
// recebe PUBLIC_TO_EVERYONE aqui mesmo assim, e só descobre a restrição real
// ao tentar publicar (erro unaudited_client_can_only_post_to_private_accounts,
// tratado em initComFallbackPrivado abaixo).
async function buscarPrivacyLevelPermitido(accessToken) {
  const res = await fetchComRateLimit('https://open.tiktokapis.com/v2/post/publish/creator_info/query/', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }
  })
  const data = await res.json()
  if (!res.ok || data?.error?.code !== 'ok')
    throw new Error(data?.error?.message || `TikTok respondeu ${res.status} ao consultar permissões da conta`)

  const options = data.data?.privacy_level_options || []
  if (options.includes('PUBLIC_TO_EVERYONE')) return 'PUBLIC_TO_EVERYONE'
  // Conta não pode postar público (ex: restrição de idade) — usa a opção
  // mais aberta disponível em vez de falhar, para o post ainda sair.
  return options[0] || 'SELF_ONLY'
}

// Apps ainda não auditados pelo TikTok para publicação pública só podem
// postar em contas privadas — a API aceita PUBLIC_TO_EVERYONE no
// creator_info/query/, mas rejeita na hora de publicar de fato com esse
// código de erro específico.
function isErroClienteNaoAuditado(initData) {
  return initData?.error?.code === 'unaudited_client_can_only_post_to_private_accounts'
}

// Chama o endpoint de init (video ou photo) com o privacyLevel pedido; se o
// TikTok recusar por falta de audit do app, tenta de novo automaticamente
// com SELF_ONLY em vez de falhar o post inteiro — sem isso, todo post
// pararia de sair assim que o app tentasse ir público sem estar auditado.
async function initComFallbackPrivado(url, montarBody, privacyLevel, headers) {
  const initRes = await fetchComRateLimit(url, { method: 'POST', headers, body: montarBody(privacyLevel) })
  const initData = await initRes.json()
  if (initRes.ok && initData?.error?.code === 'ok') return initData

  if (isErroClienteNaoAuditado(initData) && privacyLevel !== 'SELF_ONLY') {
    const retryRes = await fetchComRateLimit(url, { method: 'POST', headers, body: montarBody('SELF_ONLY') })
    const retryData = await retryRes.json()
    if (retryRes.ok && retryData?.error?.code === 'ok') return retryData
    throw new Error(`[${retryData?.error?.code || retryRes.status}] ${retryData?.error?.message || 'Erro desconhecido'}`)
  }

  throw new Error(`[${initData?.error?.code || initRes.status}] ${initData?.error?.message || 'Erro desconhecido'}`)
}

// Consulta o status real do processamento depois do upload — o /init/ só
// confirma que o TikTok aceitou o envio, não que o vídeo já foi publicado de
// fato. Poucas tentativas com delay curto: o suficiente pro caso comum
// (alguns segundos), sem bloquear a resposta por muito tempo se demorar mais.
async function aguardarStatusPublicacaoTiktok(publishId, accessToken) {
  for (let tentativa = 0; tentativa < 3; tentativa++) {
    await new Promise(r => setTimeout(r, 2000))
    const res = await fetchComRateLimit('https://open.tiktokapis.com/v2/post/publish/status/fetch/', {
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
  const privacyLevel = await buscarPrivacyLevelPermitido(token.accessToken)

  // ── Vídeo ──
  if (isVideo) {
    const { buffer } = await mediaToBlob(items[0].path)
    // disable_duet/disable_comment/disable_stitch são obrigatórios pelas
    // diretrizes de integração do TikTok — sem eles, o
    // post/publish/video/init/ responde "Please review our integration
    // guidelines".
    const montarBody = privacy => JSON.stringify({
      post_info: {
        title: post.text || '',
        privacy_level: privacy,
        disable_duet: false,
        disable_comment: false,
        disable_stitch: false
      },
      source_info: { source: 'FILE_UPLOAD', video_size: buffer.length, chunk_size: buffer.length, total_chunk_count: 1 }
    })
    const initData = await initComFallbackPrivado(
      'https://open.tiktokapis.com/v2/post/publish/video/init/',
      montarBody,
      privacyLevel,
      { Authorization: `Bearer ${token.accessToken}`, 'Content-Type': 'application/json' }
    )

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

  // Para media_type PHOTO, o schema de post_info é diferente do de vídeo:
  // não existem disable_duet/disable_stitch (causam invalid_params se
  // enviados), title tem limite de 90 caracteres (não 2200), e
  // brand_content_toggle/brand_organic_toggle são obrigatórios.
  const montarBody = privacy => JSON.stringify({
    post_info: {
      title: (post.text || '').slice(0, 90),
      privacy_level: privacy,
      disable_comment: false,
      brand_content_toggle: false,
      brand_organic_toggle: false
    },
    source_info: {
      source: 'PULL_FROM_URL',
      photo_cover_index: 0,
      photo_images: photoImages
    },
    post_mode: 'DIRECT_POST',
    media_type: 'PHOTO'
  })
  const initData = await initComFallbackPrivado(
    'https://open.tiktokapis.com/v2/post/publish/content/init/',
    montarBody,
    privacyLevel,
    { Authorization: `Bearer ${token.accessToken}`, 'Content-Type': 'application/json' }
  )

  const { status, failReason } = await aguardarStatusPublicacaoTiktok(initData.data.publish_id, token.accessToken)
  if (status === 'FAILED') throw new Error(`TikTok rejeitou a foto após o envio (publish_id: ${initData.data.publish_id}, motivo: ${failReason || 'não informado'})`)

  return { ...initData.data, status }
}

module.exports = { publicarTiktok }
