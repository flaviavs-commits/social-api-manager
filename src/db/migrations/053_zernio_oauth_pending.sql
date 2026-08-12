CREATE TABLE IF NOT EXISTS zernio_oauth_pending (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  profile_id TEXT NOT NULL,
  temp_token TEXT NOT NULL,
  user_profile JSONB NOT NULL,
  connect_token TEXT,
  criado_em TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_zernio_oauth_pending_created ON zernio_oauth_pending(criado_em);
