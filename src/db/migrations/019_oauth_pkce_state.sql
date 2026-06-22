-- Execute manualmente: psql $DATABASE_URL -f src/db/migrations/019_oauth_pkce_state.sql
-- Estado do PKCE (TikTok OAuth) movido de um Map em memória para o banco —
-- em serverless (Vercel), cada invocação pode cair numa instância de função
-- diferente, então um Map a nível de módulo não sobrevive entre a chamada
-- que inicia o OAuth e o callback que o conclui.

CREATE TABLE IF NOT EXISTS oauth_pkce_state (
  state TEXT PRIMARY KEY,
  code_verifier TEXT NOT NULL,
  criado_em TIMESTAMP NOT NULL DEFAULT NOW()
);
