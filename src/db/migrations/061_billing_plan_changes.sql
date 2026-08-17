-- Uma troca de plano pago gera no máximo uma cobrança por usuário no mês.
-- A confirmação do plano acontece somente depois do webhook assinado do gateway.
ALTER TABLE users ALTER COLUMN plan SET DEFAULT 'gratuito';

CREATE TABLE IF NOT EXISTS billing_plan_changes (
  id BIGSERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  from_plan TEXT NOT NULL,
  to_plan TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
  currency TEXT NOT NULL DEFAULT 'brl',
  billing_month DATE NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  gateway TEXT NOT NULL DEFAULT 'stripe',
  gateway_session_id TEXT UNIQUE,
  gateway_payment_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'paid', 'failed', 'cancelled')),
  checkout_url TEXT,
  failure_code TEXT,
  failure_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  paid_at TIMESTAMPTZ,
  UNIQUE (user_id, billing_month)
);

CREATE INDEX IF NOT EXISTS idx_billing_plan_changes_user_month
  ON billing_plan_changes (user_id, billing_month DESC);
CREATE INDEX IF NOT EXISTS idx_billing_plan_changes_gateway_session
  ON billing_plan_changes (gateway_session_id)
  WHERE gateway_session_id IS NOT NULL;
