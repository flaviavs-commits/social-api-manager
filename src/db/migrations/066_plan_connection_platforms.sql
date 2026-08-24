-- Registra as redes escolhidas no cadastro e permite aplicar o limite de
-- conexões do plano no servidor. Contas antigas continuam com as quatro
-- plataformas disponíveis para não perder acesso às integrações existentes.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS allowed_platforms TEXT[] NOT NULL
  DEFAULT ARRAY['instagram', 'youtube', 'tiktok', 'facebook']::text[];

UPDATE users
   SET allowed_platforms = ARRAY['instagram', 'youtube', 'tiktok', 'facebook']::text[]
 WHERE allowed_platforms IS NULL OR cardinality(allowed_platforms) = 0;
