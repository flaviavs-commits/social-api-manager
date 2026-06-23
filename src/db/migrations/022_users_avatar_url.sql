-- Execute manualmente: psql $DATABASE_URL -f src/db/migrations/022_users_avatar_url.sql

ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT;
