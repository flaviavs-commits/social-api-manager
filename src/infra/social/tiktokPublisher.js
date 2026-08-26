// Adapter TikTok (Content Posting API v2).
const { mediaToBlob } = require('./mediaFetch')
const { fetchComRateLimit } = require('./rateLimitedFetch')

// A Content Posting API exige consultar as opções de privacidade permitidas
// para a conta antes de publicar (ex: contas de menores de idade não podem
// postar público) — publicar direto com PUBLIC_TO_EVERYONE sem checar falha
// com privacy_level_option_mismatch mesmo em apps aprovados. As Content
// Sharing Guidelines (https://developers.tiktok.com/doc/content-sharing-guidelines/)
// também exigem mostrar essas opções ao usuário antes de publicar (dropdown
// de privacidade sem valor default, checkboxes de comentário/duet/stitch) —
// por isso esta consulta é exposta para a tela de criação de post chamar
// antecipadamente, não só no momento de publicar.
//
// Importante: essa lista reflete o que a CONTA do usuário permite, não o que
// o APP está autorizado a usar de fato. Um app que ainda não passou pelo
// audit de conteúdo do TikTok recebe PUBLIC_TO_EVERYONE aqui mesmo assim, e só
// descobre a restrição real ao tentar publicar (erro
// unaudited_client_can_only_post_to_private_accounts, tratado em
// initComFallbackPrivado abaixo).
async function buscarCreatorInfo(accessToken) {
  const res = await fetchComRateLimit('https://open.tiktokapis.com/v2/post/publish/creator_info/query/', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }
  })
  const data = await res.json()
  if (!res.ok || data?.error?.code !== 'ok')
    throw new Error(data?.error?.message || `TikTok respondeu ${res.status} ao consultar permissões da conta`)

  const d = data.data || {}
  return {
    creatorNickname: d.creator_nickname || null,
    creatorUsername: d.creator_username || null,
    creatorAvatarUrl: d.creator_avatar_url || null,
    privacyLevelOptions: d.privacy_level_options || [],
    commentDisabled: !!d.comment_disabled,
    duetDisabled: !!d.duet_disabled,
    stitchDisabled: !!d.stitch_disabled,
    maxVideoPostDurationSec: d.max_video_post_duration_sec ?? null
  }
}

async function buscarPrivacyLevelPermitido(accessToken) {
  const { privacyLevelOptions: options } = await buscarCreatorInfo(accessToken)
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

// Chama o endpoint de init de vídeo com o privacyLevel pedido; se o
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
  if (items.length !== 1 || items[0].type !== 'video') {
    throw new Error('O adaptador direto legado do TikTok aceita somente um vídeo; contas atuais publicam imagens pelo Zernio.')
  }

  // A privacidade e as interações (comentário/duet/stitch) são escolhidas
  // pelo usuário na tela de post (exigência das Content Sharing Guidelines —
  // ver GET /api/posts/tiktok-creator-info e o dropdown/checkboxes no frontend).
  // Posts antigos ou criados antes dessa tela existir não têm esses campos
  // salvos — nesse caso, mantém o comportamento anterior (auto-detecção de
  // privacidade + interações sempre permitidas) em vez de falhar.
  const privacyLevel = post.tiktokPrivacyLevel || await buscarPrivacyLevelPermitido(token.accessToken)
  const disableComment = post.tiktokDisableComment ?? false
  const disableDuet = post.tiktokDisableDuet ?? false
  const disableStitch = post.tiktokDisableStitch ?? false
  const tiktokDescription = post.textByPlatform?.tiktokDescription || post.text || ''

  const { buffer } = await mediaToBlob(items[0].path)
  // disable_duet/disable_comment/disable_stitch são obrigatórios pelas
  // diretrizes de integração do TikTok — sem eles, o
  // post/publish/video/init/ responde "Please review our integration
  // guidelines".
  const montarBody = privacy => JSON.stringify({
    post_info: {
      title: tiktokDescription.slice(0, 2200),
      privacy_level: privacy,
      disable_duet: disableDuet,
      disable_comment: disableComment,
      disable_stitch: disableStitch
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

module.exports = { publicarTiktok, buscarCreatorInfo }
