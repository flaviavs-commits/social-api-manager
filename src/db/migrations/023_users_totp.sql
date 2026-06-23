-- Execute manualmente: psql $DATABASE_URL -f src/db/migrations/023_users_totp.sql

-- Segredo TOTP (2FA) cifrado em repouso (mesmo esquema dos tokens de rede
-- social) e flag indicando se o usuário concluiu a ativação. totp_secret pode
-- existir sem totp_enabled durante o setup (antes de o usuário confirmar o
-- primeiro código).
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_secret TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_enabled BOOLEAN NOT NULL DEFAULT FALSE;
