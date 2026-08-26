const { executeAgentAction } = require('../../src/services/ai/agentExecutor')

describe('agentExecutor image quota', () => {
  test('não transforma o limite mensal em fallback genérico ao gerar post com imagem', async () => {
    const quotaError = Object.assign(new Error('Limite do plano atingido'), {
      code: 'AI_IMAGE_LIMIT_REACHED',
      status: 429,
    })

    await expect(executeAgentAction({
      actionId: 'generate_post_with_image',
      arguments: { instruction: 'uma ideia para Instagram' },
      user: { id: 7, role: 'user' },
      generatePosts: jest.fn().mockResolvedValue({ posts: [{ texto: 'Texto pronto' }] }),
      generateImage: jest.fn().mockRejectedValue(quotaError),
    })).rejects.toBe(quotaError)
  })

  test('não retorna sucesso somente com texto quando a geração da imagem falha', async () => {
    const providerError = Object.assign(new Error('Provedores indisponíveis'), { status: 502 })

    await expect(executeAgentAction({
      actionId: 'generate_post_with_image',
      arguments: { instruction: 'uma ideia para Instagram' },
      user: { id: 7, role: 'user' },
      generatePosts: jest.fn().mockResolvedValue({ posts: [{ texto: 'Texto pronto' }] }),
      generateImage: jest.fn().mockRejectedValue(providerError),
    })).rejects.toBe(providerError)
  })
})
