const { detectarTemaRestrito } = require('../../../../src/services/ai/contentSafety')

describe('contentSafety', () => {
  test('bloqueia temas médicos', () => {
    expect(detectarTemaRestrito('explique os sintomas de uma doença')).toMatchObject({ id: 'medical' })
  })

  test('bloqueia temas jurídicos', () => {
    expect(detectarTemaRestrito('crie um post sobre contrato trabalhista')).toMatchObject({ id: 'legal' })
  })

  test('bloqueia conteúdo adulto', () => {
    expect(detectarTemaRestrito('crie conteúdo +18')).toMatchObject({ id: 'adult' })
  })

  test('bloqueia finanças aprofundadas', () => {
    expect(detectarTemaRestrito('faça uma análise de day trade')).toMatchObject({ id: 'deep_finance' })
  })

  test('permite temas gerais e educação financeira básica', () => {
    expect(detectarTemaRestrito('crie ideias sobre educação financeira para jovens')).toBeNull()
    expect(detectarTemaRestrito('crie um post sobre fotografia de viagens')).toBeNull()
  })
})
