-- Fila durável para os callbacks de publicação enviados pela Zernio.
-- O provedor usa entrega at-least-once: event_id precisa ser único para que
-- retries não processem o mesmo resultado duas vezes.
CREATE TABLE IF NOT EXISTS zernio_webhook_events (
  id BIGSERIAL PRIMARY KEY,
  event_id TEXT NOT NULL UNIQUE,
  event_name TEXT NOT NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'processed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  next_attempt_at TIMESTAMPTZ,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_zernio_webhook_events_pending
  ON zernio_webhook_events (next_attempt_at, received_at)
  WHERE status IN ('pending', 'processing');

-- Permite confirmar uma publicação mesmo quando o provedor ainda não
-- disponibilizou um ID público (caso possível no TikTok).
ALTER TABLE post_accounts
  ADD COLUMN IF NOT EXISTS publication_confirmed BOOLEAN NOT NULL DEFAULT FALSE;
