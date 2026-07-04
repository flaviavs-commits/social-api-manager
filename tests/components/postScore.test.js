// Testes de componente — lógica de score de qualidade do post
// Extrai e testa a lógica pura de calcPostScore sem DOM
// (espelha o que está em public/index.html mas testável isoladamente)

const SCORE_RULES = {
  instagram: [
    { pts: 20, check: ({text}) => text.length > 0 },
    { pts: 10, check: ({text}) => text.length >= 50 },
    { pts: 15, check: ({text}) => (text.match(/#\w/g)||[]).length >= 3 },
    { pts: 25, check: ({hasMedia}) => hasMedia },
    { pts: 10, check: ({date}) => !!date },
    { pts: 10, check: ({text}) => /\p{Emoji}/u.test(text) },
    { pts: 10, check: ({text}) => text.length >= 100 },
  ],
  youtube: [
    { pts: 25, check: ({youtubeTitle}) => youtubeTitle.length >= 30 },
    { pts: 15, check: ({youtubeTitle}) => youtubeTitle.length > 0 },
    { pts: 20, check: ({hasMedia}) => hasMedia },
    { pts: 15, check: ({text}) => text.length >= 100 },
    { pts: 10, check: ({text}) => text.length > 0 },
    { pts: 10, check: ({date}) => !!date },
    { pts: 5,  check: ({text}) => /#\w/.test(text) },
  ],
  tiktok: [
    { pts: 20, check: ({hasMedia}) => hasMedia },
    { pts: 15, check: ({text}) => text.length > 0 },
    { pts: 20, check: ({text}) => (text.match(/#\w/g)||[]).length >= 3 },
    { pts: 15, check: ({text}) => /\p{Emoji}/u.test(text) },
    { pts: 15, check: ({date}) => !!date },
    { pts: 15, check: ({text}) => text.length >= 50 },
  ],
}

function calcScore(plat, ctx) {
  const rules = SCORE_RULES[plat]
  const total = rules.reduce((s, r) => s + r.pts, 0)
  const score = rules.reduce((s, r) => s + (r.check(ctx) ? r.pts : 0), 0)
  return Math.round((score / total) * 100)
}

describe('Score Instagram', () => {
  const base = { text: '', youtubeTitle: '', date: '', hasMedia: false }

  test('post vazio = 0', () => {
    expect(calcScore('instagram', base)).toBe(0)
  })

  test('só texto curto < 50 chars', () => {
    const s = calcScore('instagram', { ...base, text: 'Olá mundo' })
    expect(s).toBeGreaterThan(0)
    expect(s).toBeLessThan(50)
  })

  test('post completo com mídia, hashtags, emojis = 100', () => {
    const text = '😀 Post incrível sobre marketing digital! #marketing #digital #social '.padEnd(101, 'x')
    const s = calcScore('instagram', { text, date: '2026-07-04T12:00', hasMedia: true, youtubeTitle: '' })
    expect(s).toBe(100)
  })

  test('3 hashtags dão mais pontos que 1', () => {
    const um = calcScore('instagram', { ...base, text: '#um texto aqui para ter mais de cinquenta caracteres totais nessa legenda' })
    const tres = calcScore('instagram', { ...base, text: '#um #dois #tres texto aqui para ter mais de cinquenta caracteres totais nessa legenda' })
    expect(tres).toBeGreaterThan(um)
  })

  test('data preenchida vale pontos', () => {
    const semData = calcScore('instagram', { ...base, text: 'teste', hasMedia: true })
    const comData = calcScore('instagram', { ...base, text: 'teste', hasMedia: true, date: '2026-07-04T09:00' })
    expect(comData).toBeGreaterThan(semData)
  })
})

describe('Score YouTube', () => {
  const base = { text: '', youtubeTitle: '', date: '', hasMedia: false }

  test('sem título = pontuação baixa', () => {
    const s = calcScore('youtube', base)
    expect(s).toBe(0)
  })

  test('título curto < 30 chars recebe menos pontos que título longo', () => {
    const curto = calcScore('youtube', { ...base, youtubeTitle: 'Curto', hasMedia: true })
    const longo = calcScore('youtube', { ...base, youtubeTitle: 'Este é um título longo para o YouTube com mais de 30', hasMedia: true })
    expect(longo).toBeGreaterThan(curto)
  })

  test('post completo = 100', () => {
    const text = 'Descrição completa do vídeo com mais de cem caracteres para garantir a pontuação máxima no YouTube e SEO bom. #youtube'
    const s = calcScore('youtube', {
      text,
      youtubeTitle: 'Título longo YouTube com mais de trinta chars aqui OK',
      date: '2026-07-04T15:00',
      hasMedia: true,
    })
    expect(s).toBe(100)
  })
})

describe('Score TikTok', () => {
  const base = { text: '', youtubeTitle: '', date: '', hasMedia: false }

  test('sem vídeo = 0', () => {
    expect(calcScore('tiktok', base)).toBe(0)
  })

  test('vídeo + 3 hashtags + emoji + data + legenda = 100', () => {
    const text = '😂 Vídeo viral! #viral #tiktok #foryou esse texto é longo o suficiente pra passar de cinquenta chars'
    const s = calcScore('tiktok', { text, date: '2026-07-04T19:00', hasMedia: true, youtubeTitle: '' })
    expect(s).toBe(100)
  })
})
