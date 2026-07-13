-- Execute manualmente: psql $DATABASE_URL -f src/db/migrations/026_youtube_stats_history.sql

-- Snapshot diário de inscritos de cada canal do YouTube, no mesmo padrão
-- usado para o saldo de seguidores do Instagram e estatísticas do TikTok
-- (instagram_followers_history / tiktok_stats_history): a API não dá
-- histórico retroativo de inscritos, então o saldo é construído a partir
-- de hoje, 1 ponto por dia.
CREATE TABLE IF NOT EXISTS youtube_stats_history (
  id SERIAL PRIMARY KEY,
  conta_id INTEGER NOT NULL REFERENCES contas(id) ON DELETE CASCADE,
  captured_on DATE NOT NULL DEFAULT CURRENT_DATE,
  subscriber_count INTEGER,
  UNIQUE (conta_id, captured_on)
);

CREATE INDEX IF NOT EXISTS idx_youtube_stats_history_conta_id ON youtube_stats_history(conta_id);
