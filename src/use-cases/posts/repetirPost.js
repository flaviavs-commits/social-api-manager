const postsRepo = require('../../infra/db/postsRepository')
const contasRepo = require('../../repositories/contasRepository')
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
  const originalAccountIds = accounts.map(account => account.accountId).filter(Boolean)
  if (!originalAccountIds.length && source.accountId) originalAccountIds.push(source.accountId)

  // A conexão pode ter sido renovada no provedor desde a publicação original.
  // Nesse caso, o registro antigo de `contas` é removido e recriado com outro
  // ID, mesmo que o perfil do Instagram continue sendo o mesmo. Repetir o post
  // deve usar a conexão ativa atual do próprio usuário, sem abrir mão da
  // validação de posse feita por listarContasPorIds/listarContasAtivas...
  let targetAccounts = originalAccountIds.length
    ? await contasRepo.listarContasPorIds(originalAccountIds, userId, false)
    : []

  if (targetAccounts.length !== originalAccountIds.length) {
    const activeAccounts = await contasRepo.listarContasAtivasPorPlataformas(platforms, userId, false)
    const currentById = new Map(targetAccounts.map(account => [String(account.id ?? account.accountId), account]))
    const usedIds = new Set()
    const sourceAccounts = accounts.length ? accounts : []

    targetAccounts = sourceAccounts.length
      ? sourceAccounts.reduce((resolved, sourceAccount) => {
          const current = currentById.get(String(sourceAccount.accountId))
          const sameHandle = activeAccounts.find(account =>
            account.platform === sourceAccount.platform &&
            account.handle && sourceAccount.handle &&
            account.handle === sourceAccount.handle &&
            !usedIds.has(String(account.id))
          )
          const replacement = current || sameHandle || activeAccounts.find(account =>
            account.platform === sourceAccount.platform && !usedIds.has(String(account.id))
          )
          if (replacement && !usedIds.has(String(replacement.id))) {
            usedIds.add(String(replacement.id))
            resolved.push(replacement)
          }
          return resolved
        }, [])
      : activeAccounts

    // Posts antigos podem não ter o vínculo por conta completo. Nesse caso,
    // mantém a repetição funcional usando as conexões ativas das redes do post.
    if (!targetAccounts.length) targetAccounts = activeAccounts
  }

  const accountIds = targetAccounts.map(account => account.id ?? account.accountId).filter(Boolean)
  if (!accountIds.length) throw new ValidationError('Não foi possível identificar uma conta ativa para esta publicação.')
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
