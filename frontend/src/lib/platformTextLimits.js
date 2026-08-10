// Limites de descrição usados pelo editor. Eles espelham
// src/domain/posts/platformLimits.js, que continua sendo a fonte de verdade
// no backend.
export const PLATFORM_TEXT_LIMITS = Object.freeze({
  instagram: { label: 'Instagram', max: 2200 },
  facebook: { label: 'Facebook', max: 63206 },
  youtube: { label: 'YouTube', max: 5000 },
  tiktok: { label: 'TikTok', max: 4000 },
})

export function getPlatformTextLimit(platform) {
  return PLATFORM_TEXT_LIMITS[platform]?.max || 5000
}
