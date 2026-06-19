-- Execute manualmente: psql $DATABASE_URL -f src/db/migrations/015_instagram_followers_history.sql

-- Snapshot diário do número de seguidores de cada conta do Instagram. A API
-- de Insights (follower_count histórico) exige uma permissão extra da Meta
-- que o app não tem aprovada ainda ("Application does not have permission
-- for this action"); por isso o saldo é construído aqui, a partir de hoje,
-- usando o campo básico followers_count (disponível com o escopo atual).
CREATE TABLE IF NOT EXISTS instagram_followers_history (
  id SERIAL PRIMARY KEY,
  conta_id INTEGER NOT NULL REFERENCES contas(id) ON DELETE CASCADE,
  captured_on DATE NOT NULL DEFAULT CURRENT_DATE,
  follower_count INTEGER NOT NULL,
  UNIQUE (conta_id, captured_on)
);

CREATE INDEX IF NOT EXISTS idx_instagram_followers_history_conta_id ON instagram_followers_history(conta_id);
