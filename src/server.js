require('dotenv').config()
const express  = require('express')
const path     = require('path')
const session  = require('express-session')
const pgSession = require('connect-pg-simple')(session)

const pool           = require('./db/pool')
const accountsRoutes = require('./routes/accounts')
const tokensRoutes   = require('./routes/tokens')
const logsRoutes     = require('./routes/logs')
const postsRoutes    = require('./routes/posts')
const oauthRoutes    = require('./routes/oauth')
const authRoutes     = require('./routes/auth')
const adminRoutes    = require('./routes/admin')
const requireAuth    = require('./middleware/requireAuth')
const requireAdmin   = require('./middleware/requireAdmin')
const scheduler      = require('./services/scheduler')
const { validarTokenMedia } = require('./services/mediaToken')

const app = express()
app.disable('x-powered-by')

// O app fica atrás do túnel ngrok (HTTPS termina no ngrok, e o tráfego chega
// ao processo Node como HTTP puro com o header X-Forwarded-Proto/X-Forwarded-For).
// Sem isso, o Express não confia nesses headers: req.secure fica sempre false
// (quebrando cookies com secure:true) e o express-rate-limit rejeita a
// requisição inteira por ver X-Forwarded-For sem confiar nele
// (ERR_ERL_UNEXPECTED_X_FORWARDED_FOR). trust proxy = 1 confia no primeiro
// proxy na frente (o ngrok), que é a única camada entre o cliente e este processo.
app.set('trust proxy', 1)

// Cabeçalhos básicos de segurança (sem dependências extras)
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
  if (req.secure) res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains')
  next()
})

app.use(express.json({ limit: '1mb' }))

app.use(session({
  store: new pgSession({ pool, tableName: 'session' }),
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  proxy: true,
  // secure:true exige HTTPS para o navegador enviar o cookie de volta — com
  // trust proxy=1, req.secure passa a refletir corretamente o X-Forwarded-Proto
  // do ngrok, então isso agora é seguro de habilitar (antes, sem trust proxy,
  // o cookie secure nunca seria reenviado e a sessão "expirava" a cada request).
  cookie: { maxAge: 30 * 24 * 60 * 60 * 1000, httpOnly: true, sameSite: 'lax', secure: 'auto' }
}))

app.use('/auth/login', authRoutes)

// As rotas de OAuth (incluindo os callbacks navegados pelo provedor externo)
// ficam fora do requireAuth global: o callback não tem garantia de que o
// cookie de sessão chega na requisição de retorno (popup + redirect
// cross-site), então a autenticação é validada por rota dentro de oauth.js
// via state assinado, não pelo middleware aqui.
app.use('/auth', oauthRoutes)
app.use('/oauth', oauthRoutes)

app.get('/admin.html', requireAuth, requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, '../public/admin.html'))
})

// Mídia enviada pelos usuários (fotos/vídeos de posts) normalmente só pode
// ser acessada por quem está autenticado. Exceção: um link assinado de curta
// duração (?token=...), gerado só na hora de publicar — é assim que
// Instagram/TikTok conseguem baixar a imagem/vídeo, já que essas APIs
// buscam a mídia direto por URL pública, sem enviar nosso cookie de sessão.
app.use('/uploads', (req, res, next) => {
  const filename = path.basename(req.path)
  if (validarTokenMedia(filename, req.query.token)) return next()
  requireAuth(req, res, next)
}, express.static(path.join(__dirname, '../public/uploads')))

app.use(express.static(path.join(__dirname, '../public'), { index: false }))

app.get('/api/config', (req, res) => {
  res.json({
    googleClientId: process.env.GOOGLE_CLIENT_ID || null,
    googleApiKey: process.env.GOOGLE_API_KEY || null
  })
})

app.use(requireAuth)

app.get('/api/me', (req, res) => {
  res.json({ id: req.user.id, email: req.user.email, role: req.user.role, fullName: req.user.fullName })
})

app.use('/api/accounts', accountsRoutes)
app.use('/api/tokens',   tokensRoutes)
app.use('/api/logs',     logsRoutes)
app.use('/api/posts',    postsRoutes)
app.use('/api/admin',    requireAdmin, adminRoutes)

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'))
})

// Error handler global — nunca expõe stack traces ao cliente
app.use((err, req, res, next) => {
  console.error(err)
  if (res.headersSent) return next(err)
  const status = err.status || err.statusCode || 500
  if (status >= 500) return res.status(500).json({ erro: 'Erro interno do servidor' })
  res.status(status).json({ erro: err.message || 'Requisição inválida' })
})

const PORT = process.env.PORT || 3000
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Servidor rodando em http://localhost:${PORT}`)
  console.log(`   Acesso na rede local: http://${process.env.LAN_IP || '0.0.0.0'}:${PORT}`)
  scheduler.start()
})