import { render, screen } from '@testing-library/react'
import { AnalyticsCards } from '../../src/components/analytics/analytics-cards.jsx'

function baseData(metrics) {
  const today = new Date().toISOString().slice(0, 10)
  return {
    metrics,
    instagramFollowers: {},
    tiktokStats: { [today]: { followerCount: 968, likesCount: 42 } },
    youtubeSubscribers: {},
  }
}

describe('AnalyticsCards', () => {
  it('usa os valores reais do catálogo de vídeos quando a linha local veio sem métrica', () => {
    render(<AnalyticsCards
      net="tiktok"
      tab="community"
      data={baseData([{ platform: 'tiktok', publishedAt: new Date().toISOString(), metrics: { views: null, likes: null } }])}
      tiktokVideos={[{ createTime: Math.floor(Date.now() / 1000), viewCount: 21, likeCount: 8, commentCount: 3, shareCount: 2 }]}
      periodDays={7}
    />)

    expect(screen.getByText('21')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
    expect(screen.getByText('968')).toBeInTheDocument()
  })
})
