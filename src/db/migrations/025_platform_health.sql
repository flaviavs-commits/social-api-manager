-- Execute manualmente: psql $DATABASE_URL -f src/db/migrations/025_platform_health.sql
-- Guarda o status de disponibilidade de cada rede social (Instagram, Facebook,
-- YouTube, TikTok), verificado periodicamente via uma chamada leve à API
-- (não relacionado à validade do token, que já existe em `tokens.status`).

CREATE TABLE IF NOT EXISTS platform_health (
  platform        TEXT PRIMARY KEY,
  status          TEXT NOT NULL DEFAULT 'unknown', -- 'up' | 'down' | 'unknown'
  fail_count      INTEGER NOT NULL DEFAULT 0,
  message         TEXT,
  checked_at      TIMESTAMP NOT NULL DEFAULT NOW()
);
