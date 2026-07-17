const { gerarUploadUrl: gerarUploadUrlBlob, ALLOWED_MEDIA_TYPES } = require('../../infra/storage/blobStorage')
const { ValidationError } = require('../../domain/posts/errors')

async function gerarUploadUrl({ filename, mimetype }) {
  if (!filename || !mimetype) throw new ValidationError('filename e mimetype são obrigatórios')
  if (!mimetype.startsWith('image/') && !mimetype.startsWith('video/'))
    throw new ValidationError('Arquivo precisa ser uma imagem ou vídeo')

  // A checagem de assinatura binária real (que existia no fluxo antigo via
  // multer+file-type) não é possível aqui — o servidor nunca vê o conteúdo do
  // arquivo nesse fluxo. allowedContentTypes/maximumSizeInBytes em
  // blobStorage são a validação equivalente possível num upload direto
  // navegador→Blob.
  const uploadUrl = await gerarUploadUrlBlob(filename, mimetype)
  return { uploadUrl, mimetype }
}

module.exports = { gerarUploadUrl, ALLOWED_MEDIA_TYPES }
