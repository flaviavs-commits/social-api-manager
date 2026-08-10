-- Benchmarking de perfis públicos. Os dados são snapshots informados pelo
-- usuário ou por uma integração oficial; não há credenciais ou dados privados.
ALTER TABLE competitor_profiles
  ADD COLUMN IF NOT EXISTS niche TEXT NOT NULL DEFAULT 'geral';

ALTER TABLE competitor_profiles
  ADD COLUMN IF NOT EXISTS public_only BOOLEAN NOT NULL DEFAULT TRUE;

CREATE TABLE IF NOT EXISTS public_profile_snapshots (
  id SERIAL PRIMARY KEY,
  competitor_profile_id INTEGER NOT NULL REFERENCES competitor_profiles(id) ON DELETE CASCADE,
  captured_on DATE NOT NULL DEFAULT CURRENT_DATE,
  followers BIGINT NOT NULL DEFAULT 0 CHECK (followers >= 0),
  posts_last_30_days INTEGER NOT NULL DEFAULT 0 CHECK (posts_last_30_days >= 0),
  avg_likes NUMERIC(20, 2) NOT NULL DEFAULT 0 CHECK (avg_likes >= 0),
  avg_comments NUMERIC(20, 2) NOT NULL DEFAULT 0 CHECK (avg_comments >= 0),
  avg_shares NUMERIC(20, 2) NOT NULL DEFAULT 0 CHECK (avg_shares >= 0),
  avg_views NUMERIC(20, 2) NOT NULL DEFAULT 0 CHECK (avg_views >= 0),
  avg_saves NUMERIC(20, 2) NOT NULL DEFAULT 0 CHECK (avg_saves >= 0),
  source_url TEXT,
  collection_method TEXT NOT NULL DEFAULT 'manual' CHECK (collection_method IN ('manual', 'official_api')),
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (competitor_profile_id, captured_on)
);

CREATE INDEX IF NOT EXISTS idx_public_profile_snapshots_profile_date
  ON public_profile_snapshots(competitor_profile_id, captured_on DESC);

CREATE INDEX IF NOT EXISTS idx_competitor_profiles_user_niche
  ON competitor_profiles(user_id, niche, criado_em DESC);
