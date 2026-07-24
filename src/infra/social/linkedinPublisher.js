// Adapter LinkedIn (Posts API, perfil pessoal — w_member_social). Publica no
// feed do próprio usuário autenticado; Company Pages exige a Community
// Management API (fora de escopo, ver src/routes/oauth.js). Mídia é enviada
// via upload em 2 passos (registerUpload → PUT binário), padrão da API do
// LinkedIn desde a migração para as Posts API/Images API/Videos API.
const { mediaToBlob } = require('./mediaFetch')

// APIs do LinkedIn são versionadas por mês — manter esse header atualizado
// trimestralmente, conforme o guia de referência (Capítulo 5.4).
const LINKEDIN_VERSION = '202601'

function headersLinkedin(accessToken, extra = {}) {
  return {
    Authorization: `Bearer ${accessToken}`,
    'LinkedIn-Version': LINKEDIN_VERSION,
    'X-Restli-Protocol-Version': '2.0.0',
    ...extra
  }
}

async function registrarUploadImagem(token, authorUrn) {
  const res = await fetch('https://api.linkedin.com/rest/images?action=initializeUpload', {
    method: 'POST',
    headers: headersLinkedin(token.accessToken, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ initializeUploadRequest: { owner: authorUrn } })
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data?.message || `LinkedIn respondeu ${res.status} ao iniciar upload de imagem`)
  return { uploadUrl: data.value.uploadUrl, image: data.value.image }
}

async function registrarUploadVideo(token, authorUrn, tamanhoBytes) {
  const res = await fetch('https://api.linkedin.com/rest/videos?action=initializeUpload', {
    method: 'POST',
    headers: headersLinkedin(token.accessToken, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ initializeUploadRequest: { owner: authorUrn, fileSizeBytes: tamanhoBytes, uploadCaptions: false, uploadThumbnail: false } })
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data?.message || `LinkedIn respondeu ${res.status} ao iniciar upload de vídeo`)
  // Vídeos grandes usam múltiplas partes — para os tamanhos típicos de post
  // agendado (poucos MB) uma única parte cobre o caso comum.
  const primeiraParte = data.value.uploadInstructions[0]
  return { uploadUrl: primeiraParte.uploadUrl, video: data.value.video }
}

async function subirMidiaLinkedin(token, authorUrn, item) {
  const { buffer } = await mediaToBlob(item.path)
  const isVideo = item.type === 'video'

  const { uploadUrl, image, video } = isVideo
    ? await registrarUploadVideo(token, authorUrn, buffer.length)
    : await registrarUploadImagem(token, authorUrn)

  const putRes = await fetch(uploadUrl, { method: 'PUT', body: buffer })
  if (!putRes.ok) throw new Error(`LinkedIn respondeu ${putRes.status} ao enviar o arquivo de mídia`)

  return { urn: isVideo ? video : image, isVideo }
}

async function publicarLinkedin(token, post) {
  // externalUserId guarda o "sub" (URN numérico) devolvido pelo OpenID
  // Connect no momento da conexão — não é o mesmo que handle (nome de
  // exibição da conta, usado só na UI). Ver src/routes/oauth.js callback
  // do LinkedIn e contasRepository.criarContaRapida.
  const authorUrn = `urn:li:person:${token.externalUserId}`
  if (!token.externalUserId) throw new Error('Conta LinkedIn sem ID de perfil (sub do OpenID) salvo — reconecte a conta')

  const items = post.mediaItems?.length ? post.mediaItems
    : post.mediaPath ? [{ path: post.mediaPath, type: post.mediaType }]
    : []

  const body = {
    author: authorUrn,
    commentary: post.text || '',
    visibility: 'PUBLIC',
    distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] },
    lifecycleState: 'PUBLISHED',
    isReshareDisabledByAuthor: false
  }

  if (items.length === 1) {
    const { urn, isVideo } = await subirMidiaLinkedin(token, authorUrn, items[0])
    body.content = isVideo ? { media: { id: urn } } : { media: { id: urn, altText: post.text?.slice(0, 100) || '' } }
  } else if (items.length > 1) {
    // multiImage — só suportado para imagens (não vídeo) na Posts API.
    const uploads = await Promise.all(items.map(item => subirMidiaLinkedin(token, authorUrn, item)))
    body.content = { multiImage: { images: uploads.map(u => ({ id: u.urn })) } }
  }

  const res = await fetch('https://api.linkedin.com/rest/posts', {
    method: 'POST',
    headers: headersLinkedin(token.accessToken, { 'Content-Type': 'application/json' }),
    body: JSON.stringify(body)
  })

  if (!res.ok) {
    const data = await res.json().catch(() => null)
    throw new Error(data?.message || `LinkedIn respondeu ${res.status}`)
  }

  // LinkedIn devolve o ID do post no header x-restli-id, não no corpo.
  const postId = res.headers.get('x-restli-id')
  return { id: postId }
}

module.exports = { publicarLinkedin }
