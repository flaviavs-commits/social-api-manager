-- Execute manualmente: psql $DATABASE_URL -f src/db/migrations/027_post_accounts.sql
-- (também roda automaticamente no startup via runMigrations() em server.js)

-- Até aqui, posts.account_id era uma coluna ÚNICA — um post só podia
-- publicar em 1 conta, mesmo quando platforms tinha várias redes marcadas.
-- Esta tabela guarda a relação N:M entre post e conta, permitindo publicar
-- em TODAS as contas conectadas de cada rede marcada (ex.: 2 perfis de
-- Instagram publicando o mesmo post ao mesmo tempo).
--
-- instagram_pending migra aqui de posts.instagram_pending: cada linha
-- (post, conta) tem sua própria pendência de processamento assíncrono do
-- Instagram, independente das demais — necessário porque agora pode haver
-- mais de uma conta de Instagram publicando o mesmo post simultaneamente.
CREATE TABLE IF NOT EXISTS post_accounts (
  id SERIAL PRIMARY KEY,
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  account_id INTEGER NOT NULL REFERENCES contas(id) ON DELETE CASCADE,
  instagram_pending JSONB,
  criado_em TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (post_id, account_id)
);

CREATE INDEX IF NOT EXISTS idx_post_accounts_post_id ON post_accounts(post_id);
CREATE INDEX IF NOT EXISTS idx_post_accounts_pending ON post_accounts(id) WHERE instagram_pending IS NOT NULL;

-- Backfill: todo post existente com account_id preenchido vira 1 linha aqui,
-- preservando o comportamento de "1 conta por post" que já tinham.
-- posts.account_id/posts.instagram_pending continuam existindo (coluna
-- legada, só leitura) — não são removidas nem reescritas por código novo.
INSERT INTO post_accounts (post_id, account_id)
SELECT id, account_id FROM posts WHERE account_id IS NOT NULL
ON CONFLICT (post_id, account_id) DO NOTHING;
