-- Execute manualmente: psql $DATABASE_URL -f src/db/migrations/018_contas_external_user_id.sql
-- Guarda o ID numérico do usuário na rede social (ex: Facebook user_id do
-- signed_request, Instagram user_id da Graph API) — necessário para localizar
-- e apagar os dados certos quando a Meta chamar o Data Deletion Callback
-- (ela manda esse ID, não o @handle). Contas conectadas antes desta coluna
-- existir ficam com external_user_id NULL até serem reconectadas.

ALTER TABLE contas ADD COLUMN IF NOT EXISTS external_user_id VARCHAR(64);

CREATE INDEX IF NOT EXISTS idx_contas_platform_external_user_id
  ON contas (platform, external_user_id);
