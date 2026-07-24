-- Retry automático de publicação com falha transitória (5xx/rate limit).
-- retry_count: quantas tentativas já foram feitas (máx. 3, ver services/scheduler.js).
-- next_retry_at: quando o próximo tick do cron deve tentar publicar de novo
-- (backoff exponencial: 1min, 5min, 15min). NULL/0 para posts que nunca falharam.
ALTER TABLE posts ADD COLUMN IF NOT EXISTS retry_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS next_retry_at TIMESTAMPTZ;
