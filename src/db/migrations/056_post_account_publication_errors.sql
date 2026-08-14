-- Mantém o motivo individual de cada conta/rede quando uma publicação falha.
ALTER TABLE post_accounts ADD COLUMN IF NOT EXISTS publication_error TEXT;
