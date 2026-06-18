-- Execute manualmente: psql $DATABASE_URL -f src/db/migrations/008_contas_platform_handle.sql
--
-- Reestrutura "contas" de "1 linha = 1 pessoa com até 5 redes sociais
-- (colunas facebook/instagram/youtube/tiktok/kwai + email + nicho)" para
-- "1 linha = 1 conexão de rede social" (colunas platform + handle), sem
-- nicho/estrela nem e-mail. Cada rede social conectada na tabela antiga
-- se torna uma linha própria na nova tabela; tokens são realocados para
-- apontar para a linha correta.

BEGIN;

CREATE TABLE contas_v2 (
  id SERIAL PRIMARY KEY,
  platform VARCHAR(20) NOT NULL,
  handle VARCHAR(255) NOT NULL,
  tipo tipo_nivel NOT NULL,
  ativo BOOLEAN DEFAULT true,
  criado_em TIMESTAMP DEFAULT NOW(),
  atualizado_em TIMESTAMP DEFAULT NOW(),
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE (user_id, platform, handle)
);

-- Expande cada coluna de rede social preenchida em uma linha própria,
-- guardando o id antigo da conta para realocar os tokens depois.
CREATE TEMP TABLE contas_old_to_new (old_id INTEGER, new_id INTEGER, platform VARCHAR(20));

DO $$
DECLARE
  r RECORD;
  new_id INTEGER;
BEGIN
  FOR r IN SELECT * FROM contas LOOP
    IF r.facebook IS NOT NULL THEN
      INSERT INTO contas_v2 (platform, handle, tipo, ativo, criado_em, atualizado_em, user_id)
        VALUES ('facebook', r.facebook, r.tipo, r.ativo, r.criado_em, r.atualizado_em, r.user_id)
        RETURNING id INTO new_id;
      INSERT INTO contas_old_to_new VALUES (r.id, new_id, 'facebook');
    END IF;
    IF r.instagram IS NOT NULL THEN
      INSERT INTO contas_v2 (platform, handle, tipo, ativo, criado_em, atualizado_em, user_id)
        VALUES ('instagram', r.instagram, r.tipo, r.ativo, r.criado_em, r.atualizado_em, r.user_id)
        RETURNING id INTO new_id;
      INSERT INTO contas_old_to_new VALUES (r.id, new_id, 'instagram');
    END IF;
    IF r.youtube IS NOT NULL THEN
      INSERT INTO contas_v2 (platform, handle, tipo, ativo, criado_em, atualizado_em, user_id)
        VALUES ('youtube', r.youtube, r.tipo, r.ativo, r.criado_em, r.atualizado_em, r.user_id)
        RETURNING id INTO new_id;
      INSERT INTO contas_old_to_new VALUES (r.id, new_id, 'youtube');
    END IF;
    IF r.tiktok IS NOT NULL THEN
      INSERT INTO contas_v2 (platform, handle, tipo, ativo, criado_em, atualizado_em, user_id)
        VALUES ('tiktok', r.tiktok, r.tipo, r.ativo, r.criado_em, r.atualizado_em, r.user_id)
        RETURNING id INTO new_id;
      INSERT INTO contas_old_to_new VALUES (r.id, new_id, 'tiktok');
    END IF;
    IF r.kwai IS NOT NULL THEN
      INSERT INTO contas_v2 (platform, handle, tipo, ativo, criado_em, atualizado_em, user_id)
        VALUES ('kwai', r.kwai, r.tipo, r.ativo, r.criado_em, r.atualizado_em, r.user_id)
        RETURNING id INTO new_id;
      INSERT INTO contas_old_to_new VALUES (r.id, new_id, 'kwai');
    END IF;
  END LOOP;
END $$;

-- A FK de tokens.conta_id continua ligada ao OID da tabela antiga mesmo após
-- um RENAME (Postgres não move FKs por nome). Removemos a FK, atualizamos os
-- tokens para os novos ids (ainda sem constraint, então não há conflito), e
-- só então recriamos a FK apontando para a tabela renomeada.
ALTER TABLE tokens DROP CONSTRAINT tokens_conta_id_fkey;

ALTER TABLE contas RENAME TO contas_old_backup;
ALTER TABLE contas_v2 RENAME TO contas;

-- Realoca cada token para a nova linha de conta correspondente à mesma
-- plataforma (um token antigo só pertencia a UMA plataforma da conta antiga).
UPDATE tokens t
SET conta_id = m.new_id
FROM contas_old_to_new m
WHERE t.conta_id = m.old_id AND t.platform = m.platform;

ALTER TABLE tokens ADD CONSTRAINT tokens_conta_id_fkey
  FOREIGN KEY (conta_id) REFERENCES contas(id) ON DELETE CASCADE;

DROP TABLE nichos CASCADE;

COMMIT;
