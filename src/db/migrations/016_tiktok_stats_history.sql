-- Execute manualmente: psql $DATABASE_URL -f src/db/migrations/016_tiktok_stats_history.sql

-- Snapshot diário de seguidores/curtidas totais/vídeos de cada conta do
-- TikTok, no mesmo padrão usado para o saldo de seguidores do Instagram
-- (instagram_followers_history): a API não dá histórico retroativo, então
-- o saldo é construído a partir de hoje, 1 ponto por dia.
CREATE TABLE IF NOT EXISTS tiktok_stats_history (
  id SERIAL PRIMARY KEY,
  conta_id INTEGER NOT NULL REFERENCES contas(id) ON DELETE CASCADE,
  captured_on DATE NOT NULL DEFAULT CURRENT_DATE,
  follower_count INTEGER,
  likes_count INTEGER,
  video_count INTEGER,
  UNIQUE (conta_id, captured_on)
);

CREATE INDEX IF NOT EXISTS idx_tiktok_stats_history_conta_id ON tiktok_stats_history(conta_id);
