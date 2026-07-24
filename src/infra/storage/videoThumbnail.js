// Extrai um frame de um vídeo local como thumbnail JPEG — usado hoje só pelo
// Pinterest, que exige uma imagem de capa separada (cover_image_url) para
// publicar vídeo e não gera thumbnail automática a partir do vídeo (ver
// pinterestPublisher.js). ffmpeg-static empacota o binário real (fluent-ffmpeg
// é só o wrapper Node — sem o binário, todas as chamadas falhariam).
const ffmpeg = require('fluent-ffmpeg')
const ffmpegStatic = require('ffmpeg-static')
const os = require('os')
const path = require('path')
const fs = require('fs')
const crypto = require('crypto')

ffmpeg.setFfmpegPath(ffmpegStatic)

// Captura o frame em 1s (evita frames pretos/fade-in comuns no frame 0)
// de um arquivo de vídeo local e devolve o buffer JPEG resultante.
function extrairFrame(absVideoPath) {
  const outPath = path.join(os.tmpdir(), `${crypto.randomUUID()}.jpg`)
  return new Promise((resolve, reject) => {
    ffmpeg(absVideoPath)
      .on('end', () => {
        fs.readFile(outPath, (err, buffer) => {
          fs.unlink(outPath, () => {})
          if (err) return reject(err)
          resolve(buffer)
        })
      })
      .on('error', err => {
        fs.unlink(outPath, () => {})
        reject(err)
      })
      .screenshots({ timestamps: ['1'], filename: path.basename(outPath), folder: path.dirname(outPath), size: '640x?' })
  })
}

module.exports = { extrairFrame }
