-- Execute manualmente: psql $DATABASE_URL -f src/db/migrations/014_post_metrics_history.sql

-- Snapshot diário de likes/comentários/views por post, para alimentar o
-- gráfico de linha de curtidas ao longo do tempo no Analytics. A API das
-- redes sociais só retorna o valor atual (sem histórico), então salvamos um
-- ponto por dia a cada vez que o Analytics busca métricas.
CREATE TABLE IF NOT EXISTS post_metrics_history (
  id SERIAL PRIMARY KEY,
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  captured_on DATE NOT NULL DEFAULT CURRENT_DATE,
  likes INTEGER,
  comments INTEGER,
  views INTEGER,
  UNIQUE (post_id, captured_on)
);

CREATE INDEX IF NOT EXISTS idx_post_metrics_history_post_id ON post_metrics_history(post_id);
