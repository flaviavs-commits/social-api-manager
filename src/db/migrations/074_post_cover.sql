-- Capa escolhida pelo usuário para vídeos (frame capturado ou imagem própria).
-- A capa fica separada da mídia publicada para não virar um item extra no carrossel.
ALTER TABLE posts
  ADD COLUMN IF NOT EXISTS cover_path TEXT,
  ADD COLUMN IF NOT EXISTS cover_type TEXT;
