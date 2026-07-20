-- Execute manualmente: psql $DATABASE_URL -f src/db/migrations/028_post_publications_multi_account.sql
-- (também roda automaticamente no startup via runMigrations() em server.js)

-- post_publications tinha UNIQUE(post_id, platform) — com 2 contas da mesma
-- rede publicando o mesmo post (ver migrations/027), a segunda publicação
-- sobrescreveria o resultado da primeira via ON CONFLICT DO UPDATE, perdendo
-- o external_post_id de uma das contas no Analytics.
ALTER TABLE post_publications ADD COLUMN IF NOT EXISTS account_id INTEGER REFERENCES contas(id) ON DELETE SET NULL;

-- Backfill: preenche o que dá pra inferir do legado (posts que só tinham 1
-- conta). Linhas que não derem pra inferir ficam com account_id NULL —
-- aceitável, são publicações antigas de posts que nunca tiveram múltiplas
-- contas para começar.
UPDATE post_publications pp SET account_id = p.account_id
FROM posts p WHERE pp.post_id = p.id AND pp.account_id IS NULL AND p.account_id IS NOT NULL;

ALTER TABLE post_publications DROP CONSTRAINT IF EXISTS post_publications_post_id_platform_key;

-- Índice único parcial (só cobre linhas com account_id preenchido) — linhas
-- históricas com account_id NULL não entram em conflito entre si.
CREATE UNIQUE INDEX IF NOT EXISTS post_publications_post_platform_account
  ON post_publications (post_id, platform, account_id) WHERE account_id IS NOT NULL;
