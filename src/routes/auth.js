const express = require('express')
const router = express.Router()
const bcrypt = require('bcrypt')
const rateLimit = require('express-rate-limit')
const { createRateLimitStore } = require('../infra/http/postgresRateLimitStore')
const usersRepo = require('../repositories/usersRepository')
const credentialsRepo = require('../repositories/credentialsRepository')
const mailer = require('../services/mailer')
const { addLog } = require('../middleware/logger')
const { safeStringify, safeMessage } = require('../utils/redact')
const { validarComplexidadeSenha } = require('../utils/http')
const totp = require('../services/totp')
const { verificarTokenSessaoDetalhado, verificarTokenPending2fa, gerarGoogleOAuthState, verificarGoogleOAuthState } = require('../utils/authToken')
const { issueAuthSession, issuePending2fa, clearAuthCookies, clearPending2faCookie, readCookie, AUTH_COOKIE, PENDING_2FA_COOKIE } = require('../utils/authCookie')
const { sincronizarCredencial, autenticarViaMeuEcoo } = require('../services/meuEcoo')
const { DEFAULT_PLAN, PLANS, SUPPORTED_PLATFORMS, getPlanConnectionLimit, getPlanPlatforms, normalizePlan } = require('../config/plans')
const { allowedEmailDomainLabel, isAllowedEmail } = require('../utils/allowedEmailDomain')
const { bestEffortEnsureZernioProfile } = require('../services/zernioProfileService')

const BCRYPT_COST = 12

// O caminho precisa ser absoluto e não relativo: essa página é servida pelo
// backend (Railway) dentro do callback do Google, então um caminho relativo
// como '/login.html' navegava para o domínio do Railway, não para o domínio
// de onde o login começou (Vercel ou um domínio customizado) — o usuário
// ficava "preso" no domínio errado ao ver o erro. baseUrl vem da origem
// validada no início do fluxo (ver origensPermitidas), com fallback pro
// FRONTEND_URL padrão quando não há origem capturada/válida.
function friendlyAuthError(msg, baseUrl) {
  const loginUrl = (baseUrl || process.env.FRONTEND_URL || '') + '/login.html?error=' + encodeURIComponent(msg)
  return `<!DOCTYPE html><html><body><script>
    window.location.href = ${JSON.stringify(loginUrl)};
  </script></body></html>`
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
function isValidEmail(email) {
  return typeof email === 'string' && EMAIL_REGEX.test(email.trim())
}

// O cookie HttpOnly é a credencial real. O campo token só é mantido em testes
// para preservar contratos antigos; produção nunca devolve a sessão ao JavaScript.
function respondAuth(res, body, token) {
  return res.json(process.env.NODE_ENV === 'test' ? { ...body, token } : body)
}

async function revokeSessions(userId) {
  if (userId && typeof usersRepo.invalidarSessoes === 'function') {
    await usersRepo.invalidarSessoes(userId)
  }
}

// Limita tentativas por IP para dificultar brute-force de senha e abuso do
// envio de e-mails de redefinição. Mensagem amigável, sem detalhes técnicos.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  store: createRateLimitStore('auth-login'),
  message: { erro: 'Muitas tentativas. Aguarde alguns minutos antes de tentar novamente.' }
})

const forgotPasswordLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  store: createRateLimitStore('auth-forgot'),
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
  if (!isAllowedEmail(email)) {
    return res.status(403).json({ erro: `Use um e-mail ${allowedEmailDomainLabel()} para acessar a aplicação.` })
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

    let senhaOk = await bcrypt.compare(password, cred.password_hash)
    if (!senhaOk) {
      // Pode ter sido trocada só no Meu Ecoo (ex.: reset de senha feito por
      // lá). Se ele confirmar, re-hasheia aqui pro próximo login não
      // depender de rede.
      const confirmadoPeloMeuEcoo = await autenticarViaMeuEcoo(email, password)
      if (confirmadoPeloMeuEcoo) {
        await credentialsRepo.atualizarSenha(user.id, await bcrypt.hash(password, BCRYPT_COST))
        senhaOk = true
      }
    }
    if (!senhaOk) {
      addLog('err', 'Falha no login: senha incorreta', null, null, user.id)
      return res.status(401).json({ erro: 'E-mail ou senha incorretos.' })
    }

    // Senhas antigas podem continuar válidas, mas não devem ser bloqueadas
    // de forma inesperada. O tamanho da senha só pode ser avaliado no login,
    // já que o banco armazena apenas o hash.
    const passwordUpgradeRecommended = password.length < 8

    // O Meu Ecoo é a fonte da verdade da identidade daqui pra frente — cada
    // login certo também empurra a credencial pra lá (best-effort, nunca
    // bloqueia este login se o Meu Ecoo estiver fora).
    void sincronizarCredencial(email, password, user.full_name)

    if (user.totp_enabled) {
      // Senha confere, mas falta o segundo fator — não abre sessão ainda,
      // devolve um token de curta duração que prova que a senha já foi
      // validada, sem entregar acesso de fato até o código TOTP confirmar.
      addLog('ok', 'Senha confirmada, aguardando código 2FA', null, null, user.id)
      const pendingToken = issuePending2fa(res, user.id)
      return res.json(process.env.NODE_ENV === 'test'
        ? { ok: true, requires2fa: true, pendingToken, passwordUpgradeRecommended }
        : { ok: true, requires2fa: true, passwordUpgradeRecommended })
    }

    addLog('ok', 'Login realizado com sucesso', null, null, user.id)
    await revokeSessions(user.id)
    const token = issueAuthSession(res, user.id)
    respondAuth(res, { ok: true, passwordUpgradeRecommended }, token)
  } catch (err) {
    addLog('err', `Falha no login: ${safeMessage(err.message)}`, null, null, user?.id)
    res.status(500).json({ erro: 'Não foi possível entrar agora. Tente novamente em alguns instantes.' })
  }
})

router.post('/register', loginLimiter, async (req, res) => {
  const { email, password, fullName, plan: requestedPlan } = req.body || {}
  if (!email || !password) {
    return res.status(400).json({ erro: 'Preencha o e-mail e a senha.' })
  }
  if (!isValidEmail(email)) {
    return res.status(400).json({ erro: 'Informe um e-mail válido.' })
  }
  if (!isAllowedEmail(email)) {
    return res.status(403).json({ erro: `O cadastro está disponível somente para e-mails ${allowedEmailDomainLabel()}.` })
  }
  const erroComplexidade = validarComplexidadeSenha(password)
  if (erroComplexidade) {
    return res.status(400).json({ erro: erroComplexidade })
  }
  if (requestedPlan !== undefined && !PLANS[requestedPlan]) {
    return res.status(400).json({ erro: 'Plano selecionado inválido.' })
  }
  const selectedPlan = requestedPlan ? normalizePlan(requestedPlan) : DEFAULT_PLAN
  const plan = selectedPlan
  const maxConnections = getPlanConnectionLimit(selectedPlan)
  const requestedPlatforms = req.body?.selectedPlatforms
  const selectedPlatforms = selectedPlan === 'premium'
    ? [...SUPPORTED_PLATFORMS]
    : Array.isArray(requestedPlatforms)
      ? [...new Set(requestedPlatforms.map(platform => String(platform).trim().toLowerCase()))]
      : getPlanPlatforms(selectedPlan).slice(0, maxConnections)
  if (!selectedPlatforms || selectedPlatforms.some(platform => !getPlanPlatforms(selectedPlan).includes(platform)) || selectedPlatforms.length !== maxConnections) {
    return res.status(400).json({ erro: `Escolha exatamente ${maxConnections} rede${maxConnections === 1 ? '' : 's'} social${maxConnections === 1 ? '' : 'is'} antes de continuar.` })
  }

  try {
    const existente = await usersRepo.buscarPorEmail(email)
    if (existente) {
      return res.status(409).json({ erro: 'Já existe uma conta com esse e-mail.' })
    }

    const user = await usersRepo.criar({ email, fullName, plan, allowedPlatforms: selectedPlatforms })
    const passwordHash = await bcrypt.hash(password, BCRYPT_COST)
    await credentialsRepo.criar(user.id, passwordHash)
    // O cadastro não deve ficar indisponível se o provedor externo estiver
    // temporariamente fora do ar; a conexão social tenta provisionar de novo.
    void bestEffortEnsureZernioProfile(user.id)
    addLog('ok', 'Conta criada com sucesso', null, null, user.id)
    const token = issueAuthSession(res, user.id)
    respondAuth(res, {
      ok: true,
      plan,
      selectedPlan,
      requiresPayment: true,
      allowedPlatforms: selectedPlatforms,
      maxConnections,
    }, token)
  } catch (err) {
    addLog('err', `Falha ao criar conta: ${safeMessage(err.message)}`)
    res.status(500).json({ erro: 'Não foi possível criar sua conta agora. Tente novamente em alguns instantes.' })
  }
})

router.post('/logout', async (req, res) => {
  const token = readCookie(req, AUTH_COOKIE)
  if (token) {
    try {
      const { userId } = verificarTokenSessaoDetalhado(token)
      await revokeSessions(userId)
    } catch {}
  }
  clearAuthCookies(res)
  res.json({ ok: true })
})

// Completa o login depois que a senha já foi confirmada e a conta tem 2FA
// ativo (ver pendingToken em /login). Reaproveita o mesmo rate limit do
// login para não abrir uma porta de brute-force separada no código TOTP.
router.post('/verify-2fa', loginLimiter, async (req, res) => {
  const { code } = req.body || {}
  const pendingToken = req.body?.pendingToken || readCookie(req, PENDING_2FA_COOKIE)
  let userId
  try {
    userId = verificarTokenPending2fa(pendingToken)
  } catch {
    return res.status(400).json({ erro: 'Nenhum login pendente de confirmação. Faça login novamente.' })
  }

  try {
    const info = await usersRepo.buscarTotp(userId)
    if (!info?.enabled || !info.secret || !totp.validarCodigo(info.secret, String(code || ''))) {
      addLog('err', 'Falha no login: código 2FA inválido', null, null, userId)
      return res.status(400).json({ erro: 'Código inválido. Verifique o app autenticador e tente de novo.' })
    }

    addLog('ok', 'Login com 2FA concluído', null, null, userId)
    await revokeSessions(userId)
    const token = issueAuthSession(res, userId)
    clearPending2faCookie(res)
    respondAuth(res, { ok: true }, token)
  } catch (err) {
    addLog('err', `Falha no login com 2FA: ${safeMessage(err.message)}`, null, null, userId)
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
  if (!isAllowedEmail(email)) {
    return res.status(403).json({ erro: `Use um e-mail ${allowedEmailDomainLabel()} para recuperar o acesso.` })
  }

  const respostaPadrao = { ok: true, mensagem: 'Se esse e-mail tiver uma conta, enviamos um link de redefinição de senha.' }

  try {
    const user = await usersRepo.buscarPorEmail(email)
    if (!user) return res.json(respostaPadrao)

    const cred = await credentialsRepo.buscarPorUserId(user.id)
    if (!cred) return res.json(respostaPadrao)

    const token = await credentialsRepo.gerarTokenReset(user.id)
    // Fragmento não é enviado ao servidor nem aparece no Referer. A página
    // troca o fragmento por memória assim que carrega.
    const resetLink = `${process.env.BASE_URL}/reset-password.html#token=${encodeURIComponent(token)}`
    await mailer.enviarEmailRedefinicaoSenha(user.email, resetLink)

    res.json(respostaPadrao)
  } catch (err) {
    addLog('err', `Falha ao solicitar redefinição de senha: ${safeMessage(err.message)}`)
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
    addLog('err', `Falha no reset via 2FA: ${safeMessage(err.message)}`)
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
    addLog('err', `Falha ao validar token de redefinição: ${safeMessage(err.message)}`)
    res.json({ valido: false })
  }
})

router.post('/reset-password/validar', async (req, res) => {
  const token = typeof req.body?.token === 'string' ? req.body.token : ''
  if (!token) return res.json({ valido: false })
  try {
    const cred = await credentialsRepo.buscarPorResetToken(token)
    res.json({ valido: !!cred })
  } catch (err) {
    addLog('err', `Falha ao validar token de redefinição: ${safeMessage(err.message)}`)
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
    const passwordHash = await bcrypt.hash(password, BCRYPT_COST)
    const cred = await credentialsRepo.atualizarSenhaPorResetToken(token, passwordHash)
    if (!cred) {
      return res.status(400).json({ erro: 'Esse link não é mais válido. Solicite a redefinição de senha novamente.' })
    }

    if (cred?.user_id && typeof usersRepo.invalidarSessoes === 'function') {
      await usersRepo.invalidarSessoes(cred.user_id)
    }
    res.json({ ok: true })
  } catch (err) {
    addLog('err', `Falha ao redefinir senha: ${safeMessage(err.message)}`)
    res.status(500).json({ erro: 'Não foi possível redefinir sua senha agora. Tente novamente em alguns instantes.' })
  }
})

// ─── Login com Google ────────────────────────────────────────────────────

// Domínios com permissão de iniciar/receber o fluxo de login com Google —
// mesma lista usada no CORS (FRONTEND_ORIGIN). Restringir a essa lista evita
// que o parâmetro de origem vindo do Referer vire um open redirect (alguém
// forjando um Referer de domínio arbitrário para roubar o token de sessão
// devolvido no fim do fluxo).
function origensPermitidas() {
  return (process.env.FRONTEND_ORIGIN || '').split(',').map(o => o.trim()).filter(Boolean)
}

router.get('/google', (req, res) => {
  const redirectUri = process.env.GOOGLE_LOGIN_REDIRECT_URI
  const scopes = ['openid', 'email', 'profile'].join(' ')

  // Guarda o domínio de onde o login começou (ex: um domínio customizado
  // diferente do FRONTEND_URL padrão) para devolver o usuário ao mesmo lugar
  // no callback, em vez de sempre cair no FRONTEND_URL fixo. Só aceita
  // origens já autorizadas no CORS — nunca um valor arbitrário do Referer.
  let origin = null
  try {
    const refererOrigin = req.headers.referer ? new URL(req.headers.referer).origin : null
    if (refererOrigin && origensPermitidas().includes(refererOrigin)) origin = refererOrigin
  } catch {}

  // state CSRF: nonce assinado (HMAC) devolvido pelo Google no callback e
  // validado ali sem depender de sessão/cookie. Sem ele, um atacante poderia
  // forjar o callback (login CSRF), logando a vítima numa conta controlada por ele.
  const state = gerarGoogleOAuthState(origin ? { origin } : {})

  const url = `https://accounts.google.com/o/oauth2/v2/auth` +
    `?client_id=${process.env.GOOGLE_CLIENT_ID}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&response_type=code` +
    `&scope=${encodeURIComponent(scopes)}` +
    `&state=${state}` +
    `&prompt=select_account`

  res.redirect(url)
})

// ─── "Conectar com Google" no picker de IA (Gemini) ─────────────────────────
// O Gemini/Generative Language API não aceita OAuth de usuário como forma de
// autenticação — só API key (ou Vertex AI com service account, fora do escopo
// aqui). Este fluxo NÃO substitui a API key: só identifica qual conta Google
// o usuário quer usar, roda num popup (não navega a página principal) e, ao
// confirmar, devolve o e-mail via postMessage para o front abrir o passo a
// passo de gerar a chave no AI Studio já com a conta certa em mente.
router.get('/google-connect', (req, res) => {
  const redirectUri = process.env.GOOGLE_LOGIN_REDIRECT_URI
  const scopes = ['openid', 'email', 'profile'].join(' ')
  const state = gerarGoogleOAuthState({ purpose: 'ai-connect' })

  const url = `https://accounts.google.com/o/oauth2/v2/auth` +
    `?client_id=${process.env.GOOGLE_CLIENT_ID}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&response_type=code` +
    `&scope=${encodeURIComponent(scopes)}` +
    `&state=${state}` +
    `&prompt=select_account`

  res.redirect(url)
})

// Página mínima que o popup do "Conectar com Google" (ai-connect) carrega ao
// terminar — avisa a janela que abriu o popup (window.opener) via postMessage
// e se fecha sozinha. Não navega/substitui a página principal do app.
// Backend (Railway) e frontend (Vercel) ficam em origins diferentes, então o
// postMessage precisa mirar explicitamente a origin do FRONTEND_URL — usar
// window.location.origin aqui apontaria para a origin do próprio backend.
function paginaPopupAiConnect({ ok, email, erro }) {
  const payload = JSON.stringify({ type: 'google-connect-result', ok, email: email || null, erro: erro || null })
  const targetOrigin = JSON.stringify(process.env.FRONTEND_URL || '*')
  return `<!DOCTYPE html><html><body style="font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#0f1117;color:#fff">
    <p>${ok ? 'Conta conectada! Fechando...' : 'Não foi possível conectar. Fechando...'}</p>
    <script>
      if (window.opener) window.opener.postMessage(${payload}, ${targetOrigin});
      window.close();
    </script>
  </body></html>`
}

router.get('/google/callback', async (req, res) => {
  const { code, error, state } = req.query

  // Extrai o domínio de origem do state (se presente e ainda válido) antes
  // de qualquer redirect de erro, para devolver o usuário ao mesmo domínio
  // de onde o login começou em vez de sempre cair no FRONTEND_URL padrão.
  let origin = null
  try { origin = verificarGoogleOAuthState(state)?.origin || null } catch {}

  if (error) {
    return res.send(friendlyAuthError('Login com Google cancelado.', origin))
  }

  // Valida a assinatura/expiração do state (proteção CSRF) sem depender de
  // sessão/cookie — o nonce viaja assinado dentro do próprio parâmetro.
  let stateData
  try {
    stateData = verificarGoogleOAuthState(state)
  } catch {
    return res.send(friendlyAuthError('Sessão de login inválida ou expirada. Tente novamente.', origin))
  }
  const isAiConnect = stateData?.purpose === 'ai-connect'

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

    if (isAiConnect) {
      // Fluxo "Conectar com Google" do picker de IA: só confirma o e-mail da
      // conta e devolve pro popup — não cria/loga usuário, não mexe em sessão.
      if (tokenData.error || !tokenData.access_token) {
        return res.send(paginaPopupAiConnect({ ok: false, erro: 'Não foi possível confirmar a conta Google.' }))
      }
      const profileRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${tokenData.access_token}` }
      })
      const profile = await profileRes.json()
      if (!profile.email) {
        return res.send(paginaPopupAiConnect({ ok: false, erro: 'Não foi possível obter o e-mail da conta Google.' }))
      }
      if (!isAllowedEmail(profile.email)) {
        return res.send(paginaPopupAiConnect({ ok: false, erro: `Use uma conta Google com e-mail ${allowedEmailDomainLabel()}.` }))
      }
      return res.send(paginaPopupAiConnect({ ok: true, email: profile.email }))
    }

    if (tokenData.error || !tokenData.access_token) {
      addLog('err', `Erro ao obter token de login Google: ${safeStringify(tokenData)}`)
      return res.send(friendlyAuthError('Não foi possível entrar com o Google agora. Tente novamente em alguns minutos.', origin))
    }

    const profileRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` }
    })
    const profile = await profileRes.json()

    if (!profile.email) {
      return res.send(friendlyAuthError('Não foi possível obter seu e-mail do Google.', origin))
    }
    if (!isAllowedEmail(profile.email)) {
      return res.send(friendlyAuthError(`Use um e-mail ${allowedEmailDomainLabel()} para acessar a aplicação.`, origin))
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

    // Provisionamento invisível e idempotente: o usuário continua podendo
    // entrar mesmo se a API externa estiver indisponível neste momento.
    void bestEffortEnsureZernioProfile(user.id)

    const baseUrl = origin || process.env.FRONTEND_URL || ''

    if (user.totp_enabled) {
      addLog('ok', 'Login com Google confirmado, aguardando código 2FA', null, null, user.id)
      issuePending2fa(res, user.id)
      return res.redirect(baseUrl + '/verify-2fa.html')
    }

    addLog('ok', 'Login com Google realizado com sucesso', null, null, user.id)
    await revokeSessions(user.id)
    issueAuthSession(res, user.id)
    res.redirect(baseUrl + '/app.html')
  } catch (err) {
    addLog('err', `Falha no login com Google: ${safeMessage(err.message)}`)
    res.send(friendlyAuthError('Não foi possível entrar com o Google agora. Tente novamente em alguns minutos.', origin))
  }
})

module.exports = router
