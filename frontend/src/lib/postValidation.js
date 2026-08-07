// Validações client-side do agendador — espelham o subconjunto verificável no
// navegador de social-api-manager/src/domain/posts/post.js (validarCriacaoPost)
// e src/domain/posts/videoRules.js (isAspectRatioValidForTiktok). O backend
// continua sendo a fonte da verdade (ver comentário lá); ao mudar uma regra
// nesses arquivos, atualize aqui também.
import { PLATFORM_TEXT_LIMITS, getPlatformTextLimit } from './platformTextLimits.js'

const TIKTOK_PRIVACY_LEVELS = ['PUBLIC_TO_EVERYONE', 'MUTUAL_FOLLOW_FRIENDS', 'SELF_ONLY']
const INSTAGRAM_MIN_ANTECEDENCIA_MIN = 20

export function mediaFileKey(file) {
  return `${file.name}-${file.lastModified}-${file.size}`
}

export function isAspectRatioValidForTiktok({ width, height }) {
  if (!width || !height) return false
  const ratio = width / height
  return ratio >= 9 / 16 && ratio <= 16 / 9
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
export function buildValidationIssues({ text, textByPlatform = {}, platforms, files, publishNow, scheduledAt, youtubeTitle, youtubeMadeForKids, igFormat, tiktokPrivacyLevel, videoMetaByKey }) {
  const issues = []
  const hasMedia = files.length > 0
  const videoFiles = files.filter(file => file.type.startsWith('video/'))
  const hasVideo = videoFiles.length > 0
  const textForPlatform = platform => Object.prototype.hasOwnProperty.call(textByPlatform, platform)
    ? textByPlatform[platform]
    : text

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
      issues.push({ platform: 'tiktok', message: 'Falta mídia para publicar no TikTok — anexe um vídeo ou imagem.' })
    const meta = videoFiles[0] && videoMetaByKey[mediaFileKey(videoFiles[0])]
    if (meta && !isAspectRatioValidForTiktok(meta))
      issues.push({ platform: 'tiktok', message: 'O vídeo precisa ter proporção entre 9:16 (vertical) e 16:9 (horizontal) para publicar no TikTok.' })
    if (!TIKTOK_PRIVACY_LEVELS.includes(tiktokPrivacyLevel))
      issues.push({ platform: 'tiktok', message: 'Escolha quem pode ver o vídeo no TikTok.' })
  }

  if (platforms.includes('instagram')) {
    if (!hasMedia)
      issues.push({ platform: 'instagram', message: 'Falta imagem ou vídeo para publicar no Instagram — anexe uma mídia ou desmarque o Instagram.' })
    if (igFormat === 'story' && files.length > 1)
      issues.push({ platform: 'instagram', message: 'Stories não suporta carrossel — escolha Post ou Reel, ou remova os itens extras.' })
    if (!publishNow && scheduledAt) {
      const minutosAteAgendamento = (new Date(scheduledAt).getTime() - Date.now()) / 60000
      if (minutosAteAgendamento < INSTAGRAM_MIN_ANTECEDENCIA_MIN)
        issues.push({ platform: 'instagram', message: `Para publicar no Instagram, escolha um horário com pelo menos ${INSTAGRAM_MIN_ANTECEDENCIA_MIN} minutos de antecedência.` })
    }
  }

  return issues
}
