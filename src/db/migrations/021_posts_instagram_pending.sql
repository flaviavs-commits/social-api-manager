-- Execute manualmente: psql $DATABASE_URL -f src/db/migrations/021_posts_instagram_pending.sql
-- Guarda o estado intermediário da publicação no Instagram (containers
-- criados, ainda aguardando processamento) — necessário porque em serverless
-- não dá para bloquear a função por até 60s+ esperando o Instagram terminar
-- de processar a mídia. A criação do container acontece na requisição/cron
-- atual; a confirmação (media_publish) acontece num próximo tick do cron,
-- quando o status_code já estiver FINISHED.

ALTER TABLE posts ADD COLUMN IF NOT EXISTS instagram_pending JSONB;

CREATE INDEX IF NOT EXISTS idx_posts_instagram_pending
  ON posts ((instagram_pending IS NOT NULL))
  WHERE instagram_pending IS NOT NULL;
