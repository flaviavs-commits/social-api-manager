-- Execute manualmente: psql $DATABASE_URL -f src/db/migrations/012_posts_external_metrics.sql

ALTER TABLE posts ADD COLUMN IF NOT EXISTS external_post_id TEXT;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS external_platform TEXT;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS published_at TIMESTAMP;
