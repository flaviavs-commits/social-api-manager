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

module.exports = { isShortEligible, isAspectRatioValidForTiktok }
