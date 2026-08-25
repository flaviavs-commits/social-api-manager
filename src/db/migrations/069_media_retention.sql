-- Retenção automática de mídias temporárias do Vercel Blob.
-- Publicações concluídas ficam disponíveis por 48 horas; falhas, parciais e
-- cancelamentos ficam disponíveis por 7 dias para permitir nova tentativa.
ALTER TABLE posts ADD COLUMN IF NOT EXISTS media_cleanup_after TIMESTAMPTZ;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS media_cleaned_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_posts_media_cleanup
  ON posts (media_cleanup_after)
  WHERE media_cleanup_after IS NOT NULL AND media_cleaned_at IS NULL;
