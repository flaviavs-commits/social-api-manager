-- Execute manualmente: psql $DATABASE_URL -f src/db/migrations/075_comment_notifications.sql
-- A chave evita registrar novamente a mesma notificação enquanto o Inbox
-- consulta os comentários periodicamente.

ALTER TABLE logs ADD COLUMN IF NOT EXISTS notification_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_logs_notification_key
  ON logs (notification_key)
  WHERE notification_key IS NOT NULL;
