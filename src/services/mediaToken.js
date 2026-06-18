const crypto = require('crypto')

// Gera/valida um token HMAC de curta duração que libera acesso público a um
// arquivo específico em /uploads, sem exigir sessão — necessário porque as
// APIs de Instagram/TikTok/etc baixam a mídia direto de uma URL pública, sem
// enviar nosso cookie de sessão.
const EXPIRACAO_MS = 10 * 60 * 1000 // 10 minutos

function gerarTokenMedia(filename) {
  const expira = Date.now() + EXPIRACAO_MS
  const payload = `${filename}:${expira}`
  const sig = crypto.createHmac('sha256', process.env.SESSION_SECRET).update(payload).digest('hex')
  return `${expira}.${sig}`
}

function validarTokenMedia(filename, token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return false
  const [expiraStr, sig] = token.split('.')
  const expira = Number(expiraStr)
  if (!expira || Date.now() > expira) return false

  const payload = `${filename}:${expira}`
  const sigEsperada = crypto.createHmac('sha256', process.env.SESSION_SECRET).update(payload).digest('hex')
  const bufA = Buffer.from(sig || '')
  const bufB = Buffer.from(sigEsperada)
  if (bufA.length !== bufB.length) return false
  return crypto.timingSafeEqual(bufA, bufB)
}

module.exports = { gerarTokenMedia, validarTokenMedia }
