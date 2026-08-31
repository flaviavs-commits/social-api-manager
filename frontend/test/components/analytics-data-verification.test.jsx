import { render, screen } from '@testing-library/react'
import { AnalyticsDataVerification } from '../../src/components/analytics/analytics-data-verification.jsx'

describe('AnalyticsDataVerification', () => {
  it('explica cobertura e diferencia ausência de métrica de zero', () => {
    render(<AnalyticsDataVerification
      verification={{
        period: { days: 7, since: '2026-08-25', until: '2026-08-31' },
        overall: { status: 'partial', label: 'Dados parciais', description: 'Parte dos dados foi confirmada.' },
        coverage: { content: { total: 2, withData: 1, withoutData: 1, percent: 50 } },
        platforms: {
          instagram: {
            status: 'partial', label: 'Dados parciais', description: 'Uma publicação não tem métrica confirmada.',
            content: { total: 2, withData: 1 }, accounts: { connected: 1, withAnalytics: 1 },
          },
        },
      }}
      sourceErrors={[{ source: 'TikTok', message: 'Consulta indisponível' }]}
    />)

    expect(screen.getByRole('heading', { name: 'Dados parciais' })).toBeInTheDocument()
    expect(screen.getByText('50%')).toBeInTheDocument()
    expect(screen.getByText('Não entram como zero no cálculo.')).toBeInTheDocument()
    expect(screen.getByText(/TikTok: Consulta indisponível/)).toBeInTheDocument()
    expect(screen.getByText(/Visualizações são reproduções/)).toBeInTheDocument()
  })
})
