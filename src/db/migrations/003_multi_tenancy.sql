-- Execute manualmente: psql $DATABASE_URL -f src/db/migrations/003_multi_tenancy.sql

-- Papel do usuário: 'admin' ou 'user'
ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(20) NOT NULL DEFAULT 'user';

-- Dono de cada conta de rede social
ALTER TABLE contas ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE CASCADE;

-- Dono de cada post agendado
ALTER TABLE posts ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE CASCADE;

-- Cria o admin inicial — senha definida depois via "esqueci minha senha" ou login Google
INSERT INTO users (email, role) VALUES ('tiago@vitissouls.com', 'admin')
ON CONFLICT (email) DO UPDATE SET role = 'admin';

-- Atribui todos os dados pré-existentes (sem dono) ao admin inicial
UPDATE contas SET user_id = (SELECT id FROM users WHERE email = 'tiago@vitissouls.com') WHERE user_id IS NULL;
UPDATE posts  SET user_id = (SELECT id FROM users WHERE email = 'tiago@vitissouls.com') WHERE user_id IS NULL;
