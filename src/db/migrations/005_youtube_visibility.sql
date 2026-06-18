-- Execute manualmente: psql $DATABASE_URL -f src/db/migrations/005_youtube_visibility.sql

ALTER TABLE posts ADD COLUMN IF NOT EXISTS youtube_visibility TEXT NOT NULL DEFAULT 'public';
