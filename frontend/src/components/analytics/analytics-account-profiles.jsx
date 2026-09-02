import { PlatformIcon } from '../ui/platform-icon.jsx'
import { latestOf, NETWORK_ORDER, PLAT_LABELS, fmtNum } from '../../lib/analytics-format.js'

function metricValue(profile, name) {
  const entry = profile?.totals?.metrics?.[name] ?? profile?.metrics?.[name]
  const value = entry?.total ?? entry
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function sumMetrics(profile, names) {
  const values = names.map(name => metricValue(profile, name)).filter(value => value != null)
  return values.length ? values.reduce((total, value) => total + value, 0) : null
}

function tiktokMetricTotal(tiktokVideos, accountId, names) {
  const values = tiktokVideos
    .filter(video => String(video.accountId) === String(accountId))
    .flatMap(video => names.map(name => Number(video[name])).filter(Number.isFinite))
  return values.length ? values.reduce((total, value) => total + value, 0) : null
}

function profileFor(data, account) {
  const profiles = data.accountAnalytics?.platforms?.[account.platform] || []
  const matchingProfile = profiles.find(profile => String(profile.localAccountId) === String(account.id))
  return matchingProfile || (profiles.length === 1 ? profiles[0] : null)
}

function audienceFor(data, account, profile, accountCount) {
  const follower = (data.accountAnalytics?.followerStats?.accounts || []).find(item => String(item.localAccountId || item.accountId) === String(account.id))
  if (follower?.currentFollowers != null && Number.isFinite(Number(follower.currentFollowers))) return Number(follower.currentFollowers)

  const legacy = account.platform === 'instagram'
    ? latestOf(data.instagramFollowers)
    : account.platform === 'tiktok'
      ? latestOf(data.tiktokStats)
      : account.platform === 'youtube'
        ? latestOf(data.youtubeSubscribers)
        : null
  if (legacy && accountCount === 1) {
    const value = Number(legacy.followerCount ?? legacy.subscriberCount)
    return Number.isFinite(value) ? value : null
  }
  return metricValue(profile, account.platform === 'tiktok' ? 'follower_count' : account.platform === 'facebook' ? 'page_follows' : 'subscriberCount')
}

function reachFor(account, profile, tiktokVideos) {
  if (account.platform === 'facebook') return sumMetrics(profile, ['page_media_view', 'page_video_views'])
  if (account.platform === 'instagram') return sumMetrics(profile, ['reach', 'views'])
  if (account.platform === 'youtube') return metricValue(profile, 'views')
  return tiktokMetricTotal(tiktokVideos, account.id, ['viewCount']) ?? metricValue(profile, 'views')
}

function interactionsFor(account, profile, tiktokVideos) {
  if (account.platform === 'facebook') return metricValue(profile, 'page_post_engagements')
  if (account.platform === 'instagram') return sumMetrics(profile, ['total_interactions', 'likes', 'comments', 'shares', 'saves'])
  if (account.platform === 'youtube') return sumMetrics(profile, ['likes', 'comments', 'shares'])
  return tiktokMetricTotal(tiktokVideos, account.id, ['likeCount', 'commentCount', 'shareCount']) ?? metricValue(profile, 'likes_count')
}

function accountStatus(account, profile) {
  const statuses = (account.tokens || []).map(token => token.status).filter(Boolean)
  if (statuses.includes('expired') || statuses.includes('error')) return { label: 'Atenção necessária', className: 'is-warning' }
  if (!statuses.length) return { label: 'Sem token ativo', className: 'is-warning' }
  if (profile?.errors?.length && !profile.totals && !profile.metrics) return { label: 'Analytics indisponível', className: 'is-warning' }
  return { label: 'Conectado', className: 'is-ready' }
}

function profileName(account) {
  const tokenName = (account.tokens || []).map(token => token.accountName).find(Boolean)
  return tokenName || account.handle || `Conta ${PLAT_LABELS[account.platform] || account.platform}`
}

export function AnalyticsAccountProfiles({ accounts, data, tiktokVideos, periodDays, onSelectNetwork, activeNet = null }) {
  const scopedAccounts = activeNet ? accounts.filter(account => account.platform === activeNet) : accounts
  const orderedAccounts = [...scopedAccounts].sort((a, b) => NETWORK_ORDER.indexOf(a.platform) - NETWORK_ORDER.indexOf(b.platform))
  if (!orderedAccounts.length) return null

  return <section className="analytics-profiles-section" aria-labelledby="analytics-profiles-title">
    <div className="analytics-profiles-heading">
      <div>
        <p className="analytics-kicker">PERFIS CONECTADOS</p>
        <h3 id="analytics-profiles-title">{activeNet ? `Perfil conectado do ${PLAT_LABELS[activeNet]}` : 'Sua operação em cada rede'}</h3>
        <p>{activeNet ? 'Identidade, saúde da conexão e resultados somente desta rede.' : 'Identidade, saúde da conexão e os principais resultados por conta.'}</p>
      </div>
      <span className="analytics-profiles-period">Últimos {periodDays} dias</span>
    </div>
    <div className="analytics-profiles-grid">
      {orderedAccounts.map(account => {
        const profile = profileFor(data, account)
        const status = accountStatus(account, profile)
        const audienceLabel = account.platform === 'youtube' ? 'Inscritos' : 'Seguidores'
        const accountCount = orderedAccounts.filter(item => item.platform === account.platform).length
        return <article className={`analytics-profile-card analytics-profile-card-${account.platform}`} key={account.id}>
          <div className="analytics-profile-card-header">
            <div className="analytics-profile-identity">
              <span className="analytics-profile-avatar">{account.avatarUrl ? <img src={account.avatarUrl} alt=""/> : <PlatformIcon platform={account.platform} className="h-5 w-5"/>}</span>
              <div><strong>{profileName(account)}</strong><span>{account.handle ? (account.handle.startsWith('@') ? account.handle : `@${account.handle}`) : PLAT_LABELS[account.platform]}</span></div>
            </div>
            <span className={`analytics-profile-status ${status.className}`}><i aria-hidden="true"/>{status.label}</span>
          </div>
          <div className="analytics-profile-network"><span className={`analytics-profile-network-icon analytics-profile-network-icon-${account.platform}`}><PlatformIcon platform={account.platform} className="h-4 w-4"/></span><span>{PLAT_LABELS[account.platform]}</span><button type="button" onClick={() => onSelectNetwork(account.platform, account.id)}>Ver relatório <span aria-hidden="true">→</span></button></div>
          <div className="analytics-profile-metrics">
            <div><span>{audienceLabel}</span><strong>{fmtNum(audienceFor(data, account, profile, accountCount))}</strong></div>
            <div><span>Alcance / views</span><strong>{fmtNum(reachFor(account, profile, tiktokVideos))}</strong></div>
            <div><span>Interações</span><strong>{fmtNum(interactionsFor(account, profile, tiktokVideos))}</strong></div>
          </div>
        </article>
      })}
    </div>
  </section>
}
