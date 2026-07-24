-- Biblioteca de textos salvos, reutilizáveis entre posts (botão "textos
-- salvos" no editor, ver public/app.html).
CREATE TABLE IF NOT EXISTS saved_texts (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT,
  body TEXT NOT NULL,
  criado_em TIMESTAMPTZ DEFAULT NOW()
);

-- Localização anexada ao post (Facebook/Instagram, via Graph API "place").
-- location_id é o ID do local na Graph API; location_name é só para exibição
-- (evita nova busca ao reabrir/editar o post).
ALTER TABLE posts ADD COLUMN IF NOT EXISTS location_id TEXT;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS location_name TEXT;

-- Primeiro comentário automático — texto opcional publicado logo após o post
-- ir ao ar (Facebook, Instagram, YouTube, Threads, LinkedIn; TikTok e
-- Pinterest não têm endpoint de comentário na API oficial).
ALTER TABLE posts ADD COLUMN IF NOT EXISTS first_comment TEXT;

-- Controle de execução do primeiro comentário — uma linha por publicação
-- (post_publications) que tenha first_comment definido, para o cron saber
-- quais ainda precisam comentar e nunca comentar duas vezes na mesma conta.
CREATE TABLE IF NOT EXISTS post_first_comments (
  id SERIAL PRIMARY KEY,
  post_publication_id INTEGER NOT NULL REFERENCES post_publications(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | done | failed
  error_message TEXT,
  criado_em TIMESTAMPTZ DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (post_publication_id)
);
