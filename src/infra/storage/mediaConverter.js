// Converte formatos que as APIs não aceitam sem reduzir a imagem. A largura,
// altura e o enquadramento originais são preservados.
const sharp = require('sharp')
const convertHeic = require('heic-convert')
const ffmpeg = require('fluent-ffmpeg')
const ffmpegPath = require('ffmpeg-static')
const os = require('os')
const path = require('path')
const fs = require('fs')
const crypto = require('crypto')

if (ffmpegPath && fs.existsSync(ffmpegPath)) ffmpeg.setFfmpegPath(ffmpegPath)

async function converterParaJpeg(inputBuffer, { mimetype } = {}) {
  const normalizedType = String(mimetype || '').toLowerCase()
  if (normalizedType === 'image/heic' || normalizedType === 'image/heif') {
    const output = await convertHeic({ buffer: inputBuffer, format: 'JPEG', quality: 1 })
    return Buffer.from(output)
  }

  // Achata a transparência (ex: PNG/sticker com fundo transparente) sobre
  // branco antes de converter — sem isso, o sharp preenche com preto por
  // padrão ao gerar o JPEG (que não suporta canal alfa).
  return sharp(inputBuffer)
    .flatten({ background: '#ffffff' })
    .jpeg({ quality: 100, chromaSubsampling: '4:4:4' })
    .toBuffer()
}

// Lê largura/altura de uma imagem sem decodificar o arquivo inteiro (sharp
// só lê o cabeçalho para metadata()) — usado para validar a proporção
// aceita pelo Instagram antes de publicar (ver domain/posts/videoRules.js,
// isAspectRatioValidForInstagram).
async function lerDimensoesImagem(buffer) {
  const { width, height } = await sharp(buffer).metadata()
  return { width: width || null, height: height || null }
}

// Prepara a cópia exclusiva de uma foto para o TikTok. Fotos aceitam qualquer
// proporção, mas o canvas final é sempre 1080x1920. `contain` cria margens
// quando necessário e preserva todo o enquadramento original — a foto nunca é
// cortada para preencher o canvas vertical.
async function converterImagemParaTiktok(inputBuffer) {
  return sharp(inputBuffer)
    .flatten({ background: '#ffffff' })
    .resize({
      width: 1080,
      height: 1920,
      fit: 'contain',
      background: '#ffffff'
    })
    .jpeg({ quality: 100, chromaSubsampling: '4:4:4' })
    .toBuffer()
}

// Prepara uma cópia exclusiva para o TikTok. O arquivo final tem exatamente
// 1080x1920, H.264/AAC e pixels yuv420p, que evita que o Zernio/TikTok tenha
// que decidir como enquadrar vídeos de celular com dimensões diferentes.
// O vídeo é ampliado proporcionalmente e recortado no centro, sem distorção.
async function converterVideoParaTiktok(inputBuffer) {
  const inputPath = path.join(os.tmpdir(), `${crypto.randomUUID()}-tiktok-input`)
  const outputPath = path.join(os.tmpdir(), `${crypto.randomUUID()}-tiktok-output.mp4`)
  await fs.promises.writeFile(inputPath, inputBuffer)

  try {
    await new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .videoCodec('libx264')
        .audioCodec('aac')
        .outputOptions([
          '-map', '0:v:0',
          '-map', '0:a:0?',
          '-vf', 'scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920',
          '-pix_fmt', 'yuv420p',
          '-movflags', '+faststart',
          '-preset', 'veryfast',
          '-b:a', '128k'
        ])
        .format('mp4')
        .on('end', resolve)
        .on('error', reject)
        .save(outputPath)
    })
    return await fs.promises.readFile(outputPath)
  } finally {
    await fs.promises.unlink(inputPath).catch(() => {})
    await fs.promises.unlink(outputPath).catch(() => {})
  }
}

// Normaliza uma cópia exclusiva para o Instagram. O upload direto aceita
// vários contêineres, mas o Instagram exige MP4/MOV com vídeo H.264 e 30 fps.
// A largura é limitada a 1080 px sem cortar nem distorcer o enquadramento; a
// cópia original continua disponível para as outras redes.
async function converterVideoParaInstagram(inputBuffer) {
  const inputPath = path.join(os.tmpdir(), `${crypto.randomUUID()}-instagram-input`)
  const outputPath = path.join(os.tmpdir(), `${crypto.randomUUID()}-instagram-output.mp4`)
  await fs.promises.writeFile(inputPath, inputBuffer)

  try {
    await new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .videoCodec('libx264')
        .audioCodec('aac')
        .outputOptions([
          '-map', '0:v:0',
          '-map', '0:a:0?',
          '-vf', "scale=w='min(1080,iw)':h=-2",
          '-r', '30',
          '-pix_fmt', 'yuv420p',
          '-profile:v', 'high',
          '-level', '4.1',
          '-crf', '20',
          '-preset', 'veryfast',
          '-ar', '48000',
          '-ac', '2',
          '-b:a', '128k',
          '-movflags', '+faststart'
        ])
        .format('mp4')
        .on('end', resolve)
        .on('error', reject)
        .save(outputPath)
    })
    return await fs.promises.readFile(outputPath)
  } finally {
    await fs.promises.unlink(inputPath).catch(() => {})
    await fs.promises.unlink(outputPath).catch(() => {})
  }
}

module.exports = { converterParaJpeg, lerDimensoesImagem, converterImagemParaTiktok, converterVideoParaTiktok, converterVideoParaInstagram }
