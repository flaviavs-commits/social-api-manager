-- Execute manualmente: psql $DATABASE_URL -f src/db/migrations/013_indices_performance.sql
-- Índices nas colunas mais usadas em WHERE/JOIN/ORDER BY, identificadas como
-- causa de full table scan nas queries de dashboard, tokens, posts e publicação.

CREATE INDEX IF NOT EXISTS idx_contas_user_id ON contas (user_id);
CREATE INDEX IF NOT EXISTS idx_contas_platform ON contas (platform);

CREATE INDEX IF NOT EXISTS idx_tokens_conta_id ON tokens (conta_id);
CREATE INDEX IF NOT EXISTS idx_tokens_platform ON tokens (platform);
CREATE INDEX IF NOT EXISTS idx_tokens_status ON tokens (status);
CREATE INDEX IF NOT EXISTS idx_tokens_platform_status ON tokens (platform, status);

CREATE INDEX IF NOT EXISTS idx_posts_status ON posts (status);
CREATE INDEX IF NOT EXISTS idx_posts_user_id ON posts (user_id);
CREATE INDEX IF NOT EXISTS idx_posts_scheduled_at ON posts (scheduled_at);
CREATE INDEX IF NOT EXISTS idx_posts_account_id ON posts (account_id);

CREATE INDEX IF NOT EXISTS idx_logs_user_id ON logs (user_id);
CREATE INDEX IF NOT EXISTS idx_logs_criado_em ON logs (criado_em);
