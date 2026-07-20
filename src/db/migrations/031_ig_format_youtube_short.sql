-- Execute manualmente: psql $DATABASE_URL -f src/db/migrations/031_ig_format_youtube_short.sql
-- (também roda automaticamente no startup via runMigrations() em server.js)

-- Formato de publicação escolhido pelo usuário no Instagram (post/reel/story)
-- e no YouTube (video/short) — ambos opcionais. Sem valor, o comportamento
-- automático atual é preservado (vídeo no Instagram vira Reel por padrão;
-- YouTube decide Short via proporção/duração do vídeo).
ALTER TABLE posts ADD COLUMN IF NOT EXISTS ig_format TEXT;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS youtube_format TEXT;
