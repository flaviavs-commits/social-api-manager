CREATE TABLE IF NOT EXISTS media_folders (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  criado_em TIMESTAMPTZ DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_media_folders_user_name_lower ON media_folders(user_id, LOWER(name));
