-- Execute manualmente: psql $DATABASE_URL -f src/db/migrations/029_post_text_by_platform.sql
-- (também roda automaticamente no startup via runMigrations() em server.js)

-- Permite um texto diferente por rede social no mesmo post (Agendador manual).
-- Opcional: só contém as plataformas cujo texto foi explicitamente
-- diferenciado do texto principal (posts.text, que continua sendo gravado
-- sempre e é usado como fallback e pelas demais telas/fluxos que ainda leem
-- só posts.text — Calendário, Analytics, Inbox, Agente IA, rascunhos).
ALTER TABLE posts ADD COLUMN IF NOT EXISTS text_by_platform JSONB;
