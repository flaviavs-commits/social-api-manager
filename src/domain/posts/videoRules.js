// Regras puras sobre vídeo (dado width/height/duration já lidos por ffprobe).
// Não faz I/O — a leitura do arquivo fica em infra/storage/videoProbe.

const NINE_BY_SIXTEEN_RATIO = 9 / 16
const VERTICAL_RATIO_TOLERANCE = 0.02
const YOUTUBE_SHORT_MAX_DURATION_SECONDS = 60

// TikTok, Reels e Stories usam o enquadramento vertical 9:16. A pequena
// tolerância absorve diferenças de alguns pixels causadas por exportadores de
// celular sem transformar vídeos 1:1 ou horizontais em conteúdo vertical.
function isVerticalNineBySixteen({ width, height }) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return false
  const ratio = width / height
  const min = NINE_BY_SIXTEEN_RATIO * (1 - VERTICAL_RATIO_TOLERANCE)
  const max = NINE_BY_SIXTEEN_RATIO * (1 + VERTICAL_RATIO_TOLERANCE)
  return ratio >= min && ratio <= max
}

// Um Short do YouTube, conforme a regra do produto, é um vídeo vertical 9:16
// com duração inferior a 60 segundos.
function isShortEligible({ width, height, duration }) {
  if (!isVerticalNineBySixteen({ width, height })) return false
  if (!Number.isFinite(duration) || duration <= 0 || duration >= YOUTUBE_SHORT_MAX_DURATION_SECONDS) return false
  return true
}

// O TikTok publica vídeo em 9:16. A cópia enviada pelo caso de uso é
// normalizada para 1080x1920 somente depois que esta regra aprova o original.
function isAspectRatioValidForTiktok({ width, height }) {
  return isVerticalNineBySixteen({ width, height })
}

// Faixas de proporção aceitas pela Graph API do Instagram — rejeitam fora
// disso (ex.: "Aspect ratio 0.56:1 is outside Instagram's allowed range").
// Feed (post/carrossel) aceita 4:5 (vertical) a 1.91:1 (horizontal). Reels e
// Stories são formato fixo vertical, 9:16, com pouca tolerância.
const IG_ASPECT_RATIO_RANGES = {
  post:  [4 / 5, 1.91],
  reel:  [0.5625 * 0.98, 0.5625 * 1.02],
  story: [0.5625 * 0.98, 0.5625 * 1.02],
}

// format: 'post' | 'reel' | 'story' — mesmos valores de domain/posts/post.js
// (INSTAGRAM_FORMATS). Sem format definido (automático), usa a faixa mais
// permissiva (post) para não bloquear escolhas que o backend ainda vai
// resolver sozinho (vídeo sem format vira reel, mas nesse caso a checagem
// roda de novo já com o format resolvido — ver criarPost.js).
function isAspectRatioValidForInstagram({ width, height }, format) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return false
  const ratio = width / height
  const [min, max] = IG_ASPECT_RATIO_RANGES[format] || IG_ASPECT_RATIO_RANGES.post
  return ratio >= min && ratio <= max
}

module.exports = {
  NINE_BY_SIXTEEN_RATIO,
  YOUTUBE_SHORT_MAX_DURATION_SECONDS,
  isVerticalNineBySixteen,
  isShortEligible,
  isAspectRatioValidForTiktok,
  isAspectRatioValidForInstagram,
  ...require('./mediaLimits')
}
