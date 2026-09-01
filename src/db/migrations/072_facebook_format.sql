-- Formato de publicação do Facebook: post (Feed) ou reel.
-- O valor é opcional para manter posts antigos compatíveis; o agendador usa
-- Feed como fallback quando a coluna estiver nula.
ALTER TABLE posts ADD COLUMN IF NOT EXISTS facebook_format TEXT DEFAULT 'post';
ALTER TABLE drafts ADD COLUMN IF NOT EXISTS facebook_format TEXT DEFAULT 'post';
