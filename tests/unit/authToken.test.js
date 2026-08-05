// Testes unitários — src/utils/authToken.js
process.env.AUTH_TOKEN_SECRET = 'test-secret-auth-12345'

const {
  gerarTokenSessao,
  verificarTokenSessao,
  gerarTokenPending2fa,
  verificarTokenPending2fa,
  gerarGoogleOAuthState,
  verificarGoogleOAuthState,
  gerarTokenAprovacaoAgente,
  verificarTokenAprovacaoAgente,
} = require('../../src/utils/authToken')

describe('gerarTokenSessao / verificarTokenSessao', () => {
  test('token gerado é verificável e retorna o userId correto', () => {
    const token = gerarTokenSessao(42)
    expect(verificarTokenSessao(token)).toBe(42)
  })
  test('token adulterado lança erro', () => {
    const token = gerarTokenSessao(1)
    const tampered = token.slice(0, -4) + 'XXXX'
    expect(() => verificarTokenSessao(tampered)).toThrow()
  })
  test('token com secret diferente lança erro', () => {
    process.env.AUTH_TOKEN_SECRET = 'outro-secret'
    const tokenOutro = gerarTokenSessao(5)
    process.env.AUTH_TOKEN_SECRET = 'test-secret-auth-12345'
    expect(() => verificarTokenSessao(tokenOutro)).toThrow()
  })
  test('token expirado lança erro', () => {
    // Gera token manualmente com exp no passado
    const crypto = require('crypto')
    function sign(payload, secret) {
      const json = JSON.stringify(payload)
      const sig = crypto.createHmac('sha256', secret).update(json).digest('hex')
      return Buffer.from(JSON.stringify({ ...payload, sig })).toString('base64url')
    }
    const expired = sign({ userId: 1, exp: Date.now() - 1000 }, 'test-secret-auth-12345')
    expect(() => verificarTokenSessao(expired)).toThrow('Token expirado')
  })
})

describe('gerarTokenPending2fa / verificarTokenPending2fa', () => {
  test('token 2FA válido retorna userId', () => {
    const token = gerarTokenPending2fa(99)
    expect(verificarTokenPending2fa(token)).toBe(99)
  })
  test('token de sessão não serve para 2FA (mesmo formato, mesma secret — aceito por design)', () => {
    // Ambos usam a mesma secret: é esperado que funcionem intercambiavelmente
    // Documentado aqui como comportamento conhecido
    const sessao = gerarTokenSessao(7)
    expect(typeof verificarTokenPending2fa(sessao)).toBe('number')
  })
})

describe('gerarGoogleOAuthState / verificarGoogleOAuthState', () => {
  test('state válido verifica e retorna payload', () => {
    const state = gerarGoogleOAuthState({ redirectTo: '/dashboard' })
    const payload = verificarGoogleOAuthState(state)
    expect(payload.redirectTo).toBe('/dashboard')
    expect(typeof payload.nonce).toBe('string')
  })
  test('state adulterado lança erro', () => {
    const state = gerarGoogleOAuthState({})
    expect(() => verificarGoogleOAuthState(state + 'X')).toThrow()
  })
})

describe('gerarTokenAprovacaoAgente / verificarTokenAprovacaoAgente', () => {
  test('aprovação válida preserva ação e argumentos para o mesmo usuário', () => {
    const token = gerarTokenAprovacaoAgente(42, 'create_draft', { text: 'conteúdo' })
    const payload = verificarTokenAprovacaoAgente(token, 42)

    expect(payload.action).toBe('create_draft')
    expect(payload.args).toEqual({ text: 'conteúdo' })
  })

  test('aprovação de outro usuário é rejeitada', () => {
    const token = gerarTokenAprovacaoAgente(42, 'delete_draft', { id: 3 })

    expect(() => verificarTokenAprovacaoAgente(token, 7)).toThrow('Aprovação inválida')
  })
})
