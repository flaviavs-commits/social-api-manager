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

module.exports = { probeVideo }
