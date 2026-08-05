-- Rascunhos/templates ficaram desatualizados em relação ao que o Agendador
-- suporta hoje (formato por rede, opções do TikTok, localização, primeiro
-- comentário) — sem essas colunas, salvar um rascunho perdia essas
-- configurações ao reaplicar depois. Ver os fluxos React de drafts.
-- e src/routes/drafts.js.
ALTER TABLE drafts ADD COLUMN IF NOT EXISTS ig_format TEXT;
ALTER TABLE drafts ADD COLUMN IF NOT EXISTS youtube_format TEXT;
ALTER TABLE drafts ADD COLUMN IF NOT EXISTS youtube_category_id TEXT;
ALTER TABLE drafts ADD COLUMN IF NOT EXISTS youtube_made_for_kids TEXT;
ALTER TABLE drafts ADD COLUMN IF NOT EXISTS tiktok_privacy_level TEXT;
ALTER TABLE drafts ADD COLUMN IF NOT EXISTS tiktok_disable_comment BOOLEAN;
ALTER TABLE drafts ADD COLUMN IF NOT EXISTS tiktok_disable_duet BOOLEAN;
ALTER TABLE drafts ADD COLUMN IF NOT EXISTS tiktok_disable_stitch BOOLEAN;
ALTER TABLE drafts ADD COLUMN IF NOT EXISTS location_id TEXT;
ALTER TABLE drafts ADD COLUMN IF NOT EXISTS location_name TEXT;
ALTER TABLE drafts ADD COLUMN IF NOT EXISTS first_comment TEXT;
