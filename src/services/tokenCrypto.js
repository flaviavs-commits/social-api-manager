// Cifra/decifra access_token e refresh_token antes de salvar/ler no Postgres,
// com AES-256-GCM — protege contra exposição desses segredos em caso de dump
// do banco, backup vazado ou acesso indevido à infraestrutura, já que esses
// tokens dão acesso direto às contas conectadas (Facebook/Instagram/YouTube/
// TikTok) em nome do usuário.
const crypto = require('crypto')

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 12 // recomendado para GCM
const KEY = process.env.TOKEN_ENCRYPTION_KEY
  ? Buffer.from(process.env.TOKEN_ENCRYPTION_KEY, 'hex')
  : null

if (KEY && KEY.length !== 32) {
  throw new Error('TOKEN_ENCRYPTION_KEY deve conter exatamente 32 bytes em hexadecimal (64 caracteres)')
}

// Formato salvo: "enc:v1:<iv>:<authTag>:<ciphertext>" (tudo em hex) — o
// prefixo "enc:v1:" distingue de tokens antigos em texto puro, permitindo
// migração gradual sem quebrar nada que já estava no banco antes desta mudança.
const PREFIX = 'enc:v1:'

function encrypt(plainText) {
  if (plainText == null) return plainText
  if (!KEY) throw new Error('TOKEN_ENCRYPTION_KEY não configurada — não é possível cifrar tokens')

  const iv = crypto.randomBytes(IV_LENGTH)
  const cipher = crypto.createCipheriv(ALGORITHM, KEY, iv)
  const ciphertext = Buffer.concat([cipher.update(String(plainText), 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()

  return `${PREFIX}${iv.toString('hex')}:${authTag.toString('hex')}:${ciphertext.toString('hex')}`
}

// Tokens salvos antes desta mudança continuam em texto puro no banco — decrypt
// detecta a ausência do prefixo e devolve o valor como está, sem tentar decifrar.
function decrypt(value) {
  if (value == null || !value.startsWith(PREFIX)) return value
  if (!KEY) throw new Error('TOKEN_ENCRYPTION_KEY não configurada — não é possível decifrar tokens')

  const [ivHex, authTagHex, ciphertextHex] = value.slice(PREFIX.length).split(':')
  if (!ivHex || !authTagHex || !ciphertextHex) throw new Error('Token cifrado em formato inválido')

  const decipher = crypto.createDecipheriv(ALGORITHM, KEY, Buffer.from(ivHex, 'hex'))
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'))
  const plaintext = Buffer.concat([decipher.update(Buffer.from(ciphertextHex, 'hex')), decipher.final()])
  return plaintext.toString('utf8')
}

module.exports = { encrypt, decrypt }
