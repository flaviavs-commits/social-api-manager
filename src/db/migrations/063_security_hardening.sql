-- Execute manualmente antes de publicar uma nova réplica:
-- psql $DATABASE_URL -f src/db/migrations/063_security_hardening.sql

CREATE TABLE IF NOT EXISTS rate_limit_counters (
  key TEXT PRIMARY KEY,
  hits INTEGER NOT NULL DEFAULT 0 CHECK (hits >= 0),
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rate_limit_counters_expiry
  ON rate_limit_counters(expires_at);

CREATE TABLE IF NOT EXISTS oauth_flow_states (
  state_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  payload JSONB NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_oauth_flow_states_expiry
  ON oauth_flow_states(expires_at);
