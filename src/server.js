require('dotenv').config()
const express  = require('express')
const path     = require('path')

const accountsRoutes = require('./routes/accounts')
const tokensRoutes   = require('./routes/tokens')
const logsRoutes     = require('./routes/logs')
const postsRoutes    = require('./routes/posts')
const oauthRoutes    = require('./routes/oauth')
const scheduler      = require('./services/scheduler')

const app = express()
app.disable('x-powered-by')

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
app.use(express.static(path.join(__dirname, '../public')))

app.get('/api/config', (req, res) => {
  res.json({
    googleClientId: process.env.GOOGLE_CLIENT_ID || null,
    googleApiKey: process.env.GOOGLE_API_KEY || null
  })
})

app.use('/api/accounts', accountsRoutes)
app.use('/api/tokens',   tokensRoutes)
app.use('/api/logs',     logsRoutes)
app.use('/api/posts',    postsRoutes)
app.use('/auth',         oauthRoutes)
app.use('/oauth',        oauthRoutes)

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