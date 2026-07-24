// Busca de local (Facebook Places) para a tag de localização do post —
// usada tanto pelo Facebook quanto pelo Instagram, já que o location_id do
// Instagram vem da mesma infraestrutura de Places do Facebook (não existe
// endpoint de busca de local próprio na Instagram Platform API). Por isso
// exige uma conta do FACEBOOK conectada (com pages_read_engagement),
// independente de qual rede o usuário vai marcar no post.
const { buscarContaToken } = require('../../infra/social/publisher')
const { ValidationError } = require('../../domain/posts/errors')

async function buscarLocaisFacebook({ termo, userId, isAdmin }) {
  if (!termo?.trim()) return { locations: [] }

  const token = await buscarContaToken('facebook', userId, isAdmin, null)
  if (!token) throw new ValidationError('Conecte uma conta do Facebook para buscar locais')

  const url = `https://graph.facebook.com/v19.0/search` +
    `?type=place&q=${encodeURIComponent(termo)}&access_token=${encodeURIComponent(token.accessToken)}`
  const res = await fetch(url)
  const data = await res.json()
  if (!res.ok) throw new ValidationError(data?.error?.message || `Facebook respondeu ${res.status} ao buscar locais`)

  const locations = (data.data || []).map(place => ({
    id: place.id,
    name: place.name,
    city: place.location?.city || null,
    country: place.location?.country || null
  }))
  return { locations }
}

module.exports = { buscarLocaisFacebook }
