const { detectarTemaRestrito } = require('../../../../src/services/ai/contentSafety')

describe('contentSafety', () => {
  test('bloqueia conteúdo adulto', () => {
    expect(detectarTemaRestrito('crie conteúdo +18')).toMatchObject({ id: 'adult' })
    expect(detectarTemaRestrito('crie uma campanha sexual')).toMatchObject({ id: 'adult' })
  })

  test('permite finanças, jurídico, saúde e demais assuntos', () => {
    expect(detectarTemaRestrito('crie um post sobre investimentos e bolsa de valores')).toBeNull()
    expect(detectarTemaRestrito('explique um contrato trabalhista')).toBeNull()
    expect(detectarTemaRestrito('fale sobre sintomas de uma doença')).toBeNull()
    expect(detectarTemaRestrito('crie ideias sobre educação financeira para jovens')).toBeNull()
    expect(detectarTemaRestrito('crie um post sobre fotografia de viagens')).toBeNull()
  })
})
