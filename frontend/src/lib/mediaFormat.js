export const PREVIEW_ASPECTS = {
  square: { key: 'square', label: '1:1', ratio: 1 },
  portrait: { key: 'portrait', label: '3:4', ratio: 3 / 4 },
  vertical: { key: 'vertical', label: '9:16', ratio: 9 / 16 },
  landscape: { key: 'landscape', label: '16:9', ratio: 16 / 9 },
}

export const PREVIEW_ASPECT_OPTIONS = [
  PREVIEW_ASPECTS.square,
  PREVIEW_ASPECTS.portrait,
  PREVIEW_ASPECTS.vertical,
]

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
  if (platform === 'instagram') return nearestPreviewAspect(sourceRatio, [PREVIEW_ASPECTS.square, PREVIEW_ASPECTS.portrait])
  if (platform === 'tiktok') return nearestPreviewAspect(sourceRatio, PREVIEW_ASPECT_OPTIONS)
  return nearestPreviewAspect(sourceRatio, Object.values(PREVIEW_ASPECTS))
}

export function mediaKindLabel(kind) {
  if (kind === 'video') return 'Vídeo detectado'
  if (kind === 'image') return 'Foto detectada'
  return 'Mídia não detectada'
}
