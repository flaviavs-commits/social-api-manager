// Adapter para o Vercel Blob — geração de URL pré-assinada de upload e escrita direta.
const path = require('path')
const crypto = require('crypto')
const { get, put, del, presignUrl, issueSignedToken } = require('@vercel/blob')
const { gerarTokenMedia, validarTokenMedia } = require('./mediaToken')

const ALLOWED_MEDIA_TYPES = new Set([
  'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/heic', 'image/heif', 'image/avif', 'image/tiff', 'image/bmp',
  'video/mp4', 'video/quicktime', 'video/webm', 'video/x-matroska'
])

const MAX_UPLOAD_SIZE_BYTES = 200 * 1024 * 1024
const UPLOAD_URL_TTL_MS = 10 * 60 * 1000
const BLOB_ALLOWED_HOSTS = new Set(String(process.env.BLOB_ALLOWED_HOSTS || '')
  .split(',').map(host => host.trim().toLowerCase()).filter(Boolean))
// Público é o padrão deliberado para manter compatibilidade com a aplicação
// atual. O modo privado só entra em vigor quando for configurado explicitamente.
const BLOB_ACCESS_MODE = String(process.env.BLOB_ACCESS_MODE || 'public').trim().toLowerCase()
const PRIVATE_BLOB_MODE = BLOB_ACCESS_MODE === 'private'
const BLOB_ACCESS = PRIVATE_BLOB_MODE ? 'private' : 'public'
const BASE_URL = String(process.env.BASE_URL || '').replace(/\/$/, '')

function blobOrigin() {
  const configured = String(process.env.BLOB_PUBLIC_BASE_URL || '').trim().replace(/\/$/, '')
  if (configured) return configured
  const host = Array.from(BLOB_ALLOWED_HOSTS)[0]
  return host ? `https://${host}` : ''
}

function blobUrlForPath(pathname) {
  const origin = blobOrigin()
  if (!origin) throw new Error('BLOB_ALLOWED_HOSTS ou BLOB_PUBLIC_BASE_URL é necessário para o modo privado')
  return `${origin}/${String(pathname).replace(/^\//, '')}`
}

function mediaProxyUrl(blobUrl) {
  if (!PRIVATE_BLOB_MODE || !BASE_URL) return null
  const token = gerarTokenMedia(blobUrl)
  const encoded = Buffer.from(blobUrl).toString('base64url')
  const ext = path.extname(new URL(blobUrl).pathname) || '.bin'
  return `${BASE_URL}/media-proxy/${token}/${encoded}${ext}`
}

function decodeMediaProxyUrl(value) {
  if (!PRIVATE_BLOB_MODE || typeof value !== 'string' || !BASE_URL) return null
  try {
    const parsed = new URL(value)
    const base = new URL(BASE_URL)
    if (parsed.origin !== base.origin || !parsed.pathname.startsWith('/media-proxy/')) return null
    const parts = parsed.pathname.split('/').filter(Boolean)
    if (parts.length < 3) return null
    const token = parts[1]
    const encoded = parts[2].replace(/\.[^.]+$/, '')
    const blobUrl = Buffer.from(encoded, 'base64url').toString('utf8')
    if (!validarTokenMedia(blobUrl, token)) return null
    return blobUrl
  } catch {
    return null
  }
}

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
    access: BLOB_ACCESS,
    allowedContentTypes: Array.from(ALLOWED_MEDIA_TYPES),
    maximumSizeInBytes: MAX_UPLOAD_SIZE_BYTES,
    validUntil
  })

  if (!PRIVATE_BLOB_MODE) return { uploadUrl: presignedUrl, mediaUrl: null, blobUrl: null }
  const blobUrl = blobUrlForPath(pathname)
  return { uploadUrl: presignedUrl, mediaUrl: mediaProxyUrl(blobUrl), blobUrl }
}

async function salvarBuffer(filename, buffer, contentType) {
  const { url } = await put(filename, buffer, { access: BLOB_ACCESS, contentType })
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
  if (decodeMediaProxyUrl(url)) return true
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

function isPrivateBlobMode() {
  return PRIVATE_BLOB_MODE
}

async function getPrivateBlob(url) {
  const actualUrl = decodeMediaProxyUrl(url) || url
  if (!isActualBlobUrl(actualUrl)) return null
  const pathname = new URL(actualUrl).pathname.replace(/^\//, '')
  return get(pathname, { access: 'private' })
}

function isActualBlobUrl(url) {
  if (typeof url !== 'string') return false
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:') return false
    if (BLOB_ALLOWED_HOSTS.size) return BLOB_ALLOWED_HOSTS.has(parsed.hostname.toLowerCase())
    return process.env.NODE_ENV !== 'production' && parsed.hostname.endsWith('.public.blob.vercel-storage.com')
  } catch {
    return false
  }
}

// Retorna a URL real do objeto para operações administrativas. No modo
// privado, a aplicação grava uma URL do nosso /media-proxy; o Vercel Blob
// precisa receber a URL original para excluir o objeto.
function canonicalBlobUrl(url) {
  const actualUrl = decodeMediaProxyUrl(url) || url
  return isActualBlobUrl(actualUrl) ? actualUrl : null
}

async function excluirBlobs(urls) {
  const targets = Array.from(new Set((Array.isArray(urls) ? urls : [urls])
    .map(canonicalBlobUrl)
    .filter(Boolean)))
  if (!targets.length) return 0
  await del(targets)
  return targets.length
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

async function readBlobStreamLimited(blobResult, maxBytes = MAX_UPLOAD_SIZE_BYTES) {
  const declared = Number(blobResult?.blob?.size || 0)
  if (declared > maxBytes) throw new Error('Mídia excede o tamanho máximo permitido')
  const chunks = []
  let total = 0
  for await (const chunk of blobResult?.stream || []) {
    const buffer = Buffer.from(chunk)
    total += buffer.length
    if (total > maxBytes) throw new Error('Mídia excede o tamanho máximo permitido')
    chunks.push(buffer)
  }
  return Buffer.concat(chunks, total)
}

module.exports = {
  ALLOWED_MEDIA_TYPES, MAX_UPLOAD_SIZE_BYTES, gerarUploadUrl, salvarBuffer, isBlobUrl,
  isActualBlobUrl, canonicalBlobUrl, excluirBlobs, isPrivateBlobMode, getPrivateBlob, mediaProxyUrl, decodeMediaProxyUrl,
  readResponseLimited, readBlobStreamLimited
}
