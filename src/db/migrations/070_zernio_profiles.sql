-- Um perfil do provedor por cliente. O identificador fica somente no backend;
-- a interface continua trabalhando apenas com as contas da aplicação.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS zernio_profile_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_zernio_profile_id
  ON users (zernio_profile_id)
  WHERE zernio_profile_id IS NOT NULL;

-- Guarda o perfil da conexão para que contas antigas, ainda no perfil legado
-- global, não sejam confundidas com contas novas durante a reconciliação.
ALTER TABLE contas
  ADD COLUMN IF NOT EXISTS zernio_profile_id TEXT;

CREATE INDEX IF NOT EXISTS idx_contas_zernio_profile_id
  ON contas (zernio_profile_id)
  WHERE zernio_profile_id IS NOT NULL;
