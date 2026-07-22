-- Execute manualmente: psql $DATABASE_URL -f src/db/migrations/032_post_title_by_platform.sql
-- (também roda automaticamente no startup via runMigrations() em server.js)

-- Permite um título diferente por rede social no mesmo post (Agendador manual),
-- mesmo padrão de text_by_platform (migrations/029). Hoje só o YouTube usa
-- título (posts.youtube_title, que continua sendo gravado sempre e é usado
-- como fallback) — esta coluna existe para quando o mesmo post tem 2+ redes
-- com título próprio configuradas na aba "Configurar por rede".
ALTER TABLE posts ADD COLUMN IF NOT EXISTS title_by_platform JSONB;
