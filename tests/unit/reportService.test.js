jest.mock('../../src/db/pool', () => ({ query: jest.fn() }))
jest.mock('../../src/services/mailer', () => ({ enviarRelatorioAgendado: jest.fn() }))

const pool = require('../../src/db/pool')
const mailer = require('../../src/services/mailer')
const { escapeHtml, gerarResumoRelatorio, enviarRelatorioAgendado } = require('../../src/services/reportService')

describe('reportService', () => {
  beforeEach(() => jest.clearAllMocks())

  test('escapa valores vindos do banco antes de montar o HTML', async () => {
    expect(escapeHtml('<status> & "teste"')).toBe('&lt;status&gt; &amp; &quot;teste&quot;')
    pool.query.mockResolvedValueOnce({ rows: [{ status: '<erro>', count: 2 }] })

    await expect(gerarResumoRelatorio({ userId: 7, periodDays: 30 })).resolves.toBe('<li>&lt;erro&gt;: 2</li>')
  })

  test('envia o relatório para os destinatários configurados', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] })
    mailer.enviarRelatorioAgendado.mockResolvedValueOnce(undefined)

    await expect(enviarRelatorioAgendado({ user_id: 7, name: 'Operacional', period_days: 30, recipients: ['user@example.com'] })).resolves.toEqual({ periodDays: 30, recipientCount: 1 })
    expect(mailer.enviarRelatorioAgendado).toHaveBeenCalledWith(['user@example.com'], 'Operacional', 30, '<li>Nenhuma publicação no período.</li>')
  })
})
