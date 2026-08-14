const { gerarRelatorioPdf, normalizeRows } = require('../../src/services/reportPdf')

describe('reportPdf', () => {
  test('normaliza linhas e gera um PDF válido', async () => {
    expect(normalizeRows([{ status: 'published', count: '4' }])).toEqual([{ status: 'published', count: 4 }])
    const pdf = await gerarRelatorioPdf({
      name: 'Relatório mensal',
      periodDays: 30,
      rows: [{ status: 'published', count: 4 }, { status: 'error', count: 1 }]
    })
    expect(Buffer.isBuffer(pdf)).toBe(true)
    expect(pdf.subarray(0, 4).toString()).toBe('%PDF')
  })
})
