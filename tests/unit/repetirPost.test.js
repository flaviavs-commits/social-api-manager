jest.mock('../../src/infra/db/postsRepository', () => ({
  buscarPostPorId: jest.fn(),
}))

jest.mock('../../src/repositories/contasRepository', () => ({
  listarContasPorIds: jest.fn(),
  listarContasAtivasPorPlataformas: jest.fn(),
}))

jest.mock('../../src/use-cases/posts/criarPost', () => ({
  criarPost: jest.fn(),
}))

const postsRepo = require('../../src/infra/db/postsRepository')
const contasRepo = require('../../src/repositories/contasRepository')
const { criarPost } = require('../../src/use-cases/posts/criarPost')
const { repetirPost } = require('../../src/use-cases/posts/repetirPost')

describe('repetirPost', () => {
  beforeEach(() => jest.clearAllMocks())

  test('usa a conexão ativa atual quando o ID da publicação antiga foi renovado', async () => {
    postsRepo.buscarPostPorId.mockResolvedValue({
      id: 10,
      status: 'published',
      text: 'Post antigo',
      platforms: ['instagram'],
      mediaItems: '[]',
      accounts: [{ accountId: 31, platform: 'instagram', handle: '@perfil' }],
    })
    contasRepo.listarContasPorIds.mockResolvedValue([])
    contasRepo.listarContasAtivasPorPlataformas.mockResolvedValue([
      { id: 44, platform: 'instagram', handle: '@perfil' },
    ])
    criarPost.mockResolvedValue({ post: { id: 11 } })

    await repetirPost({ id: 10, scheduledAt: '2026-08-26T12:30:00.000Z', userId: 7, isAdmin: false })

    expect(contasRepo.listarContasPorIds).toHaveBeenCalledWith([31], 7, false)
    expect(contasRepo.listarContasAtivasPorPlataformas).toHaveBeenCalledWith(['instagram'], 7, false)
    expect(JSON.parse(criarPost.mock.calls[0][0].body.accountIds)).toEqual([44])
  })
})
