const { validarCriacaoPost, INSTAGRAM_MIN_ANTECEDENCIA_MIN } = require('../../../../src/domain/posts/post')

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
