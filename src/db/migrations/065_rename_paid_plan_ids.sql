-- O catálogo público usa apenas os identificadores basico, pro e premium.
-- Os valores antigos são convertidos para preservar contas e cobranças existentes.
ALTER TABLE users ALTER COLUMN plan SET DEFAULT 'basico';
UPDATE users SET plan = 'basico' WHERE plan = 'gratuito';
UPDATE users SET plan = 'pro' WHERE plan = 'criador';
UPDATE users SET plan = 'premium' WHERE plan = 'agencia';

UPDATE billing_plan_changes SET from_plan = 'pro' WHERE from_plan = 'criador';
UPDATE billing_plan_changes SET from_plan = 'premium' WHERE from_plan = 'agencia';
UPDATE billing_plan_changes SET to_plan = 'pro' WHERE to_plan = 'criador';
UPDATE billing_plan_changes SET to_plan = 'premium' WHERE to_plan = 'agencia';
