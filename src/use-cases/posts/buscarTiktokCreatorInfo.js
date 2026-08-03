// As Content Sharing Guidelines do TikTok exigem que a tela de publicação
// mostre, antes do usuário postar, as opções de privacidade e interações
// permitidas pela CONTA conectada (não decididas sozinhas pelo backend) — ver
// tiktokPublisher.js (buscarCreatorInfo) e o dropdown/checkboxes no frontend.
const { buscarContaToken } = require('../../infra/social/publisher')
const { buscarCreatorInfo } = require('../../infra/social/tiktokPublisher')
const contasRepo = require('../../repositories/contasRepository')
const { ValidationError } = require('../../domain/posts/errors')

async function buscarTiktokCreatorInfo({ contaId, userId, isAdmin }) {
  const token = await buscarContaToken('tiktok', userId, isAdmin, contaId)
  if (!token) throw new ValidationError('Conta do TikTok não encontrada ou desconectada')

  // Contas migradas para o Zernio (docs.zernio.com) não têm mais um
  // access_token real da Content Posting API — token.accessToken é o
  // accountId do Zernio, e chamar creator_info/query/ direto sempre falha
  // com "Invalid OAuth access token". O Zernio não expõe um endpoint
  // equivalente para consultar as opções de privacidade permitidas pela
  // conta (verificado em 2026-08-03: nem no objeto de conta, nem no health
  // check), então cai num fallback com todas as opções do enum oficial do
  // TikTok — a Content Posting API ainda valida a escolha real no momento
  // de publicar (ver zernioPublisher.js/publicarZernioTiktok).
  const conta = await contasRepo.buscarContaPorId(contaId, userId, isAdmin)
  if (conta?.zernio_account_id) {
    return {
      creatorNickname: conta.handle || null,
      creatorUsername: conta.handle || null,
      creatorAvatarUrl: conta.avatar_url || null,
      privacyLevelOptions: ['PUBLIC_TO_EVERYONE', 'MUTUAL_FOLLOW_FRIENDS', 'SELF_ONLY'],
      commentDisabled: false,
      duetDisabled: false,
      stitchDisabled: false,
      maxVideoPostDurationSec: null
    }
  }

  return buscarCreatorInfo(token.accessToken)
}

module.exports = { buscarTiktokCreatorInfo }
