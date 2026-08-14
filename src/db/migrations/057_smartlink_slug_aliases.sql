CREATE TABLE IF NOT EXISTS smartlink_slug_aliases (
  slug TEXT PRIMARY KEY,
  smartlink_id INTEGER NOT NULL REFERENCES smartlinks(id) ON DELETE CASCADE,
  criado_em TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_smartlink_slug_aliases_smartlink ON smartlink_slug_aliases(smartlink_id);
