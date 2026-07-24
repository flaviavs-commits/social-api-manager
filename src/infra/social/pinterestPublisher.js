// Adapter Pinterest (API v5). Publica um Pin (imagem ou vídeo) num board —
// a API aceita a mídia por URL pública (media_source.url), sem upload
// binário, então usa mediaUrl() como Instagram/Threads. Carrossel/múltiplas
// imagens não é suportado num único Pin — cada arquivo vira um Pin separado.
const { mediaUrl } = require('./mediaFetch')

async function publicarUmPin(token, boardId, item, text) {
  const isVideo = item.type === 'video'
  const body = {
    board_id: boardId,
    title: (text || '').slice(0, 100) || undefined,
    description: text || undefined,
    media_source: isVideo
      ? { source_type: 'video_url', url: mediaUrl(item.path), cover_image_url: mediaUrl(item.path) }
      : { source_type: 'image_url', url: mediaUrl(item.path) }
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
