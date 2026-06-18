-- Execute manualmente: psql $DATABASE_URL -f src/db/migrations/007_contas_email_unico_por_usuario.sql

-- O e-mail de uma conta era único globalmente, mas deveria ser único só
-- dentro das contas de cada usuário — dois usuários distintos podem conectar
-- contas com o mesmo e-mail (ou nomes que geram o mesmo e-mail derivado
-- "@pendente.local") sem conflito entre si.
ALTER TABLE contas DROP CONSTRAINT IF EXISTS contas_email_key;
ALTER TABLE contas ADD CONSTRAINT contas_email_user_id_key UNIQUE (email, user_id);
