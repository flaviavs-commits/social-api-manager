// TOTP (RFC 6238) implementado com o módulo crypto nativo, sem dependências
// externas. Compatível com Google Authenticator / Authy: gera um segredo em
// Base32, monta a otpauth:// URI (que o frontend transforma em QR code) e
// valida o código de 6 dígitos com uma pequena janela de tolerância.
const crypto = require('crypto')

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
const PERIODO_SEGUNDOS = 30
const DIGITOS = 6

// ── Base32 (RFC 4648, sem padding) ───────────────────────────────────────────
function base32Encode(buffer) {
  let bits = 0
  let valor = 0
  let saida = ''
  for (const byte of buffer) {
    valor = (valor << 8) | byte
    bits += 8
    while (bits >= 5) {
      saida += BASE32_ALPHABET[(valor >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) saida += BASE32_ALPHABET[(valor << (5 - bits)) & 31]
  return saida
}

function base32Decode(str) {
  const limpo = str.toUpperCase().replace(/=+$/, '').replace(/\s/g, '')
  let bits = 0
  let valor = 0
  const bytes = []
  for (const char of limpo) {
    const idx = BASE32_ALPHABET.indexOf(char)
    if (idx === -1) throw new Error('Segredo Base32 inválido')
    valor = (valor << 5) | idx
    bits += 5
    if (bits >= 8) {
      bytes.push((valor >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }
  return Buffer.from(bytes)
}

// Gera um segredo TOTP aleatório (20 bytes = 160 bits, recomendado) em Base32.
function gerarSegredo() {
  return base32Encode(crypto.randomBytes(20))
}

// HOTP (RFC 4226): código a partir de um contador de 8 bytes.
function hotp(segredoBuffer, contador) {
  const buf = Buffer.alloc(8)
  // contador cabe em 32 bits no nosso uso (tempo/30 ≈ 5.8e7), então grava na
  // metade baixa do buffer de 8 bytes (a alta fica zerada).
  buf.writeUInt32BE(Math.floor(contador / 0x100000000), 0)
  buf.writeUInt32BE(contador >>> 0, 4)

  const hmac = crypto.createHmac('sha1', segredoBuffer).update(buf).digest()
  const offset = hmac[hmac.length - 1] & 0xf
  const binario = ((hmac[offset] & 0x7f) << 24) |
                  ((hmac[offset + 1] & 0xff) << 16) |
                  ((hmac[offset + 2] & 0xff) << 8) |
                  (hmac[offset + 3] & 0xff)
  return String(binario % 10 ** DIGITOS).padStart(DIGITOS, '0')
}

// Código TOTP atual para um segredo Base32 (usado em testes/depuração).
function gerarCodigo(segredoBase32, paraTimestamp = Date.now()) {
  const contador = Math.floor(paraTimestamp / 1000 / PERIODO_SEGUNDOS)
  return hotp(base32Decode(segredoBase32), contador)
}

// Valida um código informado pelo usuário, aceitando uma janela de ±1 período
// (±30s) para tolerar diferença de relógio entre o servidor e o celular.
// Comparação em tempo constante para não vazar acerto parcial por timing.
function validarCodigo(segredoBase32, codigo, janela = 1) {
  if (typeof codigo !== 'string' || !/^\d{6}$/.test(codigo.trim())) return false
  const segredoBuffer = base32Decode(segredoBase32)
  const contadorAtual = Math.floor(Date.now() / 1000 / PERIODO_SEGUNDOS)
  const informado = Buffer.from(codigo.trim())

  for (let i = -janela; i <= janela; i++) {
    const esperado = Buffer.from(hotp(segredoBuffer, contadorAtual + i))
    if (esperado.length === informado.length && crypto.timingSafeEqual(esperado, informado)) {
      return true
    }
  }
  return false
}

// Monta a otpauth:// URI lida pelo Google Authenticator (via QR code).
// label e issuer identificam a conta no app autenticador.
function gerarOtpauthUri(segredoBase32, contaEmail, issuer = 'Meu Ecoo Mídia') {
  const label = encodeURIComponent(`${issuer}:${contaEmail}`)
  const params = new URLSearchParams({
    secret: segredoBase32,
    issuer,
    algorithm: 'SHA1',
    digits: String(DIGITOS),
    period: String(PERIODO_SEGUNDOS)
  })
  return `otpauth://totp/${label}?${params.toString()}`
}

module.exports = { gerarSegredo, gerarCodigo, validarCodigo, gerarOtpauthUri }
