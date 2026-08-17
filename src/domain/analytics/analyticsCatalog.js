const PLATFORMS = ['facebook', 'instagram', 'youtube', 'tiktok']
const DEFAULT_ANALYTICS_DAYS = 7
const MAX_ANALYTICS_DAYS = 90

// Métricas aceitas pelos relatórios do provedor atual. A lista fica no
// domínio para ser reutilizada pelo backend, frontend e documentação sem
// espalhar strings de API pelos adaptadores.
const ACCOUNT_METRICS = {
  facebook: [
    'page_media_view', 'page_views_total', 'page_post_engagements',
    'page_video_views', 'page_video_view_time', 'page_follows',
    'followers_gained', 'followers_lost'
  ],
  instagram: [
    'reach', 'views', 'accounts_engaged', 'total_interactions', 'comments',
    'likes', 'saves', 'shares', 'replies', 'reposts', 'follows_and_unfollows',
    'profile_links_taps'
  ],
  tiktok: [
    'follower_count', 'following_count', 'likes_count', 'video_count',
    'followers_gained', 'followers_lost'
  ],
  youtube: [
    'views', 'engagedViews', 'likes', 'comments', 'shares', 'dislikes',
    'estimatedMinutesWatched', 'averageViewDuration', 'averageViewPercentage',
    'subscribersGained', 'subscribersLost'
  ]
}

const UNAVAILABLE_METRICS = {
  tiktok: [
    'profile_views', 'account_impressions', 'account_reach', 'watch_time',
    'average_watch_time', 'full_watched_rate', 'impression_sources'
  ],
  youtube: ['impressions', 'impressionsClickThroughRate']
}

function accountMetrics(platform) {
  return ACCOUNT_METRICS[platform] || []
}

module.exports = {
  PLATFORMS, ACCOUNT_METRICS, UNAVAILABLE_METRICS, accountMetrics,
  DEFAULT_ANALYTICS_DAYS, MAX_ANALYTICS_DAYS
}
