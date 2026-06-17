-- Execute manualmente: psql $DATABASE_URL -f src/db/migrations/002_credentials.sql

-- Tabela de credenciais, separada do perfil (users).
-- Login via Google não grava nada aqui.
CREATE TABLE IF NOT EXISTS credentials (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  password_hash VARCHAR(255) NOT NULL,
  reset_token VARCHAR(255),
  reset_token_expires TIMESTAMP,
  atualizado_em TIMESTAMP DEFAULT NOW()
);

-- Migrar senhas já existentes na tabela users (se houver) para a nova tabela
INSERT INTO credentials (user_id, password_hash)
SELECT id, password_hash FROM users
WHERE password_hash IS NOT NULL
ON CONFLICT (user_id) DO NOTHING;

ALTER TABLE users DROP COLUMN IF EXISTS password_hash;
