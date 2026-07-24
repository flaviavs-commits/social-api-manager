// Adapter Pinterest (API v5). Publica um Pin (imagem ou vídeo) num board.
// Imagem aceita URL pública direta (media_source.image_url) — usa mediaUrl()
// como Instagram/Threads. Vídeo NÃO tem source_type por URL na API v5 (não
// existe "video_url", apesar de existir para imagem): exige registrar a
// mídia primeiro em /v5/media, fazer upload do binário, aguardar o
// processamento, e só então criar o Pin com video_id. Confirmado contra o
// quickstart oficial (github.com/pinterest/api-quickstart) e a documentação
// atual — um "video_url" direto retornaria erro de validação da API.
const path = require('path')
const os = require('os')
const fs = require('fs')
const crypto = require('crypto')
const { pipeline } = require('stream/promises')
const { mediaUrl, mediaToBlob } = require('./mediaFetch')
const { extrairFrame } = require('../storage/videoThumbnail')
const { salvarBuffer } = require('../storage/blobStorage')

// Vídeo de Pin exige cover_image_url própria (uma IMAGEM, não pode ser a URL
// do vídeo) — a API retorna 400 sem isso e não gera thumbnail automática.
// Baixa o vídeo para um arquivo temporário (ffmpeg só funciona com path
// local, mesmo padrão de probarVideos em criarPost.js), extrai um frame em
// disco e sobe o JPEG resultante ao Blob storage.
async function gerarCapaDoVideo(item) {
  const tmpPath = path.join(os.tmpdir(), `${crypto.randomUUID()}.mp4`)
  try {
    const res = await fetch(mediaUrl(item.path))
    if (!res.ok) throw new Error(`Falha ao baixar vídeo para gerar capa (${res.status})`)
    await pipeline(res.body, fs.createWriteStream(tmpPath))
    const frameBuffer = await extrairFrame(tmpPath)
    return await salvarBuffer(`${crypto.randomUUID()}.jpg`, frameBuffer, 'image/jpeg')
  } finally {
    await fs.promises.unlink(tmpPath).catch(() => {})
  }
}

// Aguarda o processamento do vídeo enviado (status succeeded/failed) — sem
// isso, criar o Pin logo após o upload falha porque a mídia ainda não está
// pronta para ser referenciada por video_id.
async function aguardarProcessamentoMidia(token, mediaId, { tentativas = 15, intervaloMs = 2000 } = {}) {
  for (let i = 0; i < tentativas; i++) {
    const res = await fetch(`https://api.pinterest.com/v5/media/${encodeURIComponent(mediaId)}`, {
      headers: { Authorization: `Bearer ${token.accessToken}` }
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data?.message || `Pinterest respondeu ${res.status} ao consultar status da mídia`)
    if (data.status === 'succeeded') return
    if (data.status === 'failed') throw new Error('Pinterest falhou ao processar o vídeo enviado')
    await new Promise(r => setTimeout(r, intervaloMs))
  }
  throw new Error('Pinterest não terminou de processar o vídeo a tempo')
}

// Registra a mídia, sobe o binário para a URL assinada devolvida (formato
// multipart/form-data com campos fixos vindos de upload_parameters, padrão
// de presigned POST), e aguarda o processamento terminar.
async function subirVideoPinterest(token, item) {
  const registroRes = await fetch('https://api.pinterest.com/v5/media', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token.accessToken}` },
    body: JSON.stringify({ media_type: 'video' })
  })
  const registro = await registroRes.json()
  if (!registroRes.ok) throw new Error(registro?.message || `Pinterest respondeu ${registroRes.status} ao registrar mídia`)

  const { buffer, filename } = await mediaToBlob(item.path)
  const form = new FormData()
  for (const [chave, valor] of Object.entries(registro.upload_parameters || {})) form.append(chave, valor)
  form.append('file', new Blob([buffer]), filename)

  const uploadRes = await fetch(registro.upload_url, { method: 'POST', body: form })
  if (!uploadRes.ok) throw new Error(`Pinterest respondeu ${uploadRes.status} ao enviar o arquivo de vídeo`)

  await aguardarProcessamentoMidia(token, registro.media_id)
  return registro.media_id
}

// Upload do vídeo e geração da capa não dependem um do outro — roda em
// paralelo para não somar os dois tempos de processamento.
async function montarMediaSourceVideo(token, item) {
  const [mediaId, coverImageUrl] = await Promise.all([subirVideoPinterest(token, item), gerarCapaDoVideo(item)])
  return { source_type: 'video_id', media_id: mediaId, cover_image_url: coverImageUrl }
}

async function publicarUmPin(token, boardId, item, text) {
  const isVideo = item.type === 'video'
  const mediaSource = isVideo
    ? await montarMediaSourceVideo(token, item)
    : { source_type: 'image_url', url: mediaUrl(item.path) }

  const body = {
    board_id: boardId,
    title: (text || '').slice(0, 100) || undefined,
    description: text || undefined,
    media_source: mediaSource
  }

  const res = await fetch('https://api.pinterest.com/v5/pins', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token.accessToken}` },
    body: JSON.stringify(body)
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data?.message || `Pinterest respondeu ${res.status}`)
  return data
}

// Pinterest exige um board_id para cada Pin, mas o produto ainda não tem uma
// tela de escolha de board por post — usa o primeiro board da conta (mais
// antigo primeiro) como destino padrão. Trocar por um seletor de board no
// formulário de post é um passo natural quando houver demanda, sem exigir
// mudança nesta função (só passar post.pinterestBoardId, se existir).
async function buscarPrimeiroBoardId(accessToken) {
  const res = await fetch('https://api.pinterest.com/v5/boards?page_size=1', {
    headers: { Authorization: `Bearer ${accessToken}` }
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data?.message || `Pinterest respondeu ${res.status} ao listar boards`)
  const board = data.items?.[0]
  if (!board) throw new Error('Nenhum board encontrado na conta do Pinterest — crie um board antes de publicar')
  return board.id
}

async function publicarPinterest(token, post) {
  const boardId = post.pinterestBoardId || await buscarPrimeiroBoardId(token.accessToken)

  const items = post.mediaItems?.length ? post.mediaItems
    : post.mediaPath ? [{ path: post.mediaPath, type: post.mediaType }]
    : null
  if (!items) throw new Error('Pinterest exige uma imagem ou vídeo para publicar')

  // Sem suporte nativo a carrossel num Pin só — publica o primeiro item
  // (comportamento consistente com o restante do app quando uma rede não
  // suporta múltiplas mídias no mesmo post, ver TikTok/YouTube).
  return publicarUmPin(token, boardId, items[0], post.text)
}

module.exports = { publicarPinterest }
