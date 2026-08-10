-- Recursos de produtividade e operação: biblioteca, filas, relatórios e mídia.
CREATE TABLE IF NOT EXISTS media_assets (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  mime_type TEXT,
  size_bytes BIGINT,
  folder TEXT NOT NULL DEFAULT 'Geral',
  tags TEXT[] NOT NULL DEFAULT '{}',
  criado_em TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_media_assets_user_created ON media_assets(user_id, criado_em DESC);

CREATE TABLE IF NOT EXISTS content_queues (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  platforms TEXT[] NOT NULL DEFAULT '{}',
  content JSONB NOT NULL DEFAULT '{}',
  recurrence JSONB NOT NULL DEFAULT '{"days":[1,3,5],"time":"10:00"}',
  next_run_at TIMESTAMPTZ,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  criado_em TIMESTAMPTZ DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_content_queues_due ON content_queues(active, next_run_at);

CREATE TABLE IF NOT EXISTS report_schedules (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  period_days INTEGER NOT NULL DEFAULT 30,
  platform TEXT,
  recipients TEXT[] NOT NULL DEFAULT '{}',
  frequency TEXT NOT NULL DEFAULT 'monthly',
  branding JSONB NOT NULL DEFAULT '{}',
  next_run_at TIMESTAMPTZ,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  last_sent_at TIMESTAMPTZ,
  criado_em TIMESTAMPTZ DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_report_schedules_due ON report_schedules(active, next_run_at);
