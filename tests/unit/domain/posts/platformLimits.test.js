const { limiteTexto, cortarParaLimite, ajustarPostParaPlataformas, YOUTUBE_TITLE_MAX } = require('../../../../src/domain/posts/platformLimits')

describe('limiteTexto', () => {
  test('tiktok com mídia de imagem usa o limite de foto (90)', () => {
    expect(limiteTexto('tiktok', 'image')).toBe(90)
  })

  test('tiktok com mídia de vídeo também usa o limite de 90', () => {
    expect(limiteTexto('tiktok', 'video')).toBe(90)
  })

  test('tiktok sem mediaType definido mantém o limite de 90', () => {
    expect(limiteTexto('tiktok', null)).toBe(90)
  })

  test('instagram sempre usa 2200 independente do mediaType', () => {
    expect(limiteTexto('instagram', 'image')).toBe(2200)
    expect(limiteTexto('instagram', 'video')).toBe(2200)
  })

  test('plataforma desconhecida retorna null', () => {
    expect(limiteTexto('bluesky', 'image')).toBeNull()
  })
})

describe('cortarParaLimite', () => {
  test('não corta texto dentro do limite', () => {
    expect(cortarParaLimite('oi', 10)).toBe('oi')
  })

  test('corta preservando palavra inteira quando o espaço está próximo do limite', () => {
    const texto = 'palavra um dois tres quatro'
    const cortado = cortarParaLimite(texto, 20)
    expect(cortado.length).toBeLessThanOrEqual(20)
    expect(texto.startsWith(cortado)).toBe(true)
    expect(cortado.endsWith(' ')).toBe(false)
  })

  test('corta no meio da palavra se ela sozinha já estourar o limite', () => {
    const texto = 'a'.repeat(200)
    const cortado = cortarParaLimite(texto, 50)
    expect(cortado.length).toBe(50)
  })
})

describe('ajustarPostParaPlataformas', () => {
  test('corta texto para o limite de foto do TikTok quando mediaType é image', () => {
    const { post, avisos } = ajustarPostParaPlataformas({ texto: 'x'.repeat(200), titulo: '' }, ['tiktok'], 'image')
    expect(post.texto.length).toBeLessThanOrEqual(90)
    expect(avisos).toHaveLength(1)
    expect(avisos[0]).toMatch(/90 caracteres/)
  })

  test('corta texto para vídeo do TikTok acima do limite de 90', () => {
    const texto = 'x'.repeat(200)
    const { post, avisos } = ajustarPostParaPlataformas({ texto, titulo: '' }, ['tiktok'], 'video')
    expect(post.texto.length).toBeLessThanOrEqual(90)
    expect(avisos).toHaveLength(1)
    expect(avisos[0]).toMatch(/90 caracteres/)
  })

  test('usa o menor limite entre múltiplas plataformas selecionadas', () => {
    const { post } = ajustarPostParaPlataformas({ texto: 'x'.repeat(200), titulo: '' }, ['facebook', 'tiktok'], 'image')
    expect(post.texto.length).toBeLessThanOrEqual(90)
  })

  test('corta o título do YouTube para 100 caracteres', () => {
    const { post, avisos } = ajustarPostParaPlataformas({ texto: 'oi', titulo: 'x'.repeat(150) }, ['youtube'], 'video')
    expect(post.titulo.length).toBeLessThanOrEqual(YOUTUBE_TITLE_MAX)
    expect(avisos.some(a => a.includes('Título do YouTube'))).toBe(true)
  })

  test('não gera avisos quando tudo já está dentro do limite', () => {
    const { post, avisos } = ajustarPostParaPlataformas({ texto: 'post curto', titulo: 'título curto' }, ['instagram'], 'image')
    expect(post.texto).toBe('post curto')
    expect(avisos).toHaveLength(0)
  })

  test('plataforma sem limite conhecido não corta nada', () => {
    const texto = 'x'.repeat(5000)
    const { post, avisos } = ajustarPostParaPlataformas({ texto, titulo: '' }, ['bluesky'], 'image')
    expect(post.texto).toBe(texto)
    expect(avisos).toHaveLength(0)
  })
})
