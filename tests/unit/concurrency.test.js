const { mapWithConcurrency } = require('../../src/utils/concurrency')

describe('mapWithConcurrency', () => {
  test('preserva a ordem e respeita o limite', async () => {
    let running = 0
    let maxRunning = 0
    const result = await mapWithConcurrency([1, 2, 3, 4, 5, 6], async value => {
      running++
      maxRunning = Math.max(maxRunning, running)
      await new Promise(resolve => setTimeout(resolve, 2))
      running--
      return value * 2
    }, 2)

    expect(result).toEqual([2, 4, 6, 8, 10, 12])
    expect(maxRunning).toBeLessThanOrEqual(2)
  })
})
