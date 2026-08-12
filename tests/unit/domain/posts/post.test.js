const { validarCriacaoPost, normalizarScheduledAtBR, scheduledAtParaUTC, INSTAGRAM_MIN_ANTECEDENCIA_MIN, YOUTUBE_CATEGORY_IDS } = require('../../../../src/domain/posts/post')

function baseArgs(overrides = {}) {
  return {
    text: 'oi',
    youtubeTitle: null,
    youtubeVisibility: 'public',
    platforms: ['instagram'],
    repeat: 'none',
    items: [{ path: 'x.jpg', type: 'image', caption: '' }],
    temVideo: false,
    mediaType: 'image',
    aspectRatioValidoTiktok: null,
    scheduledAtUTC: null,
    publishNow: false,
    ...overrides,
  }
}

describe('validarCriacaoPost — antecedência mínima do Instagram', () => {
  test('rejeita agendamento a menos de 20 minutos do Instagram', () => {
    const daqui15min = new Date(Date.now() + 15 * 60000).toISOString().replace('Z', '')
    const erro = validarCriacaoPost(baseArgs({ scheduledAtUTC: daqui15min }))
    expect(erro).toMatch(new RegExp(`${INSTAGRAM_MIN_ANTECEDENCIA_MIN} minutos`))
  })

  test('aceita agendamento a mais de 20 minutos do Instagram', () => {
    const daqui30min = new Date(Date.now() + 30 * 60000).toISOString().replace('Z', '')
    const erro = validarCriacaoPost(baseArgs({ scheduledAtUTC: daqui30min }))
    expect(erro).toBeNull()
  })

  test('não bloqueia "publicar agora" mesmo com scheduledAt no passado imediato', () => {
    const agora = new Date().toISOString().replace('Z', '')
    const erro = validarCriacaoPost(baseArgs({ scheduledAtUTC: agora, publishNow: true }))
    expect(erro).toBeNull()
  })

  test('não se aplica quando Instagram não está entre as plataformas', () => {
    const daqui5min = new Date(Date.now() + 5 * 60000).toISOString().replace('Z', '')
    const erro = validarCriacaoPost(baseArgs({ platforms: ['facebook'], scheduledAtUTC: daqui5min }))
    expect(erro).toBeNull()
  })

  test('agendamento exatamente no limite (20 min) é aceito', () => {
    const noLimite = new Date(Date.now() + 21 * 60000).toISOString().replace('Z', '')
    const erro = validarCriacaoPost(baseArgs({ scheduledAtUTC: noLimite }))
    expect(erro).toBeNull()
  })
})

describe('normalizarScheduledAtBR', () => {
  test('preserva ISO UTC enviado por publicar agora', () => {
    const iso = '2026-08-06T12:13:44.778Z'
    const normalizado = normalizarScheduledAtBR(iso)
    expect(normalizado).toBe(iso)
    expect(() => scheduledAtParaUTC(normalizado)).not.toThrow()
    expect(Number.isNaN(new Date(normalizado).getTime())).toBe(false)
  })

  test('adiciona o fuso de Brasília ao valor do datetime-local', () => {
    const normalizado = normalizarScheduledAtBR('2026-08-06T09:13')
    expect(normalizado).toBe('2026-08-06T09:13:00-03:00')
    expect(Number.isNaN(new Date(normalizado).getTime())).toBe(false)
  })

  test('preserva offsets explícitos', () => {
    const iso = '2026-08-06T12:13:44+00:00'
    expect(normalizarScheduledAtBR(iso)).toBe(iso)
  })
})

describe('validarCriacaoPost — data no passado', () => {
  test('rejeita agendamento com data no passado', () => {
    const ontem = new Date(Date.now() - 24 * 60 * 60000).toISOString().replace('Z', '')
    const erro = validarCriacaoPost(baseArgs({ platforms: ['facebook'], scheduledAtUTC: ontem }))
    expect(erro).toMatch(/passado/)
  })

  test('não bloqueia "publicar agora" mesmo com scheduledAtUTC no passado', () => {
    const ontem = new Date(Date.now() - 24 * 60 * 60000).toISOString().replace('Z', '')
    const erro = validarCriacaoPost(baseArgs({ platforms: ['facebook'], scheduledAtUTC: ontem, publishNow: true }))
    expect(erro).toBeNull()
  })
})

describe('validarCriacaoPost — textByPlatform', () => {
  test('aceita descrição do TikTok até 4000 caracteres', () => {
    const erro = validarCriacaoPost(baseArgs({
      platforms: ['tiktok'],
      textByPlatform: { tiktokDescription: 'a'.repeat(4000) },
      titleByPlatform: { tiktok: 'Título curto' },
      tiktokPrivacyLevel: 'PUBLIC_TO_EVERYONE',
      itemsByPlatform: { tiktok: [{ path: 'x.jpg', type: 'image', caption: '' }] },
      aspectRatioValidoTiktokByPlatform: { tiktok: true },
    }))
    expect(erro).toBeNull()
  })

  test('rejeita descrição do TikTok acima de 4000 caracteres', () => {
    const erro = validarCriacaoPost(baseArgs({
      platforms: ['tiktok'],
      textByPlatform: { tiktokDescription: 'a'.repeat(4001) },
      tiktokPrivacyLevel: 'PUBLIC_TO_EVERYONE',
      itemsByPlatform: { tiktok: [{ path: 'x.jpg', type: 'image', caption: '' }] },
      aspectRatioValidoTiktokByPlatform: { tiktok: true },
    }))
    expect(erro).toMatch(/4000 caracteres/)
  })

  test('rejeita título do TikTok acima de 90 caracteres', () => {
    const erro = validarCriacaoPost(baseArgs({
      platforms: ['tiktok'],
      textByPlatform: { tiktokDescription: 'descrição' },
      titleByPlatform: { tiktok: 'a'.repeat(91) },
      tiktokPrivacyLevel: 'PUBLIC_TO_EVERYONE',
      itemsByPlatform: { tiktok: [{ path: 'x.jpg', type: 'image', caption: '' }] },
      aspectRatioValidoTiktokByPlatform: { tiktok: true },
    }))
    expect(erro).toMatch(/título do TikTok.*90 caracteres/)
  })

  test('aceita textByPlatform ausente', () => {
    const erro = validarCriacaoPost(baseArgs())
    expect(erro).toBeNull()
  })

  test('aceita textos por rede dentro do limite', () => {
    const erro = validarCriacaoPost(baseArgs({
      textByPlatform: { instagram: 'texto ig', facebook: 'texto fb' }
    }))
    expect(erro).toBeNull()
  })

  test('rejeita quando o texto da rede selecionada excede o limite dela', () => {
    const textoGigante = 'a'.repeat(63206 + 1)
    const erro = validarCriacaoPost(baseArgs({
      platforms: ['facebook'],
      textByPlatform: { facebook: textoGigante }
    }))
    expect(erro).toMatch(/63206 caracteres/)
  })

  test('não deixa o limite do TikTok interferir no Instagram', () => {
    const erro = validarCriacaoPost(baseArgs({
      platforms: ['instagram', 'tiktok'],
      textByPlatform: { instagram: 'a'.repeat(2200), tiktok: 'a'.repeat(90) },
      tiktokPrivacyLevel: 'PUBLIC_TO_EVERYONE',
      itemsByPlatform: { tiktok: [{ path: 'x.mp4', type: 'video', caption: '' }] },
      aspectRatioValidoTiktokByPlatform: { tiktok: true },
    }))
    expect(erro).toBeNull()
  })
})

describe('validarCriacaoPost — youtubeCategoryId', () => {
  test('aceita youtubeCategoryId ausente', () => {
    const erro = validarCriacaoPost(baseArgs())
    expect(erro).toBeNull()
  })

  test('aceita youtubeCategoryId válido', () => {
    const erro = validarCriacaoPost(baseArgs({ youtubeCategoryId: YOUTUBE_CATEGORY_IDS[0] }))
    expect(erro).toBeNull()
  })

  test('rejeita youtubeCategoryId desconhecido', () => {
    const erro = validarCriacaoPost(baseArgs({ youtubeCategoryId: '999' }))
    expect(erro).toMatch(/youtubeCategoryId inválido/)
  })
})

describe('validarCriacaoPost — youtubeFormat', () => {
  test('aceita youtubeFormat ausente', () => {
    const erro = validarCriacaoPost(baseArgs())
    expect(erro).toBeNull()
  })

  test('aceita video e short', () => {
    expect(validarCriacaoPost(baseArgs({ youtubeFormat: 'video' }))).toBeNull()
    expect(validarCriacaoPost(baseArgs({ youtubeFormat: 'short' }))).toBeNull()
  })

  test('rejeita youtubeFormat desconhecido', () => {
    const erro = validarCriacaoPost(baseArgs({ youtubeFormat: 'longform' }))
    expect(erro).toMatch(/youtubeFormat inválido/)
  })
})

describe('validarCriacaoPost — igFormat', () => {
  test('aceita igFormat ausente', () => {
    const erro = validarCriacaoPost(baseArgs())
    expect(erro).toBeNull()
  })

  test('aceita post, reel e story', () => {
    expect(validarCriacaoPost(baseArgs({ igFormat: 'post' }))).toBeNull()
    expect(validarCriacaoPost(baseArgs({ igFormat: 'reel' }))).toBeNull()
    expect(validarCriacaoPost(baseArgs({ igFormat: 'story' }))).toBeNull()
  })

  test('rejeita igFormat desconhecido', () => {
    const erro = validarCriacaoPost(baseArgs({ igFormat: 'highlight' }))
    expect(erro).toMatch(/igFormat inválido/)
  })

  test('rejeita story com carrossel (mais de 1 item)', () => {
    const erro = validarCriacaoPost(baseArgs({
      igFormat: 'story',
      items: [{ path: 'a.jpg', type: 'image', caption: '' }, { path: 'b.jpg', type: 'image', caption: '' }]
    }))
    expect(erro).toMatch(/Stories.*carrossel/)
  })

  test('aceita story com 1 item só', () => {
    const erro = validarCriacaoPost(baseArgs({
      igFormat: 'story',
      items: [{ path: 'a.jpg', type: 'image', caption: '' }]
    }))
    expect(erro).toBeNull()
  })

  test('aceita post/reel com carrossel', () => {
    const items = [{ path: 'a.jpg', type: 'image', caption: '' }, { path: 'b.jpg', type: 'image', caption: '' }]
    expect(validarCriacaoPost(baseArgs({ igFormat: 'post', items }))).toBeNull()
  })

  test('rejeita carrossel do Instagram com vídeo misturado', () => {
    const items = [{ path: 'a.jpg', type: 'image', caption: '' }, { path: 'b.mp4', type: 'video', caption: '' }]
    expect(validarCriacaoPost(baseArgs({ igFormat: 'post', items }))).toMatch(/somente fotos/)
  })

  test('rejeita mais de 10 fotos no carrossel do Instagram', () => {
    const items = Array.from({ length: 11 }, (_, index) => ({ path: `${index}.jpg`, type: 'image', caption: '' }))
    expect(validarCriacaoPost(baseArgs({ igFormat: 'post', items }))).toMatch(/no máximo 10 fotos/)
  })

  test('aceita carrossel de fotos do TikTok e rejeita vídeo misturado', () => {
    const fotos = Array.from({ length: 3 }, (_, index) => ({ path: `${index}.jpg`, type: 'image', caption: '' }))
    expect(validarCriacaoPost(baseArgs({
      platforms: ['tiktok'],
      textByPlatform: { tiktokDescription: 'descrição' },
      titleByPlatform: { tiktok: 'Título' },
      tiktokPrivacyLevel: 'PUBLIC_TO_EVERYONE',
      items: fotos,
    }))).toBeNull()
    expect(validarCriacaoPost(baseArgs({
      platforms: ['tiktok'],
      textByPlatform: { tiktokDescription: 'descrição' },
      tiktokPrivacyLevel: 'PUBLIC_TO_EVERYONE',
      items: [...fotos, { path: 'video.mp4', type: 'video', caption: '' }],
    }))).toMatch(/somente fotos/)
  })
})
