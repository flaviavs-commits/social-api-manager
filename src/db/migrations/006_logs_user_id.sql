-- Execute manualmente: psql $DATABASE_URL -f src/db/migrations/006_logs_user_id.sql

ALTER TABLE logs ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
