const pool = require('./pool')

// Compatibilidade de inicialização para instalações que ainda não executaram
// todas as migrations versionadas. Cada operação é idempotente e falhas
// individuais não impedem o servidor de atender as demais rotas.
const bestEffort = query => pool.query(query).catch(() => undefined)

async function ensurePostAccounts() {
  await bestEffort(`
    CREATE TABLE IF NOT EXISTS post_accounts (
      id SERIAL PRIMARY KEY,
      post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      account_id INTEGER NOT NULL REFERENCES contas(id) ON DELETE CASCADE,
      instagram_pending JSONB,
      criado_em TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (post_id, account_id)
    )
  `)
  await bestEffort('CREATE INDEX IF NOT EXISTS idx_post_accounts_post_id ON post_accounts(post_id)')
  await bestEffort('CREATE INDEX IF NOT EXISTS idx_post_accounts_pending ON post_accounts(id) WHERE instagram_pending IS NOT NULL')
  await bestEffort('ALTER TABLE post_accounts ADD COLUMN IF NOT EXISTS media_items JSONB')
  await bestEffort(`
    INSERT INTO post_accounts (post_id, account_id)
    SELECT id, account_id FROM posts WHERE account_id IS NOT NULL
    ON CONFLICT (post_id, account_id) DO NOTHING
  `)
}

async function ensureMetricHistory() {
  await bestEffort(`
    CREATE TABLE IF NOT EXISTS post_metrics_history (
      id SERIAL PRIMARY KEY,
      post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      captured_on DATE NOT NULL DEFAULT CURRENT_DATE,
      likes INTEGER, comments INTEGER, views INTEGER
    )
  `)
  await bestEffort('ALTER TABLE post_metrics_history ADD COLUMN IF NOT EXISTS platform TEXT')
  await bestEffort(`UPDATE post_metrics_history h SET platform = COALESCE(p.external_platform, 'unknown') FROM posts p WHERE h.post_id = p.id AND h.platform IS NULL`)
  await bestEffort("UPDATE post_metrics_history SET platform = 'unknown' WHERE platform IS NULL")
  await bestEffort('ALTER TABLE post_metrics_history DROP CONSTRAINT IF EXISTS post_metrics_history_post_id_captured_on_key')
  await bestEffort('CREATE UNIQUE INDEX IF NOT EXISTS post_metrics_history_post_platform_day ON post_metrics_history (post_id, platform, captured_on)')
}

async function ensurePostPublications() {
  await bestEffort(`
    CREATE TABLE IF NOT EXISTS post_publications (
      id SERIAL PRIMARY KEY,
      post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      platform TEXT NOT NULL,
      external_post_id TEXT,
      published_at TIMESTAMPTZ DEFAULT NOW(),
      account_id INTEGER REFERENCES contas(id) ON DELETE SET NULL
    )
  `)
  await bestEffort('CREATE INDEX IF NOT EXISTS idx_post_publications_post_id ON post_publications(post_id)')
  await bestEffort('ALTER TABLE post_publications ADD COLUMN IF NOT EXISTS account_id INTEGER REFERENCES contas(id) ON DELETE SET NULL')
  await bestEffort('ALTER TABLE post_publications DROP CONSTRAINT IF EXISTS post_publications_post_id_platform_key')
  await bestEffort('CREATE UNIQUE INDEX IF NOT EXISTS post_publications_post_platform_account ON post_publications (post_id, platform, account_id) WHERE account_id IS NOT NULL')
  await bestEffort(`
    INSERT INTO post_publications (post_id, platform, external_post_id, published_at)
    SELECT id, external_platform, external_post_id, published_at
    FROM posts WHERE external_post_id IS NOT NULL AND external_platform IS NOT NULL
    ON CONFLICT DO NOTHING
  `)
  await bestEffort(`
    CREATE TABLE IF NOT EXISTS post_first_comments (
      id SERIAL PRIMARY KEY,
      post_publication_id INTEGER NOT NULL REFERENCES post_publications(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'pending',
      error_message TEXT,
      criado_em TIMESTAMPTZ DEFAULT NOW(),
      atualizado_em TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (post_publication_id)
    )
  `)
}

async function ensureAiTables() {
  await Promise.all([
    bestEffort(`CREATE TABLE IF NOT EXISTS user_ai_keys (id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, modelo TEXT NOT NULL, api_key TEXT NOT NULL, last_four TEXT, status TEXT NOT NULL DEFAULT 'valid', criado_em TIMESTAMPTZ DEFAULT NOW(), UNIQUE(user_id, modelo))`),
    bestEffort(`CREATE TABLE IF NOT EXISTS user_ai_prefs (user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, preferred_model TEXT NOT NULL, atualizado_em TIMESTAMPTZ DEFAULT NOW())`),
    bestEffort(`CREATE TABLE IF NOT EXISTS ai_demo_usage (user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, dia DATE NOT NULL, usos INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (user_id, dia))`),
    bestEffort(`CREATE TABLE IF NOT EXISTS ai_activity_log (id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id) ON DELETE SET NULL, acao TEXT NOT NULL, status TEXT NOT NULL, modelo TEXT, detalhes TEXT, criado_em TIMESTAMPTZ DEFAULT NOW())`),
    bestEffort(`CREATE TABLE IF NOT EXISTS ai_chat_messages (id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, contexto TEXT NOT NULL, role TEXT NOT NULL, conteudo TEXT NOT NULL, criado_em TIMESTAMPTZ DEFAULT NOW())`),
    bestEffort(`CREATE TABLE IF NOT EXISTS ai_image_leads (id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id) ON DELETE SET NULL, email TEXT NOT NULL, descricao TEXT, criado_em TIMESTAMPTZ DEFAULT NOW())`)
  ])
  await Promise.all([
    bestEffort('ALTER TABLE user_ai_keys ADD COLUMN IF NOT EXISTS last_four TEXT'),
    bestEffort("ALTER TABLE user_ai_keys ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'valid'"),
    bestEffort('CREATE INDEX IF NOT EXISTS idx_ai_chat_messages_user ON ai_chat_messages (user_id, criado_em DESC)')
  ])
}

async function runMigrations() {
  await Promise.all([
    bestEffort('ALTER TABLE posts ADD COLUMN IF NOT EXISTS text_by_platform JSONB'),
    bestEffort('ALTER TABLE posts ADD COLUMN IF NOT EXISTS title_by_platform JSONB'),
    bestEffort('ALTER TABLE posts ADD COLUMN IF NOT EXISTS youtube_category_id TEXT'),
    bestEffort('ALTER TABLE posts ADD COLUMN IF NOT EXISTS youtube_made_for_kids BOOLEAN'),
    bestEffort('ALTER TABLE posts ADD COLUMN IF NOT EXISTS ig_format TEXT'),
    bestEffort('ALTER TABLE posts ADD COLUMN IF NOT EXISTS youtube_format TEXT'),
    bestEffort('ALTER TABLE posts ADD COLUMN IF NOT EXISTS tiktok_privacy_level TEXT'),
    bestEffort('ALTER TABLE posts ADD COLUMN IF NOT EXISTS tiktok_disable_comment BOOLEAN'),
    bestEffort('ALTER TABLE posts ADD COLUMN IF NOT EXISTS tiktok_disable_duet BOOLEAN'),
    bestEffort('ALTER TABLE posts ADD COLUMN IF NOT EXISTS tiktok_disable_stitch BOOLEAN'),
    bestEffort('ALTER TABLE posts ADD COLUMN IF NOT EXISTS retry_count INTEGER NOT NULL DEFAULT 0'),
    bestEffort('ALTER TABLE posts ADD COLUMN IF NOT EXISTS next_retry_at TIMESTAMPTZ'),
    bestEffort('ALTER TABLE posts ADD COLUMN IF NOT EXISTS error_message TEXT'),
    bestEffort('ALTER TABLE posts ADD COLUMN IF NOT EXISTS location_id TEXT'),
    bestEffort('ALTER TABLE posts ADD COLUMN IF NOT EXISTS location_name TEXT'),
    bestEffort('ALTER TABLE posts ADD COLUMN IF NOT EXISTS first_comment TEXT'),
    bestEffort('ALTER TABLE contas ADD COLUMN IF NOT EXISTS zernio_account_id TEXT'),
    bestEffort("ALTER TABLE users ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'America/Sao_Paulo'"),
    bestEffort("ALTER TABLE users ADD COLUMN IF NOT EXISTS language TEXT NOT NULL DEFAULT 'pt-BR'"),
    bestEffort('ALTER TABLE users ADD COLUMN IF NOT EXISTS default_platform TEXT'),
    bestEffort("ALTER TABLE users ADD COLUMN IF NOT EXISTS notification_preferences JSONB NOT NULL DEFAULT '{\"email\":true,\"published\":true,\"failures\":true,\"comments\":true}'::jsonb"),
    bestEffort('ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_tokens_invalidated_at TIMESTAMPTZ'),
    bestEffort(`CREATE TABLE IF NOT EXISTS saved_texts (id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, title TEXT, body TEXT NOT NULL, criado_em TIMESTAMPTZ DEFAULT NOW())`),
    bestEffort(`CREATE TABLE IF NOT EXISTS platform_presets (id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, platform TEXT NOT NULL, name TEXT NOT NULL, config JSONB NOT NULL DEFAULT '{}', criado_em TIMESTAMPTZ DEFAULT NOW())`),
    bestEffort(`CREATE TABLE IF NOT EXISTS push_subscriptions (id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, endpoint TEXT UNIQUE NOT NULL, p256dh TEXT, auth TEXT, criado_em TIMESTAMPTZ DEFAULT NOW())`),
    bestEffort(`CREATE TABLE IF NOT EXISTS inbox_seen_comments (user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE, seen_ids TEXT[] DEFAULT '{}', atualizado_em TIMESTAMPTZ DEFAULT NOW(), PRIMARY KEY (user_id, post_id))`),
    bestEffort(`CREATE TABLE IF NOT EXISTS ai_memory (id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, model TEXT NOT NULL, tipo TEXT NOT NULL, conteudo TEXT NOT NULL, resolvido BOOLEAN DEFAULT FALSE, criado_em TIMESTAMPTZ DEFAULT NOW(), lembrar_em TIMESTAMPTZ)`),
    bestEffort('CREATE INDEX IF NOT EXISTS idx_credentials_user_id ON credentials (user_id)'),
    bestEffort('CREATE INDEX IF NOT EXISTS idx_credentials_reset_token ON credentials (reset_token) WHERE reset_token IS NOT NULL'),
    bestEffort("CREATE INDEX IF NOT EXISTS idx_posts_published_no_external ON posts (status, criado_em DESC) WHERE status = 'published' AND external_post_id IS NULL"),
    bestEffort('CREATE INDEX IF NOT EXISTS idx_posts_instagram_pending ON posts (id) WHERE instagram_pending IS NOT NULL'),
    ensurePostAccounts(),
    ensurePostPublications(),
    ensureMetricHistory(),
    ensureAiTables(),
    bestEffort(`
      CREATE TABLE IF NOT EXISTS drafts (
        id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title TEXT, text TEXT, platforms TEXT[] DEFAULT '{}', media_path TEXT, media_type TEXT,
        media_items JSONB, youtube_title TEXT, youtube_visibility TEXT DEFAULT 'public',
        is_template BOOLEAN DEFAULT FALSE, criado_em TIMESTAMPTZ DEFAULT NOW()
      )
    `).then(() => Promise.all([
      bestEffort('ALTER TABLE drafts ADD COLUMN IF NOT EXISTS text_by_platform JSONB'),
      bestEffort('ALTER TABLE drafts ADD COLUMN IF NOT EXISTS media_by_platform JSONB'),
      bestEffort('ALTER TABLE drafts ADD COLUMN IF NOT EXISTS ig_format TEXT'),
      bestEffort('ALTER TABLE drafts ADD COLUMN IF NOT EXISTS youtube_format TEXT'),
      bestEffort('ALTER TABLE drafts ADD COLUMN IF NOT EXISTS youtube_category_id TEXT'),
      bestEffort('ALTER TABLE drafts ADD COLUMN IF NOT EXISTS youtube_made_for_kids TEXT'),
      bestEffort('ALTER TABLE drafts ADD COLUMN IF NOT EXISTS tiktok_privacy_level TEXT'),
      bestEffort('ALTER TABLE drafts ADD COLUMN IF NOT EXISTS tiktok_disable_comment BOOLEAN'),
      bestEffort('ALTER TABLE drafts ADD COLUMN IF NOT EXISTS tiktok_disable_duet BOOLEAN'),
      bestEffort('ALTER TABLE drafts ADD COLUMN IF NOT EXISTS tiktok_disable_stitch BOOLEAN'),
      bestEffort('ALTER TABLE drafts ADD COLUMN IF NOT EXISTS location_id TEXT'),
      bestEffort('ALTER TABLE drafts ADD COLUMN IF NOT EXISTS location_name TEXT'),
      bestEffort('ALTER TABLE drafts ADD COLUMN IF NOT EXISTS first_comment TEXT'),
    ])),
  ])
}

module.exports = { runMigrations }
