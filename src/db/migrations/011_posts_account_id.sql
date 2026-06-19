-- Execute manualmente: psql $DATABASE_URL -f src/db/migrations/011_posts_account_id.sql

ALTER TABLE posts ADD COLUMN IF NOT EXISTS account_id INTEGER REFERENCES contas(id);
