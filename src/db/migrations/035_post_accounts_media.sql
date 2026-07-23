-- Execute manualmente: psql $DATABASE_URL -f src/db/migrations/035_post_accounts_media.sql
-- (também roda automaticamente no startup via runMigrations() em server.js)

-- Mídia independente por rede social: até aqui, media_items/media_path/
-- media_type em posts eram compartilhados entre TODAS as redes marcadas —
-- não era possível anexar um vídeo diferente para o TikTok e outro para o
-- Instagram no mesmo post. Esta coluna guarda a mídia específica de cada
-- (post, conta), no mesmo formato de posts.media_items.
--
-- NULL significa "esta conta usa a mídia compartilhada do post"
-- (posts.media_path/media_type/media_items) — é o que mantém posts antigos
-- e o cron em produção funcionando sem nenhuma migração de dado: nenhuma
-- linha existente ganha media_items, e todo código de leitura cai de volta
-- na mídia legada quando esta coluna vier vazia. Ver src/infra/social/publisher.js
-- (publicarNaConta).
ALTER TABLE post_accounts ADD COLUMN IF NOT EXISTS media_items JSONB;
