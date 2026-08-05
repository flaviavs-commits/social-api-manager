import { fireEvent, render, screen } from '@testing-library/react'
import { AnalyticsSummary } from '../../src/components/analytics/analytics-summary.jsx'

vi.mock('react-chartjs-2', () => ({
  Line: () => <div data-testid="line-chart"/>,
  Bar: () => <div data-testid="bar-chart"/>,
}))

const data = {
  metrics: [{
    platform: 'instagram',
    publishedAt: new Date().toISOString(),
    metrics: { views: 100, likes: 12, comments: 3, shares: 2 },
  }],
  instagramFollowers: {},
  tiktokStats: {},
  youtubeSubscribers: {},
}

describe('AnalyticsSummary', () => {
  it('explica os números principais e permite trocar o período', () => {
    const onSelectPeriod = vi.fn()

    render(<AnalyticsSummary data={data} tiktokVideos={[]} periodDays={7} onSelectPeriod={onSelectPeriod}/>)

    expect(screen.getByRole('heading', { name: 'Visão geral' })).toBeInTheDocument()
    expect(screen.getByText('Visualizações')).toBeInTheDocument()
    expect(screen.getByText('Taxa de interação')).toBeInTheDocument()
    expect(screen.getByText(/uma taxa maior indica/i)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '30 dias' }))
    expect(onSelectPeriod).toHaveBeenCalledWith(30)
  })
})
