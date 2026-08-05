-- Preferências básicas do perfil, separadas das contas sociais e dos tokens.
ALTER TABLE users ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'America/Sao_Paulo';
ALTER TABLE users ADD COLUMN IF NOT EXISTS language TEXT NOT NULL DEFAULT 'pt-BR';
ALTER TABLE users ADD COLUMN IF NOT EXISTS default_platform TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS notification_preferences JSONB NOT NULL DEFAULT '{"email":true,"published":true,"failures":true,"comments":true}'::jsonb;
ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_tokens_invalidated_at TIMESTAMPTZ;
