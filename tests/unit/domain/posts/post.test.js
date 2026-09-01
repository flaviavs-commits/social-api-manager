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
      itemsByPlatform: { tiktok: [{ path: 'x.mp4', type: 'video', caption: '' }] },
      aspectRatioValidoTiktokByPlatform: { tiktok: true },
    }))
    expect(erro).toBeNull()
  })

  test('rejeita descrição do TikTok acima de 4000 caracteres', () => {
    const erro = validarCriacaoPost(baseArgs({
      platforms: ['tiktok'],
      textByPlatform: { tiktokDescription: 'a'.repeat(4001) },
      tiktokPrivacyLevel: 'PUBLIC_TO_EVERYONE',
      itemsByPlatform: { tiktok: [{ path: 'x.mp4', type: 'video', caption: '' }] },
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
      itemsByPlatform: { tiktok: [{ path: 'x.mp4', type: 'video', caption: '' }] },
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

  test('rejeita Short sem vídeo vertical 9:16 e com 60 segundos ou mais', () => {
    const erro = validarCriacaoPost(baseArgs({
      platforms: ['youtube'],
      youtubeFormat: 'short',
      youtubeTitle: 'Meu Short',
      youtubeMadeForKids: false,
      items: [{ path: 'video.mp4', type: 'video', caption: '' }],
      mediaType: 'video',
      shortElegivel: false,
    }))
    expect(erro).toMatch(/Short.*9:16.*menor que 60 segundos/)
  })

  test('aceita Short elegível', () => {
    const erro = validarCriacaoPost(baseArgs({
      platforms: ['youtube'],
      youtubeFormat: 'short',
      youtubeTitle: 'Meu Short',
      youtubeMadeForKids: false,
      items: [{ path: 'video.mp4', type: 'video', caption: '' }],
      mediaType: 'video',
      shortElegivel: true,
    }))
    expect(erro).toBeNull()
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

  test('aceita um vídeo ou carrossel de fotos no TikTok', () => {
    expect(validarCriacaoPost(baseArgs({
      platforms: ['tiktok'],
      textByPlatform: { tiktokDescription: 'descrição' },
      tiktokPrivacyLevel: 'PUBLIC_TO_EVERYONE',
      items: [{ path: 'video.mp4', type: 'video', caption: '' }],
    }))).toBeNull()
    expect(validarCriacaoPost(baseArgs({
      platforms: ['tiktok'],
      textByPlatform: { tiktokDescription: 'descrição' },
      tiktokPrivacyLevel: 'PUBLIC_TO_EVERYONE',
      items: [{ path: 'foto.jpg', type: 'image', caption: '' }],
    }))).toBeNull()
    expect(validarCriacaoPost(baseArgs({
      platforms: ['tiktok'],
      textByPlatform: { tiktokDescription: 'descrição' },
      tiktokPrivacyLevel: 'PUBLIC_TO_EVERYONE',
      items: [{ path: 'a.jpg', type: 'image', caption: '' }, { path: 'b.jpg', type: 'image', caption: '' }],
    }))).toBeNull()
  })

  test('rejeita mistura de vídeo com fotos no TikTok', () => {
    expect(validarCriacaoPost(baseArgs({
      platforms: ['tiktok'],
      textByPlatform: { tiktokDescription: 'descrição' },
      tiktokPrivacyLevel: 'PUBLIC_TO_EVERYONE',
      items: [{ path: 'a.mp4', type: 'video', caption: '' }, { path: 'b.mp4', type: 'video', caption: '' }],
    }))).toMatch(/vídeo sozinho ou um carrossel/)
    expect(validarCriacaoPost(baseArgs({
      platforms: ['tiktok'],
      textByPlatform: { tiktokDescription: 'descrição' },
      tiktokPrivacyLevel: 'PUBLIC_TO_EVERYONE',
      items: [{ path: 'a.mp4', type: 'video', caption: '' }, { path: 'b.jpg', type: 'image', caption: '' }],
    }))).toMatch(/vídeo sozinho ou um carrossel/)
  })

  test('rejeita mais de 35 fotos no carrossel do TikTok', () => {
    const items = Array.from({ length: 36 }, (_, index) => ({ path: `${index}.jpg`, type: 'image', caption: '' }))
    expect(validarCriacaoPost(baseArgs({
      platforms: ['tiktok'],
      textByPlatform: { tiktokDescription: 'descrição' },
      tiktokPrivacyLevel: 'PUBLIC_TO_EVERYONE',
      items,
    }))).toMatch(/no máximo 35 imagens/)
  })

  test('rejeita vídeo do TikTok que não é 9:16', () => {
    const erro = validarCriacaoPost(baseArgs({
      platforms: ['tiktok'],
      textByPlatform: { tiktokDescription: 'descrição' },
      tiktokPrivacyLevel: 'PUBLIC_TO_EVERYONE',
      items: [{ path: 'video.mp4', type: 'video', caption: '' }],
      mediaType: 'video',
      aspectRatioValidoTiktok: false,
    }))
    expect(erro).toMatch(/proporção 9:16/)
  })
})

describe('validarCriacaoPost — facebookFormat', () => {
  test('aceita Feed e Reel do Facebook quando a mídia corresponde ao formato', () => {
    expect(validarCriacaoPost(baseArgs({ platforms: ['facebook'], facebookFormat: 'post' }))).toBeNull()
    expect(validarCriacaoPost(baseArgs({
      platforms: ['facebook'],
      facebookFormat: 'reel',
      items: [{ path: 'reel.mp4', type: 'video', caption: '' }],
      mediaType: 'video',
      aspectRatioValidoFacebook: true,
    }))).toBeNull()
  })

  test('rejeita Reel do Facebook sem um vídeo vertical 9:16', () => {
    const erro = validarCriacaoPost(baseArgs({
      platforms: ['facebook'],
      facebookFormat: 'reel',
      items: [{ path: 'foto.jpg', type: 'image', caption: '' }],
      mediaType: 'image',
    }))
    expect(erro).toMatch(/Reel do Facebook.*vídeo/)
  })

  test('rejeita proporção inválida no Reel do Facebook', () => {
    const erro = validarCriacaoPost(baseArgs({
      platforms: ['facebook'],
      facebookFormat: 'reel',
      items: [{ path: 'reel.mp4', type: 'video', caption: '' }],
      mediaType: 'video',
      aspectRatioValidoFacebook: false,
    }))
    expect(erro).toMatch(/Facebook.*9:16/)
  })

  test('rejeita facebookFormat desconhecido', () => {
    const erro = validarCriacaoPost(baseArgs({ facebookFormat: 'story' }))
    expect(erro).toMatch(/facebookFormat inválido/)
  })
})

describe('validarCriacaoPost — limites de mídia', () => {
  test('rejeita imagem do Instagram acima de 8 MB', () => {
    const erro = validarCriacaoPost(baseArgs({
      mediaMetadata: [{ type: 'image', size: 8 * 1024 * 1024 + 1 }],
    }))
    expect(erro).toMatch(/Instagram.*8 MB/)
  })

  test('usa a mídia e o limite da plataforma própria', () => {
    const erro = validarCriacaoPost(baseArgs({
      platforms: ['instagram', 'tiktok'],
      items: [{ path: 'ig.jpg', type: 'image', caption: '' }],
      mediaMetadata: [{ type: 'image', size: 8 * 1024 * 1024 }],
      itemsByPlatform: { tiktok: [{ path: 'tt.jpg', type: 'image', caption: '' }] },
      mediaMetadataByPlatform: { tiktok: [{ type: 'image', size: 20 * 1024 * 1024 + 1 }] },
      tiktokPrivacyLevel: 'PUBLIC_TO_EVERYONE',
    }))
    expect(erro).toMatch(/TikTok.*20 MB/)
  })

  test('rejeita vídeo do TikTok abaixo de 720p ou fora de 3s–10min', () => {
    const erro = validarCriacaoPost(baseArgs({
      platforms: ['tiktok'],
      items: [{ path: 'tt.mp4', type: 'video', caption: '' }],
      mediaType: 'video',
      aspectRatioValidoTiktok: true,
      mediaMetadata: [{ type: 'video', size: 1, width: 719, height: 1279, duration: 2 }],
      tiktokPrivacyLevel: 'PUBLIC_TO_EVERYONE',
    }))
    expect(erro).toMatch(/720p/)
  })

  test('rejeita vídeo do Facebook Reel acima de 90 segundos', () => {
    const erro = validarCriacaoPost(baseArgs({
      platforms: ['facebook'],
      facebookFormat: 'reel',
      items: [{ path: 'fb.mp4', type: 'video', caption: '' }],
      mediaType: 'video',
      aspectRatioValidoFacebook: true,
      mediaMetadata: [{ type: 'video', size: 1, width: 1080, height: 1920, duration: 91 }],
    }))
    expect(erro).toMatch(/90 segundos/)
  })
})
