// Adapter para o Vercel Blob — geração de URL pré-assinada de upload e escrita direta.
const path = require('path')
const crypto = require('crypto')
const { put, presignUrl, issueSignedToken } = require('@vercel/blob')

const ALLOWED_MEDIA_TYPES = new Set([
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'video/mp4', 'video/quicktime', 'video/webm', 'video/x-matroska'
])

const MAX_UPLOAD_SIZE_BYTES = 200 * 1024 * 1024
const UPLOAD_URL_TTL_MS = 10 * 60 * 1000

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

module.exports = { ALLOWED_MEDIA_TYPES, gerarUploadUrl, salvarBuffer }
