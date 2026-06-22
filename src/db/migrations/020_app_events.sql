-- Execute manualmente: psql $DATABASE_URL -f src/db/migrations/020_app_events.sql
-- Eventos nomeados (post_published, youtube_video_ready) hoje só existem em
-- memória, transmitidos via SSE para clientes conectados no momento exato do
-- broadcast. Em serverless não há conexão persistente para escutar isso, então
-- esses eventos passam a ser persistidos aqui e consumidos via polling
-- (GET /api/events/since/:lastId), igual ao histórico de logs.

CREATE TABLE IF NOT EXISTS app_events (
  id BIGSERIAL PRIMARY KEY,
  event_name TEXT NOT NULL,
  payload JSONB NOT NULL,
  user_id INTEGER REFERENCES users(id),
  criado_em TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_app_events_id ON app_events (id);
