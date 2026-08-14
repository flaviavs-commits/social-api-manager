jest.mock('../../src/db/pool', () => ({ query: jest.fn() }))
jest.mock('../../src/services/mailer', () => ({ enviarRelatorioAgendado: jest.fn() }))
jest.mock('../../src/services/reportPdf', () => ({ gerarRelatorioPdf: jest.fn().mockResolvedValue(Buffer.from('%PDF-test')) }))

const pool = require('../../src/db/pool')
const mailer = require('../../src/services/mailer')
const { gerarRelatorioPdf } = require('../../src/services/reportPdf')
const { escapeHtml, reportFilename, gerarResumoRelatorio, enviarRelatorioAgendado } = require('../../src/services/reportService')

describe('reportService', () => {
  beforeEach(() => jest.clearAllMocks())

  test('escapa valores vindos do banco antes de montar o HTML', async () => {
    expect(escapeHtml('<status> & "teste"')).toBe('&lt;status&gt; &amp; &quot;teste&quot;')
    pool.query.mockResolvedValueOnce({ rows: [{ status: '<erro>', count: 2 }] })

    await expect(gerarResumoRelatorio({ userId: 7, periodDays: 30 })).resolves.toBe('<li>&lt;erro&gt;: 2</li>')
  })

  test('normaliza acentos no nome do arquivo PDF', () => {
    expect(reportFilename('Relatório mensal')).toBe('relatorio-mensal.pdf')
  })

  test('envia o relatório para os destinatários configurados', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] })
    mailer.enviarRelatorioAgendado.mockResolvedValueOnce(undefined)

    await expect(enviarRelatorioAgendado({ user_id: 7, name: 'Operacional', period_days: 30, recipients: ['user@example.com'] })).resolves.toEqual({ periodDays: 30, recipientCount: 1 })
    expect(gerarRelatorioPdf).toHaveBeenCalledWith(expect.objectContaining({ name: 'Operacional', periodDays: 30, rows: [] }))
    expect(mailer.enviarRelatorioAgendado).toHaveBeenCalledWith(['user@example.com'], 'Operacional', 30, '<li>Nenhuma publicação no período.</li>', expect.objectContaining({ filename: 'relatorio-operacional.pdf', pdf: expect.any(Buffer) }))
  })
})
