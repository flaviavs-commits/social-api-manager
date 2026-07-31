// Busca os boards da conta do Pinterest conectada, para o seletor de board
// por post no composer — mesmo endpoint (GET /v5/boards) já usado como
// fallback em pinterestPublisher.js:buscarPrimeiroBoardId, agora exposto ao
// usuário escolher explicitamente em vez de sempre cair no primeiro board.
const { buscarContaToken } = require('../../infra/social/publisher')
const { ValidationError } = require('../../domain/posts/errors')

async function buscarBoardsPinterest({ userId, isAdmin }) {
  const token = await buscarContaToken('pinterest', userId, isAdmin, null)
  if (!token) throw new ValidationError('Conecte uma conta do Pinterest para listar os boards')

  const res = await fetch('https://api.pinterest.com/v5/boards?page_size=100', {
    headers: { Authorization: `Bearer ${token.accessToken}` }
  })
  const data = await res.json()
  if (!res.ok) throw new ValidationError(data?.message || `Pinterest respondeu ${res.status} ao listar boards`)

  const boards = (data.items || []).map(board => ({ id: board.id, name: board.name }))
  return { boards }
}

module.exports = { buscarBoardsPinterest }
