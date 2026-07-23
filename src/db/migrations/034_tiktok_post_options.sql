-- Execute manualmente: psql $DATABASE_URL -f src/db/migrations/034_tiktok_post_options.sql
-- (também roda automaticamente no startup via runMigrations() em server.js)

-- Opções de publicação do TikTok exigidas pelas Content Sharing Guidelines
-- (https://developers.tiktok.com/doc/content-sharing-guidelines): a tela de
-- publicação precisa deixar o usuário escolher a privacidade (sem valor
-- default) e as interações permitidas, em vez do backend decidir sozinho.
ALTER TABLE posts ADD COLUMN IF NOT EXISTS tiktok_privacy_level TEXT;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS tiktok_disable_comment BOOLEAN;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS tiktok_disable_duet BOOLEAN;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS tiktok_disable_stitch BOOLEAN;
