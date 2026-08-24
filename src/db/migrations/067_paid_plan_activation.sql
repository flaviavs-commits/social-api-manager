-- Todos os planos atuais são pagos. Usuários novos ficam pendentes até o
-- webhook assinado do Stripe confirmar a primeira cobrança.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS plan_active BOOLEAN;

-- Contas existentes antes desta migração já estavam em operação; preserva o
-- acesso delas. Novos cadastros definem FALSE explicitamente no repositório.
UPDATE users SET plan_active = TRUE WHERE plan_active IS NULL;

ALTER TABLE users
  ALTER COLUMN plan_active SET DEFAULT FALSE,
  ALTER COLUMN plan_active SET NOT NULL;

ALTER TABLE users
  ALTER COLUMN plan_unrestricted SET DEFAULT FALSE;

UPDATE users
   SET plan_unrestricted = FALSE
 WHERE role NOT IN ('admin', 'super_admin') OR role IS NULL;

CREATE INDEX IF NOT EXISTS idx_users_plan_active ON users(plan_active);
