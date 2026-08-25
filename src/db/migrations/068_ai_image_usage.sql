-- Limite mensal de imagens geradas pela Assistente de IA por usuário.
CREATE TABLE IF NOT EXISTS ai_image_usage (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  usage_month DATE NOT NULL,
  images_used INTEGER NOT NULL DEFAULT 0 CHECK (images_used >= 0),
  PRIMARY KEY (user_id, usage_month)
);
