const { gerarUploadUrl: gerarUploadUrlBlob, ALLOWED_MEDIA_TYPES } = require('../../infra/storage/blobStorage')
const { ValidationError } = require('../../domain/posts/errors')

async function gerarUploadUrl({ filename, mimetype }) {
  if (!filename || !mimetype) throw new ValidationError('filename e mimetype são obrigatórios')
  if (typeof filename !== 'string' || filename.length > 255 || filename !== filename.trim())
    throw new ValidationError('Nome de arquivo inválido')
  if (!ALLOWED_MEDIA_TYPES.has(String(mimetype).toLowerCase()))
    throw new ValidationError('Tipo de mídia não permitido')

  // A checagem de assinatura binária real (que existia no fluxo antigo via
  // multer+file-type) não é possível aqui — o servidor nunca vê o conteúdo do
  // arquivo nesse fluxo. allowedContentTypes/maximumSizeInBytes em
  // blobStorage são a validação equivalente possível num upload direto
  // navegador→Blob.
  const upload = await gerarUploadUrlBlob(filename, mimetype)
  return { ...upload, mimetype: String(mimetype).toLowerCase() }
}

module.exports = { gerarUploadUrl, ALLOWED_MEDIA_TYPES }
