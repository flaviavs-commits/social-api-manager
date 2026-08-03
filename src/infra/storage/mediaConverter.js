// Conversão de imagem via sharp — Instagram e TikTok só aceitam JPEG (Instagram
// bloqueia outros formatos; TikTok rejeita o post depois do envio com
// file_format_check_failed). Converte PNG/GIF/WebP antes de publicar, em vez
// de bloquear o post.
const sharp = require('sharp')

// Para o TikTok, também redimensiona para 1080x1920 (9:16) — o app adiciona
// barras pretas em fotos horizontais, então usa fit "cover" centralizado
// para preencher a tela toda.
async function converterParaJpeg(inputBuffer, { resizeForTiktok = false } = {}) {
  // Achata a transparência (ex: PNG/sticker com fundo transparente) sobre
  // branco antes de converter — sem isso, o sharp preenche com preto por
  // padrão ao gerar o JPEG (que não suporta canal alfa).
  let pipeline = sharp(inputBuffer).flatten({ background: '#ffffff' })
  if (resizeForTiktok) pipeline = pipeline.resize(1080, 1920, { fit: 'cover', position: 'centre' })
  return pipeline.jpeg({ quality: 90 }).toBuffer()
}

// Lê largura/altura de uma imagem sem decodificar o arquivo inteiro (sharp
// só lê o cabeçalho para metadata()) — usado para validar a proporção
// aceita pelo Instagram antes de publicar (ver domain/posts/videoRules.js,
// isAspectRatioValidForInstagram).
async function lerDimensoesImagem(buffer) {
  const { width, height } = await sharp(buffer).metadata()
  return { width: width || null, height: height || null }
}

module.exports = { converterParaJpeg, lerDimensoesImagem }
