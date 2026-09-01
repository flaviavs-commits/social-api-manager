// Limites de mídia definidos pelo produto para cada rede/formato.
// Este módulo é puro: não faz I/O e pode ser usado tanto por casos de uso
// quanto por testes. O navegador mantém um espelho desta tabela em
// frontend/src/lib/mediaLimits.js.

const BYTES_PER_MB = 1024 ** 2
const BYTES_PER_GB = 1024 ** 3

const MEDIA_LIMITS = Object.freeze({
  instagram: Object.freeze({
    image: Object.freeze({ maxBytes: 8 * BYTES_PER_MB }),
    video: Object.freeze({
      post: Object.freeze({ maxBytes: null, maxDurationSeconds: 60 * 60 }),
      reel: Object.freeze({ maxBytes: 300 * BYTES_PER_MB, maxDurationSeconds: 15 * 60 }),
      story: Object.freeze({ maxBytes: 100 * BYTES_PER_MB, maxDurationSeconds: 60 }),
    }),
  }),
  tiktok: Object.freeze({
    image: Object.freeze({ maxBytes: 20 * BYTES_PER_MB }),
    video: Object.freeze({
      maxBytes: 4 * BYTES_PER_GB,
      minWidth: 720,
      minHeight: 1280,
      minDurationSeconds: 3,
      maxDurationSeconds: 10 * 60,
    }),
  }),
  youtube: Object.freeze({
    thumbnail: Object.freeze({ maxBytes: 2 * BYTES_PER_MB }),
    video: Object.freeze({ maxBytes: 256 * BYTES_PER_GB, maxDurationSeconds: 12 * 60 * 60 }),
    short: Object.freeze({ maxBytes: 256 * BYTES_PER_GB, maxDurationSeconds: 60, maxDurationExclusive: true }),
  }),
  facebook: Object.freeze({
    image: Object.freeze({ maxBytes: 10 * BYTES_PER_MB }),
    video: Object.freeze({
      post: Object.freeze({ maxBytes: 4 * BYTES_PER_GB, maxDurationSeconds: 240 * 60 }),
      reel: Object.freeze({ maxBytes: 4 * BYTES_PER_GB, maxDurationSeconds: 90 }),
    }),
  }),
})

function mediaKindFromMime(mimetype) {
  const value = String(mimetype || '').toLowerCase()
  if (value === 'thumbnail') return 'thumbnail'
  return value === 'video' || value.startsWith('video/') ? 'video' : 'image'
}

function getMediaLimits(platform, { mediaKind = 'image', format, youtubeFormat } = {}) {
  const platformLimits = MEDIA_LIMITS[platform]
  if (!platformLimits) return null

  if (platform === 'instagram' || platform === 'facebook') {
    if (mediaKind !== 'video') return platformLimits[mediaKind] || null
    return platformLimits.video[format || 'post'] || platformLimits.video.post
  }

  if (platform === 'youtube') {
    if (mediaKind === 'thumbnail') return platformLimits.thumbnail
    return youtubeFormat === 'short' || format === 'short' ? platformLimits.short : platformLimits.video
  }

  return platformLimits[mediaKind] || null
}

function isKnownNumber(value) {
  return Number.isFinite(value) && value >= 0
}

// Retorna códigos estruturados para que a camada de apresentação possa
// montar uma mensagem adequada sem duplicar a lógica dos limites.
function validateMediaMetadata({ platform, mediaKind, format, youtubeFormat, size, duration, width, height }) {
  const limits = getMediaLimits(platform, { mediaKind, format, youtubeFormat })
  if (!limits) return []

  const violations = []
  if (limits.maxBytes !== null && limits.maxBytes !== undefined && isKnownNumber(size) && size > limits.maxBytes) {
    violations.push({ code: 'max-size', value: size, limit: limits.maxBytes })
  }

  if (mediaKind === 'video' && isKnownNumber(width) && isKnownNumber(height)) {
    if (limits.minWidth && (width < limits.minWidth || height < limits.minHeight)) {
      violations.push({ code: 'min-resolution', width, height, minWidth: limits.minWidth, minHeight: limits.minHeight })
    }
  }

  if (mediaKind === 'video' && isKnownNumber(duration)) {
    if (limits.minDurationSeconds !== undefined && duration < limits.minDurationSeconds) {
      violations.push({ code: 'min-duration', value: duration, limit: limits.minDurationSeconds })
    }
    if (limits.maxDurationSeconds !== undefined) {
      const acimaDoLimite = limits.maxDurationExclusive
        ? duration >= limits.maxDurationSeconds
        : duration > limits.maxDurationSeconds
      if (acimaDoLimite) {
        violations.push({
          code: limits.maxDurationExclusive ? 'max-duration-exclusive' : 'max-duration',
          value: duration,
          limit: limits.maxDurationSeconds,
        })
      }
    }
  }

  return violations
}

function networkLabel(platform) {
  return { instagram: 'Instagram', tiktok: 'TikTok', youtube: 'YouTube', facebook: 'Facebook' }[platform] || platform
}

function formatLabel(platform, format, youtubeFormat) {
  if (platform === 'instagram') return { post: 'Feed', reel: 'Reel', story: 'Story' }[format || 'post'] + ' do Instagram'
  if (platform === 'facebook') return { post: 'Feed', reel: 'Reel' }[format || 'post'] + ' do Facebook'
  if (platform === 'youtube' && (youtubeFormat === 'short' || format === 'short')) return 'Short do YouTube'
  return networkLabel(platform)
}

function formatMegabytes(bytes) {
  return `${Math.round(bytes / BYTES_PER_MB)} MB`
}

function formatGigabytes(bytes) {
  return `${Math.round(bytes / BYTES_PER_GB)} GB`
}

function formatSeconds(seconds) {
  if (seconds % 60 === 0 && seconds >= 60) {
    const minutes = seconds / 60
    return `${minutes} ${minutes === 1 ? 'minuto' : 'minutos'}`
  }
  return `${seconds} ${seconds === 1 ? 'segundo' : 'segundos'}`
}

function formatMediaLimitViolation(platform, { mediaKind, format, youtubeFormat }, violation) {
  const subject = mediaKind === 'thumbnail' ? 'A thumbnail do YouTube' : mediaKind === 'video' ? `O vídeo do ${formatLabel(platform, format, youtubeFormat)}` : `A imagem do ${networkLabel(platform)}`
  if (violation.code === 'max-size') {
    const limit = violation.limit >= BYTES_PER_GB ? formatGigabytes(violation.limit) : formatMegabytes(violation.limit)
    return `${subject} pode ter no máximo ${limit}.`
  }
  if (violation.code === 'min-resolution') {
    return 'O vídeo do TikTok precisa ter no mínimo 720p (720 × 1280 px).'
  }
  if (violation.code === 'min-duration') {
    return `O vídeo do TikTok precisa ter pelo menos ${formatSeconds(violation.limit)}.`
  }
  if (violation.code === 'max-duration-exclusive') {
    return `${subject} precisa ter menos de ${formatSeconds(violation.limit)}.`
  }
  if (violation.code === 'max-duration') {
    return `${subject} pode ter no máximo ${formatSeconds(violation.limit)}.`
  }
  return `${subject} não atende aos limites da rede.`
}

module.exports = {
  BYTES_PER_MB,
  BYTES_PER_GB,
  MEDIA_LIMITS,
  mediaKindFromMime,
  getMediaLimits,
  validateMediaMetadata,
  formatMediaLimitViolation,
}
