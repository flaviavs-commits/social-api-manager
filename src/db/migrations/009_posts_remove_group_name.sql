-- Execute manualmente: psql $DATABASE_URL -f src/db/migrations/009_posts_remove_group_name.sql

-- group_name (estrela/nicho) deixou de ser usado para escolher a conta na
-- hora de publicar — a escolha agora é direta por usuário + plataforma.
ALTER TABLE posts DROP COLUMN IF EXISTS group_name;
