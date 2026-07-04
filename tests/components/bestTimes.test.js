// Testes de componente — lógica de horários sugeridos (applyBestTime / updateBestTimesWidget)
// Testa a lógica pura: seleção de horário mantém o dia já escolhido

const BEST_TIMES = {
  instagram: [
    { time: '08:00', label: 'Manhã' },
    { time: '12:00', label: 'Almoço' },
    { time: '18:00', label: 'Tarde' },
    { time: '21:00', label: 'Noite' },
  ],
  facebook:  [{ time: '09:00', label: 'Manhã' }, { time: '19:00', label: 'Noite' }],
  youtube:   [{ time: '15:00', label: 'Tarde' }, { time: '20:00', label: 'Noite' }],
  tiktok:    [{ time: '07:00', label: 'Cedo'  }, { time: '21:00', label: 'Tarde-noite' }],
}

function mergeHorarios(plats) {
  const seen = new Set()
  const result = []
  plats.forEach(p => {
    (BEST_TIMES[p] || []).forEach(t => {
      if (!seen.has(t.time)) { seen.add(t.time); result.push({ ...t }) }
    })
  })
  return result.sort((a, b) => a.time.localeCompare(b.time))
}

function applyBestTime(time, dpSelected) {
  const pad = n => String(n).padStart(2, '0')
  const [h, m] = time.split(':').map(Number)
  const base = dpSelected
    ? { ...dpSelected, hour: h, minute: m }
    : (() => { const n = new Date(); return { year: n.getFullYear(), month: n.getMonth(), day: n.getDate(), hour: h, minute: m } })()
  return {
    dpSelected: base,
    value: `${base.year}-${pad(base.month+1)}-${pad(base.day)}T${pad(h)}:${pad(m)}`
  }
}

describe('mergeHorarios', () => {
  test('plataforma única retorna seus horários', () => {
    const times = mergeHorarios(['instagram'])
    expect(times).toHaveLength(4)
    expect(times.map(t => t.time)).toContain('08:00')
  })

  test('múltiplas plataformas une sem duplicatas', () => {
    // instagram tem 12:00, facebook também — não deve duplicar
    const times = mergeHorarios(['instagram', 'facebook'])
    const timeStrings = times.map(t => t.time)
    expect(new Set(timeStrings).size).toBe(timeStrings.length) // sem duplicatas
    expect(timeStrings).toContain('09:00') // facebook
    expect(timeStrings).toContain('08:00') // instagram
  })

  test('plataforma desconhecida retorna array vazio', () => {
    const times = mergeHorarios(['rede-que-nao-existe'])
    expect(times).toHaveLength(0)
  })

  test('resultado está ordenado por horário', () => {
    const times = mergeHorarios(['instagram', 'tiktok'])
    for (let i = 1; i < times.length; i++) {
      expect(times[i].time >= times[i-1].time).toBe(true)
    }
  })

  test('lista vazia retorna vazio', () => {
    expect(mergeHorarios([])).toHaveLength(0)
  })
})

describe('applyBestTime', () => {
  test('sem dia selecionado usa hoje com o horário dado', () => {
    const { dpSelected, value } = applyBestTime('09:00', null)
    expect(dpSelected.hour).toBe(9)
    expect(dpSelected.minute).toBe(0)
    expect(value).toMatch(/T09:00$/)
  })

  test('com dia selecionado mantém o dia e troca só o horário', () => {
    const existente = { year: 2026, month: 6, day: 15, hour: 8, minute: 0 }
    const { dpSelected, value } = applyBestTime('21:00', existente)
    expect(dpSelected.year).toBe(2026)
    expect(dpSelected.month).toBe(6)
    expect(dpSelected.day).toBe(15)
    expect(dpSelected.hour).toBe(21)
    expect(value).toBe('2026-07-15T21:00')
  })

  test('minutos são sempre dois dígitos', () => {
    const { value } = applyBestTime('08:00', { year: 2026, month: 0, day: 5, hour: 0, minute: 0 })
    expect(value).toBe('2026-01-05T08:00')
  })

  test('mês é sempre dois dígitos (zero-padded)', () => {
    const { value } = applyBestTime('12:00', { year: 2026, month: 0, day: 1, hour: 0, minute: 0 })
    expect(value).toMatch(/2026-01-01/)
  })
})
