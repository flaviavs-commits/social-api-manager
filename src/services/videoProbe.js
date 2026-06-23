const ffmpeg = require('fluent-ffmpeg')
const ffprobeStatic = require('ffprobe-static')

ffmpeg.setFfprobePath(ffprobeStatic.path)

// Lê largura, altura e duração (segundos) de um arquivo de vídeo.
function probeVideo(absPath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(absPath, (err, data) => {
      if (err) return reject(err)
      const stream = data.streams.find(s => s.codec_type === 'video')
      if (!stream) return reject(new Error('Nenhum stream de vídeo encontrado'))

      let { width, height } = stream
      // Aplica rotação (vídeos gravados na vertical no celular costumam vir
      // com width/height de paisagem + metadado de rotação 90/270).
      const rotation = parseInt(stream.tags?.rotate || stream.side_data_list?.find(s => s.rotation)?.rotation || 0, 10)
      if (Math.abs(rotation) === 90 || Math.abs(rotation) === 270) {
        ;[width, height] = [height, width]
      }

      const duration = parseFloat(data.format.duration || stream.duration || 0)
      resolve({ width, height, duration })
    })
  })
}

// Um vídeo é elegível como Short se for vertical (9:16) ou quadrado (1:1)
// e tiver no máximo 3 minutos (180s). Vídeos horizontais (16:9) nunca são Shorts.
function isShortEligible({ width, height, duration }) {
  if (!width || !height) return false
  if (duration > 180) return false
  return height >= width // vertical (9:16) ou quadrado (1:1)
}

// O TikTok rejeita o vídeo após o upload (fail_reason: picture_size_check_failed)
// quando a proporção está fora da faixa aceita para gerar a capa automática —
// entre 9:16 (vertical) e 16:9 (horizontal), aproximadamente. Checar antes do
// upload evita gastar uma chamada de API só para descobrir isso depois.
function isAspectRatioValidForTiktok({ width, height }) {
  if (!width || !height) return false
  const ratio = width / height
  return ratio >= 9 / 16 && ratio <= 16 / 9
}

module.exports = { probeVideo, isShortEligible, isAspectRatioValidForTiktok }
