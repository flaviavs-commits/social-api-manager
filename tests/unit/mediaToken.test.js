// Testes unitários — src/services/mediaToken.js
process.env.SESSION_SECRET = 'test-session-secret-xyz'

const { gerarTokenMedia, validarTokenMedia } = require('../../src/services/mediaToken')

describe('gerarTokenMedia / validarTokenMedia', () => {
  test('token gerado é válido para o mesmo filename', () => {
    const token = gerarTokenMedia('foto.jpg')
    expect(validarTokenMedia('foto.jpg', token)).toBe(true)
  })
  test('token não é válido para filename diferente', () => {
    const token = gerarTokenMedia('foto.jpg')
    expect(validarTokenMedia('outro.jpg', token)).toBe(false)
  })
  test('token adulterado é inválido', () => {
    const token = gerarTokenMedia('video.mp4')
    const tampered = token.slice(0, -4) + 'XXXX'
    expect(validarTokenMedia('video.mp4', tampered)).toBe(false)
  })
  test('token expirado é inválido', () => {
    // Cria token com exp no passado
    const crypto = require('crypto')
    const filename = 'img.png'
    const expira = Date.now() - 1000
    const payload = `${filename}:${expira}`
    const sig = crypto.createHmac('sha256', 'test-session-secret-xyz').update(payload).digest('hex')
    const token = `${expira}.${sig}`
    expect(validarTokenMedia(filename, token)).toBe(false)
  })
  test('token vazio / null / undefined são inválidos', () => {
    expect(validarTokenMedia('foto.jpg', null)).toBe(false)
    expect(validarTokenMedia('foto.jpg', '')).toBe(false)
    expect(validarTokenMedia('foto.jpg', undefined)).toBe(false)
    expect(validarTokenMedia('foto.jpg', 'semPonto')).toBe(false)
  })
  test('token sem ponto é inválido', () => {
    expect(validarTokenMedia('foto.jpg', 'tokenSemPonto')).toBe(false)
  })
})
