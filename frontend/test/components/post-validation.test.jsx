import { buildValidationIssues, isAspectRatioValidForInstagram, isAspectRatioValidForTiktok } from '../../src/lib/postValidation.js'

function baseArgs(overrides = {}) {
  return {
    text: 'Olá mundo',
    platforms: ['instagram'],
    files: [{ type: 'image/png' }],
    publishNow: true,
    scheduledAt: '',
    youtubeTitle: '',
    youtubeMadeForKids: '',
    igFormat: 'post',
    tiktokPrivacyLevel: 'PUBLIC_TO_EVERYONE',
    videoMetaByKey: {},
    mediaMetaByKey: {},
    ...overrides
  }
}

describe('buildValidationIssues', () => {
  it('requires text or media', () => {
    const issues = buildValidationIssues(baseArgs({ text: '', files: [], platforms: [] }))
    expect(issues.map(i => i.message)).toContain('Escreva um texto ou anexe uma imagem/vídeo.')
  })

  it('requires at least one platform', () => {
    const issues = buildValidationIssues(baseArgs({ platforms: [] }))
    expect(issues.some(i => i.message.includes("Plataformas"))).toBe(true)
  })

  it('rejects a scheduled date in the past', () => {
    const issues = buildValidationIssues(baseArgs({ publishNow: false, scheduledAt: '2000-01-01T00:00' }))
    expect(issues.some(i => i.message.includes('não pode estar no passado'))).toBe(true)
  })

  it('requires video, title and made-for-kids answer for YouTube', () => {
    const issues = buildValidationIssues(baseArgs({ platforms: ['youtube'], files: [] }))
    expect(issues.map(i => i.message)).toEqual(expect.arrayContaining([
      expect.stringContaining('Falta vídeo'),
      expect.stringContaining('título do vídeo'),
      expect.stringContaining('feito para crianças')
    ]))
  })

  it('accepts a valid YouTube post', () => {
    const issues = buildValidationIssues(baseArgs({
      platforms: ['youtube'],
      files: [{ type: 'video/mp4' }],
      youtubeTitle: 'Meu vídeo',
      youtubeMadeForKids: 'false'
    }))
    expect(issues.filter(i => i.platform === 'youtube')).toHaveLength(0)
  })

  it('validates each selected network with its own text limit', () => {
    const issues = buildValidationIssues(baseArgs({
      platforms: ['instagram', 'facebook', 'tiktok'],
      files: [{ type: 'video/mp4' }],
      text: 'a'.repeat(5000),
      textByPlatform: {
        instagram: 'a'.repeat(2200),
        facebook: 'a'.repeat(5000),
        tiktokDescription: 'a'.repeat(4001),
      },
      tiktokPrivacyLevel: 'PUBLIC_TO_EVERYONE',
    }))
    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({ platform: 'tiktok' })
    expect(issues[0].message).toContain('4000 caracteres')
  })

  it('accepts a TikTok description up to 4000 and rejects a title above 90', () => {
    const issues = buildValidationIssues(baseArgs({
      platforms: ['tiktok'],
      files: [{ type: 'video/mp4' }],
      textByPlatform: { tiktokDescription: 'a'.repeat(4000) },
      titleByPlatform: { tiktok: 'a'.repeat(91) },
      tiktokDescription: 'a'.repeat(4000),
    }))
    expect(issues).toHaveLength(1)
    expect(issues[0].message).toContain('90 caracteres')
  })

  it('blocks Instagram Stories carousels (more than one file)', () => {
    const issues = buildValidationIssues(baseArgs({
      platforms: ['instagram'],
      igFormat: 'story',
      files: [{ type: 'image/png' }, { type: 'image/png' }]
    }))
    expect(issues.some(i => i.message.includes('Stories não suporta carrossel'))).toBe(true)
  })

  it('requires at least 20 minutes of lead time for scheduled Instagram posts', () => {
    const soonLocal = new Date(Date.now() + 5 * 60000)
    const pad = n => String(n).padStart(2, '0')
    const soon = `${soonLocal.getFullYear()}-${pad(soonLocal.getMonth() + 1)}-${pad(soonLocal.getDate())}T${pad(soonLocal.getHours())}:${pad(soonLocal.getMinutes())}`
    const issues = buildValidationIssues(baseArgs({ publishNow: false, scheduledAt: soon }))
    expect(issues.some(i => i.message.includes('20 minutos de antecedência'))).toBe(true)
  })

  it('flags an invalid TikTok video aspect ratio', () => {
    const issues = buildValidationIssues(baseArgs({
      platforms: ['tiktok'],
      files: [{ type: 'video/mp4', name: 'a.mp4', lastModified: 1, size: 10 }],
      videoMetaByKey: { 'a.mp4-1-10': { width: 2000, height: 100 } }
    }))
    expect(issues.some(i => i.message.includes('proporção 9:16'))).toBe(true)
  })

  it('accepts an image or photo carousel for TikTok', () => {
    const issues = buildValidationIssues(baseArgs({
      platforms: ['tiktok'],
      files: [{ type: 'image/png' }],
    }))
    expect(issues.filter(i => i.platform === 'tiktok')).toHaveLength(0)

    const carouselIssues = buildValidationIssues(baseArgs({
      platforms: ['tiktok'],
      files: Array.from({ length: 35 }, () => ({ type: 'image/png' })),
    }))
    expect(carouselIssues.filter(i => i.platform === 'tiktok')).toHaveLength(0)
  })

  it('requires a vertical 9:16 video shorter than 60 seconds for YouTube Shorts', () => {
    const file = { type: 'video/mp4', name: 'short.mp4', lastModified: 1, size: 10 }
    const issues = buildValidationIssues(baseArgs({
      platforms: ['youtube'],
      files: [file],
      youtubeTitle: 'Meu Short',
      youtubeMadeForKids: 'false',
      youtubeFormat: 'short',
      mediaMetaByKey: { 'short.mp4-1-10': { width: 1080, height: 1920, duration: 60 } }
    }))
    expect(issues.some(i => i.message.includes('9:16') && i.message.includes('menor que 60'))).toBe(true)
  })

  it('requires a single vertical video for Facebook Reels', () => {
    const file = { type: 'video/mp4', name: 'reel.mp4', lastModified: 1, size: 10 }
    const issues = buildValidationIssues(baseArgs({
      platforms: ['facebook'],
      files: [file],
      facebookFormat: 'reel',
      mediaMetaByKey: { 'reel.mp4-1-10': { width: 1920, height: 1080, duration: 20 } }
    }))
    expect(issues.some(i => i.message.includes('Facebook') && i.message.includes('9:16'))).toBe(true)
  })

  it('valida a mídia própria de cada rede quando ela substitui a compartilhada', () => {
    const tiktokVideo = { type: 'video/mp4', name: 'tiktok.mp4', lastModified: 2, size: 20 }
    const issues = buildValidationIssues(baseArgs({
      platforms: ['instagram', 'tiktok'],
      files: [{ type: 'image/png', name: 'instagram.png', lastModified: 1, size: 10 }],
      filesByPlatform: { tiktok: [tiktokVideo] },
      videoMetaByKey: { 'tiktok.mp4-2-20': { width: 1080, height: 1920 } },
      textByPlatform: { instagram: 'Texto do Instagram', tiktokDescription: 'Descrição do TikTok' },
    }))
    expect(issues).toEqual([])
  })

  it('rejects mixed TikTok video and photo media', () => {
    const issues = buildValidationIssues(baseArgs({
      platforms: ['tiktok'],
      files: [{ type: 'video/mp4' }, { type: 'image/png' }],
    }))
    expect(issues.some(i => i.message.includes('vídeo sozinho ou um carrossel'))).toBe(true)
  })

  it('accepts a wide Instagram Feed image up to 1.91:1', () => {
    const file = { type: 'image/jpeg', name: 'wide.jpg', lastModified: 1, size: 10 }
    const issues = buildValidationIssues(baseArgs({
      files: [file],
      mediaMetaByKey: { 'wide.jpg-1-10': { width: 1910, height: 1000 } }
    }))
    expect(issues.filter(i => i.platform === 'instagram')).toHaveLength(0)
  })

  it('rejects an Instagram Feed image outside 4:5..1.91:1', () => {
    const file = { type: 'image/jpeg', name: 'too-wide.jpg', lastModified: 1, size: 10 }
    const issues = buildValidationIssues(baseArgs({
      files: [file],
      mediaMetaByKey: { 'too-wide.jpg-1-10': { width: 2000, height: 1000 } }
    }))
    expect(issues.some(i => i.message.includes('4:5 (vertical)') && i.message.includes('1,91:1'))).toBe(true)
  })

  it('applies image limits independently to each selected network', () => {
    const instagramIssues = buildValidationIssues(baseArgs({
      platforms: ['instagram'],
      files: [{ type: 'image/jpeg', name: 'ig.jpg', lastModified: 1, size: 8 * 1024 * 1024 + 1 }],
    }))
    expect(instagramIssues.some(issue => issue.message.includes('Instagram') && issue.message.includes('8 MB'))).toBe(true)

    const facebookIssues = buildValidationIssues(baseArgs({
      platforms: ['facebook'],
      files: [{ type: 'image/jpeg', name: 'fb.jpg', lastModified: 1, size: 10 * 1024 * 1024 + 1 }],
    }))
    expect(facebookIssues.some(issue => issue.message.includes('Facebook') && issue.message.includes('10 MB'))).toBe(true)
  })

  it('applies duration and size limits to Instagram formats', () => {
    const file = { type: 'video/mp4', name: 'reel.mp4', lastModified: 1, size: 300 * 1024 * 1024 + 1 }
    const issues = buildValidationIssues(baseArgs({
      platforms: ['instagram'],
      igFormat: 'reel',
      files: [file],
      mediaMetaByKey: { 'reel.mp4-1-314572801': { width: 1080, height: 1920, duration: 901 } },
    }))
    expect(issues.some(issue => issue.message.includes('300 MB'))).toBe(true)
    expect(issues.some(issue => issue.message.includes('15 minutos'))).toBe(true)
  })

  it('applies TikTok 720p, duration and 4 GB video limits', () => {
    const file = { type: 'video/mp4', name: 'tiktok.mp4', lastModified: 1, size: 4 * 1024 ** 3 + 1 }
    const issues = buildValidationIssues(baseArgs({
      platforms: ['tiktok'],
      files: [file],
      tiktokPrivacyLevel: 'PUBLIC_TO_EVERYONE',
      mediaMetaByKey: { 'tiktok.mp4-1-4294967297': { width: 719, height: 1279, duration: 2 } },
    }))
    expect(issues.some(issue => issue.message.includes('4 GB'))).toBe(true)
    expect(issues.some(issue => issue.message.includes('720p'))).toBe(true)
    expect(issues.some(issue => issue.message.includes('pelo menos 3 segundos'))).toBe(true)
  })

  it('applies YouTube long-video and Short limits', () => {
    const file = { type: 'video/mp4', name: 'youtube.mp4', lastModified: 1, size: 256 * 1024 ** 3 + 1 }
    const issues = buildValidationIssues(baseArgs({
      platforms: ['youtube'],
      files: [file],
      youtubeTitle: 'Meu vídeo',
      youtubeMadeForKids: 'false',
      mediaMetaByKey: { 'youtube.mp4-1-274877906945': { width: 1920, height: 1080, duration: 12 * 60 * 60 + 1 } },
    }))
    expect(issues.some(issue => issue.message.includes('256 GB'))).toBe(true)
    expect(issues.some(issue => issue.message.includes('720 minutos'))).toBe(true)

    const shortIssues = buildValidationIssues(baseArgs({
      platforms: ['youtube'],
      files: [{ ...file, size: 10 }],
      youtubeTitle: 'Meu Short',
      youtubeMadeForKids: 'false',
      youtubeFormat: 'short',
      mediaMetaByKey: { 'youtube.mp4-1-10': { width: 1080, height: 1920, duration: 60 } },
    }))
    expect(shortIssues.some(issue => issue.message.includes('menor que 60'))).toBe(true)
    expect(shortIssues.some(issue => issue.message.includes('menos de 1 minuto'))).toBe(true)
  })

  it('applies the 90-second Facebook Reel duration limit', () => {
    const file = { type: 'video/mp4', name: 'fb-reel.mp4', lastModified: 1, size: 10 }
    const issues = buildValidationIssues(baseArgs({
      platforms: ['facebook'],
      facebookFormat: 'reel',
      files: [file],
      mediaMetaByKey: { 'fb-reel.mp4-1-10': { width: 1080, height: 1920, duration: 91 } },
    }))
    expect(issues.some(issue => issue.message.includes('90 segundos'))).toBe(true)
  })
})

describe('isAspectRatioValidForTiktok', () => {
  it('accepts only vertical 9:16 video ratios', () => {
    expect(isAspectRatioValidForTiktok({ width: 1080, height: 1920 })).toBe(true)
    expect(isAspectRatioValidForTiktok({ width: 1088, height: 1920 })).toBe(true)
    expect(isAspectRatioValidForTiktok({ width: 1080, height: 1080 })).toBe(false)
    expect(isAspectRatioValidForTiktok({ width: 1920, height: 1080 })).toBe(false)
  })

  it('rejects extreme ratios or missing dimensions', () => {
    expect(isAspectRatioValidForTiktok({ width: 3000, height: 100 })).toBe(false)
    expect(isAspectRatioValidForTiktok({ width: 0, height: 0 })).toBe(false)
  })
})

describe('isAspectRatioValidForInstagram', () => {
  it('accepts the complete Feed range, including wide landscape', () => {
    expect(isAspectRatioValidForInstagram({ width: 800, height: 1000 })).toBe(true)
    expect(isAspectRatioValidForInstagram({ width: 1910, height: 1000 })).toBe(true)
    expect(isAspectRatioValidForInstagram({ width: 1920, height: 1080 })).toBe(true)
  })

  it('rejects ratios outside the Feed range', () => {
    expect(isAspectRatioValidForInstagram({ width: 700, height: 1000 })).toBe(false)
    expect(isAspectRatioValidForInstagram({ width: 2000, height: 1000 })).toBe(false)
  })

  it('keeps Instagram Reels and Stories in 9:16', () => {
    expect(isAspectRatioValidForInstagram({ width: 1080, height: 1920 }, 'reel')).toBe(true)
    expect(isAspectRatioValidForInstagram({ width: 1080, height: 1920 }, 'story')).toBe(true)
    expect(isAspectRatioValidForInstagram({ width: 1920, height: 1080 }, 'reel')).toBe(false)
  })
})
