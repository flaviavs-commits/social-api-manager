require('dotenv').config()
const express  = require('express')
const path     = require('path')
const cors     = require('cors')

const pool           = require('./db/pool')
const accountsRoutes = require('./routes/accounts')
const tokensRoutes   = require('./routes/tokens')
const logsRoutes     = require('./routes/logs')
const postsRoutes    = require('./routes/posts')
const oauthRoutes    = require('./routes/oauth')
const authRoutes     = require('./routes/auth')
const adminRoutes    = require('./routes/admin')
const meRoutes       = require('./routes/me')
const requireAuth    = require('./middleware/requireAuth')
const requireAdmin   = require('./middleware/requireAdmin')
const cronRoutes     = require('./routes/cron')
const draftsRoutes   = require('./routes/drafts')
const pushRoutes     = require('./routes/push')
const aiRoutes       = require('./routes/ai')
const scheduler      = require('./services/scheduler')
const { validarTokenMedia } = require('./services/mediaToken')
const { gerarTokenSessao } = require('./utils/authToken')

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

// Frontend (Vercel) e backend (Railway) são domínios diferentes — a
// autenticação viaja via Bearer token, não cookie, então não precisa de
// credentials:true aqui (sem cookies envolvidos na requisição cross-origin).
app.use(cors({ origin: (process.env.FRONTEND_ORIGIN || '').split(',').filter(Boolean) }))

// Cabeçalhos básicos de segurança (sem dependências extras)
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
  if (req.secure) res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains')
  next()
})

// O webhook do TikTok precisa do corpo bruto (raw body) para validar a
// assinatura HMAC antes do parse — capturado aqui, antes do express.json()
// global consumir o stream, e reusado em oauthRoutes via req.rawBody.
app.use('/oauth/tiktok/webhook', express.json({
  verify: (req, _res, buf) => { req.rawBody = buf }
}))

app.use(express.json({ limit: '1mb' }))

app.use('/auth/login', authRoutes)

// As rotas de OAuth (incluindo os callbacks navegados pelo provedor externo)
// ficam fora do requireAuth global: o callback não tem garantia de que o
// cookie de sessão chega na requisição de retorno (popup + redirect
// cross-site), então a autenticação é validada por rota dentro de oauth.js
// via state assinado, não pelo middleware aqui.
app.use('/auth', oauthRoutes)
app.use('/oauth', oauthRoutes)

// Disparado pela infra de cron da Vercel (vercel.json) via requisição HTTP
// comum — autenticado pelo header Authorization (CRON_SECRET), não por
// sessão de usuário, então fica fora do requireAuth global.
app.use('/api/cron', cronRoutes)

// Bearer token não viaja em navegação simples, então o HTML em si não pode
// mais ser bloqueado no servidor — a página carrega vazia para quem não tem
// token, e as chamadas de API por baixo (apiFetch('/api/admin/...')) são
// quem de fato exige token + role admin, redirecionando no 401/403.
app.get('/admin.html', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/admin.html'))
})

// Mídia enviada pelos usuários (fotos/vídeos de posts). Acesso exige o link
// assinado de curta duração (?token=...), gerado na hora de publicar — é
// assim que Instagram/TikTok conseguem baixar a imagem/vídeo, já que essas
// APIs buscam a mídia direto por URL pública, sem cabeçalho de autenticação.
// O fallback por sessão de usuário saiu: Bearer token não viaja em
// requisições simples como <img src>, então sem o token assinado o acesso é negado.
app.use('/uploads', (req, res, next) => {
  const filename = path.basename(req.path)
  if (validarTokenMedia(filename, req.query.token)) return next()
  res.status(403).end()
}, express.static(path.join(__dirname, '../public/uploads')))

// Repassa um arquivo do Vercel Blob através do nosso próprio domínio (já
// verificado no TikTok) — necessário porque o domínio do Blob
// (*.public.blob.vercel-storage.com) não pode ser verificado em "Verify
// domains" (DNS de terceiro, fora do nosso controle). Só usado para enviar
// fotos ao TikTok via pull_by_url; outras plataformas continuam recebendo a
// URL do Blob direto.
// A URL real do Blob vem codificada em base64url no path (não em query
// string), porque o TikTok rejeita URLs com ?params na validação de
// pull_from_url. O último segmento carrega a extensão real do arquivo (.jpg
// etc) só para o TikTok reconhecer o tipo — o que importa é o base64url antes
// dela.
app.get('/media-proxy/:token/:encoded', async (req, res) => {
  const { token, encoded } = req.params
  const base64 = encoded.replace(/\.[^.]+$/, '') // remove a extensão do fim
  let url
  try {
    url = Buffer.from(base64, 'base64url').toString('utf8')
  } catch {
    return res.status(400).end()
  }

  if (!validarTokenMedia(url, token)) return res.status(403).end()

  // Defense-in-depth contra SSRF: além do token HMAC (que só nós assinamos),
  // restringe o destino a HTTPS no domínio do Vercel Blob. Sem isso, se o
  // SESSION_SECRET vazasse ou houvesse bug na validação, o proxy viraria um
  // SSRF capaz de alcançar localhost/metadata interna da infra.
  let parsed
  try {
    parsed = new URL(url)
  } catch {
    return res.status(400).end()
  }
  if (parsed.protocol !== 'https:' || !parsed.hostname.endsWith('.public.blob.vercel-storage.com')) {
    return res.status(403).end()
  }

  const upstream = await fetch(url)
  if (!upstream.ok) return res.status(502).end()

  res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/octet-stream')
  const buffer = Buffer.from(await upstream.arrayBuffer())
  res.send(buffer)
})

// Página pública explicando o que o app faz, quem mantém e como funciona —
// acessível sem login (exigência de revisores como o TikTok for Developers,
// que precisam entender o app sem precisar de uma conta). Quem já tem sessão
// válida vai direto para o painel, sem precisar passar por ela de novo.
app.get('/', (req, res) => {
  // Sem cookie de sessão para checar aqui (Bearer token não viaja em
  // navegação simples) — quem decide se já está logado e redireciona para
  // /index.html é o próprio front, lendo o token salvo no localStorage.

  // Modo de revisão (TikTok): quando TIKTOK_REVIEW_MODE=true e há um usuário
  // demo configurado, o app abre direto no painel sem tela de login — o
  // avaliador acessa a URL e já vê o dashboard funcionando, como exigido pela
  // revisão. O auto-login entra SOMENTE na conta demo isolada (nunca em dados
  // reais de outros usuários), e a flag deve ser desligada após a aprovação.
  if (process.env.TIKTOK_REVIEW_MODE === 'true' && process.env.TIKTOK_REVIEW_USER_ID) {
    const token = gerarTokenSessao(Number(process.env.TIKTOK_REVIEW_USER_ID))
    return res.redirect((process.env.FRONTEND_URL || '') + '/index.html?token=' + encodeURIComponent(token))
  }

  res.sendFile(path.join(__dirname, '../public/sobre.html'))
})

// Páginas legais públicas (exigência da revisão do TikTok: ToS e Privacy
// Policy precisam estar no mesmo domínio do app, não em hospedagem externa).
app.get('/privacy-policy', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/privacy-policy.html'))
})
app.get('/terms-of-service', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/terms-of-service.html'))
})

app.use(express.static(path.join(__dirname, '../public'), { index: false }))

app.get('/api/config', (req, res) => {
  res.json({
    googleClientId: process.env.GOOGLE_CLIENT_ID || null,
    googleApiKey: process.env.GOOGLE_API_KEY || null,
    reviewMode: process.env.TIKTOK_REVIEW_MODE === 'true'
  })
})

// Endpoint público: retorna um token de sessão temporário para o avaliador do
// TikTok entrar sem precisar de login. Só funciona quando TIKTOK_REVIEW_MODE=true.
// Não expõe senha nem dados reais — o user_id apontado deve ser uma conta demo isolada.
app.get('/api/review-token', (req, res) => {
  if (process.env.TIKTOK_REVIEW_MODE !== 'true' || !process.env.TIKTOK_REVIEW_USER_ID) {
    return res.status(404).json({ erro: 'não disponível' })
  }
  const token = gerarTokenSessao(Number(process.env.TIKTOK_REVIEW_USER_ID))
  res.json({ token })
})

app.use(requireAuth)

app.get('/api/me', (req, res) => {
  res.json({ id: req.user.id, email: req.user.email, role: req.user.role, fullName: req.user.fullName, avatarUrl: req.user.avatarUrl, totpEnabled: req.user.totpEnabled })
})

app.use('/api/me',       meRoutes)
app.use('/api/accounts', accountsRoutes)
app.use('/api/tokens',   tokensRoutes)
app.use('/api/logs',     logsRoutes)
app.use('/api/posts',    postsRoutes)
app.use('/api/admin',    requireAdmin, adminRoutes)
app.use('/api/drafts',   draftsRoutes)
app.use('/api/push',     pushRoutes)
app.use('/api/ai',       aiRoutes)

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

// Em serverless (Vercel) não há app.listen() — o api/index.js importa "app"
// direto e a plataforma cuida de invocar a função por requisição. Local
// (npm start) continua chamando .listen() normalmente.
// Migrations de novas tabelas — executado no startup para garantir que as
// tabelas existem sem exigir processo manual de migration.
async function runMigrations() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS drafts (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT,
      text TEXT,
      platforms TEXT[] DEFAULT '{}',
      media_path TEXT,
      media_type TEXT,
      media_items JSONB,
      youtube_title TEXT,
      youtube_visibility TEXT DEFAULT 'public',
      is_template BOOLEAN DEFAULT FALSE,
      criado_em TIMESTAMPTZ DEFAULT NOW()
    )
  `)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      endpoint TEXT UNIQUE NOT NULL,
      p256dh TEXT,
      auth TEXT,
      criado_em TIMESTAMPTZ DEFAULT NOW()
    )
  `)
}

if (require.main === module) {
  const PORT = process.env.PORT || 3000
  runMigrations().catch(err => console.error('Migration error:', err))
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Servidor rodando em http://localhost:${PORT}`)
    console.log(`   Acesso na rede local: http://${process.env.LAN_IP || '0.0.0.0'}:${PORT}`)
    scheduler.start()
  })
}

module.exports = app