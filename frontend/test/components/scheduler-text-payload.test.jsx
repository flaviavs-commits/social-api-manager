import { describe, expect, it } from 'vitest'
import { textsForSelectedPlatforms } from '../../src/pages/scheduler-page.jsx'

describe('textsForSelectedPlatforms', () => {
  it('mantém a descrição do TikTok apesar da chave específica do formulário', () => {
    expect(textsForSelectedPlatforms({
      instagram: 'Texto do Instagram',
      tiktokDescription: 'Descrição do vídeo'
    }, ['tiktok'])).toEqual({ tiktokDescription: 'Descrição do vídeo' })
  })

  it('remove textos de redes não selecionadas', () => {
    expect(textsForSelectedPlatforms({ instagram: 'Instagram', facebook: 'Facebook' }, ['instagram']))
      .toEqual({ instagram: 'Instagram' })
  })
})
