-- Execute manualmente: psql $DATABASE_URL -f src/db/migrations/015_post_publications.sql
-- (também roda automaticamente no startup via runMigrations() em server.js)

-- Um post pode ser publicado em VÁRIAS redes (posts.platforms é um array),
-- mas o schema antigo só guardava UM external_post_id + external_platform por
-- post. Ao publicar em paralelo, cada rede sobrescrevia esses campos, então só
-- a última a terminar "vencia" — e o Analytics só mostrava métricas dessa rede.
--
-- Esta tabela guarda uma linha por (post, rede), preservando o ID externo de
-- CADA publicação, para que todas apareçam no Analytics com suas métricas.
CREATE TABLE IF NOT EXISTS post_publications (
  id SERIAL PRIMARY KEY,
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  external_post_id TEXT,
  published_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (post_id, platform)
);

CREATE INDEX IF NOT EXISTS idx_post_publications_post_id ON post_publications(post_id);

-- Backfill: traz os IDs externos já salvos no schema antigo (uma linha por post)
-- para a nova tabela, sem duplicar quem já foi migrado.
INSERT INTO post_publications (post_id, platform, external_post_id, published_at)
SELECT id, external_platform, external_post_id, published_at
FROM posts
WHERE external_post_id IS NOT NULL AND external_platform IS NOT NULL
ON CONFLICT (post_id, platform) DO NOTHING;
