-- Identificador estável por (post, conta) para que retries de uma publicação
-- sejam reconhecidos pelo Zernio como a mesma operação lógica.
ALTER TABLE post_accounts ADD COLUMN IF NOT EXISTS provider_request_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_post_accounts_provider_request_id
  ON post_accounts(provider_request_id)
  WHERE provider_request_id IS NOT NULL;
