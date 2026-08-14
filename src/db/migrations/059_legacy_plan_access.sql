-- Usuários que já existiam antes da separação de planos mantêm acesso total
-- temporariamente. Novos cadastros recebem false no fluxo de autenticação.
ALTER TABLE users ADD COLUMN IF NOT EXISTS plan_unrestricted BOOLEAN NOT NULL DEFAULT TRUE;
CREATE INDEX IF NOT EXISTS idx_users_plan_unrestricted ON users(plan_unrestricted);
