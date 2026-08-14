export const PREVIEW_ASPECTS = {
  square: { key: 'square', label: '1:1', ratio: 1, dimensions: '1080 × 1080 px' },
  portrait: { key: 'portrait', label: '4:5', ratio: 4 / 5, dimensions: '1080 × 1350 px' },
  vertical: { key: 'vertical', label: '9:16', ratio: 9 / 16, dimensions: '1080 × 1920 px' },
  landscape: { key: 'landscape', label: '16:9', ratio: 16 / 9, dimensions: '1920 × 1080 px' },
  instagramWide: { key: 'instagramWide', label: '1,91:1', ratio: 1.91, dimensions: '1080 × 566 px' },
}

export const PREVIEW_ASPECT_OPTIONS = [
  PREVIEW_ASPECTS.square,
  PREVIEW_ASPECTS.portrait,
  PREVIEW_ASPECTS.vertical,
]

export const SOCIAL_MEDIA_RESOLUTIONS = {
  instagram: {
    feed: [
      { key: 'square', label: 'Quadrado', dimensions: '1080 × 1080 px', ratio: 1 },
      { key: 'portrait', label: 'Retrato', dimensions: '1080 × 1350 px', ratio: 4 / 5 },
      { key: 'wide', label: 'Paisagem', dimensions: '1080 × 566 px', ratio: 1.91 },
    ],
    reel: { key: 'vertical', label: 'Reel', dimensions: '1080 × 1920 px', ratio: 9 / 16 },
    story: { key: 'vertical', label: 'Story', dimensions: '1080 × 1920 px', ratio: 9 / 16 },
  },
  facebook: {
    feed: [
      { key: 'wide', label: 'Paisagem', dimensions: '1200 × 630 px', ratio: 1.91 },
      { key: 'square', label: 'Quadrado', dimensions: '1080 × 1080 px', ratio: 1 },
      { key: 'portrait', label: 'Retrato', dimensions: '1080 × 1350 px', ratio: 4 / 5 },
    ],
  },
  youtube: {
    video: { key: 'landscape', label: 'Vídeo', dimensions: '1920 × 1080 px', ratio: 16 / 9 },
    short: { key: 'vertical', label: 'Short', dimensions: '1080 × 1920 px', ratio: 9 / 16 },
    thumbnail: { key: 'thumbnail', label: 'Miniatura', dimensions: '1280 × 720 px', ratio: 16 / 9 },
  },
  tiktok: {
    video: { key: 'vertical', label: 'Vídeo', dimensions: '1080 × 1920 px', ratio: 9 / 16 },
    photo: [
      { key: 'square', label: 'Quadrado', dimensions: '1080 × 1080 px', ratio: 1 },
      { key: 'portrait', label: 'Retrato', dimensions: '1080 × 1350 px', ratio: 4 / 5 },
      { key: 'vertical', label: 'Vertical', dimensions: '1080 × 1920 px', ratio: 9 / 16 },
    ],
  },
}

export const TIKTOK_VIDEO_DIMENSIONS = { width: 1080, height: 1920, label: '1080 × 1920 px' }

export function socialMediaResolutionHint(platform, { instagramFormat = 'post', youtubeFormat = '', mediaKind = 'image' } = {}) {
  if (platform === 'instagram') {
    if (instagramFormat === 'reel' || instagramFormat === 'story') return SOCIAL_MEDIA_RESOLUTIONS.instagram[instagramFormat].dimensions
    return SOCIAL_MEDIA_RESOLUTIONS.instagram.feed.map(item => item.dimensions).join(' · ')
  }
  if (platform === 'facebook') return SOCIAL_MEDIA_RESOLUTIONS.facebook.feed.map(item => item.dimensions).join(' · ')
  if (platform === 'youtube') {
    const format = youtubeFormat === 'short' ? SOCIAL_MEDIA_RESOLUTIONS.youtube.short : SOCIAL_MEDIA_RESOLUTIONS.youtube.video
    return `${format.dimensions} · miniatura ${SOCIAL_MEDIA_RESOLUTIONS.youtube.thumbnail.dimensions}`
  }
  if (platform === 'tiktok') {
    if (mediaKind === 'video') return SOCIAL_MEDIA_RESOLUTIONS.tiktok.video.dimensions
    return SOCIAL_MEDIA_RESOLUTIONS.tiktok.photo.map(item => item.dimensions).join(' · ')
  }
  return ''
}

function distanceBetweenRatios(left, right) {
  if (!left || !right) return Number.POSITIVE_INFINITY
  return Math.abs(Math.log(left / right))
}

export function nearestPreviewAspect(ratio, options = PREVIEW_ASPECT_OPTIONS) {
  if (!Number.isFinite(ratio) || ratio <= 0) return options[0] || PREVIEW_ASPECTS.square
  return options.reduce((nearest, option) => (
    distanceBetweenRatios(ratio, option.ratio) < distanceBetweenRatios(ratio, nearest.ratio) ? option : nearest
  ), options[0] || PREVIEW_ASPECTS.square)
}

export function ratioLabel(width, height) {
  if (!width || !height) return 'proporção não detectada'
  const ratio = width / height
  const known = Object.values(PREVIEW_ASPECTS).find(option => distanceBetweenRatios(ratio, option.ratio) < 0.035)
  return known?.label || `${ratio.toFixed(2)}:1`
}

export function resolvePreviewAspect({ platform, mediaKind, sourceRatio, requested = 'auto', instagramFormat = 'post' }) {
  if (platform === 'instagram' && ['reel', 'story'].includes(instagramFormat)) return PREVIEW_ASPECTS.vertical
  if (requested !== 'auto' && PREVIEW_ASPECTS[requested]) return PREVIEW_ASPECTS[requested]

  if (platform === 'tiktok' && mediaKind === 'video') return PREVIEW_ASPECTS.vertical
  if (platform === 'instagram') return nearestPreviewAspect(sourceRatio, [PREVIEW_ASPECTS.square, PREVIEW_ASPECTS.portrait, PREVIEW_ASPECTS.instagramWide])
  if (platform === 'tiktok') return nearestPreviewAspect(sourceRatio, PREVIEW_ASPECT_OPTIONS)
  return nearestPreviewAspect(sourceRatio, Object.values(PREVIEW_ASPECTS))
}

export function mediaKindLabel(kind) {
  if (kind === 'video') return 'Vídeo detectado'
  if (kind === 'image') return 'Foto detectada'
  return 'Mídia não detectada'
}
