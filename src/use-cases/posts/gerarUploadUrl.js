const { gerarUploadUrl: gerarUploadUrlBlob, ALLOWED_MEDIA_TYPES } = require('../../infra/storage/blobStorage')
const { ValidationError } = require('../../domain/posts/errors')

async function gerarUploadUrl({ filename, mimetype, maxSizeBytes, allowedMediaTypes } = {}) {
  if (!filename || !mimetype) throw new ValidationError('filename e mimetype são obrigatórios')
  if (typeof filename !== 'string' || filename.length > 255 || filename !== filename.trim())
    throw new ValidationError('Nome de arquivo inválido')
  const normalizedMimetype = String(mimetype).toLowerCase()
  const allowedTypes = allowedMediaTypes instanceof Set ? allowedMediaTypes : ALLOWED_MEDIA_TYPES
  if (!allowedTypes.has(normalizedMimetype))
    throw new ValidationError('Tipo de mídia não permitido')

  // O upload é direto navegador→Blob; a assinatura binária é validada depois,
  // quando a URL for associada/processada pelo servidor.
  const upload = await gerarUploadUrlBlob(filename, normalizedMimetype, { maxSizeBytes, allowedMediaTypes: allowedTypes })
  return { ...upload, mimetype: normalizedMimetype }
}

module.exports = { gerarUploadUrl, ALLOWED_MEDIA_TYPES }
