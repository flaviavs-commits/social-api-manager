const {
  BYTES_PER_MB,
  BYTES_PER_GB,
  getMediaLimits,
  validateMediaMetadata,
} = require('../../../../src/domain/posts/mediaLimits')

const validVideo = { mediaKind: 'video', width: 1080, height: 1920, duration: 30 }

describe('mediaLimits — limites por rede e formato', () => {
  test('Instagram limita imagens a 8 MB e aplica tamanhos/durações por formato', () => {
    expect(validateMediaMetadata({ platform: 'instagram', mediaKind: 'image', size: 8 * BYTES_PER_MB })).toEqual([])
    expect(validateMediaMetadata({ platform: 'instagram', mediaKind: 'image', size: 8 * BYTES_PER_MB + 1 })).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'max-size', limit: 8 * BYTES_PER_MB }),
    ]))
    expect(getMediaLimits('instagram', { mediaKind: 'video', format: 'reel' })).toMatchObject({ maxBytes: 300 * BYTES_PER_MB, maxDurationSeconds: 900 })
    expect(getMediaLimits('instagram', { mediaKind: 'video', format: 'story' })).toMatchObject({ maxBytes: 100 * BYTES_PER_MB, maxDurationSeconds: 60 })
    expect(getMediaLimits('instagram', { mediaKind: 'video', format: 'post' })).toMatchObject({ maxBytes: null, maxDurationSeconds: 3600 })
    expect(validateMediaMetadata({ platform: 'instagram', mediaKind: 'video', format: 'reel', size: 300 * BYTES_PER_MB, duration: 900, width: 1080, height: 1920 })).toEqual([])
    expect(validateMediaMetadata({ platform: 'instagram', mediaKind: 'video', format: 'reel', size: 300 * BYTES_PER_MB + 1, duration: 901, width: 1080, height: 1920 })).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'max-size' }),
      expect.objectContaining({ code: 'max-duration', limit: 900 }),
    ]))
  })

  test('TikTok aceita foto até 20 MB e vídeo até 4 GB, 720p e 3s–10min', () => {
    expect(validateMediaMetadata({ platform: 'tiktok', mediaKind: 'image', size: 20 * BYTES_PER_MB })).toEqual([])
    expect(validateMediaMetadata({ platform: 'tiktok', mediaKind: 'image', size: 20 * BYTES_PER_MB + 1 })).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'max-size' }),
    ]))
    expect(validateMediaMetadata({ platform: 'tiktok', ...validVideo, size: 4 * BYTES_PER_GB })).toEqual([])
    expect(validateMediaMetadata({ platform: 'tiktok', ...validVideo, size: 4 * BYTES_PER_GB + 1 })).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'max-size' }),
    ]))
    expect(validateMediaMetadata({ platform: 'tiktok', ...validVideo, width: 719, height: 1279, duration: 2 })).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'min-resolution' }),
      expect.objectContaining({ code: 'min-duration', limit: 3 }),
    ]))
    expect(validateMediaMetadata({ platform: 'tiktok', ...validVideo, duration: 600 })).toEqual([])
    expect(validateMediaMetadata({ platform: 'tiktok', ...validVideo, duration: 601 })).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'max-duration', limit: 600 }),
    ]))
  })

  test('YouTube separa thumbnail, vídeo longo e Short', () => {
    expect(validateMediaMetadata({ platform: 'youtube', mediaKind: 'thumbnail', size: 2 * BYTES_PER_MB })).toEqual([])
    expect(validateMediaMetadata({ platform: 'youtube', mediaKind: 'thumbnail', size: 2 * BYTES_PER_MB + 1 })).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'max-size' }),
    ]))
    expect(validateMediaMetadata({ platform: 'youtube', mediaKind: 'video', size: 256 * BYTES_PER_GB, duration: 12 * 60 * 60 })).toEqual([])
    expect(validateMediaMetadata({ platform: 'youtube', mediaKind: 'video', size: 256 * BYTES_PER_GB + 1, duration: 12 * 60 * 60 + 1 })).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'max-size' }),
      expect.objectContaining({ code: 'max-duration', limit: 12 * 60 * 60 }),
    ]))
    expect(validateMediaMetadata({ platform: 'youtube', mediaKind: 'video', youtubeFormat: 'short', size: 256 * BYTES_PER_GB, duration: 59.99 })).toEqual([])
    expect(validateMediaMetadata({ platform: 'youtube', mediaKind: 'video', youtubeFormat: 'short', duration: 60 })).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'max-duration-exclusive', limit: 60 }),
    ]))
  })

  test('Facebook limita imagens, vídeos e a duração específica dos Reels', () => {
    expect(validateMediaMetadata({ platform: 'facebook', mediaKind: 'image', size: 10 * BYTES_PER_MB })).toEqual([])
    expect(validateMediaMetadata({ platform: 'facebook', mediaKind: 'image', size: 10 * BYTES_PER_MB + 1 })).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'max-size' }),
    ]))
    expect(validateMediaMetadata({ platform: 'facebook', mediaKind: 'video', format: 'post', size: 4 * BYTES_PER_GB, duration: 240 * 60 })).toEqual([])
    expect(validateMediaMetadata({ platform: 'facebook', mediaKind: 'video', format: 'reel', size: 4 * BYTES_PER_GB, duration: 90 })).toEqual([])
    expect(validateMediaMetadata({ platform: 'facebook', mediaKind: 'video', format: 'reel', duration: 91 })).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'max-duration', limit: 90 }),
    ]))
  })
})
