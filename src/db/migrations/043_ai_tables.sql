-- Tabelas da IA. Antes eram criadas como efeito colateral do require de
-- src/routes/ai.js, o que abria conexão com o banco em health checks/testes.
CREATE TABLE IF NOT EXISTS user_ai_keys (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  modelo TEXT NOT NULL,
  api_key TEXT NOT NULL,
  last_four TEXT,
  status TEXT NOT NULL DEFAULT 'valid',
  criado_em TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, modelo)
);

CREATE TABLE IF NOT EXISTS user_ai_prefs (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  preferred_model TEXT NOT NULL,
  atualizado_em TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ai_demo_usage (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  dia DATE NOT NULL,
  usos INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, dia)
);

CREATE TABLE IF NOT EXISTS ai_activity_log (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  acao TEXT NOT NULL,
  status TEXT NOT NULL,
  modelo TEXT,
  detalhes TEXT,
  criado_em TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ai_chat_messages (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  contexto TEXT NOT NULL,
  role TEXT NOT NULL,
  conteudo TEXT NOT NULL,
  criado_em TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_chat_messages_user ON ai_chat_messages (user_id, criado_em DESC);

CREATE TABLE IF NOT EXISTS ai_image_leads (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  email TEXT NOT NULL,
  descricao TEXT,
  criado_em TIMESTAMPTZ DEFAULT NOW()
);
