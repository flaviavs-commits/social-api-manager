// Validação mínima de formato baseada nos primeiros bytes do arquivo. O MIME
// vem do navegador e pode ser falsificado; ele nunca deve ser a única barreira
// antes de enviar a mídia para sharp, heic-convert, ffprobe ou ffmpeg.

function startsWithBytes(buffer, bytes) {
  return Buffer.isBuffer(buffer) && buffer.length >= bytes.length && bytes.every((value, index) => buffer[index] === value)
}

function asciiAt(buffer, offset, length) {
  if (!Buffer.isBuffer(buffer) || buffer.length < offset + length) return ''
  return buffer.subarray(offset, offset + length).toString('ascii')
}

function isIsoBmff(buffer) {
  return asciiAt(buffer, 4, 4) === 'ftyp'
}

function isImageSignature(buffer, mimetype) {
  switch (mimetype) {
    case 'image/jpeg': return startsWithBytes(buffer, [0xff, 0xd8, 0xff])
    case 'image/png': return startsWithBytes(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    case 'image/gif': return asciiAt(buffer, 0, 6) === 'GIF87a' || asciiAt(buffer, 0, 6) === 'GIF89a'
    case 'image/webp': return asciiAt(buffer, 0, 4) === 'RIFF' && asciiAt(buffer, 8, 4) === 'WEBP'
    case 'image/tiff': return startsWithBytes(buffer, [0x49, 0x49, 0x2a, 0x00]) || startsWithBytes(buffer, [0x4d, 0x4d, 0x00, 0x2a])
    case 'image/bmp': return asciiAt(buffer, 0, 2) === 'BM'
    case 'image/heic':
    case 'image/heif':
    case 'image/avif': {
      if (!isIsoBmff(buffer)) return false
      const brand = asciiAt(buffer, 8, 4)
      const compatibleBrands = []
      for (let offset = 16; offset + 4 <= Math.min(buffer.length, 128); offset += 4) compatibleBrands.push(asciiAt(buffer, offset, 4))
      if (mimetype === 'image/avif') return brand === 'avif' || brand === 'avis' || compatibleBrands.includes('avif') || compatibleBrands.includes('avis')
      return ['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1'].includes(brand) || compatibleBrands.some(value => ['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1'].includes(value))
    }
    default: return false
  }
}

function isVideoSignature(buffer, mimetype) {
  if (mimetype === 'video/webm' || mimetype === 'video/x-matroska') return startsWithBytes(buffer, [0x1a, 0x45, 0xdf, 0xa3])
  if (mimetype === 'video/mp4' || mimetype === 'video/quicktime') return isIsoBmff(buffer)
  return false
}

function validarAssinaturaMedia(buffer, mimetype) {
  const normalized = String(mimetype || '').toLowerCase()
  if (normalized.startsWith('image/')) return isImageSignature(buffer, normalized)
  if (normalized.startsWith('video/')) return isVideoSignature(buffer, normalized)
  return false
}

module.exports = { validarAssinaturaMedia }
