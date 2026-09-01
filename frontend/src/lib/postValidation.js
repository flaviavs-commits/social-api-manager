// Validações client-side do agendador — espelham o subconjunto verificável no
// navegador de social-api-manager/src/domain/posts/post.js (validarCriacaoPost)
// e src/domain/posts/videoRules.js (regras de proporção/duração). O backend
// continua sendo a fonte da verdade (ver comentário lá); ao mudar uma regra
// nesses arquivos, atualize aqui também.
import { PLATFORM_TEXT_LIMITS, getPlatformTextLimit } from './platformTextLimits.js'
import { MEDIA_LIMITS, formatMediaLimitViolation, mediaKindFromMime, validateMediaMetadata } from './mediaLimits.js'

export { MEDIA_LIMITS, formatMediaLimitViolation, mediaKindFromMime, validateMediaMetadata }

const TIKTOK_PRIVACY_LEVELS = ['PUBLIC_TO_EVERYONE', 'MUTUAL_FOLLOW_FRIENDS', 'FOLLOWER_OF_CREATOR', 'SELF_ONLY']
const INSTAGRAM_MIN_ANTECEDENCIA_MIN = 20
export const INSTAGRAM_CAROUSEL_MAX_ITEMS = 10
export const TIKTOK_PHOTO_MAX_ITEMS = 35
const NINE_BY_SIXTEEN_RATIO = 9 / 16
const VERTICAL_RATIO_TOLERANCE = 0.02
const YOUTUBE_SHORT_MAX_DURATION_SECONDS = 60
const INSTAGRAM_ASPECT_RATIO_RANGES = {
  post: [4 / 5, 1.91],
  reel: [0.5625 * 0.98, 0.5625 * 1.02],
  story: [0.5625 * 0.98, 0.5625 * 1.02],
}

export function mediaFileKey(file) {
  return `${file.name}-${file.lastModified}-${file.size}`
}

export function isAspectRatioValidForTiktok({ width, height }) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return false
  const ratio = width / height
  const min = NINE_BY_SIXTEEN_RATIO * (1 - VERTICAL_RATIO_TOLERANCE)
  const max = NINE_BY_SIXTEEN_RATIO * (1 + VERTICAL_RATIO_TOLERANCE)
  return ratio >= min && ratio <= max
}

export function isShortEligible({ width, height, duration }) {
  if (!isAspectRatioValidForTiktok({ width, height })) return false
  return Number.isFinite(duration) && duration > 0 && duration < YOUTUBE_SHORT_MAX_DURATION_SECONDS
}

export function isAspectRatioValidForInstagram({ width, height }, format = 'post') {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return false
  const ratio = width / height
  const [min, max] = INSTAGRAM_ASPECT_RATIO_RANGES[format] || INSTAGRAM_ASPECT_RATIO_RANGES.post
  return ratio >= min && ratio <= max
}

// Lê largura/altura/duração de um vídeo sem enviá-lo — usado só para a
// checagem de proporção do TikTok antes do upload. Resolve `null` se o
// navegador não conseguir carregar os metadados (arquivo corrompido, etc.);
// nesse caso a checagem de proporção é simplesmente pulada no cliente e fica
// a cargo da validação do backend.
export function readVideoMeta(file) {
  return new Promise(resolve => {
    const url = URL.createObjectURL(file)
    const video = document.createElement('video')
    video.preload = 'metadata'
    video.onloadedmetadata = () => {
      resolve({ width: video.videoWidth, height: video.videoHeight, duration: video.duration })
      URL.revokeObjectURL(url)
    }
    video.onerror = () => { URL.revokeObjectURL(url); resolve(null) }
    video.src = url
  })
}

// Retorna a lista de pendências para o post atual. `youtubeMadeForKids` é a
// string do <select> ('', 'true' ou 'false'), não um boolean — mesmo padrão
// já usado por youtubeVisibility/igFormat/tiktokPrivacyLevel neste formulário.
export function buildValidationIssues({ text = '', textByPlatform = {}, titleByPlatform = {}, tiktokDescription = '', platforms = [], files = [], filesByPlatform = {}, publishNow, scheduledAt, youtubeTitle = '', youtubeMadeForKids, youtubeFormat = '', facebookFormat = 'post', igFormat = 'post', tiktokPrivacyLevel, videoMetaByKey = {}, mediaMetaByKey = {} }) {
  const issues = []
  const mediaForPlatform = platform => Object.prototype.hasOwnProperty.call(filesByPlatform, platform) && filesByPlatform[platform]?.length
    ? filesByPlatform[platform]
    : files
  const hasMedia = files.length > 0 || Object.values(filesByPlatform).some(platformFiles => platformFiles?.length > 0)
  const textForPlatform = platform => {
    const key = platform === 'tiktok' && Object.prototype.hasOwnProperty.call(textByPlatform, 'tiktokDescription')
      ? 'tiktokDescription'
      : platform
    return Object.prototype.hasOwnProperty.call(textByPlatform, key)
      ? textByPlatform[key]
      : text
  }

  const metadataForFile = file => {
    const key = mediaFileKey(file)
    const meta = { ...(mediaMetaByKey[key] || {}), ...(videoMetaByKey[key] || {}) }
    if (!Object.keys(meta).length && !Number.isFinite(file.size)) return null
    return Number.isFinite(file.size) ? { ...meta, size: file.size } : meta
  }
  const mediaLimitIssuesFor = (platform, platformFiles, options = {}) => platformFiles.flatMap(file => {
    const mediaKind = mediaKindFromMime(file.type)
    const violations = validateMediaMetadata({
      platform,
      mediaKind,
      format: options.format,
      youtubeFormat: options.youtubeFormat,
      ...(metadataForFile(file) || {}),
    })
    return violations.map(violation => ({
      platform,
      message: formatMediaLimitViolation(platform, { mediaKind, format: options.format, youtubeFormat: options.youtubeFormat }, violation),
    }))
  })

  for (const platform of platforms) {
    const value = textForPlatform(platform) || ''
    const maxLength = getPlatformTextLimit(platform)
    if (value.length > maxLength) {
      issues.push({
        platform,
        message: `O texto do ${PLATFORM_TEXT_LIMITS[platform]?.label || platform} pode ter no máximo ${maxLength} caracteres.`,
      })
    }
  }

  if (platforms.includes('tiktok') && (titleByPlatform.tiktok || '').length > 90)
    issues.push({ platform: 'tiktok', message: 'O título do TikTok pode ter no máximo 90 caracteres.' })
  if (platforms.includes('tiktok') && tiktokDescription.length > 4000)
    issues.push({ platform: 'tiktok', message: 'A descrição do TikTok pode ter no máximo 4000 caracteres.' })

  const hasText = text.trim() || Object.values(textByPlatform).some(value => value?.trim())
  if (!hasText && !hasMedia)
    issues.push({ platform: null, message: 'Escreva um texto ou anexe uma imagem/vídeo.' })

  if (!platforms.length)
    issues.push({ platform: null, message: "Escolha ao menos uma rede social em 'Plataformas'." })

  if (!publishNow && scheduledAt && new Date(scheduledAt).getTime() < Date.now())
    issues.push({ platform: null, message: 'A data de publicação não pode estar no passado.' })

  if (platforms.includes('youtube')) {
    const youtubeFiles = mediaForPlatform('youtube')
    const hasVideo = youtubeFiles.some(file => file.type.startsWith('video/'))
    if (!hasVideo)
      issues.push({ platform: 'youtube', message: 'Falta vídeo para publicar no YouTube — anexe um vídeo ou desmarque o YouTube.' })
    else if (youtubeFiles.length !== 1)
      issues.push({ platform: 'youtube', message: 'O YouTube aceita exatamente um vídeo por publicação.' })
    if (!youtubeTitle.trim())
      issues.push({ platform: 'youtube', message: 'Informe o título do vídeo para o YouTube.' })
    if (youtubeMadeForKids !== 'true' && youtubeMadeForKids !== 'false')
      issues.push({ platform: 'youtube', message: 'Informe se o vídeo é feito para crianças (obrigatório pelo YouTube).' })
    if (youtubeFormat === 'short' && youtubeFiles.length === 1 && hasVideo) {
      const video = youtubeFiles[0]
      const meta = metadataForFile(video)
      if (Number.isFinite(meta?.width) && Number.isFinite(meta?.height) && Number.isFinite(meta?.duration) && !isShortEligible(meta))
        issues.push({ platform: 'youtube', message: 'Um Short do YouTube precisa ter vídeo vertical 9:16 e duração menor que 60 segundos.' })
    }
    issues.push(...mediaLimitIssuesFor('youtube', youtubeFiles, { youtubeFormat }))
  }

  if (platforms.includes('tiktok')) {
    const tiktokFiles = mediaForPlatform('tiktok')
    const videoFiles = tiktokFiles.filter(file => file.type.startsWith('video/'))
    const hasVideo = videoFiles.length > 0
    if (!tiktokFiles.length)
      issues.push({ platform: 'tiktok', message: 'Falta imagem ou vídeo para publicar no TikTok — anexe uma mídia ou desmarque o TikTok.' })
    else if (videoFiles.length) {
      if (tiktokFiles.length !== 1 || videoFiles.length !== 1)
        issues.push({ platform: 'tiktok', message: 'O TikTok aceita um vídeo sozinho ou um carrossel somente de fotos. Remova a mistura de mídias e os arquivos extras.' })
      const meta = videoFiles.length === 1 && tiktokFiles.length === 1
        ? videoMetaByKey[mediaFileKey(videoFiles[0])]
        : null
      if (meta && !isAspectRatioValidForTiktok(meta))
        issues.push({ platform: 'tiktok', message: 'O vídeo precisa ter proporção 9:16 (vertical) para publicar no TikTok.' })
    } else if (tiktokFiles.length > TIKTOK_PHOTO_MAX_ITEMS) {
      issues.push({ platform: 'tiktok', message: `O carrossel de fotos do TikTok aceita no máximo ${TIKTOK_PHOTO_MAX_ITEMS} imagens.` })
    }
    issues.push(...mediaLimitIssuesFor('tiktok', tiktokFiles))
    if (!TIKTOK_PRIVACY_LEVELS.includes(tiktokPrivacyLevel))
      issues.push({ platform: 'tiktok', message: 'Escolha quem pode ver a publicação no TikTok.' })
  }

  if (platforms.includes('facebook') && facebookFormat === 'reel') {
    const facebookFiles = mediaForPlatform('facebook')
    const video = facebookFiles.length === 1 && facebookFiles[0].type.startsWith('video/') ? facebookFiles[0] : null
    if (!video)
      issues.push({ platform: 'facebook', message: 'O Reel do Facebook aceita exatamente um vídeo vertical.' })
    else {
      const meta = mediaMetaByKey[mediaFileKey(video)] || videoMetaByKey[mediaFileKey(video)]
      if (meta && !isAspectRatioValidForTiktok(meta))
        issues.push({ platform: 'facebook', message: 'O Reel do Facebook precisa ter proporção 9:16 (vertical).' })
    }
  }

  if (platforms.includes('facebook'))
    issues.push(...mediaLimitIssuesFor('facebook', mediaForPlatform('facebook'), { format: facebookFormat }))

  if (platforms.includes('instagram')) {
    const instagramFiles = mediaForPlatform('instagram')
    if (!instagramFiles.length)
      issues.push({ platform: 'instagram', message: 'Falta imagem ou vídeo para publicar no Instagram — anexe uma mídia ou desmarque o Instagram.' })
    if (igFormat === 'story' && instagramFiles.length > 1)
      issues.push({ platform: 'instagram', message: 'Stories não suporta carrossel — escolha Feed ou remova os itens extras.' })
    if (instagramFiles.length > 1) {
      if (igFormat && igFormat !== 'post')
        issues.push({ platform: 'instagram', message: 'O carrossel do Instagram está disponível no Feed — escolha Feed ou remova as fotos extras.' })
      if (instagramFiles.some(file => !file.type.startsWith('image/')))
        issues.push({ platform: 'instagram', message: 'O carrossel do Instagram aceita somente fotos neste agendador. Remova os vídeos ou publique uma mídia única.' })
      if (instagramFiles.length > INSTAGRAM_CAROUSEL_MAX_ITEMS)
        issues.push({ platform: 'instagram', message: `O carrossel do Instagram aceita no máximo ${INSTAGRAM_CAROUSEL_MAX_ITEMS} fotos.` })
    }
    if (instagramFiles.length === 1) {
      const file = instagramFiles[0]
      const meta = metadataForFile(file)
      if (Number.isFinite(meta?.width) && Number.isFinite(meta?.height) && !isAspectRatioValidForInstagram(meta, igFormat)) {
        const faixaLabel = igFormat === 'reel' || igFormat === 'story'
          ? '9:16 (vertical)'
          : 'entre 4:5 (vertical) e 1,91:1 (horizontal)'
        issues.push({ platform: 'instagram', message: `A imagem/vídeo precisa ter proporção ${faixaLabel} para publicar no Instagram${igFormat ? ` como ${igFormat}` : ''}.` })
      }
    }
    issues.push(...mediaLimitIssuesFor('instagram', instagramFiles, { format: igFormat }))
    if (!publishNow && scheduledAt) {
      const minutosAteAgendamento = (new Date(scheduledAt).getTime() - Date.now()) / 60000
      if (minutosAteAgendamento < INSTAGRAM_MIN_ANTECEDENCIA_MIN)
        issues.push({ platform: 'instagram', message: `Para publicar no Instagram, escolha um horário com pelo menos ${INSTAGRAM_MIN_ANTECEDENCIA_MIN} minutos de antecedência.` })
    }
  }

  return issues
}
