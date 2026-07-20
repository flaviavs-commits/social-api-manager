const { validarCriacaoPost, INSTAGRAM_MIN_ANTECEDENCIA_MIN, MAX_TEXT_LENGTH, YOUTUBE_CATEGORY_IDS } = require('../../../../src/domain/posts/post')

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

describe('validarCriacaoPost — textByPlatform', () => {
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

  test('rejeita quando o texto de uma rede específica excede o limite', () => {
    const textoGigante = 'a'.repeat(MAX_TEXT_LENGTH + 1)
    const erro = validarCriacaoPost(baseArgs({
      textByPlatform: { instagram: 'ok', facebook: textoGigante }
    }))
    expect(erro).toMatch(new RegExp(`${MAX_TEXT_LENGTH} caracteres`))
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
})
