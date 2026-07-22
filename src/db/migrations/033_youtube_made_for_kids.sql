-- Execute manualmente: psql $DATABASE_URL -f src/db/migrations/033_youtube_made_for_kids.sql
-- (também roda automaticamente no startup via runMigrations() em server.js)

-- Declaração obrigatória do YouTube (status.selfDeclaredMadeForKids na Data
-- API v3, exigida pela FTC/COPPA) — todo vídeo enviado precisa dizer se é ou
-- não "feito para crianças". Sem essa coluna, o publisher nunca enviava o
-- campo e o YouTube assumia o default da API (false / "Não, não é feito
-- para crianças"), sem o usuário ter escolhido isso conscientemente.
ALTER TABLE posts ADD COLUMN IF NOT EXISTS youtube_made_for_kids BOOLEAN;
