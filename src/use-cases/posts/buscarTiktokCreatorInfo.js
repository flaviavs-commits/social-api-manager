// As Content Sharing Guidelines do TikTok exigem que a tela de publicação
// mostre, antes do usuário postar, as opções de privacidade e interações
// permitidas pela CONTA conectada (não decididas sozinhas pelo backend) — ver
// tiktokPublisher.js (buscarCreatorInfo) e o dropdown/checkboxes no frontend.
const { buscarContaToken } = require('../../infra/social/publisher')
const { buscarCreatorInfo } = require('../../infra/social/tiktokPublisher')
const { ValidationError } = require('../../domain/posts/errors')

async function buscarTiktokCreatorInfo({ contaId, userId, isAdmin }) {
  const token = await buscarContaToken('tiktok', userId, isAdmin, contaId)
  if (!token) throw new ValidationError('Conta do TikTok não encontrada ou desconectada')

  return buscarCreatorInfo(token.accessToken)
}

module.exports = { buscarTiktokCreatorInfo }
