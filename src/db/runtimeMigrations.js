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
  // Remove credenciais que versões antigas gravavam no estado operacional.
  await bestEffort("UPDATE post_accounts SET instagram_pending = instagram_pending - 'accessToken' - 'refreshToken' WHERE instagram_pending IS NOT NULL")
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
    bestEffort(`CREATE TABLE IF NOT EXISTS media_assets (id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, name TEXT NOT NULL, url TEXT NOT NULL, mime_type TEXT, size_bytes BIGINT, folder TEXT NOT NULL DEFAULT 'Geral', tags TEXT[] NOT NULL DEFAULT '{}', criado_em TIMESTAMPTZ DEFAULT NOW())`),
    bestEffort('CREATE INDEX IF NOT EXISTS idx_media_assets_user_created ON media_assets(user_id, criado_em DESC)'),
    bestEffort(`CREATE TABLE IF NOT EXISTS media_folders (id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, name TEXT NOT NULL, criado_em TIMESTAMPTZ DEFAULT NOW())`),
    bestEffort('CREATE UNIQUE INDEX IF NOT EXISTS idx_media_folders_user_name_lower ON media_folders(user_id, LOWER(name))'),
    bestEffort(`CREATE TABLE IF NOT EXISTS zernio_oauth_pending (id TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, platform TEXT NOT NULL, profile_id TEXT NOT NULL, temp_token TEXT NOT NULL, user_profile JSONB NOT NULL, connect_token TEXT, criado_em TIMESTAMPTZ DEFAULT NOW())`),
    bestEffort('CREATE INDEX IF NOT EXISTS idx_zernio_oauth_pending_created ON zernio_oauth_pending(criado_em)'),
    bestEffort('ALTER TABLE zernio_oauth_pending ADD COLUMN IF NOT EXISTS account_name TEXT'),
    bestEffort(`CREATE TABLE IF NOT EXISTS content_queues (id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, name TEXT NOT NULL, platforms TEXT[] NOT NULL DEFAULT '{}', content JSONB NOT NULL DEFAULT '{}', recurrence JSONB NOT NULL DEFAULT '{"days":[1,3,5],"time":"10:00"}', next_run_at TIMESTAMPTZ, active BOOLEAN NOT NULL DEFAULT TRUE, criado_em TIMESTAMPTZ DEFAULT NOW(), atualizado_em TIMESTAMPTZ DEFAULT NOW())`),
    bestEffort('CREATE INDEX IF NOT EXISTS idx_content_queues_due ON content_queues(active, next_run_at)'),
    bestEffort(`CREATE TABLE IF NOT EXISTS report_schedules (id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, name TEXT NOT NULL, period_days INTEGER NOT NULL DEFAULT 30, platform TEXT, recipients TEXT[] NOT NULL DEFAULT '{}', frequency TEXT NOT NULL DEFAULT 'monthly', branding JSONB NOT NULL DEFAULT '{}', next_run_at TIMESTAMPTZ, active BOOLEAN NOT NULL DEFAULT TRUE, last_sent_at TIMESTAMPTZ, criado_em TIMESTAMPTZ DEFAULT NOW(), atualizado_em TIMESTAMPTZ DEFAULT NOW())`),
    bestEffort('CREATE INDEX IF NOT EXISTS idx_report_schedules_due ON report_schedules(active, next_run_at)'),
    bestEffort(`CREATE TABLE IF NOT EXISTS workspaces (id SERIAL PRIMARY KEY, owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE, branding JSONB NOT NULL DEFAULT '{}', criado_em TIMESTAMPTZ DEFAULT NOW())`),
    bestEffort(`CREATE TABLE IF NOT EXISTS workspace_members (workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, role TEXT NOT NULL DEFAULT 'editor', criado_em TIMESTAMPTZ DEFAULT NOW(), PRIMARY KEY (workspace_id,user_id))`),
    bestEffort(`CREATE TABLE IF NOT EXISTS approval_requests (id SERIAL PRIMARY KEY, workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE, requested_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL, status TEXT NOT NULL DEFAULT 'pending', feedback TEXT, criado_em TIMESTAMPTZ DEFAULT NOW(), revisado_em TIMESTAMPTZ)`),
    bestEffort('CREATE INDEX IF NOT EXISTS idx_approval_requests_workspace ON approval_requests(workspace_id,status,criado_em DESC)'),
    bestEffort(`CREATE TABLE IF NOT EXISTS smartlinks (id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE, title TEXT, description TEXT, theme JSONB NOT NULL DEFAULT '{}', active BOOLEAN NOT NULL DEFAULT TRUE, criado_em TIMESTAMPTZ DEFAULT NOW())`),
    bestEffort(`CREATE TABLE IF NOT EXISTS smartlink_items (id SERIAL PRIMARY KEY, smartlink_id INTEGER NOT NULL REFERENCES smartlinks(id) ON DELETE CASCADE, label TEXT NOT NULL, url TEXT NOT NULL, position INTEGER NOT NULL DEFAULT 0, clicks INTEGER NOT NULL DEFAULT 0)`),
    bestEffort('CREATE INDEX IF NOT EXISTS idx_smartlinks_slug ON smartlinks(slug)'),
    bestEffort(`CREATE TABLE IF NOT EXISTS webhook_endpoints (id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, name TEXT NOT NULL, url TEXT NOT NULL, secret TEXT NOT NULL, events TEXT[] NOT NULL DEFAULT '{post_published,approval_updated}', active BOOLEAN NOT NULL DEFAULT TRUE, last_status INTEGER, last_error TEXT, criado_em TIMESTAMPTZ DEFAULT NOW())`),
    bestEffort('CREATE INDEX IF NOT EXISTS idx_webhook_endpoints_user ON webhook_endpoints(user_id,active)'),
    bestEffort(`CREATE TABLE IF NOT EXISTS api_keys (id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, name TEXT NOT NULL, prefix TEXT NOT NULL, key_hash TEXT NOT NULL UNIQUE, last_used_at TIMESTAMPTZ, revoked_at TIMESTAMPTZ, criado_em TIMESTAMPTZ DEFAULT NOW())`),
    bestEffort('CREATE INDEX IF NOT EXISTS idx_api_keys_active ON api_keys(key_hash) WHERE revoked_at IS NULL'),
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
