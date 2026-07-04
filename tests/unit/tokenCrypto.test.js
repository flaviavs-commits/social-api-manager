// Testes unitários — tokenCrypto: AES-256-GCM encrypt/decrypt
process.env.TOKEN_ENCRYPTION_KEY = 'a'.repeat(64) // 32 bytes em hex

const { encrypt, decrypt } = require('../../src/services/tokenCrypto')

describe('encrypt / decrypt', () => {
  test('vai e volta com o mesmo valor', () => {
    const original = 'EAABsbCS1zcBAABtoken123'
    expect(decrypt(encrypt(original))).toBe(original)
  })

  test('cifra de valores diferentes é diferente', () => {
    const a = encrypt('token-a')
    const b = encrypt('token-b')
    expect(a).not.toBe(b)
  })

  test('dois encrypts do mesmo valor geram ciphertexts distintos (IV aleatório)', () => {
    const c1 = encrypt('mesmo')
    const c2 = encrypt('mesmo')
    expect(c1).not.toBe(c2)
  })

  test('resultado tem prefixo enc:v1:', () => {
    expect(encrypt('x')).toMatch(/^enc:v1:/)
  })

  test('decrypt retorna valor puro se não tiver prefixo (token legado)', () => {
    expect(decrypt('token_legado_sem_prefixo')).toBe('token_legado_sem_prefixo')
  })

  test('decrypt de null retorna null', () => {
    expect(decrypt(null)).toBeNull()
  })

  test('encrypt de null retorna null', () => {
    expect(encrypt(null)).toBeNull()
  })

  test('decrypt com formato inválido lança erro', () => {
    expect(() => decrypt('enc:v1:sotesteincompleto')).toThrow()
  })

  test('criptografa strings de um char', () => {
    expect(decrypt(encrypt('x'))).toBe('x')
  })

  test('criptografa strings longas com caracteres especiais', () => {
    const longa = '😀'.repeat(100) + '\n\t' + 'ção'
    expect(decrypt(encrypt(longa))).toBe(longa)
  })
})
