import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AnalyticsAccountInsights } from '../../src/components/analytics/analytics-account-insights.jsx'

vi.mock('react-chartjs-2', () => ({
  Bar: () => <div data-testid="bar-chart" />,
  Line: ({ data }) => <pre data-testid="line-chart">{JSON.stringify(data)}</pre>
}))

describe('AnalyticsAccountInsights', () => {
  it('renders the evolution chart with numeric values returned as strings', () => {
    const data = {
      accountAnalytics: {
        platforms: {
          instagram: [{
            timeSeries: {
              metrics: {
                reach: {
                  values: [
                    { date: '2026-08-01', value: '10' },
                    { date: '2026-08-02', value: '20' }
                  ]
                }
              }
            }
          }]
        }
      }
    }

    render(<AnalyticsAccountInsights net="instagram" data={data} />)

    expect(screen.getByText('Evolução das principais métricas')).toBeInTheDocument()
    expect(screen.getByTestId('line-chart')).toHaveTextContent('"data":[10,20]')
  })

  it('renders the official content-decay percentage fields with an explanation', () => {
    const data = {
      accountAnalytics: {
        platforms: {
          instagram: [{ accountId: 'ig-1', timeSeries: { metrics: {} } }]
        },
        contentDecay: [{
          platform: 'instagram',
          accountId: 'ig-1',
          data: {
            buckets: [{ bucket_label: '0-6h', avg_pct_of_final: 45.2, post_count: 3 }]
          }
        }]
      }
    }

    render(<AnalyticsAccountInsights net="instagram" data={data} />)

    expect(screen.getByText('Vida útil do conteúdo')).toBeInTheDocument()
    expect(screen.getByText('0-6h').parentElement).toHaveTextContent('0-6h 45,2% · 3 posts')
    expect(screen.getByText(/Percentual médio do engajamento final acumulado/)).toBeInTheDocument()
  })
})
