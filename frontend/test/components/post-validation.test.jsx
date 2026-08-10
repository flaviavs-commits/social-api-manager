import { buildValidationIssues, isAspectRatioValidForTiktok } from '../../src/lib/postValidation.js'

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
    expect(issues.some(i => i.message.includes('proporção entre 9:16'))).toBe(true)
  })
})

describe('isAspectRatioValidForTiktok', () => {
  it('accepts vertical, square and horizontal ratios within 9:16..16:9', () => {
    expect(isAspectRatioValidForTiktok({ width: 1080, height: 1920 })).toBe(true)
    expect(isAspectRatioValidForTiktok({ width: 1080, height: 1080 })).toBe(true)
    expect(isAspectRatioValidForTiktok({ width: 1920, height: 1080 })).toBe(true)
  })

  it('rejects extreme ratios or missing dimensions', () => {
    expect(isAspectRatioValidForTiktok({ width: 3000, height: 100 })).toBe(false)
    expect(isAspectRatioValidForTiktok({ width: 0, height: 0 })).toBe(false)
  })
})
