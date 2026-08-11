const pool = require('../db/pool')
const { requestJson } = require('../infra/http/requestJson')
const zernioClient = require('../infra/social/zernioClient')
const { mapWithConcurrency } = require('../utils/concurrency')
const { safeMessage } = require('../utils/redact')

const YOUTUBE_API = 'https://www.googleapis.com/youtube/v3'
const SNAPSHOT_DAYS = 30

class UnsupportedBenchmarkSourceError extends Error {
  constructor(message) {
    super(message)
    this.name = 'UnsupportedBenchmarkSourceError'
  }
}

function dateOnly(date = new Date()) {
  return date.toISOString().slice(0, 10)
}

function number(value) {
  const result = Number(value)
  return Number.isFinite(result) && result >= 0 ? result : 0
}

function average(values) {
  return values.length ? values.reduce((sum, value) => sum + number(value), 0) / values.length : 0
}

function channelSelector(profile) {
  let url
  try { url = new URL(profile.profile_url) } catch { throw new Error('URL do perfil do YouTube inválida.') }
  const parts = url.pathname.split('/').filter(Boolean)
  const channelIndex = parts.indexOf('channel')
  if (channelIndex >= 0 && parts[channelIndex + 1]) return { id: parts[channelIndex + 1] }
  const handle = parts[0]?.startsWith('@') ? parts[0] : parts[1] && ['user', 'c'].includes(parts[0]) ? parts[1] : null
  if (handle) return { forHandle: handle.startsWith('@') ? handle : `@${handle}` }
  throw new UnsupportedBenchmarkSourceError('Para sincronizar o YouTube, use uma URL /channel/UC... ou /@handle.')
}

async function youtubeRequest(path, query) {
  if (!process.env.GOOGLE_API_KEY) throw new Error('GOOGLE_API_KEY não configurada para o monitor público do YouTube.')
  return requestJson(`${YOUTUBE_API}${path}`, { query: { ...query, key: process.env.GOOGLE_API_KEY }, timeoutMs: 12_000, retries: 2 })
}

async function collectYouTube(profile) {
  const channel = await youtubeRequest('/channels', {
    part: 'statistics,contentDetails',
    ...channelSelector(profile)
  })
  const item = channel.items?.[0]
  if (!item) throw new Error('Canal do YouTube não encontrado ou não público.')

  const until = new Date()
  const since = new Date(until.getTime() - SNAPSHOT_DAYS * 86400000)
  const uploadsPlaylistId = item.contentDetails?.relatedPlaylists?.uploads
  let recentItems = []
  if (uploadsPlaylistId) {
    const uploads = await youtubeRequest('/playlistItems', {
      part: 'snippet,contentDetails',
      playlistId: uploadsPlaylistId,
      maxResults: 50
    })
    recentItems = (uploads.items || []).filter(video => {
      const publishedAt = video.snippet?.publishedAt || video.contentDetails?.videoPublishedAt
      return publishedAt && new Date(publishedAt) >= since
    })
  }

  const videoIds = recentItems.map(item => item.contentDetails?.videoId).filter(Boolean)
  const videoStats = videoIds.length
    ? await youtubeRequest('/videos', { part: 'statistics,status', id: videoIds.join(',') })
    : { items: [] }
  const publicVideos = (videoStats.items || []).filter(video => video.status?.publicStatsViewable !== false)

  return {
    followers: number(item.statistics?.subscriberCount),
    postsLast30Days: recentItems.length,
    avgLikes: average(publicVideos.map(video => video.statistics?.likeCount)),
    avgComments: average(publicVideos.map(video => video.statistics?.commentCount)),
    avgShares: 0,
    avgViews: average(publicVideos.map(video => video.statistics?.viewCount)),
    avgSaves: 0,
    sourceUrl: profile.profile_url,
    collectionMethod: 'official_api'
  }
}

function zernioPlatformStats(post, platform, accountId) {
  const platformPost = post.platforms?.find(item => item.platform === platform && (!accountId || item.accountId === accountId))
  return platformPost?.analytics || post.analytics || {}
}

async function collectZernio(profile) {
  if (!profile.zernio_account_id) {
    throw new UnsupportedBenchmarkSourceError('Este perfil não está conectado ao Zernio com autorização do proprietário.')
  }

  const until = new Date()
  const since = new Date(until.getTime() - SNAPSHOT_DAYS * 86400000)
  const fromDate = dateOnly(since)
  const toDate = dateOnly(until)
  const [accountsResult, followerResult, analyticsResult] = await Promise.allSettled([
    zernioClient.listAccounts(),
    zernioClient.getFollowerStats({ accountIds: profile.zernio_account_id, fromDate, toDate, granularity: 'daily' }),
    zernioClient.getAnalytics({ accountId: profile.zernio_account_id, fromDate, toDate, limit: 100 })
  ])
  if (accountsResult.status !== 'fulfilled') throw accountsResult.reason
  const account = (accountsResult.value.accounts || []).find(item => item._id === profile.zernio_account_id)
  if (!account) throw new Error('Conta autorizada não encontrada no Zernio.')
  const followerData = followerResult.status === 'fulfilled' ? followerResult.value : null
  const analyticsData = analyticsResult.status === 'fulfilled' ? analyticsResult.value : null
  const followerRows = followerData?.stats?.[profile.zernio_account_id] || []
  const latestFollowerRow = followerRows[followerRows.length - 1]
  const followers = number(latestFollowerRow?.followers ?? account?.followersCount ?? account?.metadata?.profileData?.followersCount)
  const posts = (analyticsData?.posts || []).filter(post => !post.publishedAt || new Date(post.publishedAt) >= since)
  const stats = posts.map(post => zernioPlatformStats(post, profile.platform, profile.zernio_account_id))

  return {
    followers,
    postsLast30Days: posts.length,
    avgLikes: average(stats.map(item => item.likes)),
    avgComments: average(stats.map(item => item.comments)),
    avgShares: average(stats.map(item => item.shares)),
    avgViews: average(stats.map(item => item.views)),
    avgSaves: average(stats.map(item => item.saves)),
    sourceUrl: profile.profile_url,
    collectionMethod: 'official_api'
  }
}

async function saveSnapshot(profileId, snapshot) {
  await pool.query(`
    INSERT INTO public_profile_snapshots (
      competitor_profile_id, captured_on, followers, posts_last_30_days,
      avg_likes, avg_comments, avg_shares, avg_views, avg_saves,
      source_url, collection_method
    ) VALUES ($1,CURRENT_DATE,$2,$3,$4,$5,$6,$7,$8,$9,$10)
    ON CONFLICT (competitor_profile_id, captured_on) DO UPDATE SET
      followers=EXCLUDED.followers,
      posts_last_30_days=EXCLUDED.posts_last_30_days,
      avg_likes=EXCLUDED.avg_likes,
      avg_comments=EXCLUDED.avg_comments,
      avg_shares=EXCLUDED.avg_shares,
      avg_views=EXCLUDED.avg_views,
      avg_saves=EXCLUDED.avg_saves,
      source_url=EXCLUDED.source_url,
      collection_method=EXCLUDED.collection_method
  `, [profileId, snapshot.followers, snapshot.postsLast30Days, snapshot.avgLikes, snapshot.avgComments, snapshot.avgShares, snapshot.avgViews, snapshot.avgSaves, snapshot.sourceUrl, snapshot.collectionMethod])
}

function providerFor(profile) {
  if (profile.monitor_provider === 'youtube_public') return 'youtube_public'
  if (profile.monitor_provider === 'zernio') return 'zernio'
  if (profile.platform === 'youtube' && process.env.GOOGLE_API_KEY) return 'youtube_public'
  if (profile.zernio_account_id) return 'zernio'
  return null
}

async function observeProfile(profile) {
  const provider = providerFor(profile)
  if (!provider) {
    await pool.query("UPDATE competitor_profiles SET monitor_status='unsupported', monitor_error=$1 WHERE id=$2", ['Nenhuma fonte oficial disponível. YouTube usa GOOGLE_API_KEY; outras redes precisam de conta autorizada no Zernio.', profile.id])
    return { id: profile.id, status: 'unsupported' }
  }

  await pool.query("UPDATE competitor_profiles SET monitor_status='syncing', monitor_error=NULL WHERE id=$1", [profile.id])
  try {
    const snapshot = provider === 'youtube_public' ? await collectYouTube(profile) : await collectZernio(profile)
    await saveSnapshot(profile.id, snapshot)
    await pool.query("UPDATE competitor_profiles SET monitor_status='active', last_synced_at=NOW(), monitor_error=NULL WHERE id=$1", [profile.id])
    return { id: profile.id, status: 'active', provider }
  } catch (error) {
    const message = safeMessage(error?.message || 'Falha ao sincronizar perfil').slice(0, 500)
    const status = error instanceof UnsupportedBenchmarkSourceError ? 'unsupported' : 'error'
    await pool.query('UPDATE competitor_profiles SET monitor_status=$1, monitor_error=$2 WHERE id=$3', [status, message, profile.id])
    return { id: profile.id, status, error: message }
  }
}

async function observarBenchmarks(userId = null) {
  const params = []
  const ownerClause = userId ? `AND cp.user_id = $${params.push(userId)}` : ''
  const { rows } = await pool.query(`
    SELECT cp.id, cp.user_id, cp.platform, cp.handle, cp.profile_url,
           cp.monitor_provider, cp.monitor_interval_minutes,
           z.zernio_account_id
      FROM competitor_profiles cp
      LEFT JOIN LATERAL (
        SELECT c.zernio_account_id
          FROM contas c
         WHERE c.user_id = cp.user_id
           AND c.platform = cp.platform
           AND lower(regexp_replace(c.handle, '^@', '')) = lower(regexp_replace(cp.handle, '^@', ''))
           AND c.zernio_account_id IS NOT NULL
         ORDER BY c.id DESC
         LIMIT 1
      ) z ON TRUE
     WHERE cp.monitor_enabled = TRUE
       ${ownerClause}
       AND (cp.last_synced_at IS NULL OR cp.last_synced_at <= NOW() - (cp.monitor_interval_minutes || ' minutes')::INTERVAL)
  `, params)
  const results = await mapWithConcurrency(rows, observeProfile, 2)
  return { selected: rows.length, results }
}

async function coletarBenchmarksSelecionados(userId, profileIds) {
  const ids = [...new Set(profileIds.map(Number).filter(Number.isInteger))]
  if (!ids.length) return { selected: 0, results: [] }

  const { rows } = await pool.query(`
    SELECT cp.id, cp.user_id, cp.platform, cp.handle, cp.profile_url,
           cp.niche, cp.monitor_provider, cp.monitor_interval_minutes,
           z.zernio_account_id
      FROM competitor_profiles cp
      LEFT JOIN LATERAL (
        SELECT c.zernio_account_id
          FROM contas c
         WHERE c.user_id = cp.user_id
           AND c.platform = cp.platform
           AND lower(regexp_replace(c.handle, '^@', '')) = lower(regexp_replace(cp.handle, '^@', ''))
           AND c.zernio_account_id IS NOT NULL
         ORDER BY c.id DESC
         LIMIT 1
      ) z ON TRUE
     WHERE cp.user_id = $1
       AND cp.id = ANY($2::int[])
       AND cp.public_only = TRUE
  `, [userId, ids])

  if (!rows.length) return { selected: 0, results: [] }

  const niches = [...new Set(rows.map(profile => profile.niche).filter(Boolean))]
  if (niches.length > 1) {
    const error = new Error('Selecione perfis de um único nicho para a coleta Zernio.')
    error.statusCode = 400
    throw error
  }

  await pool.query(`
    UPDATE competitor_profiles
       SET monitor_enabled=TRUE,
           monitor_provider='zernio',
           monitor_interval_minutes=15,
           monitor_status='idle',
           monitor_error=NULL
     WHERE user_id=$1 AND id=ANY($2::int[]) AND public_only=TRUE
  `, [userId, rows.map(profile => profile.id)])

  const results = await mapWithConcurrency(rows, observeProfile, 2)
  return { selected: rows.length, results, niche: niches[0] || null }
}

module.exports = { observarBenchmarks, coletarBenchmarksSelecionados, observeProfile, collectYouTube, collectZernio }
