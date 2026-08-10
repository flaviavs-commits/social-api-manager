-- Automação de snapshots: YouTube público e contas autorizadas via Zernio.
-- Perfis públicos de terceiros continuam sem scraping/bypass.
ALTER TABLE competitor_profiles
  ADD COLUMN IF NOT EXISTS monitor_enabled BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE competitor_profiles
  ADD COLUMN IF NOT EXISTS monitor_provider TEXT NOT NULL DEFAULT 'auto'
    CHECK (monitor_provider IN ('auto', 'youtube_public', 'zernio'));

ALTER TABLE competitor_profiles
  ADD COLUMN IF NOT EXISTS monitor_interval_minutes INTEGER NOT NULL DEFAULT 15
    CHECK (monitor_interval_minutes IN (5, 15, 30, 60));

ALTER TABLE competitor_profiles
  ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMPTZ;

ALTER TABLE competitor_profiles
  ADD COLUMN IF NOT EXISTS monitor_status TEXT NOT NULL DEFAULT 'idle'
    CHECK (monitor_status IN ('idle', 'syncing', 'active', 'error', 'unsupported'));

ALTER TABLE competitor_profiles
  ADD COLUMN IF NOT EXISTS monitor_error TEXT;

CREATE INDEX IF NOT EXISTS idx_competitor_profiles_monitor_due
  ON competitor_profiles(monitor_enabled, last_synced_at);
