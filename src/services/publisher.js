const fs = require('fs')
const path = require('path')
const pool = require('../db/pool')
const { registrarLog, broadcastEvent } = require('../repositories/logsRepository')
const tokensRepo = require('./../repositories/tokensRepository')
const postsRepo = require('./../repositories/postsRepository')
const { gerarTokenMedia } = require('./mediaToken')

const UPLOADS_DIR = path.join(__dirname, '../../public/uploads')
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000'

// ── Busca a conta+token conectados para a plataforma ─────────────────────────
// Por padrão, restringe ao dono do post. Super admins podem publicar usando
// qualquer conta conectada no sistema (de qualquer usuário), então para eles
// a busca ignora o dono e pega a mais recente entre todas.
// Se contaId for informado, busca exatamente essa conta (escolhida pelo
// usuário ao agendar o post); senão usa a mais recente conectada na
// plataforma (não há mais agrupamento por estrela/nicho).
async function buscarContaToken(platform, userId, isSuperAdmin = false, contaId = null) {
  const conds = ['t.platform = $1']
  const params = [platform]
  if (!isSuperAdmin) { params.push(userId); conds.push(`c.user_id = $${params.length}`) }
  if (contaId) { params.push(contaId); conds.push(`c.id = $${params.length}`) }

  const { rows } = await pool.query(`
    SELECT
      t.id AS token_id, t.conta_id AS "contaId", t.access_token AS "accessToken",
      t.refresh_token AS "refreshToken", t.account_name AS "accountName",
      t.status, t.expires_at AS "expiresAt", c.handle AS handle
    FROM tokens t
    JOIN contas c ON c.id = t.conta_id
    WHERE ${conds.join(' AND ')}
    ORDER BY t.id DESC
    LIMIT 1
  `, params)

  return rows[0] || null
}

// Lista todos os tokens conectados de uma plataforma para o usuário (não só
// o mais recente). Usado para reconciliar posts antigos com o post real na
// rede social, quando ainda não se sabe qual conta publicou cada post.
async function listarContasToken(platform, userId, isSuperAdmin = false) {
  const conds = ['t.platform = $1']
  const params = [platform]
  if (!isSuperAdmin) { params.push(userId); conds.push(`c.user_id = $${params.length}`) }

  const { rows } = await pool.query(`
    SELECT
      t.id AS token_id, t.conta_id AS "contaId", t.access_token AS "accessToken",
      t.refresh_token AS "refreshToken", t.account_name AS "accountName",
      t.status, t.expires_at AS "expiresAt", c.handle AS handle
    FROM tokens t
    JOIN contas c ON c.id = t.conta_id
    WHERE ${conds.join(' AND ')}
    ORDER BY t.id DESC
  `, params)

  return rows
}

// Extrai o ID do post/mídia na rede social a partir da resposta de cada
// publisher, para permitir buscar métricas (likes/comentários) depois.
// TikTok não retorna um ID público utilizável (a Content Posting API
// devolve só um publish_id interno, assíncrono) e Kwai é simulado — ambos
// ficam sem métricas.
function extrairExternalId(platform, data) {
  if (platform === 'facebook') return data?.id || null
  if (platform === 'instagram') return data?.id || null
  if (platform === 'youtube') return data?.id || null
  return null
}

// Mídias novas são salvas no Vercel Blob — mediaPath já vem como uma URL
// pública completa (https://...blob.vercel-storage.com/...). Mantém suporte a
// posts antigos ainda com path relativo (/uploads/...), criados antes da
// migração para o Blob, para não quebrar nada que já estivesse na fila no
// momento do deploy.
function isUrlExterna(mediaPath) {
  return /^https?:\/\//i.test(mediaPath)
}

async function mediaToBlob(mediaPath) {
  if (isUrlExterna(mediaPath)) {
    const res = await fetch(mediaPath)
    if (!res.ok) throw new Error(`Falha ao baixar mídia (${res.status}): ${mediaPath}`)
    const buffer = Buffer.from(await res.arrayBuffer())
    return { buffer, filename: path.basename(new URL(mediaPath).pathname) }
  }

  const filename = path.basename(mediaPath)
  const absPath = path.join(UPLOADS_DIR, filename)
  const buffer = fs.readFileSync(absPath)
  return { buffer, filename, absPath }
}

// URL que Instagram/TikTok/etc usam para baixar a mídia diretamente. Mídias
// no Blob já têm URL pública própria — usa direto. Posts antigos com path
// relativo (/uploads/...) continuam usando o token assinado de curta duração,
// já que /uploads normalmente exige sessão e essas APIs não enviam cookie.
function mediaUrl(mediaPath) {
  if (isUrlExterna(mediaPath)) return mediaPath

  const filename = path.basename(mediaPath)
  const token = gerarTokenMedia(filename)
  return `${BASE_URL}${mediaPath}?token=${token}`
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
  form.append('source', new Blob([buffer]), filename)

  const res = await fetch(`https://graph.facebook.com/v19.0/${encodeURIComponent(pageId)}/${endpoint}`, { method: 'POST', body: form })
  const data = await res.json()
  if (!res.ok) throw new Error(data?.error?.message || `Facebook respondeu ${res.status}`)
  return data
}

// Aguarda o container de mídia do Instagram terminar de processar (IN_PROGRESS -> FINISHED).
// Publicar antes de FINISHED retorna "Media ID is not available".
// Backoff: a maioria dos containers de imagem termina em poucos segundos, então as
// primeiras tentativas são rápidas (500ms/1s) e o intervalo cresce até 2s — reduz a
// espera média sem aumentar o número de chamadas em casos lentos (~60s de budget total).
const INSTAGRAM_POLL_DELAYS_MS = [500, 1000, 1500, 2000]
async function aguardarContainerInstagram(containerId, accessToken) {
  const inicio = Date.now()
  let tentativa = 0
  while (Date.now() - inicio < 60000) {
    const statusRes = await fetch(`https://graph.instagram.com/v19.0/${encodeURIComponent(containerId)}?fields=status_code&access_token=${encodeURIComponent(accessToken)}`)
    const statusData = await statusRes.json()
    if (statusData.status_code === 'FINISHED') return
    if (statusData.status_code === 'ERROR') throw new Error('Processamento da mídia falhou no Instagram')
    const delay = INSTAGRAM_POLL_DELAYS_MS[Math.min(tentativa, INSTAGRAM_POLL_DELAYS_MS.length - 1)]
    await new Promise(r => setTimeout(r, delay))
    tentativa++
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
    // Cada item do carrossel é independente (container próprio na Graph API), então
    // criar + aguardar o processamento de todos em paralelo reduz o tempo total de
    // N × tempo-por-item para o máximo entre eles.
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
      await aguardarContainerInstagram(childData.id, token.accessToken)
      return childData.id
    }))

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

// Consulta o status de processamento do vídeo (uploadStatus/processingStatus) até
// ele ficar pronto ou falhar, e notifica o frontend via SSE quando isso acontece —
// sem isso, o vídeo passa minutos com status "publicado" no app mas ainda
// "processando" de fato no YouTube, sem nenhuma confirmação de quando fica
// disponível. Roda em background (não bloqueia a resposta da publicação).
async function aguardarProcessamentoYoutube(videoId, accessToken, post) {
  for (let i = 0; i < 40; i++) {
    await new Promise(r => setTimeout(r, i === 0 ? 3000 : 5000))
    try {
      const res = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=status,processingDetails&id=${encodeURIComponent(videoId)}`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      })
      const data = await res.json()
      const status = data.items?.[0]?.status
      const processing = data.items?.[0]?.processingDetails
      if (!status) continue

      if (status.uploadStatus === 'processed' && (!processing || processing.processingStatus === 'succeeded')) {
        broadcastEvent('youtube_video_ready', { postId: post.id, videoId, status: 'ready' }, post.userId)
        await registrarLog({ type: 'ok', message: `Vídeo do YouTube processado e disponível: ${videoId}`, platform: 'youtube', user_id: post.userId })
        return
      }
      if (status.uploadStatus === 'failed' || status.uploadStatus === 'rejected') {
        broadcastEvent('youtube_video_ready', { postId: post.id, videoId, status: 'failed', reason: status.failureReason || status.rejectionReason }, post.userId)
        await registrarLog({ type: 'err', message: `Processamento do vídeo no YouTube falhou: ${status.failureReason || status.rejectionReason || 'motivo desconhecido'}`, platform: 'youtube', user_id: post.userId })
        return
      }
    } catch {
      // Falha pontual de polling não é crítica — tenta de novo no próximo ciclo
    }
  }
}

// ── YouTube (Data API v3 - upload resumable de vídeo) ─────────────────────────────
// Upload resumable em vez de multipart: envia o vídeo em um PUT único de stream
// (em vez de montar um multipart/form-data com o arquivo todo em memória),
// permite retomar em caso de falha de rede a meio do envio, e os primeiros bytes
// começam a subir antes do buffer inteiro estar pronto — reduz o tempo de envio,
// especialmente para vídeos grandes.
async function publicarYoutube(token, post) {
  if (!post.mediaPath || post.mediaType !== 'video') throw new Error('YouTube exige um vídeo para publicar')

  // Mídia no Blob: precisa baixar o vídeo antes de poder fazer o upload
  // resumable a partir de um stream/tamanho conhecido. Posts antigos (path
  // relativo /uploads/...) continuam lendo direto do disco local.
  const usandoBlob = isUrlExterna(post.mediaPath)
  let size, bodyStream
  if (usandoBlob) {
    const { buffer } = await mediaToBlob(post.mediaPath)
    size = buffer.length
    bodyStream = buffer
  } else {
    const filename = path.basename(post.mediaPath)
    const absPath = path.join(UPLOADS_DIR, filename)
    size = fs.statSync(absPath).size
    bodyStream = fs.createReadStream(absPath)
  }

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
    snippet: { title, description },
    status: { privacyStatus: post.youtubeVisibility || 'public' }
  }

  // 1. Inicia a sessão resumable — devolve a upload_url onde o vídeo deve ser enviado
  const initRes = await fetch('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token.accessToken}`,
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': 'video/mp4',
      'X-Upload-Content-Length': String(size)
    },
    body: JSON.stringify(metadata)
  })
  if (!initRes.ok) {
    const errData = await initRes.json().catch(() => null)
    throw new Error(errData?.error?.message || `YouTube respondeu ${initRes.status} ao iniciar upload`)
  }
  const uploadUrl = initRes.headers.get('location')
  if (!uploadUrl) throw new Error('YouTube não retornou a URL de upload resumable')

  // 2. Envia o vídeo via stream (path local) ou buffer (mídia no Blob)
  const uploadRes = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': 'video/mp4', 'Content-Length': String(size) },
    body: bodyStream,
    ...(usandoBlob ? {} : { duplex: 'half' })
  })
  const data = await uploadRes.json()
  if (!uploadRes.ok) throw new Error(data?.error?.message || `YouTube respondeu ${uploadRes.status} ao enviar o vídeo`)

  // 3. Acompanha o processamento em background e notifica o frontend quando
  // o vídeo realmente ficar disponível — não bloqueia a resposta da publicação.
  if (data.id) aguardarProcessamentoYoutube(data.id, token.accessToken, post).catch(() => {})

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
    const { buffer } = await mediaToBlob(items[0].path)
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
  // Usa o endpoint de Content Posting API dedicado a fotos (media_type: PHOTO),
  // que aceita as imagens por URL pública (PULL_FROM_URL) em vez de upload binário.
  const photoImages = items.map(item => mediaUrl(item.path))

  const initRes = await fetch('https://open.tiktokapis.com/v2/post/publish/content/init/', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token.accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      post_info: {
        title: post.text || '',
        privacy_level: 'SELF_ONLY',
        disable_comment: false
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
    throw new Error(initData?.error?.message || `TikTok photo respondeu ${initRes.status}: ${JSON.stringify(initData)}`)

  return initData.data
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

// Publica em uma única plataforma e retorna o resultado (registrando o log
// correspondente) — extraído para permitir publicar em todas as plataformas
// do post em paralelo, em vez de uma por vez.
async function publicarNaPlataforma(platform, post, isSuperAdmin) {
  const publisher = PUBLISHERS[platform]
  if (!publisher) {
    return { platform, success: false, error: `Plataforma "${platform}" não suportada` }
  }

  let token = await buscarContaToken(platform, post.userId, isSuperAdmin, post.accountId)
  if (!token) {
    const msg = `Nenhuma conta de ${platform} conectada`
    await registrarLog({ type: 'err', message: `Publicação falhou [${platform}]: ${msg}`, platform, user_id: post.userId })
    return { platform, success: false, error: msg }
  }

  // ── Renovação automática do token antes de publicar, se necessário ──
  // Chamada interna do scheduler (sem requisição HTTP/usuário autenticado),
  // então passa isAdmin=true para não exigir a checagem de propriedade do
  // token que só faz sentido quando um usuário pede a renovação pela API.
  if (token.status !== 'valid') {
    const renewal = await tokensRepo.renovarToken(token.token_id, null, true)
    if (renewal.success) {
      token = await buscarContaToken(platform, post.userId, isSuperAdmin, post.accountId)
    } else {
      await registrarLog({
        type: 'err',
        message: `Falha ao publicar [${platform}] em "${token.handle || token.accountName}": ${renewal.message}`,
        platform,
        conta_id: token.contaId,
        user_id: post.userId
      })
      return { platform, success: false, account: token.handle || token.accountName, error: renewal.message }
    }
  }

  try {
    const data = await publisher(token, post)

    const externalId = extrairExternalId(platform, data)
    if (externalId) {
      await postsRepo.salvarPublicacaoExterna(post.id, {
        externalPostId: externalId,
        externalPlatform: platform,
        publishedAt: new Date().toISOString()
      })
    }

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

    return { platform, success: true, account: token.handle || token.accountName, data }
  } catch (err) {
    await registrarLog({
      type: 'err',
      message: `Falha ao publicar [${platform}] em "${token.handle || token.accountName}": ${err.message}`,
      platform,
      conta_id: token.contaId,
      user_id: post.userId
    })
    return { platform, success: false, account: token.handle || token.accountName, error: err.message }
  }
}

// ── Publica um post (já salvo no banco) em todas as suas plataformas ─────────────
// As plataformas são independentes entre si (contas/tokens/APIs distintas), então
// publicar em paralelo reduz o tempo total da soma dos tempos para o máximo entre elas.
async function publishPost(post) {
  const isSuperAdmin = post.userRole === 'super_admin'
  return Promise.all(post.platforms.map(platform => publicarNaPlataforma(platform, post, isSuperAdmin)))
}

module.exports = { publishPost, buscarContaToken, listarContasToken }
