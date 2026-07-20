// Adapter Instagram (Graph API - containers de mídia). Cria o(s) container(s)
// e devolve um estado "pending" em vez de esperar o processamento terminar
// (que pode levar até 60s+) — publicar de fato (media_publish) acontece
// depois, via finalizarPublicacaoInstagram(), chamada pelo cron. Isso evita
// bloquear a função/request por tempo demais, o que em ambiente serverless
// arrisca exceder o timeout da invocação.
const { mediaUrl } = require('./mediaFetch')

// Consulta o status_code de um container do Instagram (IN_PROGRESS, FINISHED,
// ERROR) — usada pela finalização via cron, sem bloquear a função esperando:
// cada chamada é "uma olhada", não um loop.
async function statusContainerInstagram(containerId, accessToken) {
  const res = await fetch(`https://graph.instagram.com/v19.0/${encodeURIComponent(containerId)}?fields=status_code&access_token=${encodeURIComponent(accessToken)}`)
  const data = await res.json()
  // Resposta de erro da API (token expirado, container inválido etc.) não tem
  // status_code — sem essa checagem, o post ficaria pendente para sempre, já
  // que nem 'FINISHED' nem 'ERROR' seriam retornados.
  if (!res.ok || data.error) throw new Error(data?.error?.message || `Instagram respondeu ${res.status} ao consultar status do container`)
  return data.status_code
}

async function publicarInstagram(token, post) {
  if (!post.mediaPath && !post.mediaItems?.length) throw new Error('Instagram exige uma imagem ou vídeo para publicar')

  // Tokens do fluxo "Instagram API with Instagram Login" (IGAA...) só funcionam
  // em graph.instagram.com, e o id da conta precisa ser buscado via /me
  // (o handle salvo é o @username, não o id numérico).
  const meRes = await fetch(`https://graph.instagram.com/me?fields=user_id&access_token=${encodeURIComponent(token.accessToken)}`)
  const meData = await meRes.json()
  if (!meRes.ok || !meData.user_id) throw new Error(meData?.error?.message || 'Não foi possível obter o ID da conta Instagram')
  const igUserId = meData.user_id

  // ── Carrossel (múltiplas imagens/vídeos) ──
  if (post.mediaItems?.length > 1) {
    // Cada item do carrossel tem seu próprio container na Graph API — criados
    // em paralelo, sem esperar o processamento de nenhum deles aqui.
    const childIds = await Promise.all(post.mediaItems.map(async item => {
      const childParams = new URLSearchParams({ access_token: token.accessToken, is_carousel_item: 'true' })
      if (item.type === 'video') {
        childParams.append('media_type', 'VIDEO')
        childParams.append('video_url', mediaUrl(item.path))
      } else {
        childParams.append('image_url', mediaUrl(item.path))
      }
      const childRes = await fetch(`https://graph.instagram.com/v19.0/${encodeURIComponent(igUserId)}/media`, { method: 'POST', body: childParams })
      const childData = await childRes.json()
      if (!childRes.ok) throw new Error(childData?.error?.message || `Instagram respondeu ${childRes.status} ao criar item do carrossel`)
      return childData.id
    }))

    return {
      pending: true,
      stage: 'carousel_children',
      igUserId,
      childIds,
      caption: post.text || null
    }
  }

  // ── Imagem/vídeo único ──
  const isVideo = post.mediaType === 'video'
  // Sem escolha explícita, vídeo continua virando Reel (comportamento
  // padrão de sempre) — só quem escolhe "Post" força vídeo de feed comum, e
  // só quem escolhe "Story" usa o formato efêmero (24h, sem legenda).
  const format = post.igFormat || (isVideo ? 'reel' : 'post')
  const params = new URLSearchParams({ access_token: token.accessToken })
  // Stories não aceita o parâmetro caption na Graph API do Instagram.
  if (format !== 'story' && post.text) params.append('caption', post.text)
  if (format === 'story') {
    params.append('media_type', 'STORIES')
    params.append(isVideo ? 'video_url' : 'image_url', mediaUrl(post.mediaPath))
  } else if (isVideo) {
    params.append('media_type', format === 'post' ? 'VIDEO' : 'REELS')
    params.append('video_url', mediaUrl(post.mediaPath))
  } else {
    params.append('image_url', mediaUrl(post.mediaPath))
  }

  const createRes = await fetch(`https://graph.instagram.com/v19.0/${encodeURIComponent(igUserId)}/media`, { method: 'POST', body: params })
  const createData = await createRes.json()
  if (!createRes.ok) throw new Error(createData?.error?.message || `Instagram respondeu ${createRes.status}`)

  return {
    pending: true,
    stage: 'single_media',
    igUserId,
    containerId: createData.id
  }
}

// Cria o container final (single media ou carrossel) e publica de fato —
// chamado só depois que o(s) container(s) já estão FINISHED, então não há
// espera bloqueante aqui além de duas chamadas HTTP rápidas e sequenciais.
async function finalizarPublicacaoInstagram(pending) {
  const { igUserId, accessToken } = pending

  let creationId
  if (pending.stage === 'carousel_children') {
    const carouselParams = new URLSearchParams({ access_token: accessToken, media_type: 'CAROUSEL', children: pending.childIds.join(',') })
    if (pending.caption) carouselParams.append('caption', pending.caption)
    const createRes = await fetch(`https://graph.instagram.com/v19.0/${encodeURIComponent(igUserId)}/media`, { method: 'POST', body: carouselParams })
    const createData = await createRes.json()
    if (!createRes.ok) throw new Error(createData?.error?.message || `Instagram respondeu ${createRes.status} ao criar carrossel`)
    creationId = createData.id
    // O container pai do carrossel precisa processar antes de publicar.
    // Se não ficar pronto em 10s, devolve pendente para o cron tentar de novo
    // no próximo tick — evita erro falso quando o Instagram demora mais.
    let carouselReady = false
    for (let i = 0; i < 10; i++) {
      const status = await statusContainerInstagram(creationId, accessToken)
      if (status === 'FINISHED') { carouselReady = true; break }
      if (status === 'ERROR') throw new Error('O Instagram não conseguiu montar o carrossel. Verifique se as imagens/vídeos são válidos e tente novamente.')
      await new Promise(r => setTimeout(r, 1000))
    }
    if (!carouselReady) {
      // Salva o container pai como pendente para o cron finalizar
      return { requeue: true, containerId: creationId }
    }
  } else if (pending.stage === 'carousel_container') {
    creationId = pending.containerId
  } else {
    creationId = pending.containerId
  }

  const publishRes = await fetch(`https://graph.instagram.com/v19.0/${encodeURIComponent(igUserId)}/media_publish`, {
    method: 'POST',
    body: new URLSearchParams({ creation_id: creationId, access_token: accessToken })
  })
  const publishData = await publishRes.json()
  if (!publishRes.ok) throw new Error(publishData?.error?.message || `Instagram respondeu ${publishRes.status}`)
  return publishData
}

module.exports = { publicarInstagram, statusContainerInstagram, finalizarPublicacaoInstagram }
