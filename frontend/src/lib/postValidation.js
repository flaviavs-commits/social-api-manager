// Validações client-side do agendador — espelham o subconjunto verificável no
// navegador de social-api-manager/src/domain/posts/post.js (validarCriacaoPost)
// e src/domain/posts/videoRules.js (isAspectRatioValidForTiktok). O backend
// continua sendo a fonte da verdade (ver comentário lá); ao mudar uma regra
// nesses arquivos, atualize aqui também.
import { PLATFORM_TEXT_LIMITS, getPlatformTextLimit } from './platformTextLimits.js'

const TIKTOK_PRIVACY_LEVELS = ['PUBLIC_TO_EVERYONE', 'MUTUAL_FOLLOW_FRIENDS', 'FOLLOWER_OF_CREATOR', 'SELF_ONLY']
const INSTAGRAM_MIN_ANTECEDENCIA_MIN = 20
export const INSTAGRAM_CAROUSEL_MAX_ITEMS = 10
export const TIKTOK_PHOTO_MAX_ITEMS = 35
const INSTAGRAM_ASPECT_RATIO_RANGES = {
  post: [4 / 5, 1.91],
  reel: [0.5625 * 0.98, 0.5625 * 1.02],
  story: [0.5625 * 0.98, 0.5625 * 1.02],
}

export function mediaFileKey(file) {
  return `${file.name}-${file.lastModified}-${file.size}`
}

export function isAspectRatioValidForTiktok({ width, height }) {
  if (!width || !height) return false
  const ratio = width / height
  return ratio >= 9 / 16 && ratio <= 16 / 9
}

export function isAspectRatioValidForInstagram({ width, height }, format = 'post') {
  if (!width || !height) return false
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
export function buildValidationIssues({ text = '', textByPlatform = {}, titleByPlatform = {}, tiktokDescription = '', platforms, files, publishNow, scheduledAt, youtubeTitle, youtubeMadeForKids, igFormat, tiktokPrivacyLevel, videoMetaByKey = {}, mediaMetaByKey = {} }) {
  const issues = []
  const hasMedia = files.length > 0
  const videoFiles = files.filter(file => file.type.startsWith('video/'))
  const hasVideo = videoFiles.length > 0
  const textForPlatform = platform => {
    const key = platform === 'tiktok' && Object.prototype.hasOwnProperty.call(textByPlatform, 'tiktokDescription')
      ? 'tiktokDescription'
      : platform
    return Object.prototype.hasOwnProperty.call(textByPlatform, key)
      ? textByPlatform[key]
      : text
  }

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
    if (!hasVideo)
      issues.push({ platform: 'youtube', message: 'Falta vídeo para publicar no YouTube — anexe um vídeo ou desmarque o YouTube.' })
    if (!youtubeTitle.trim())
      issues.push({ platform: 'youtube', message: 'Informe o título do vídeo para o YouTube.' })
    if (youtubeMadeForKids !== 'true' && youtubeMadeForKids !== 'false')
      issues.push({ platform: 'youtube', message: 'Informe se o vídeo é feito para crianças (obrigatório pelo YouTube).' })
  }

  if (platforms.includes('tiktok')) {
    if (!hasMedia)
      issues.push({ platform: 'tiktok', message: 'Falta imagem ou vídeo para publicar no TikTok — anexe uma mídia ou desmarque o TikTok.' })
    else if (videoFiles.length) {
      if (files.length !== 1 || videoFiles.length !== 1)
        issues.push({ platform: 'tiktok', message: 'O TikTok aceita um vídeo sozinho ou um carrossel somente de fotos. Remova a mistura de mídias e os arquivos extras.' })
      const meta = videoFiles.length === 1 && files.length === 1
        ? videoMetaByKey[mediaFileKey(videoFiles[0])]
        : null
      if (meta && !isAspectRatioValidForTiktok(meta))
        issues.push({ platform: 'tiktok', message: 'O vídeo precisa ter proporção entre 9:16 (vertical) e 16:9 (horizontal) para publicar no TikTok.' })
    } else if (files.length > TIKTOK_PHOTO_MAX_ITEMS) {
      issues.push({ platform: 'tiktok', message: `O carrossel de fotos do TikTok aceita no máximo ${TIKTOK_PHOTO_MAX_ITEMS} imagens.` })
    }
    if (!TIKTOK_PRIVACY_LEVELS.includes(tiktokPrivacyLevel))
      issues.push({ platform: 'tiktok', message: 'Escolha quem pode ver a publicação no TikTok.' })
  }

  if (platforms.includes('instagram')) {
    if (!hasMedia)
      issues.push({ platform: 'instagram', message: 'Falta imagem ou vídeo para publicar no Instagram — anexe uma mídia ou desmarque o Instagram.' })
    if (igFormat === 'story' && files.length > 1)
      issues.push({ platform: 'instagram', message: 'Stories não suporta carrossel — escolha Feed ou remova os itens extras.' })
    if (files.length > 1) {
      if (igFormat && igFormat !== 'post')
        issues.push({ platform: 'instagram', message: 'O carrossel do Instagram está disponível no Feed — escolha Feed ou remova as fotos extras.' })
      if (files.some(file => !file.type.startsWith('image/')))
        issues.push({ platform: 'instagram', message: 'O carrossel do Instagram aceita somente fotos neste agendador. Remova os vídeos ou publique uma mídia única.' })
      if (files.length > INSTAGRAM_CAROUSEL_MAX_ITEMS)
        issues.push({ platform: 'instagram', message: `O carrossel do Instagram aceita no máximo ${INSTAGRAM_CAROUSEL_MAX_ITEMS} fotos.` })
    }
    if (files.length === 1) {
      const file = files[0]
      const meta = mediaMetaByKey[mediaFileKey(file)]
      if (meta && !isAspectRatioValidForInstagram(meta, igFormat)) {
        const faixaLabel = igFormat === 'reel' || igFormat === 'story'
          ? '9:16 (vertical)'
          : 'entre 4:5 (vertical) e 1,91:1 (horizontal)'
        issues.push({ platform: 'instagram', message: `A imagem/vídeo precisa ter proporção ${faixaLabel} para publicar no Instagram${igFormat ? ` como ${igFormat}` : ''}.` })
      }
    }
    if (!publishNow && scheduledAt) {
      const minutosAteAgendamento = (new Date(scheduledAt).getTime() - Date.now()) / 60000
      if (minutosAteAgendamento < INSTAGRAM_MIN_ANTECEDENCIA_MIN)
        issues.push({ platform: 'instagram', message: `Para publicar no Instagram, escolha um horário com pelo menos ${INSTAGRAM_MIN_ANTECEDENCIA_MIN} minutos de antecedência.` })
    }
  }

  return issues
}
