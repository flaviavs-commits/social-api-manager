// Regras puras sobre vídeo (dado width/height/duration já lidos por ffprobe).
// Não faz I/O — a leitura do arquivo fica em infra/storage/videoProbe.

// Um vídeo é elegível como Short se for vertical (9:16) ou quadrado (1:1)
// e tiver no máximo 3 minutos (180s). Vídeos horizontais (16:9) nunca são Shorts.
function isShortEligible({ width, height, duration }) {
  if (!width || !height) return false
  if (duration > 180) return false
  return height >= width // vertical (9:16) ou quadrado (1:1)
}

// O TikTok rejeita o vídeo após o upload (fail_reason: picture_size_check_failed)
// quando a proporção está fora da faixa aceita para gerar a capa automática —
// entre 9:16 (vertical) e 16:9 (horizontal), aproximadamente.
function isAspectRatioValidForTiktok({ width, height }) {
  if (!width || !height) return false
  const ratio = width / height
  return ratio >= 9 / 16 && ratio <= 16 / 9
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
  if (!width || !height) return false
  const ratio = width / height
  const [min, max] = IG_ASPECT_RATIO_RANGES[format] || IG_ASPECT_RATIO_RANGES.post
  return ratio >= min && ratio <= max
}

module.exports = { isShortEligible, isAspectRatioValidForTiktok, isAspectRatioValidForInstagram }
