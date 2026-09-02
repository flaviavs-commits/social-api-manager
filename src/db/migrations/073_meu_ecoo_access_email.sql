-- Controla a entrega do link do MeuEcoo após a confirmação de planos Pro e Premium.
-- O estado fica na própria cobrança para que webhooks repetidos não dupliquem o e-mail.
ALTER TABLE billing_plan_changes
  ADD COLUMN IF NOT EXISTS meu_ecoo_email_status TEXT,
  ADD COLUMN IF NOT EXISTS meu_ecoo_email_attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS meu_ecoo_email_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS meu_ecoo_email_updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS meu_ecoo_email_last_error TEXT;

CREATE INDEX IF NOT EXISTS idx_billing_plan_changes_meu_ecoo_email
  ON billing_plan_changes (meu_ecoo_email_status)
  WHERE to_plan IN ('pro', 'premium');
