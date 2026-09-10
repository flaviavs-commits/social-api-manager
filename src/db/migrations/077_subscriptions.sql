-- Modelo de dados para assinatura recorrente de verdade (mode=subscription
-- na Stripe), decisão de 10/09/2026 (task "definir se os planos mensais são
-- assinatura ou cobrança avulsa"). billing_plan_changes continua existindo —
-- modela "uma cobrança pontual de troca de plano no mês", conceito diferente
-- de "estado atual de uma assinatura contínua".
--
-- Tabela separada de `users` (não colunas soltas): uma assinatura tem
-- histórico e ciclo de vida próprios (pode ser cancelada e recriada), mesmo
-- raciocínio já usado para separar billing_plan_changes de users.
--
-- Status usa exatamente os valores documentados pela Stripe (conferido em
-- docs.stripe.com/billing/subscriptions/webhooks, 10/09/2026), para o
-- webhook (task 3 da mesma quebra) poder gravar o status recebido sem
-- tradução.
CREATE TABLE IF NOT EXISTS subscriptions (
  id BIGSERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stripe_subscription_id TEXT UNIQUE,
  stripe_price_id TEXT,
  plan TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'incomplete' CHECK (status IN (
    'trialing', 'active', 'incomplete', 'incomplete_expired',
    'past_due', 'canceled', 'unpaid', 'paused'
  )),
  current_period_end TIMESTAMPTZ,
  cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id ON subscriptions (user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_subscription_id
  ON subscriptions (stripe_subscription_id)
  WHERE stripe_subscription_id IS NOT NULL;

-- Reaproveitado entre toda assinatura futura do mesmo usuário, para não criar
-- um Stripe Customer duplicado a cada checkout (task 2 da mesma quebra).
ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT UNIQUE;
CREATE INDEX IF NOT EXISTS idx_users_stripe_customer_id
  ON users (stripe_customer_id)
  WHERE stripe_customer_id IS NOT NULL;
