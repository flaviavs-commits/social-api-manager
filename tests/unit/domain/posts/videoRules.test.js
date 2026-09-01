const { isShortEligible, isAspectRatioValidForTiktok, isVerticalNineBySixteen } = require('../../../../src/domain/posts/videoRules')

describe('videoRules — formatos verticais', () => {
  test('aceita 9:16 com tolerância pequena e rejeita quadrado/horizontal', () => {
    expect(isVerticalNineBySixteen({ width: 1080, height: 1920 })).toBe(true)
    expect(isVerticalNineBySixteen({ width: 1088, height: 1920 })).toBe(true)
    expect(isAspectRatioValidForTiktok({ width: 1080, height: 1080 })).toBe(false)
    expect(isAspectRatioValidForTiktok({ width: 1920, height: 1080 })).toBe(false)
  })

  test('Short exige 9:16 e duração menor que 60 segundos', () => {
    expect(isShortEligible({ width: 1080, height: 1920, duration: 59.9 })).toBe(true)
    expect(isShortEligible({ width: 1080, height: 1920, duration: 60 })).toBe(false)
    expect(isShortEligible({ width: 1080, height: 1920, duration: 180 })).toBe(false)
    expect(isShortEligible({ width: 1920, height: 1080, duration: 30 })).toBe(false)
  })
})
