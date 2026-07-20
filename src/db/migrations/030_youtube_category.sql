-- Execute manualmente: psql $DATABASE_URL -f src/db/migrations/030_youtube_category.sql
-- (também roda automaticamente no startup via runMigrations() em server.js)

-- Categoria do vídeo no YouTube (Data API v3, videoCategories) — opcional,
-- sem valor cai no padrão do próprio YouTube ao publicar (ver
-- src/infra/social/youtubePublisher.js).
ALTER TABLE posts ADD COLUMN IF NOT EXISTS youtube_category_id TEXT;
