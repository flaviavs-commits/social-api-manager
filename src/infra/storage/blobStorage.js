// Adapter para o Vercel Blob — geração de URL pré-assinada de upload e escrita direta.
const path = require('path')
const crypto = require('crypto')
const { put, presignUrl, issueSignedToken } = require('@vercel/blob')

const ALLOWED_MEDIA_TYPES = new Set([
  'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/heic', 'image/heif', 'image/avif', 'image/tiff', 'image/bmp',
  'video/mp4', 'video/quicktime', 'video/webm', 'video/x-matroska'
])

const MAX_UPLOAD_SIZE_BYTES = 200 * 1024 * 1024
const UPLOAD_URL_TTL_MS = 10 * 60 * 1000
const BLOB_ALLOWED_HOSTS = new Set(String(process.env.BLOB_ALLOWED_HOSTS || '')
  .split(',').map(host => host.trim().toLowerCase()).filter(Boolean))

// Gera uma URL pré-assinada para o navegador enviar o arquivo direto ao
// Vercel Blob, sem passar pelo corpo da requisição desta API. Necessário
// porque funções serverless da Vercel têm limite de tamanho de payload
// (4.5MB no plano Hobby) — vídeos comuns de celular já excedem isso
// facilmente, então o upload precisa ir direto do navegador para o storage.
async function gerarUploadUrl(filename, mimetype) {
  const ext = path.extname(filename) || ''
  const pathname = `${crypto.randomUUID()}${ext}`
  const validUntil = Date.now() + UPLOAD_URL_TTL_MS

  const signed = await issueSignedToken({ pathname, operations: ['put'], validUntil })
  const { presignedUrl } = await presignUrl(signed, {
    operation: 'put',
    pathname,
    access: 'public',
    allowedContentTypes: Array.from(ALLOWED_MEDIA_TYPES),
    maximumSizeInBytes: MAX_UPLOAD_SIZE_BYTES,
    validUntil
  })

  return presignedUrl
}

async function salvarBuffer(filename, buffer, contentType) {
  const { url } = await put(filename, buffer, { access: 'public', contentType })
  return url
}

// Único domínio de onde o servidor tem permissão de baixar mídia enviada
// pelo cliente (conversão de imagem, probe de vídeo, geração de capa, etc.).
// Sem essa checagem, media[].url viajava direto do body da requisição até
// fetch() no servidor (criarPost.js, mediaFetch.js) — um usuário
// autenticado podia apontar para qualquer URL (rede interna,
// metadata da nuvem) e ainda ter o conteúdo baixado processado por
// sharp/ffprobe. Mesma restrição de host já aplicada em GET /media-proxy
// (server.js) para o caso inverso (proxy de saída).
function isBlobUrl(url) {
  if (typeof url !== 'string') return false
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:') return false
    if (BLOB_ALLOWED_HOSTS.size) return BLOB_ALLOWED_HOSTS.has(parsed.hostname.toLowerCase())
    // Desenvolvimento/testes mantêm compatibilidade com o formato do Blob;
    // produção precisa declarar os hosts exatos para impedir objetos de outra
    // conta/storage serem usados como origem de processamento.
    return process.env.NODE_ENV !== 'production' && parsed.hostname.endsWith('.public.blob.vercel-storage.com')
  } catch {
    return false
  }
}

async function readResponseLimited(response, maxBytes = MAX_UPLOAD_SIZE_BYTES) {
  const declared = Number(response.headers.get('content-length') || 0)
  if (declared > maxBytes) throw new Error('Mídia excede o tamanho máximo permitido')
  if (!response.body) return Buffer.alloc(0)

  const reader = response.body.getReader()
  const chunks = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel()
        throw new Error('Mídia excede o tamanho máximo permitido')
      }
      chunks.push(Buffer.from(value))
    }
  } finally {
    reader.releaseLock()
  }
  return Buffer.concat(chunks, total)
}

module.exports = { ALLOWED_MEDIA_TYPES, MAX_UPLOAD_SIZE_BYTES, gerarUploadUrl, salvarBuffer, isBlobUrl, readResponseLimited }
