-- O produto não oferece mais um plano gratuito.
ALTER TABLE users ALTER COLUMN plan SET DEFAULT 'basico';
UPDATE users SET plan = 'basico' WHERE plan = 'gratuito';
