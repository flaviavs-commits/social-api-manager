-- Execute manualmente: psql $DATABASE_URL -f src/db/migrations/017_indices_publicacao.sql
-- Índices adicionais focados no caminho de publicação (scheduler + "publicar agora"),
-- complementando os índices simples de 013_indices_performance.sql.

-- reservarPostsPendentes() filtra por status='scheduled' AND scheduled_at <= NOW()
-- a cada execução do cron (1x/minuto). Um índice composto parcial evita varrer
-- posts já publicados/cancelados, que crescem sem limite com o tempo.
CREATE INDEX IF NOT EXISTS idx_posts_status_scheduled_at
  ON posts (scheduled_at)
  WHERE status = 'scheduled';

-- listarPostsPublicadosSemExternalId() filtra por platforms @> ARRAY[$1] —
-- containment em array sem índice faz full scan; GIN acelera esse operador.
CREATE INDEX IF NOT EXISTS idx_posts_platforms_gin ON posts USING GIN (platforms);

-- buscarContaToken()/listarContasToken() filtram por t.platform e fazem JOIN com
-- contas por c.id = t.conta_id, ordenando por t.id DESC — composto cobre o filtro
-- mais comum (uma plataforma, a conta mais recente) sem precisar do índice simples.
CREATE INDEX IF NOT EXISTS idx_tokens_conta_platform ON tokens (conta_id, platform);
