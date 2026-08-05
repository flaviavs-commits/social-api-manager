const crypto = require('crypto')

// Mesma técnica do signState/verifyState em routes/oauth.js, mas com secret
// próprio (AUTH_TOKEN_SECRET) — esses tokens autenticam toda chamada de API
// (alto blast radius se vazar), enquanto SESSION_SECRET assina apenas o
// state de account-linking (curto, iniciado pelo próprio servidor). Misturar
// os dois forçaria rotacionar um por causa do outro.
function sign(payload, secret) {
  const json = JSON.stringify(payload)
  const sig = crypto.createHmac('sha256', secret).update(json).digest('hex')
  return Buffer.from(JSON.stringify({ ...payload, sig })).toString('base64url')
}

function verify(token, secret) {
  const decoded = JSON.parse(Buffer.from(token, 'base64url').toString())
  const { sig, ...payload } = decoded
  const expectedSig = crypto.createHmac('sha256', secret).update(JSON.stringify(payload)).digest('hex')
  const sigBuf = Buffer.from(sig || '')
  const expectedBuf = Buffer.from(expectedSig)
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    throw new Error('Assinatura inválida')
  }
  if (payload.exp && Date.now() > payload.exp) throw new Error('Token expirado')
  return payload
}

function gerarTokenSessao(userId) {
  return sign({ userId, exp: Date.now() + 30 * 24 * 60 * 60 * 1000 }, process.env.AUTH_TOKEN_SECRET)
}

function verificarTokenSessao(token) {
  return verify(token, process.env.AUTH_TOKEN_SECRET).userId
}

function gerarTokenPending2fa(userId) {
  return sign({ userId, exp: Date.now() + 5 * 60 * 1000 }, process.env.AUTH_TOKEN_SECRET)
}

function verificarTokenPending2fa(token) {
  return verify(token, process.env.AUTH_TOKEN_SECRET).userId
}

function gerarTokenAprovacaoAgente(userId, action, args) {
  return sign({
    purpose: 'ai-agent-approval',
    userId,
    action,
    args,
    exp: Date.now() + 5 * 60 * 1000,
  }, process.env.AUTH_TOKEN_SECRET)
}

function verificarTokenAprovacaoAgente(token, userId) {
  const payload = verify(token, process.env.AUTH_TOKEN_SECRET)
  if (payload.purpose !== 'ai-agent-approval' || payload.userId !== userId) throw new Error('Aprovação inválida')
  return payload
}

function gerarGoogleOAuthState(extra = {}) {
  return sign({ ...extra, nonce: crypto.randomBytes(16).toString('hex'), exp: Date.now() + 10 * 60 * 1000 }, process.env.AUTH_TOKEN_SECRET)
}

function verificarGoogleOAuthState(state) {
  return verify(state, process.env.AUTH_TOKEN_SECRET)
}

module.exports = {
  gerarTokenSessao,
  verificarTokenSessao,
  gerarTokenPending2fa,
  verificarTokenPending2fa,
  gerarTokenAprovacaoAgente,
  verificarTokenAprovacaoAgente,
  gerarGoogleOAuthState,
  verificarGoogleOAuthState
}
