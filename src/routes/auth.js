const express = require('express')
const router = express.Router()
const bcrypt = require('bcrypt')
const rateLimit = require('express-rate-limit')
const usersRepo = require('../repositories/usersRepository')
const credentialsRepo = require('../repositories/credentialsRepository')
const mailer = require('../services/mailer')
const { addLog } = require('../middleware/logger')
const { validarComplexidadeSenha } = require('../utils/http')
const totp = require('../services/totp')

function friendlyAuthError(msg) {
  return `<!DOCTYPE html><html><body><script>
    window.location.href = '/login.html?error=${encodeURIComponent(msg)}';
  </script></body></html>`
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
function isValidEmail(email) {
  return typeof email === 'string' && EMAIL_REGEX.test(email.trim())
}

// Limita tentativas por IP para dificultar brute-force de senha e abuso do
// envio de e-mails de redefinição. Mensagem amigável, sem detalhes técnicos.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { erro: 'Muitas tentativas. Aguarde alguns minutos antes de tentar novamente.' }
})

const forgotPasswordLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { erro: 'Muitos pedidos de redefinição de senha. Aguarde antes de tentar novamente.' }
})

// ─── Login com e-mail e senha ──────────────────────────────────────────────

router.post('/login', loginLimiter, async (req, res) => {
  const { email, password } = req.body || {}
  if (!email || !password) {
    return res.status(400).json({ erro: 'Preencha o e-mail e a senha.' })
  }
  if (!isValidEmail(email)) {
    return res.status(400).json({ erro: 'Informe um e-mail válido.' })
  }

  let user
  try {
    user = await usersRepo.buscarPorEmail(email)
    if (!user) {
      return res.status(401).json({ erro: 'E-mail ou senha incorretos.' })
    }

    const cred = await credentialsRepo.buscarPorUserId(user.id)
    if (!cred) {
      return res.status(401).json({ erro: 'Esta conta foi criada com login do Google. Use o botão "Continuar com o Google" para entrar.' })
    }

    const senhaOk = await bcrypt.compare(password, cred.password_hash)
    if (!senhaOk) {
      addLog('err', 'Falha no login: senha incorreta', null, null, user.id)
      return res.status(401).json({ erro: 'E-mail ou senha incorretos.' })
    }

    if (user.totp_enabled) {
      // Senha confere, mas falta o segundo fator — não abre sessão ainda,
      // só marca quem está pendente de confirmar o código no app autenticador.
      req.session.pending2faUserId = user.id
      addLog('ok', 'Senha confirmada, aguardando código 2FA', null, null, user.id)
      return res.json({ ok: true, requires2fa: true })
    }

    req.session.userId = user.id
    addLog('ok', 'Login realizado com sucesso', null, null, user.id)
    res.json({ ok: true })
  } catch (err) {
    addLog('err', `Falha no login: ${err.message}`, null, null, user?.id)
    res.status(500).json({ erro: 'Não foi possível entrar agora. Tente novamente em alguns instantes.' })
  }
})

router.post('/register', loginLimiter, async (req, res) => {
  const { email, password, fullName } = req.body || {}
  if (!email || !password) {
    return res.status(400).json({ erro: 'Preencha o e-mail e a senha.' })
  }
  if (!isValidEmail(email)) {
    return res.status(400).json({ erro: 'Informe um e-mail válido.' })
  }
  const erroComplexidade = validarComplexidadeSenha(password)
  if (erroComplexidade) {
    return res.status(400).json({ erro: erroComplexidade })
  }

  try {
    const existente = await usersRepo.buscarPorEmail(email)
    if (existente) {
      return res.status(409).json({ erro: 'Já existe uma conta com esse e-mail.' })
    }

    const user = await usersRepo.criar({ email, fullName })
    const passwordHash = await bcrypt.hash(password, 10)
    await credentialsRepo.criar(user.id, passwordHash)
    req.session.userId = user.id
    addLog('ok', 'Conta criada com sucesso', null, null, user.id)
    res.json({ ok: true })
  } catch (err) {
    addLog('err', `Falha ao criar conta: ${err.message}`)
    res.status(500).json({ erro: 'Não foi possível criar sua conta agora. Tente novamente em alguns instantes.' })
  }
})

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }))
})

// Completa o login depois que a senha já foi confirmada e a conta tem 2FA
// ativo (ver pending2faUserId em /login). Reaproveita o mesmo rate limit do
// login para não abrir uma porta de brute-force separada no código TOTP.
router.post('/verify-2fa', loginLimiter, async (req, res) => {
  const { code } = req.body || {}
  const userId = req.session.pending2faUserId
  if (!userId) {
    return res.status(400).json({ erro: 'Nenhum login pendente de confirmação. Faça login novamente.' })
  }

  try {
    const info = await usersRepo.buscarTotp(userId)
    if (!info?.enabled || !info.secret || !totp.validarCodigo(info.secret, String(code || ''))) {
      addLog('err', 'Falha no login: código 2FA inválido', null, null, userId)
      return res.status(400).json({ erro: 'Código inválido. Verifique o app autenticador e tente de novo.' })
    }

    delete req.session.pending2faUserId
    req.session.userId = userId
    addLog('ok', 'Login com 2FA concluído', null, null, userId)
    res.json({ ok: true })
  } catch (err) {
    addLog('err', `Falha no login com 2FA: ${err.message}`, null, null, userId)
    res.status(500).json({ erro: 'Não foi possível verificar o código agora. Tente novamente.' })
  }
})

// ─── Esqueci minha senha ────────────────────────────────────────────────────

router.post('/forgot-password', forgotPasswordLimiter, async (req, res) => {
  const { email } = req.body || {}
  if (!email) {
    return res.status(400).json({ erro: 'Informe seu e-mail.' })
  }
  if (!isValidEmail(email)) {
    return res.status(400).json({ erro: 'Informe um e-mail válido.' })
  }

  const respostaPadrao = { ok: true, mensagem: 'Se esse e-mail tiver uma conta, enviamos um link de redefinição de senha.' }

  try {
    const user = await usersRepo.buscarPorEmail(email)
    if (!user) return res.json(respostaPadrao)

    const cred = await credentialsRepo.buscarPorUserId(user.id)
    if (!cred) return res.json(respostaPadrao)

    const token = await credentialsRepo.gerarTokenReset(user.id)
    const resetLink = `${process.env.BASE_URL}/reset-password.html?token=${token}`
    await mailer.enviarEmailRedefinicaoSenha(user.email, resetLink)

    res.json(respostaPadrao)
  } catch (err) {
    addLog('err', `Falha ao solicitar redefinição de senha: ${err.message}`)
    res.status(500).json({ erro: 'Não foi possível enviar o e-mail agora. Tente novamente em alguns instantes.' })
  }
})

// Reset por 2FA (TOTP): alternativa ao link por e-mail para quem ativou o 2FA.
// A pessoa informa o e-mail + o código do app autenticador e, se baterem,
// recebe o mesmo tipo de token de reset usado pela página reset-password.html.
//
// Anti-enumeração: a resposta NÃO revela se a conta existe nem se tem 2FA —
// só diferencia "código aceito" de "não foi possível", para um atacante não
// conseguir mapear quais e-mails têm conta/2FA. O rate limit reforça isso.
router.post('/reset-2fa', forgotPasswordLimiter, async (req, res) => {
  const { email, code } = req.body || {}
  if (!email || !code) return res.status(400).json({ erro: 'Informe o e-mail e o código do aplicativo.' })
  if (!isValidEmail(email)) return res.status(400).json({ erro: 'Informe um e-mail válido.' })

  const erroGenerico = { erro: 'E-mail ou código inválido, ou 2FA não está ativo para esta conta.' }

  try {
    const info = await usersRepo.buscarTotp(email, true)
    if (!info?.enabled || !info.secret || !totp.validarCodigo(info.secret, String(code))) {
      return res.status(400).json(erroGenerico)
    }

    // Reset de senha só faz sentido para quem tem senha local — contas só do
    // Google não têm credencial para redefinir (gerarTokenReset não persistiria
    // o token). Responde o mesmo erro genérico para não vazar essa distinção.
    const cred = await credentialsRepo.buscarPorUserId(info.userId)
    if (!cred) return res.status(400).json(erroGenerico)

    const token = await credentialsRepo.gerarTokenReset(info.userId)
    addLog('ok', 'Token de redefinição gerado via 2FA', null, null, info.userId)
    res.json({ ok: true, token })
  } catch (err) {
    addLog('err', `Falha no reset via 2FA: ${err.message}`)
    res.status(500).json({ erro: 'Não foi possível verificar agora. Tente novamente em alguns instantes.' })
  }
})

router.get('/reset-password/validar', async (req, res) => {
  const { token } = req.query
  if (!token) return res.json({ valido: false })

  try {
    const cred = await credentialsRepo.buscarPorResetToken(token)
    res.json({ valido: !!cred })
  } catch (err) {
    addLog('err', `Falha ao validar token de redefinição: ${err.message}`)
    res.json({ valido: false })
  }
})

router.post('/reset-password', loginLimiter, async (req, res) => {
  const { token, password } = req.body || {}
  if (!token || !password) {
    return res.status(400).json({ erro: 'Preencha a nova senha.' })
  }
  const erroComplexidade = validarComplexidadeSenha(password)
  if (erroComplexidade) {
    return res.status(400).json({ erro: erroComplexidade })
  }

  try {
    const passwordHash = await bcrypt.hash(password, 10)
    const cred = await credentialsRepo.atualizarSenhaPorResetToken(token, passwordHash)
    if (!cred) {
      return res.status(400).json({ erro: 'Esse link não é mais válido. Solicite a redefinição de senha novamente.' })
    }

    res.json({ ok: true })
  } catch (err) {
    addLog('err', `Falha ao redefinir senha: ${err.message}`)
    res.status(500).json({ erro: 'Não foi possível redefinir sua senha agora. Tente novamente em alguns instantes.' })
  }
})

// ─── Login com Google ────────────────────────────────────────────────────

router.get('/google', (req, res) => {
  const redirectUri = process.env.GOOGLE_LOGIN_REDIRECT_URI
  const scopes = ['openid', 'email', 'profile'].join(' ')

  // state CSRF: nonce aleatório guardado na sessão e devolvido pelo Google no
  // callback. Sem ele, um atacante poderia forjar o callback (login CSRF),
  // logando a vítima numa conta controlada por ele.
  const state = require('crypto').randomBytes(16).toString('hex')
  req.session.googleOAuthState = state

  const url = `https://accounts.google.com/o/oauth2/v2/auth` +
    `?client_id=${process.env.GOOGLE_CLIENT_ID}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&response_type=code` +
    `&scope=${encodeURIComponent(scopes)}` +
    `&state=${state}` +
    `&prompt=select_account`

  res.redirect(url)
})

router.get('/google/callback', async (req, res) => {
  const { code, error, state } = req.query
  if (error) {
    return res.send(friendlyAuthError('Login com Google cancelado.'))
  }

  // Valida o state contra o nonce guardado na sessão (proteção CSRF) e o
  // consome em seguida, para não permitir reuso. Falha se ausente ou diferente.
  const expectedState = req.session.googleOAuthState
  delete req.session.googleOAuthState
  if (!state || !expectedState || state !== expectedState) {
    return res.send(friendlyAuthError('Sessão de login inválida ou expirada. Tente novamente.'))
  }

  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        grant_type: 'authorization_code',
        redirect_uri: process.env.GOOGLE_LOGIN_REDIRECT_URI,
        code
      })
    })
    const tokenData = await tokenRes.json()

    if (tokenData.error || !tokenData.access_token) {
      addLog('err', `Erro ao obter token de login Google: ${JSON.stringify(tokenData)}`)
      return res.send(friendlyAuthError('Não foi possível entrar com o Google agora. Tente novamente em alguns minutos.'))
    }

    const profileRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` }
    })
    const profile = await profileRes.json()

    if (!profile.email) {
      return res.send(friendlyAuthError('Não foi possível obter seu e-mail do Google.'))
    }

    let user = await usersRepo.buscarPorGoogleId(profile.id)
    if (!user) {
      user = await usersRepo.buscarPorEmail(profile.email)
      if (user) {
        await usersRepo.vincularGoogleId(user.id, profile.id)
      } else {
        user = await usersRepo.criarComGoogle({
          email: profile.email,
          fullName: profile.name,
          googleId: profile.id
        })
      }
    }

    if (user.totp_enabled) {
      req.session.pending2faUserId = user.id
      addLog('ok', 'Login com Google confirmado, aguardando código 2FA', null, null, user.id)
      return res.redirect('/verify-2fa.html')
    }

    req.session.userId = user.id
    addLog('ok', 'Login com Google realizado com sucesso', null, null, user.id)
    res.redirect('/')
  } catch (err) {
    addLog('err', `Falha no login com Google: ${err.message}`)
    res.send(friendlyAuthError('Não foi possível entrar com o Google agora. Tente novamente em alguns minutos.'))
  }
})

module.exports = router
