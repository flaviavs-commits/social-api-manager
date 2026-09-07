import { describe, expect, it } from 'vitest'
import { PREVIEW_ASPECTS, SOCIAL_MEDIA_RESOLUTIONS, mediaKindLabel, nearestPreviewAspect, ratioLabel, resolvePreviewAspect, shouldUseFullBleedPreview, socialMediaResolutionHint } from '../src/lib/mediaFormat.js'

describe('media format preview', () => {
  it('identifica as proporções 1:1, 4:5 e 9:16', () => {
    expect(ratioLabel(1080, 1080)).toBe('1:1')
    expect(ratioLabel(1080, 1350)).toBe('4:5')
    expect(ratioLabel(1080, 1920)).toBe('9:16')
  })

  it('exibe proporções detectadas como razões inteiras, sem casas decimais', () => {
    expect(ratioLabel(1000, 600)).toBe('5:3')
    expect(ratioLabel(1080, 566)).toBe('191:100')
    expect(ratioLabel(0, 1080)).toBe('proporção não detectada')
  })

  it('escolhe automaticamente 9:16 para vídeo do TikTok', () => {
    expect(resolvePreviewAspect({ platform: 'tiktok', mediaKind: 'video', sourceRatio: 1.78 }).key).toBe('vertical')
  })

  it('mantém o TikTok em vídeo vertical mesmo quando a mídia informada é uma imagem', () => {
    expect(resolvePreviewAspect({ platform: 'tiktok', mediaKind: 'image', sourceRatio: 1, requested: 'portrait' })).toEqual(PREVIEW_ASPECTS.vertical)
    expect(resolvePreviewAspect({ platform: 'tiktok', mediaKind: 'image', sourceRatio: 0.75, requested: 'square' })).toEqual(PREVIEW_ASPECTS.vertical)
  })

  it('mantém Reel/Story do Instagram em 9:16', () => {
    expect(resolvePreviewAspect({ platform: 'instagram', mediaKind: 'image', sourceRatio: 1, instagramFormat: 'reel' }).key).toBe('vertical')
    expect(resolvePreviewAspect({ platform: 'instagram', mediaKind: 'video', sourceRatio: 1, instagramFormat: 'story' }).key).toBe('vertical')
  })

  it('mantém o Reel do Facebook em 9:16', () => {
    expect(resolvePreviewAspect({ platform: 'facebook', mediaKind: 'video', sourceRatio: 1.78, facebookFormat: 'reel' }).key).toBe('vertical')
    expect(socialMediaResolutionHint('facebook', { facebookFormat: 'reel' })).toBe('1080 × 1920 px')
  })

  it('usa tela vertical somente para formatos verticais explícitos ou obrigatórios', () => {
    expect(shouldUseFullBleedPreview({ platform: 'instagram', instagramFormat: 'post' })).toBe(false)
    expect(shouldUseFullBleedPreview({ platform: 'instagram', instagramFormat: 'reel' })).toBe(true)
    expect(shouldUseFullBleedPreview({ platform: 'facebook', facebookFormat: 'post' })).toBe(false)
    expect(shouldUseFullBleedPreview({ platform: 'facebook', facebookFormat: 'reel' })).toBe(true)
    expect(shouldUseFullBleedPreview({ platform: 'youtube', youtubeFormat: '' })).toBe(false)
    expect(shouldUseFullBleedPreview({ platform: 'youtube', youtubeFormat: 'short' })).toBe(true)
    expect(shouldUseFullBleedPreview({ platform: 'tiktok' })).toBe(true)
  })

  it('encontra a proporção suportada mais próxima', () => {
    expect(nearestPreviewAspect(0.72).key).toBe('portrait')
    expect(resolvePreviewAspect({ platform: 'instagram', mediaKind: 'image', sourceRatio: 1.91 }).key).toBe('instagramWide')
    expect(mediaKindLabel('video')).toBe('Vídeo detectado')
  })

  it('mantém os presets de resolução das quatro redes', () => {
    expect(SOCIAL_MEDIA_RESOLUTIONS.instagram.reel.dimensions).toBe('1080 × 1920 px')
    expect(SOCIAL_MEDIA_RESOLUTIONS.facebook.feed[0].dimensions).toBe('1200 × 630 px')
    expect(SOCIAL_MEDIA_RESOLUTIONS.facebook.reel.dimensions).toBe('1080 × 1920 px')
    expect(SOCIAL_MEDIA_RESOLUTIONS.youtube.thumbnail.dimensions).toBe('1280 × 720 px')
    expect(socialMediaResolutionHint('tiktok', { mediaKind: 'video' })).toBe('1080 × 1920 px')
  })
})
