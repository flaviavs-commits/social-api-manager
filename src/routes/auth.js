const express = require('express')
const router = express.Router()
const bcrypt = require('bcrypt')
const rateLimit = require('express-rate-limit')
const usersRepo = require('../repositories/usersRepository')
const credentialsRepo = require('../repositories/credentialsRepository')
const mailer = require('../services/mailer')
const { addLog } = require('../middleware/logger')

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
  if (password.length < 6 || password.length > 72) {
    return res.status(400).json({ erro: 'A senha precisa ter entre 6 e 72 caracteres.' })
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
  if (password.length < 6 || password.length > 72) {
    return res.status(400).json({ erro: 'A senha precisa ter entre 6 e 72 caracteres.' })
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

  const url = `https://accounts.google.com/o/oauth2/v2/auth` +
    `?client_id=${process.env.GOOGLE_CLIENT_ID}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&response_type=code` +
    `&scope=${encodeURIComponent(scopes)}` +
    `&prompt=select_account`

  res.redirect(url)
})

router.get('/google/callback', async (req, res) => {
  const { code, error } = req.query
  if (error) {
    return res.send(friendlyAuthError('Login com Google cancelado.'))
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

    req.session.userId = user.id
    addLog('ok', 'Login com Google realizado com sucesso', null, null, user.id)
    res.redirect('/')
  } catch (err) {
    addLog('err', `Falha no login com Google: ${err.message}`)
    res.send(friendlyAuthError('Não foi possível entrar com o Google agora. Tente novamente em alguns minutos.'))
  }
})

module.exports = router
