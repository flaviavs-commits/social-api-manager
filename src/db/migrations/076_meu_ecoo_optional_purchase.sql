-- Registra a aquisição opcional do MeuEcoo no checkout do plano Pro.
-- O valor total continua em billing_plan_changes.amount_cents para validação
-- do webhook, enquanto estes campos preservam a composição da cobrança.
ALTER TABLE billing_plan_changes
  ADD COLUMN IF NOT EXISTS meu_ecoo_selected BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS meu_ecoo_amount_cents INTEGER NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'billing_plan_changes_meu_ecoo_amount_non_negative'
       AND conrelid = 'billing_plan_changes'::regclass
  ) THEN
    ALTER TABLE billing_plan_changes
      ADD CONSTRAINT billing_plan_changes_meu_ecoo_amount_non_negative
      CHECK (meu_ecoo_amount_cents >= 0);
  END IF;
END $$;

-- Cobranças Pro/Premium anteriores já concediam o benefício do MeuEcoo.
-- Preserva esse histórico para reprocessamento seguro de webhooks antigos.
UPDATE billing_plan_changes
   SET meu_ecoo_selected = TRUE
 WHERE to_plan IN ('pro', 'premium')
   AND meu_ecoo_selected = FALSE;
