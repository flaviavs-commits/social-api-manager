const { createRateLimiter } = require('../../../../src/infra/social/zernioRateLimiter')

describe('zernioRateLimiter', () => {
  test('libera a primeira chamada imediatamente, sem esperar a fila', async () => {
    const limiter = createRateLimiter(5)
    const start = Date.now()

    await limiter.acquire()

    expect(Date.now() - start).toBeLessThan(50)
  })

  test('espaça chamadas além do limite por segundo', async () => {
    const limiter = createRateLimiter(5) // intervalo de 200ms por chamada
    const timestamps = []

    await Promise.all(
      Array.from({ length: 6 }, () => limiter.acquire().then(() => timestamps.push(Date.now())))
    )

    timestamps.sort((a, b) => a - b)
    const totalSpan = timestamps[timestamps.length - 1] - timestamps[0]
    // 6 chamadas a 5/s exigem pelo menos 5 intervalos de ~200ms = 1000ms
    expect(totalSpan).toBeGreaterThanOrEqual(900)
  }, 10000)

  test('cada limiter mantém sua própria fila, independente de outros', async () => {
    const limiterA = createRateLimiter(5)
    const limiterB = createRateLimiter(5)
    const start = Date.now()

    await Promise.all([limiterA.acquire(), limiterB.acquire()])

    expect(Date.now() - start).toBeLessThan(150)
  })
})
