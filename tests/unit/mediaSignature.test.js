const { validarAssinaturaMedia } = require('../../src/infra/storage/mediaSignature')

describe('validarAssinaturaMedia', () => {
  test('aceita JPEG quando o MIME corresponde', () => {
    expect(validarAssinaturaMedia(Buffer.from([0xff, 0xd8, 0xff, 0xe0]), 'image/jpeg')).toBe(true)
  })

  test('rejeita conteúdo SVG disfarçado de imagem', () => {
    expect(validarAssinaturaMedia(Buffer.from('<svg><script>alert(1)</script></svg>'), 'image/png')).toBe(false)
  })

  test('rejeita MIME de vídeo para assinatura de imagem', () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    expect(validarAssinaturaMedia(png, 'video/mp4')).toBe(false)
  })

  test('aceita contêiner MP4 com caixa ftyp', () => {
    const mp4 = Buffer.alloc(16)
    mp4.writeUInt32BE(16, 0)
    mp4.write('ftyp', 4, 'ascii')
    expect(validarAssinaturaMedia(mp4, 'video/mp4')).toBe(true)
  })

  test('aceita assinatura EBML de WebM/Matroska', () => {
    expect(validarAssinaturaMedia(Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x93]), 'video/webm')).toBe(true)
  })
})
