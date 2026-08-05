-- Presets de configuração de publicação por rede — o usuário salva um
-- conjunto de opções (ex: "sempre privacidade pública no TikTok") e aplica
-- de novo em posts futuros em vez de reconfigurar toda vez. Guarda só as
-- config. de publicação da rede, não texto/mídia (ver editor React,
-- aplicarPresetNaRede). config é um JSON livre por rede:
--   instagram: { igFormat }
--   youtube:   { youtubeVisibility, youtubeCategoryId, youtubeMadeForKids }
--   tiktok:    { tiktokPrivacyLevel, tiktokDisableComment, tiktokDisableDuet, tiktokDisableStitch }
CREATE TABLE IF NOT EXISTS platform_presets (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  name TEXT NOT NULL,
  config JSONB NOT NULL DEFAULT '{}',
  criado_em TIMESTAMPTZ DEFAULT NOW()
);
