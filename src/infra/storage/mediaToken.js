const crypto = require('crypto')

// Gera/valida um token HMAC de curta duração que libera acesso público a um
// arquivo específico em /uploads, sem exigir sessão — necessário porque as
// APIs de Instagram/TikTok/etc baixam a mídia direto de uma URL pública, sem
// enviar nosso cookie de sessão.
// 6 horas: o TikTok (e outras APIs) pode buscar a mídia por pull com atraso
// — especialmente em posts agendados e carrosséis, onde cada imagem é
// baixada de forma assíncrona. Com 10 min, o token expirava antes do pull e
// o TikTok rejeitava com url_ownership_unverified (não conseguia acessar a
// URL). O token segue restrito a uma mídia específica e assinado por HMAC.
// No modo privado o token também pode ficar salvo em posts agendados. O prazo
// maior evita quebrar agendamentos sem transformar o token em permanente.
const BLOB_ACCESS_MODE = String(process.env.BLOB_ACCESS_MODE || 'public').trim().toLowerCase()
const EXPIRACAO_MS = BLOB_ACCESS_MODE === 'private'
  ? 30 * 24 * 60 * 60 * 1000
  : 6 * 60 * 60 * 1000

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
