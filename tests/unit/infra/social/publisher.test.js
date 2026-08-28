jest.mock('../../../../src/db/pool', () => ({
  query: jest.fn().mockResolvedValue({ rows: [{ token_id: 1, contaId: 7, accessToken: 'encrypted', status: 'valid', handle: '@creator' }] })
}))

jest.mock('../../../../src/repositories/logsRepository', () => ({
  registrarLog: jest.fn(),
  broadcastEvent: jest.fn()
}))

jest.mock('../../../../src/repositories/tokensRepository', () => ({
  renovarToken: jest.fn()
}))

jest.mock('../../../../src/services/tokenCrypto', () => ({
  decrypt: value => value
}))

jest.mock('../../../../src/infra/social/instagramPublisher', () => ({
  statusContainerInstagram: jest.fn(),
  finalizarPublicacaoInstagram: jest.fn()
}))

jest.mock('../../../../src/infra/social/youtubePublisher', () => ({
  publicarYoutube: jest.fn()
}))

jest.mock('../../../../src/infra/social/zernioPublisher', () => ({
  publicarZernioInstagram: jest.fn(),
  publicarZernioFacebook: jest.fn(),
  publicarZernioYoutube: jest.fn(),
  publicarZernioTiktok: jest.fn().mockResolvedValue({ platformPostId: 'tt-1' })
}))

jest.mock('../../../../src/infra/social/zernioClient', () => ({
  getPost: jest.fn()
}))

jest.mock('../../../../src/infra/db/postsRepository', () => ({
  atualizarErroPublicacaoConta: jest.fn(),
  obterProviderRequestId: jest.fn().mockResolvedValue('request-1'),
  salvarPublicacaoExterna: jest.fn(),
  marcarContaPublicada: jest.fn()
}))

const { publicarZernioTiktok } = require('../../../../src/infra/social/zernioPublisher')
const { publishPost } = require('../../../../src/infra/social/publisher')

test('preserva a descrição do TikTok no fluxo real do publisher', async () => {
  await publishPost({
    id: 20,
    userId: 8,
    text: null,
    textByPlatform: { tiktokDescription: 'Descrição longa do vídeo' },
    accounts: [{ postAccountId: 30, accountId: 7, platform: 'tiktok' }]
  })

  expect(publicarZernioTiktok).toHaveBeenCalledWith(
    expect.any(Object),
    expect.objectContaining({ text: 'Descrição longa do vídeo' }),
    expect.objectContaining({ metadata: expect.objectContaining({ platform: 'tiktok', postId: '20' }) })
  )
})
