jest.mock('../../src/db/pool', () => ({ query: jest.fn() }))

const pool = require('../../src/db/pool')
const { getPlanImageLimit } = require('../../src/config/plans')
const {
  IMAGE_QUOTA_CODE,
  IMAGE_QUOTA_MESSAGES,
  usageMonth,
  imageQuotaError,
  reserveAiImage,
  releaseAiImage,
} = require('../../src/services/ai/imageQuota')

describe('ai image quota', () => {
  beforeEach(() => jest.clearAllMocks())

  test('define 10, 15 e 20 imagens mensais para Básico, Pro e Premium', () => {
    expect(getPlanImageLimit('basico')).toBe(10)
    expect(getPlanImageLimit('pro')).toBe(15)
    expect(getPlanImageLimit('premium')).toBe(20)
  })

  test('usa o primeiro dia do mês UTC como período de consumo', () => {
    expect(usageMonth(new Date('2026-08-25T23:59:00-03:00'))).toBe('2026-08-01')
  })

  test('reserva uma imagem atomically e devolve o saldo do plano', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ images_used: 10 }] })

    await expect(reserveAiImage({ userId: 7, plan: 'basico', now: new Date('2026-08-25T12:00:00Z') }))
      .resolves.toMatchObject({ reserved: true, month: '2026-08-01', used: 10, limit: 10, remaining: 0 })
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('ON CONFLICT (user_id, usage_month)'), [7, '2026-08-01', 10])
  })

  test('retorna mensagem específica quando a cota do plano acabou', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] })

    await expect(reserveAiImage({ userId: 7, plan: 'pro', now: new Date('2026-08-25T12:00:00Z') }))
      .rejects.toMatchObject({
        status: 429,
        statusCode: 429,
        code: IMAGE_QUOTA_CODE,
        message: IMAGE_QUOTA_MESSAGES.pro,
        plan: 'pro',
        limit: 15,
      })
  })

  test('devolve uma reserva quando o usuário está liberado sem limite', async () => {
    await expect(reserveAiImage({ userId: 7, plan: 'basico', unrestricted: true }))
      .resolves.toMatchObject({ reserved: false, unlimited: true })
    expect(pool.query).not.toHaveBeenCalled()
  })

  test('libera uma reserva quando o provedor falha', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] })
    const reservation = { reserved: true, month: '2026-08-01' }

    await releaseAiImage(reservation, 7)

    expect(pool.query).toHaveBeenLastCalledWith(expect.stringContaining('GREATEST(images_used - 1, 0)'), [7, '2026-08-01'])
  })

  test('cria erro com mensagem de fallback para plano desconhecido', () => {
    expect(imageQuotaError('plano-inexistente')).toMatchObject({
      code: IMAGE_QUOTA_CODE,
      plan: 'basico',
      limit: 10,
      message: IMAGE_QUOTA_MESSAGES.basico,
    })
  })
})
