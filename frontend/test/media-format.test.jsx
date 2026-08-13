import { describe, expect, it } from 'vitest'
import { PREVIEW_ASPECTS, mediaKindLabel, nearestPreviewAspect, ratioLabel, resolvePreviewAspect } from '../src/lib/mediaFormat.js'

describe('media format preview', () => {
  it('identifica as proporções 1:1, 3:4 e 9:16', () => {
    expect(ratioLabel(1080, 1080)).toBe('1:1')
    expect(ratioLabel(1080, 1440)).toBe('3:4')
    expect(ratioLabel(1080, 1920)).toBe('9:16')
  })

  it('escolhe automaticamente 9:16 para vídeo do TikTok', () => {
    expect(resolvePreviewAspect({ platform: 'tiktok', mediaKind: 'video', sourceRatio: 1.78 }).key).toBe('vertical')
  })

  it('permite ajustar uma foto do TikTok para 1:1 ou 3:4', () => {
    expect(resolvePreviewAspect({ platform: 'tiktok', mediaKind: 'image', sourceRatio: 1, requested: 'portrait' })).toEqual(PREVIEW_ASPECTS.portrait)
    expect(resolvePreviewAspect({ platform: 'tiktok', mediaKind: 'image', sourceRatio: 0.75, requested: 'square' })).toEqual(PREVIEW_ASPECTS.square)
  })

  it('mantém Reel/Story do Instagram em 9:16', () => {
    expect(resolvePreviewAspect({ platform: 'instagram', mediaKind: 'image', sourceRatio: 1, instagramFormat: 'reel' }).key).toBe('vertical')
    expect(resolvePreviewAspect({ platform: 'instagram', mediaKind: 'video', sourceRatio: 1, instagramFormat: 'story' }).key).toBe('vertical')
  })

  it('encontra a proporção suportada mais próxima', () => {
    expect(nearestPreviewAspect(0.72).key).toBe('portrait')
    expect(resolvePreviewAspect({ platform: 'instagram', mediaKind: 'image', sourceRatio: 1.91 }).key).toBe('instagramWide')
    expect(mediaKindLabel('video')).toBe('Vídeo detectado')
  })
})
