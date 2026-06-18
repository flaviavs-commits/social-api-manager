-- Execute manualmente: psql $DATABASE_URL -f src/db/migrations/010_contas_avatar_url.sql

ALTER TABLE contas ADD COLUMN IF NOT EXISTS avatar_url TEXT;
