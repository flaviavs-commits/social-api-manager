// Adapter YouTube (Data API v3 - upload resumable de vídeo).
const fs = require('fs')
const path = require('path')
const { registrarLog, broadcastEvent } = require('../../repositories/logsRepository')
const { isUrlExterna, mediaToBlob, UPLOADS_DIR } = require('./mediaFetch')

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

  // selfDeclaredMadeForKids é obrigatório pela API (exigência legal da
  // FTC/COPPA) — validarCriacaoPost já garante que o usuário escolheu
  // explicitamente antes de chegar aqui, não existe default seguro.
  const metadata = {
    snippet: { title, description, ...(post.youtubeCategoryId ? { categoryId: post.youtubeCategoryId } : {}) },
    status: { privacyStatus: post.youtubeVisibility || 'public', selfDeclaredMadeForKids: post.youtubeMadeForKids === true }
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

module.exports = { publicarYoutube }
