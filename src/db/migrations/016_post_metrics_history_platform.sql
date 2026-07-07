-- Execute manualmente: psql $DATABASE_URL -f src/db/migrations/016_post_metrics_history_platform.sql
-- (também roda automaticamente no startup via runMigrations() em server.js)

-- Um post pode ser publicado em várias redes, então o snapshot diário de
-- métricas passa a ser por (post, rede) — antes a unique key era só
-- (post_id, captured_on), fazendo uma rede sobrescrever a outra no mesmo dia.

ALTER TABLE post_metrics_history ADD COLUMN IF NOT EXISTS platform TEXT;

-- Backfill: linhas antigas ficam com a rede legada do post (external_platform);
-- o que sobrar recebe 'unknown' para não colidir na nova unique key.
UPDATE post_metrics_history h
SET platform = COALESCE(p.external_platform, 'unknown')
FROM posts p
WHERE h.post_id = p.id AND h.platform IS NULL;

UPDATE post_metrics_history SET platform = 'unknown' WHERE platform IS NULL;

ALTER TABLE post_metrics_history DROP CONSTRAINT IF EXISTS post_metrics_history_post_id_captured_on_key;

CREATE UNIQUE INDEX IF NOT EXISTS post_metrics_history_post_platform_day
  ON post_metrics_history (post_id, platform, captured_on);
