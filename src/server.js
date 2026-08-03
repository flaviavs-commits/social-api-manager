require('dotenv').config()
const express  = require('express')
const path     = require('path')
const cors     = require('cors')

const compression    = require('compression')
const pool           = require('./db/pool')
const accountsRoutes = require('./routes/accounts')
const tokensRoutes   = require('./routes/tokens')
const logsRoutes     = require('./routes/logs')
const postsRoutes    = require('./http/routes/posts')
const oauthRoutes    = require('./routes/oauth')
const authRoutes     = require('./routes/auth')
const adminRoutes    = require('./routes/admin')
const meRoutes       = require('./routes/me')
const requireAuth    = require('./middleware/requireAuth')
const requireAdmin   = require('./middleware/requireAdmin')
const cronRoutes     = require('./routes/cron')
const draftsRoutes   = require('./routes/drafts')
const savedTextsRoutes = require('./routes/savedTexts')
const platformPresetsRoutes = require('./routes/platformPresets')
const pushRoutes     = require('./routes/push')
const aiRoutes       = require('./routes/ai')
const scheduler      = require('./services/scheduler')
const { validarTokenMedia } = require('./infra/storage/mediaToken')
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
const allowedOrigins = (process.env.FRONTEND_ORIGIN || '').split(',').map(value => value.trim()).filter(Boolean)
app.use(cors({
  origin: allowedOrigins.length ? allowedOrigins : true,
  methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  maxAge: 86400
}))
app.use(compression())

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
  // /app.html é o próprio front, lendo o token salvo no localStorage.

  // Modo de revisão (TikTok): quando TIKTOK_REVIEW_MODE=true e há um usuário
  // demo configurado, o app abre direto no painel sem tela de login — o
  // avaliador acessa a URL e já vê o dashboard funcionando, como exigido pela
  // revisão. O auto-login entra SOMENTE na conta demo isolada (nunca em dados
  // reais de outros usuários), e a flag deve ser desligada após a aprovação.
  if (process.env.TIKTOK_REVIEW_MODE === 'true' && process.env.TIKTOK_REVIEW_USER_ID) {
    const token = gerarTokenSessao(Number(process.env.TIKTOK_REVIEW_USER_ID))
    return res.redirect((process.env.FRONTEND_URL || '') + '/app.html?token=' + encodeURIComponent(token))
  }

  res.sendFile(path.join(__dirname, '../public/react/index.html'))
})

// Páginas legais públicas (exigência da revisão do TikTok: ToS e Privacy
// Policy precisam estar no mesmo domínio do app, não em hospedagem externa).
app.get('/privacy-policy', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/privacy-policy.html'))
})
app.get('/terms-of-service', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/terms-of-service.html'))
})
app.get('/support', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/support.html'))
})
app.get('/sobre', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/react/index.html'))
})

// O dashboard React é servido pela mesma URL pública do produto. O arquivo
// legado permanece disponível apenas como referência durante a migração.
app.get('/app.html', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/react/index.html'))
})

app.use(express.static(path.join(__dirname, '../public'), { index: false }))

app.get('/api/config', (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=300')
  res.json({
    googleClientId: process.env.GOOGLE_CLIENT_ID || null,
    googleApiKey: process.env.GOOGLE_API_KEY || null,
    facebookAppId: process.env.META_APP_ID || null,
    reviewMode: process.env.TIKTOK_REVIEW_MODE === 'true'
  })
})

// Endpoint público: retorna um token de sessão temporário para o avaliador do
// TikTok entrar sem precisar de login. Só funciona quando TIKTOK_REVIEW_MODE=true.
// Não expõe senha nem dados reais — o user_id apontado deve ser uma conta demo isolada.
app.get('/api/review-token', (req, res) => {
  if (process.env.TIKTOK_REVIEW_MODE === 'true' && process.env.TIKTOK_REVIEW_USER_ID) {
    return res.json({ token: gerarTokenSessao(Number(process.env.TIKTOK_REVIEW_USER_ID)) })
  }
  // Modo de revisão geral (Google) — REVIEW_MODE_NO_AUTH=true já libera a API
  // inteira sem token em requireAuth; aqui só evita o front-end redirecionar
  // pra /login.html antes de qualquer chamada de API rodar.
  if (process.env.REVIEW_MODE_NO_AUTH === 'true') {
    return res.json({ token: gerarTokenSessao(Number(process.env.REVIEW_MODE_USER_ID) || 0) })
  }
  return res.status(404).json({ erro: 'não disponível' })
})

app.use(requireAuth)

app.get('/api/me', (req, res) => {
  res.setHeader('Cache-Control', 'private, max-age=30')
  res.json({ id: req.user.id, email: req.user.email, role: req.user.role, fullName: req.user.fullName, avatarUrl: req.user.avatarUrl, totpEnabled: req.user.totpEnabled })
})

app.use('/api/me',       meRoutes)
app.use('/api/accounts', accountsRoutes)
app.use('/api/tokens',   tokensRoutes)
app.use('/api/logs',     logsRoutes)
app.use('/api/posts',    postsRoutes)
app.use('/api/admin',    requireAdmin, adminRoutes)
app.use('/api/drafts',   draftsRoutes)
app.use('/api/saved-texts', savedTextsRoutes)
app.use('/api/platform-presets', platformPresetsRoutes)
app.use('/api/push',     pushRoutes)
app.use('/api/ai',       aiRoutes)

app.get('/api/platform-health', async (req, res) => {
  const { getStatusMap } = require('./services/platformHealth')
  res.json({ platforms: await getStatusMap() })
})

// Endpoint técnico, independente de autenticação, usado por Railway/Vercel
// e por monitores externos para validar que o processo HTTP está de pé.
app.get('/health', (_req, res) => res.status(200).json({ status: 'ok', service: 'social-api-manager' }))

// A API nunca deve devolver HTML para uma rota inexistente.
app.use('/api', (_req, res) => res.status(404).json({ erro: 'Endpoint não encontrado' }))

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/app.html'))
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
  await Promise.all([
    // Texto diferente por rede social no mesmo post (Agendador manual) —
    // opcional, coluna text legada continua sendo gravada sempre como
    // fallback. Ver migrations/029.
    pool.query(`ALTER TABLE posts ADD COLUMN IF NOT EXISTS text_by_platform JSONB`).catch(() => {}),
    // Categoria do vídeo no YouTube — opcional, ver migrations/030.
    pool.query(`ALTER TABLE posts ADD COLUMN IF NOT EXISTS youtube_category_id TEXT`).catch(() => {}),
    // Formato explícito de publicação (Instagram post/reel/story, YouTube
    // video/short) — opcional, ver migrations/031.
    pool.query(`ALTER TABLE posts ADD COLUMN IF NOT EXISTS ig_format TEXT`).catch(() => {}),
    pool.query(`ALTER TABLE posts ADD COLUMN IF NOT EXISTS youtube_format TEXT`).catch(() => {}),
    // Opções de publicação do TikTok exigidas pelas Content Sharing Guidelines
    // (privacidade sem default + interações permitidas escolhidas pelo
    // usuário, não decididas sozinhas pelo backend) — ver migrations/034.
    pool.query(`ALTER TABLE posts ADD COLUMN IF NOT EXISTS tiktok_privacy_level TEXT`).catch(() => {}),
    pool.query(`ALTER TABLE posts ADD COLUMN IF NOT EXISTS tiktok_disable_comment BOOLEAN`).catch(() => {}),
    pool.query(`ALTER TABLE posts ADD COLUMN IF NOT EXISTS tiktok_disable_duet BOOLEAN`).catch(() => {}),
    pool.query(`ALTER TABLE posts ADD COLUMN IF NOT EXISTS tiktok_disable_stitch BOOLEAN`).catch(() => {}),
    // Retry automático de publicação com falha transitória (5xx/rate limit) —
    // ver migrations/036. retry_count conta tentativas já feitas (máx. 3,
    // ver services/scheduler.js); next_retry_at é quando o próximo tick do
    // cron deve tentar de novo (backoff exponencial). Ambos ficam NULL/0 para
    // posts que nunca falharam — comportamento idêntico ao de antes desta
    // coluna existir.
    pool.query(`ALTER TABLE posts ADD COLUMN IF NOT EXISTS retry_count INTEGER NOT NULL DEFAULT 0`).catch(() => {}),
    pool.query(`ALTER TABLE posts ADD COLUMN IF NOT EXISTS next_retry_at TIMESTAMPTZ`).catch(() => {}),
    // Biblioteca de textos salvos (botão "textos salvos" no editor) — ver
    // migrations/037.
    pool.query(`
      CREATE TABLE IF NOT EXISTS saved_texts (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title TEXT,
        body TEXT NOT NULL,
        criado_em TIMESTAMPTZ DEFAULT NOW()
      )
    `).catch(() => {}),
    // Localização (Facebook/Instagram) e primeiro comentário automático
    // (Facebook/Instagram/YouTube) — ver migrations/037.
    pool.query(`ALTER TABLE posts ADD COLUMN IF NOT EXISTS location_id TEXT`).catch(() => {}),
    pool.query(`ALTER TABLE posts ADD COLUMN IF NOT EXISTS location_name TEXT`).catch(() => {}),
    pool.query(`ALTER TABLE posts ADD COLUMN IF NOT EXISTS first_comment TEXT`).catch(() => {}),
    // Presets de configuração de publicação por rede (ex: privacidade padrão
    // do TikTok) — ver migrations/038.
    pool.query(`
      CREATE TABLE IF NOT EXISTS platform_presets (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        platform TEXT NOT NULL,
        name TEXT NOT NULL,
        config JSONB NOT NULL DEFAULT '{}',
        criado_em TIMESTAMPTZ DEFAULT NOW()
      )
    `).catch(() => {}),
    pool.query(`
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
    `).then(() => Promise.all([
      // Texto e mídia próprios por rede (mesmo conceito de posts.textByPlatform
      // e post_accounts.media_items) — sem isso, salvar um post com conteúdo
      // diferente por rede como template perdia essa diferenciação ao reaplicar.
      pool.query(`ALTER TABLE drafts ADD COLUMN IF NOT EXISTS text_by_platform JSONB`).catch(() => {}),
      pool.query(`ALTER TABLE drafts ADD COLUMN IF NOT EXISTS media_by_platform JSONB`).catch(() => {}),
      // Formato por rede, opções do TikTok, localização e primeiro comentário
      // — mesmos campos do post real (posts.*), replicados aqui para o
      // rascunho/template não perder essas configurações ao ser reaplicado.
      // Ver migrations/039.
      pool.query(`ALTER TABLE drafts ADD COLUMN IF NOT EXISTS ig_format TEXT`).catch(() => {}),
      pool.query(`ALTER TABLE drafts ADD COLUMN IF NOT EXISTS youtube_format TEXT`).catch(() => {}),
      pool.query(`ALTER TABLE drafts ADD COLUMN IF NOT EXISTS youtube_category_id TEXT`).catch(() => {}),
      pool.query(`ALTER TABLE drafts ADD COLUMN IF NOT EXISTS youtube_made_for_kids TEXT`).catch(() => {}),
      pool.query(`ALTER TABLE drafts ADD COLUMN IF NOT EXISTS tiktok_privacy_level TEXT`).catch(() => {}),
      pool.query(`ALTER TABLE drafts ADD COLUMN IF NOT EXISTS tiktok_disable_comment BOOLEAN`).catch(() => {}),
      pool.query(`ALTER TABLE drafts ADD COLUMN IF NOT EXISTS tiktok_disable_duet BOOLEAN`).catch(() => {}),
      pool.query(`ALTER TABLE drafts ADD COLUMN IF NOT EXISTS tiktok_disable_stitch BOOLEAN`).catch(() => {}),
      pool.query(`ALTER TABLE drafts ADD COLUMN IF NOT EXISTS location_id TEXT`).catch(() => {}),
      pool.query(`ALTER TABLE drafts ADD COLUMN IF NOT EXISTS location_name TEXT`).catch(() => {}),
      pool.query(`ALTER TABLE drafts ADD COLUMN IF NOT EXISTS first_comment TEXT`).catch(() => {}),
    ])),
    pool.query(`
      CREATE TABLE IF NOT EXISTS push_subscriptions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        endpoint TEXT UNIQUE NOT NULL,
        p256dh TEXT,
        auth TEXT,
        criado_em TIMESTAMPTZ DEFAULT NOW()
      )
    `),
    pool.query(`
      CREATE TABLE IF NOT EXISTS inbox_seen_comments (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
        seen_ids TEXT[] DEFAULT '{}',
        atualizado_em TIMESTAMPTZ DEFAULT NOW(),
        PRIMARY KEY (user_id, post_id)
      )
    `),
    pool.query(`
      CREATE TABLE IF NOT EXISTS ai_memory (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        model TEXT NOT NULL,
        tipo TEXT NOT NULL,
        conteudo TEXT NOT NULL,
        resolvido BOOLEAN DEFAULT FALSE,
        criado_em TIMESTAMPTZ DEFAULT NOW(),
        lembrar_em TIMESTAMPTZ
      )
    `),
    pool.query(`
      CREATE INDEX IF NOT EXISTS idx_credentials_user_id ON credentials (user_id);
    `).catch(() => {}),
    pool.query(`
      CREATE INDEX IF NOT EXISTS idx_credentials_reset_token ON credentials (reset_token) WHERE reset_token IS NOT NULL;
    `).catch(() => {}),
    pool.query(`
      CREATE INDEX IF NOT EXISTS idx_posts_published_no_external ON posts (status, criado_em DESC) WHERE status = 'published' AND external_post_id IS NULL;
    `).catch(() => {}),
    pool.query(`
      CREATE INDEX IF NOT EXISTS idx_posts_instagram_pending ON posts (id) WHERE instagram_pending IS NOT NULL;
    `).catch(() => {}),
    // Relação N:M entre post e conta: um post publica em TODAS as contas
    // conectadas de cada rede marcada (ex.: 2 perfis de Instagram no mesmo
    // post). instagram_pending é por (post, conta) — cada uma tem sua própria
    // pendência de processamento assíncrono, independente das demais. Ver
    // migrations/027.
    (async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS post_accounts (
          id SERIAL PRIMARY KEY,
          post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
          account_id INTEGER NOT NULL REFERENCES contas(id) ON DELETE CASCADE,
          instagram_pending JSONB,
          criado_em TIMESTAMPTZ DEFAULT NOW(),
          UNIQUE (post_id, account_id)
        )
      `).catch(() => {})
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_post_accounts_post_id ON post_accounts(post_id)`).catch(() => {})
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_post_accounts_pending ON post_accounts(id) WHERE instagram_pending IS NOT NULL`).catch(() => {})
      // Mídia independente por rede social — NULL = usa a mídia compartilhada
      // do post (comportamento legado, sem quebrar posts/cron já em voo).
      // Ver migrations/035 e src/infra/social/publisher.js (publicarNaConta).
      await pool.query(`ALTER TABLE post_accounts ADD COLUMN IF NOT EXISTS media_items JSONB`).catch(() => {})
      // Backfill: posts antigos (schema com account_id singular) viram 1 linha aqui.
      await pool.query(`
        INSERT INTO post_accounts (post_id, account_id)
        SELECT id, account_id FROM posts WHERE account_id IS NOT NULL
        ON CONFLICT (post_id, account_id) DO NOTHING
      `).catch(() => {})
    })().catch(() => {}),
    // Uma linha por (post, rede, conta): um post pode ser publicado em várias
    // redes e em várias contas da mesma rede, e cada uma precisa preservar seu
    // próprio external_post_id para o Analytics mostrar métricas de todas (o
    // schema antigo só guardava um por post+rede, sobrescrito ao publicar em
    // paralelo, e depois um por post+rede+conta). Ver migrations/015 e /028.
    pool.query(`
      CREATE TABLE IF NOT EXISTS post_publications (
        id SERIAL PRIMARY KEY,
        post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
        platform TEXT NOT NULL,
        external_post_id TEXT,
        published_at TIMESTAMPTZ DEFAULT NOW(),
        account_id INTEGER REFERENCES contas(id) ON DELETE SET NULL
      )
    `).then(() => Promise.all([
      pool.query(`CREATE INDEX IF NOT EXISTS idx_post_publications_post_id ON post_publications(post_id)`).catch(() => {}),
      pool.query(`ALTER TABLE post_publications ADD COLUMN IF NOT EXISTS account_id INTEGER REFERENCES contas(id) ON DELETE SET NULL`).catch(() => {}),
      pool.query(`ALTER TABLE post_publications DROP CONSTRAINT IF EXISTS post_publications_post_id_platform_key`).catch(() => {}),
      pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS post_publications_post_platform_account
        ON post_publications (post_id, platform, account_id) WHERE account_id IS NOT NULL`).catch(() => {}),
      // Backfill dos IDs já salvos no schema antigo (uma vez; ON CONFLICT evita duplicar).
      pool.query(`
        INSERT INTO post_publications (post_id, platform, external_post_id, published_at)
        SELECT id, external_platform, external_post_id, published_at
        FROM posts
        WHERE external_post_id IS NOT NULL AND external_platform IS NOT NULL
        ON CONFLICT DO NOTHING
      `).catch(() => {}),
      // Controle do primeiro comentário automático — depende de
      // post_publications já existir (FK), por isso encadeado aqui em vez de
      // no Promise.all paralelo do topo. Ver migrations/037.
      pool.query(`
        CREATE TABLE IF NOT EXISTS post_first_comments (
          id SERIAL PRIMARY KEY,
          post_publication_id INTEGER NOT NULL REFERENCES post_publications(id) ON DELETE CASCADE,
          status TEXT NOT NULL DEFAULT 'pending',
          error_message TEXT,
          criado_em TIMESTAMPTZ DEFAULT NOW(),
          atualizado_em TIMESTAMPTZ DEFAULT NOW(),
          UNIQUE (post_publication_id)
        )
      `).catch(() => {}),
    ])).catch(() => {}),
    // Snapshot de métricas passa a ser por (post, rede): um post em várias
    // redes precisa de histórico separado por rede, senão uma sobrescreve a
    // outra no mesmo dia. Adiciona a coluna platform e troca a unique key.
    // Idempotente — só roda o que ainda falta. Ver migrations/016.
    (async () => {
      await pool.query(`CREATE TABLE IF NOT EXISTS post_metrics_history (
        id SERIAL PRIMARY KEY,
        post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
        captured_on DATE NOT NULL DEFAULT CURRENT_DATE,
        likes INTEGER, comments INTEGER, views INTEGER
      )`).catch(() => {})
      await pool.query(`ALTER TABLE post_metrics_history ADD COLUMN IF NOT EXISTS platform TEXT`).catch(() => {})
      // Preenche a rede das linhas antigas com a rede legada do post; o que
      // sobrar (post sem external_platform) recebe 'unknown' para não colidir
      // no índice único novo.
      await pool.query(`UPDATE post_metrics_history h SET platform = COALESCE(p.external_platform, 'unknown')
        FROM posts p WHERE h.post_id = p.id AND h.platform IS NULL`).catch(() => {})
      await pool.query(`UPDATE post_metrics_history SET platform = 'unknown' WHERE platform IS NULL`).catch(() => {})
      await pool.query(`ALTER TABLE post_metrics_history DROP CONSTRAINT IF EXISTS post_metrics_history_post_id_captured_on_key`).catch(() => {})
      await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS post_metrics_history_post_platform_day
        ON post_metrics_history (post_id, platform, captured_on)`).catch(() => {})
    })().catch(() => {}),
  ])
}

// Rede de segurança: uma promise rejeitada sem catch (ex.: erro de banco numa
// rota) derrubava o processo inteiro e reiniciava o servidor em loop. Logar e
// seguir vivo é preferível a cair — a requisição que falhou já respondeu erro
// pelo error handler do Express; o resto do servidor não deve morrer junto.
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection:', reason)
})
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err)
})

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
