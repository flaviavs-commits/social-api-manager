const fs = require('fs')
const path = require('path')
const pool = require('../db/pool')
const { registrarLog } = require('../repositories/logsRepository')
const tokensRepo = require('./../repositories/tokensRepository')

const UPLOADS_DIR = path.join(__dirname, '../../public/uploads')
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000'

// ── Busca a conta+token conectados para a plataforma ─────────────────────────
// Por padrão, restringe ao dono do post. Super admins podem publicar usando
// qualquer conta conectada no sistema (de qualquer usuário), então para eles
// a busca ignora o dono e pega a mais recente entre todas.
// Se o usuário tiver mais de uma conta da mesma plataforma conectada, usa a
// mais recente (não há mais agrupamento por estrela/nicho).
async function buscarContaToken(platform, userId, isSuperAdmin = false) {
  const ownerFilter = isSuperAdmin ? '' : 'AND c.user_id = $2'
  const params = isSuperAdmin ? [platform] : [platform, userId]

  const { rows } = await pool.query(`
    SELECT
      t.id AS token_id, t.conta_id AS "contaId", t.access_token AS "accessToken",
      t.refresh_token AS "refreshToken", t.account_name AS "accountName",
      t.status, t.expires_at AS "expiresAt", c.handle AS handle
    FROM tokens t
    JOIN contas c ON c.id = t.conta_id
    WHERE t.platform = $1 ${ownerFilter}
    ORDER BY t.id DESC
    LIMIT 1
  `, params)

  return rows[0] || null
}

function mediaToBlob(mediaPath) {
  const filename = path.basename(mediaPath)
  const absPath = path.join(UPLOADS_DIR, filename)
  const buffer = fs.readFileSync(absPath)
  return { buffer, filename, absPath }
}

function mediaUrl(mediaPath) {
  return `${BASE_URL}${mediaPath}`
}

// ── Facebook (Graph API) ───────────────────────────────────────────────────────
async function publicarFacebook(token, post) {
  const pageId = token.handle || token.accountName
  if (!pageId) throw new Error('Conta Facebook sem ID/página configurado')

  if (!post.mediaPath && !post.mediaItems?.length) {
    const body = new URLSearchParams({ message: post.text || '', access_token: token.accessToken })
    const res = await fetch(`https://graph.facebook.com/v19.0/${encodeURIComponent(pageId)}/feed`, { method: 'POST', body })
    const data = await res.json()
    if (!res.ok) throw new Error(data?.error?.message || `Facebook respondeu ${res.status}`)
    return data
  }

  // ── Várias imagens/vídeos: publica cada um sem divulgar (published=false) e
  // depois cria um post no feed referenciando todos como attached_media ──
  if (post.mediaItems?.length > 1) {
    const attachedMedia = []
    for (const item of post.mediaItems) {
      const isVideoItem = item.type === 'video'
      const endpointItem = isVideoItem ? 'videos' : 'photos'
      const { buffer, filename } = mediaToBlob(item.path)

      const form = new FormData()
      form.append('access_token', token.accessToken)
      form.append('published', 'false')
      form.append('source', new Blob([buffer]), filename)

      const res = await fetch(`https://graph.facebook.com/v19.0/${encodeURIComponent(pageId)}/${endpointItem}`, { method: 'POST', body: form })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error?.message || `Facebook respondeu ${res.status} ao enviar item do carrossel`)
      attachedMedia.push({ media_fbid: data.id })
    }

    const body = new URLSearchParams({ access_token: token.accessToken })
    if (post.text) body.append('message', post.text)
    attachedMedia.forEach((m, i) => body.append(`attached_media[${i}]`, JSON.stringify(m)))

    const res = await fetch(`https://graph.facebook.com/v19.0/${encodeURIComponent(pageId)}/feed`, { method: 'POST', body })
    const data = await res.json()
    if (!res.ok) throw new Error(data?.error?.message || `Facebook respondeu ${res.status}`)
    return data
  }

  const isVideo = post.mediaType === 'video'
  const endpoint = isVideo ? 'videos' : 'photos'
  const { buffer, filename } = mediaToBlob(post.mediaPath)

  const form = new FormData()
  form.append('access_token', token.accessToken)
  if (post.text) form.append(isVideo ? 'description' : 'caption', post.text)
  form.append('source', new Blob([buffer]), filename)

  const res = await fetch(`https://graph.facebook.com/v19.0/${encodeURIComponent(pageId)}/${endpoint}`, { method: 'POST', body: form })
  const data = await res.json()
  if (!res.ok) throw new Error(data?.error?.message || `Facebook respondeu ${res.status}`)
  return data
}

// Aguarda o container de mídia do Instagram terminar de processar (IN_PROGRESS -> FINISHED).
// Publicar antes de FINISHED retorna "Media ID is not available".
async function aguardarContainerInstagram(containerId, accessToken) {
  for (let i = 0; i < 30; i++) {
    const statusRes = await fetch(`https://graph.instagram.com/v19.0/${encodeURIComponent(containerId)}?fields=status_code&access_token=${encodeURIComponent(accessToken)}`)
    const statusData = await statusRes.json()
    if (statusData.status_code === 'FINISHED') return
    if (statusData.status_code === 'ERROR') throw new Error('Processamento da mídia falhou no Instagram')
    await new Promise(r => setTimeout(r, 2000))
  }
}

// ── Instagram (Graph API - containers de mídia) ──────────────────────────────────
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
    const childIds = []
    for (const item of post.mediaItems) {
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
      await aguardarContainerInstagram(childData.id, token.accessToken)
      childIds.push(childData.id)
    }

    const carouselParams = new URLSearchParams({ access_token: token.accessToken, media_type: 'CAROUSEL', children: childIds.join(',') })
    if (post.text) carouselParams.append('caption', post.text)

    const createRes = await fetch(`https://graph.instagram.com/v19.0/${encodeURIComponent(igUserId)}/media`, { method: 'POST', body: carouselParams })
    const createData = await createRes.json()
    if (!createRes.ok) throw new Error(createData?.error?.message || `Instagram respondeu ${createRes.status} ao criar carrossel`)
    await aguardarContainerInstagram(createData.id, token.accessToken)

    const publishRes = await fetch(`https://graph.instagram.com/v19.0/${encodeURIComponent(igUserId)}/media_publish`, {
      method: 'POST',
      body: new URLSearchParams({ creation_id: createData.id, access_token: token.accessToken })
    })
    const publishData = await publishRes.json()
    if (!publishRes.ok) throw new Error(publishData?.error?.message || `Instagram respondeu ${publishRes.status}`)
    return publishData
  }

  // ── Imagem/vídeo único ──
  const isVideo = post.mediaType === 'video'
  const params = new URLSearchParams({ access_token: token.accessToken })
  if (post.text) params.append('caption', post.text)
  if (isVideo) {
    params.append('media_type', 'REELS')
    params.append('video_url', mediaUrl(post.mediaPath))
  } else {
    params.append('image_url', mediaUrl(post.mediaPath))
  }

  const createRes = await fetch(`https://graph.instagram.com/v19.0/${encodeURIComponent(igUserId)}/media`, { method: 'POST', body: params })
  const createData = await createRes.json()
  if (!createRes.ok) throw new Error(createData?.error?.message || `Instagram respondeu ${createRes.status}`)
  await aguardarContainerInstagram(createData.id, token.accessToken)

  const publishRes = await fetch(`https://graph.instagram.com/v19.0/${encodeURIComponent(igUserId)}/media_publish`, {
    method: 'POST',
    body: new URLSearchParams({ creation_id: createData.id, access_token: token.accessToken })
  })
  const publishData = await publishRes.json()
  if (!publishRes.ok) throw new Error(publishData?.error?.message || `Instagram respondeu ${publishRes.status}`)
  return publishData
}

// ── YouTube (Data API v3 - upload de vídeo) ──────────────────────────────────────
async function publicarYoutube(token, post) {
  if (!post.mediaPath || post.mediaType !== 'video') throw new Error('YouTube exige um vídeo para publicar')

  const { buffer } = mediaToBlob(post.mediaPath)

  // Vídeos verticais (9:16) ou quadrados (1:1) com até 3 minutos são elegíveis
  // como Shorts. A hashtag #Shorts no título/descrição ajuda o YouTube a
  // classificar o vídeo corretamente nesse formato.
  const isShort = post.youtubeIsShort === true
  let title = (post.youtubeTitle || post.text || 'Novo vídeo').slice(0, 100)
  let description = post.text || ''
  if (isShort && !/#shorts/i.test(title) && !/#shorts/i.test(description)) {
    description = description ? `${description}\n\n#Shorts` : '#Shorts'
  }

  const metadata = {
    snippet: {
      title,
      description
    },
    status: { privacyStatus: post.youtubeVisibility || 'public' }
  }

  const form = new FormData()
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }))
  form.append('media', new Blob([buffer]), 'video.mp4')

  const res = await fetch('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=multipart&part=snippet,status', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token.accessToken}` },
    body: form
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data?.error?.message || `YouTube respondeu ${res.status}`)
  return data
}

// ── TikTok (Content Posting API v2) ──────────────────────────────────────────────
async function publicarTiktok(token, post) {
  const items = post.mediaItems?.length ? post.mediaItems : (post.mediaPath ? [{ path: post.mediaPath, type: post.mediaType }] : [])
  if (!items.length) throw new Error('TikTok exige ao menos uma mídia para publicar')

  const isCarousel = items.length > 1 || (items.length === 1 && items[0].type === 'image')
  const isVideo    = items.length === 1 && items[0].type === 'video'

  // ── Vídeo ──
  if (isVideo) {
    const { buffer } = mediaToBlob(items[0].path)
    const initRes = await fetch('https://open.tiktokapis.com/v2/post/publish/video/init/', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        post_info: { title: post.text || '', privacy_level: 'SELF_ONLY' },
        source_info: { source: 'FILE_UPLOAD', video_size: buffer.length, chunk_size: buffer.length, total_chunk_count: 1 }
      })
    })
    const initData = await initRes.json()
    if (!initRes.ok || initData?.error?.code !== 'ok')
      throw new Error(initData?.error?.message || `TikTok respondeu ${initRes.status}`)

    const uploadRes = await fetch(initData.data.upload_url, {
      method: 'PUT',
      headers: { 'Content-Type': 'video/mp4', 'Content-Range': `bytes 0-${buffer.length - 1}/${buffer.length}` },
      body: buffer
    })
    if (!uploadRes.ok) throw new Error(`Falha no upload do vídeo para o TikTok (${uploadRes.status})`)
    return initData.data
  }

  // ── Foto única ou Carrossel ──
  // A Photo Post API só funciona em apps aprovados (produção).
  // Em Sandbox, envia como rascunho de vídeo usando a primeira imagem convertida,
  // para que apareça na caixa de entrada do TikTok e o usuário finalize lá.
  const { buffer: imgBuffer } = mediaToBlob(items[0].path)

  const initRes = await fetch('https://open.tiktokapis.com/v2/post/publish/video/init/', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token.accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      post_info: {
        title: post.text || '',
        privacy_level: 'SELF_ONLY',
        disable_duet: false,
        disable_comment: false,
        disable_stitch: false
      },
      source_info: {
        source: 'FILE_UPLOAD',
        video_size: imgBuffer.length,
        chunk_size: imgBuffer.length,
        total_chunk_count: 1
      },
      post_mode: 'MEDIA_UPLOAD'
    })
  })
  const initData = await initRes.json()
  if (!initRes.ok || initData?.error?.code !== 'ok')
    throw new Error(initData?.error?.message || `TikTok photo/draft respondeu ${initRes.status}: ${JSON.stringify(initData)}`)

  const uploadRes = await fetch(initData.data.upload_url, {
    method: 'PUT',
    headers: { 'Content-Type': 'image/jpeg', 'Content-Range': `bytes 0-${imgBuffer.length - 1}/${imgBuffer.length}` },
    body: imgBuffer
  })
  if (!uploadRes.ok) throw new Error(`Falha no upload da imagem para o TikTok (${uploadRes.status})`)

  return { ...initData.data, draft: true }
}

// ── Kwai (sem API pública de publicação - integração via login/senha) ────────────
async function publicarKwai(token, post) {
  // O Kwai não disponibiliza uma API pública/oficial para publicação de conteúdo
  // por aplicações de terceiros. A conexão é feita via login/senha (simulada),
  // então a publicação aqui também é simulada para fins de teste do fluxo.
  return {
    simulado: true,
    conta: token.handle || token.accountName,
    mediaType: post.mediaType,
    mensagem: 'Kwai não possui API pública de publicação - resultado simulado'
  }
}

const PUBLISHERS = {
  facebook: publicarFacebook,
  instagram: publicarInstagram,
  youtube: publicarYoutube,
  tiktok: publicarTiktok,
  kwai: publicarKwai
}

// ── Publica um post (já salvo no banco) em todas as suas plataformas ─────────────
async function publishPost(post) {
  const results = []
  const isSuperAdmin = post.userRole === 'super_admin'

  for (const platform of post.platforms) {
    const publisher = PUBLISHERS[platform]
    if (!publisher) {
      results.push({ platform, success: false, error: `Plataforma "${platform}" não suportada` })
      continue
    }

    let token = await buscarContaToken(platform, post.userId, isSuperAdmin)
    if (!token) {
      const msg = `Nenhuma conta de ${platform} conectada`
      results.push({ platform, success: false, error: msg })
      await registrarLog({ type: 'err', message: `Publicação falhou [${platform}]: ${msg}`, platform, user_id: post.userId })
      continue
    }

    // ── Renovação automática do token antes de publicar, se necessário ──
    // Chamada interna do scheduler (sem requisição HTTP/usuário autenticado),
    // então passa isAdmin=true para não exigir a checagem de propriedade do
    // token que só faz sentido quando um usuário pede a renovação pela API.
    if (token.status !== 'valid') {
      const renewal = await tokensRepo.renovarToken(token.token_id, null, true)
      if (renewal.success) {
        token = await buscarContaToken(platform, post.userId, isSuperAdmin)
      } else {
        results.push({ platform, success: false, account: token.handle || token.accountName, error: renewal.message })
        await registrarLog({
          type: 'err',
          message: `Falha ao publicar [${platform}] em "${token.handle || token.accountName}": ${renewal.message}`,
          platform,
          conta_id: token.contaId,
          user_id: post.userId
        })
        continue
      }
    }

    try {
      const data = await publisher(token, post)
      results.push({ platform, success: true, account: token.handle || token.accountName, data })

      if (data?.simulado) {
        await registrarLog({
          type: 'warn',
          message: `Publicação simulada [${platform}] na conta "${token.handle || token.accountName}" — ${data.mensagem || 'não foi postado de fato'}`,
          platform,
          conta_id: token.contaId,
          user_id: post.userId
        })
      } else {
        await registrarLog({
          type: 'ok',
          message: `Post publicado [${platform}] na conta "${token.handle || token.accountName}"`,
          platform,
          conta_id: token.contaId,
          user_id: post.userId
        })
      }
    } catch (err) {
      results.push({ platform, success: false, account: token.handle || token.accountName, error: err.message })
      await registrarLog({
        type: 'err',
        message: `Falha ao publicar [${platform}] em "${token.handle || token.accountName}": ${err.message}`,
        platform,
        conta_id: token.contaId,
        user_id: post.userId
      })
    }
  }

  return results
}

module.exports = { publishPost, buscarContaToken }
