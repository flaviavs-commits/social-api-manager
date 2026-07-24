// Adapter Threads (graph.threads.net) — mesmo modelo container→publish do
// Instagram, mas API própria e mais simples (sem espera assíncrona longa
// documentada como necessária no Instagram; ainda assim faz um poll curto de
// status antes de publicar, seguindo a recomendação oficial da doc).
const { mediaUrl } = require('./mediaFetch')

async function statusContainerThreads(containerId, accessToken) {
  const res = await fetch(`https://graph.threads.net/v1.0/${encodeURIComponent(containerId)}?fields=status,error_message&access_token=${encodeURIComponent(accessToken)}`)
  const data = await res.json()
  if (!res.ok || data.error) throw new Error(data?.error?.message || `Threads respondeu ${res.status} ao consultar status`)
  return data
}

async function aguardarContainerThreads(containerId, accessToken, { tentativas = 5, intervaloMs = 2000 } = {}) {
  for (let i = 0; i < tentativas; i++) {
    const { status, error_message } = await statusContainerThreads(containerId, accessToken)
    if (status === 'FINISHED') return
    if (status === 'ERROR') throw new Error(error_message || 'Threads encontrou um erro ao processar a mídia')
    await new Promise(r => setTimeout(r, intervaloMs))
  }
  // Não terminou dentro da janela de espera — tenta publicar mesmo assim
  // (a doc do Threads recomenda tentar após ~30s mesmo sem confirmação final).
}

async function criarContainerThreads(igUserId, accessToken, { text, item }) {
  const params = new URLSearchParams({ access_token: accessToken })
  if (text) params.append('text', text)

  if (item) {
    params.append('media_type', item.type === 'video' ? 'VIDEO' : 'IMAGE')
    params.append(item.type === 'video' ? 'video_url' : 'image_url', mediaUrl(item.path))
  } else {
    params.append('media_type', 'TEXT')
  }

  const res = await fetch(`https://graph.threads.net/v1.0/${igUserId}/threads`, { method: 'POST', body: params })
  const data = await res.json()
  if (!res.ok) throw new Error(data?.error?.message || `Threads respondeu ${res.status} ao criar container`)
  return data.id
}

async function publicarThreads(token, post) {
  const meRes = await fetch(`https://graph.threads.net/v1.0/me?fields=id&access_token=${encodeURIComponent(token.accessToken)}`)
  const meData = await meRes.json()
  if (!meRes.ok || !meData.id) throw new Error(meData?.error?.message || 'Não foi possível obter o ID da conta Threads')
  const userId = meData.id

  const items = post.mediaItems?.length ? post.mediaItems
    : post.mediaPath ? [{ path: post.mediaPath, type: post.mediaType }]
    : []

  // Threads suporta carrossel (children→pai, mesmo padrão do Instagram), mas
  // por ora publica só o primeiro item quando há mais de um — carrossel real
  // fica para quando houver demanda comprovada de uso (evita complexidade sem
  // necessidade, mesmo padrão de decisão já usado no Pinterest/X deste projeto).
  const item = items[0] || null
  if (!item && !post.text) throw new Error('Threads exige texto ou uma imagem/vídeo para publicar')

  const containerId = await criarContainerThreads(userId, token.accessToken, { text: post.text, item })
  await aguardarContainerThreads(containerId, token.accessToken)

  const publishRes = await fetch(`https://graph.threads.net/v1.0/${userId}/threads_publish`, {
    method: 'POST',
    body: new URLSearchParams({ creation_id: containerId, access_token: token.accessToken })
  })
  const publishData = await publishRes.json()
  if (!publishRes.ok) throw new Error(publishData?.error?.message || `Threads respondeu ${publishRes.status} ao publicar`)
  return publishData
}

module.exports = { publicarThreads }
