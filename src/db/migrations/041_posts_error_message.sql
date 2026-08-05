-- Mensagem da última falha de publicação, exibida no dashboard e usada pelo
-- fluxo de revisão/reenvio. Idempotente para bancos já atualizados.
ALTER TABLE posts ADD COLUMN IF NOT EXISTS error_message TEXT;
