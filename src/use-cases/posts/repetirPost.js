const postsRepo = require('../../infra/db/postsRepository')
const { criarPost } = require('./criarPost')
const { ValidationError } = require('../../domain/posts/errors')

function parseJson(value, fallback) {
  if (value == null) return fallback
  if (typeof value === 'object') return value
  try { return JSON.parse(value) } catch { return fallback }
}

function mediaForCreate(items, fallbackPath, fallbackType) {
  const normalized = Array.isArray(items) ? items.filter(item => item && (item.path || item.url)) : []
  if (!normalized.length && fallbackPath) normalized.push({ path: fallbackPath, type: fallbackType })
  return normalized.map(item => ({
    url: item.url || item.path,
    mimetype: item.mimetype || item.mimeType || (item.type === 'video' ? 'video/mp4' : 'image/jpeg')
  }))
}

async function repetirPost({ id, scheduledAt, userId, userRole, isAdmin }) {
  const source = await postsRepo.buscarPostPorId(id, userId, isAdmin)
  if (!source) return null
  if (!['scheduled', 'published', 'partial'].includes(source.status)) {
    throw new ValidationError('Somente posts agendados ou já publicados podem ser copiados.')
  }

  const accounts = Array.isArray(source.accounts) ? source.accounts : []
  const platforms = Array.isArray(source.platforms) ? source.platforms : []
  const accountIds = accounts.map(account => account.accountId).filter(Boolean)
  if (!accountIds.length && source.accountId) accountIds.push(source.accountId)
  if (!accountIds.length) throw new ValidationError('Não foi possível identificar as contas originais desta publicação.')
  const sharedItems = parseJson(source.mediaItems, [])
  const media = mediaForCreate(sharedItems, source.mediaPath, source.mediaType)
  const mediaByPlatform = {}
  for (const account of accounts) {
    const accountItems = parseJson(account.mediaItems, [])
    if (accountItems.length) mediaByPlatform[account.platform] = mediaForCreate(accountItems)
  }

  const body = {
    text: source.text || '',
    textByPlatform: JSON.stringify(parseJson(source.textByPlatform, {})),
    titleByPlatform: JSON.stringify(parseJson(source.titleByPlatform, {})),
    platforms: JSON.stringify(platforms),
    accountIds: JSON.stringify(accountIds),
    scheduledAt,
    repeat: 'none',
    media: JSON.stringify(media),
    mediaByPlatform: JSON.stringify(mediaByPlatform),
    youtubeTitle: source.youtubeTitle || '',
    youtubeVisibility: source.youtubeVisibility || 'public',
    youtubeCategoryId: source.youtubeCategoryId || undefined,
    youtubeFormat: source.youtubeFormat || undefined,
    youtubeMadeForKids: source.youtubeMadeForKids == null ? undefined : String(source.youtubeMadeForKids),
    igFormat: source.igFormat || undefined,
    tiktokPrivacyLevel: source.tiktokPrivacyLevel || undefined,
    tiktokDisableComment: Boolean(source.tiktokDisableComment),
    tiktokDisableDuet: Boolean(source.tiktokDisableDuet),
    tiktokDisableStitch: Boolean(source.tiktokDisableStitch),
    locationId: source.locationId || undefined,
    locationName: source.locationName || undefined,
    firstComment: source.firstComment || undefined,
    publishNow: false
  }

  const result = await criarPost({ body, userId, userRole, isAdmin })
  return result.post
}

module.exports = { repetirPost }
