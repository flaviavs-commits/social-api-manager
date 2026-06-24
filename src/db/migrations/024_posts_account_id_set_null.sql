-- Execute manualmente: psql $DATABASE_URL -f src/db/migrations/024_posts_account_id_set_null.sql

-- Sem isso, excluir uma conta com qualquer post (mesmo já publicado) falhava
-- com erro de FK. Agora o post continua existindo como histórico, só perde a
-- referência à conta removida.
ALTER TABLE posts DROP CONSTRAINT IF EXISTS posts_account_id_fkey;
ALTER TABLE posts ADD CONSTRAINT posts_account_id_fkey
  FOREIGN KEY (account_id) REFERENCES contas(id) ON DELETE SET NULL;
