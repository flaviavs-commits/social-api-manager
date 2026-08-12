ALTER TABLE zernio_oauth_pending
  ADD COLUMN IF NOT EXISTS return_to TEXT;
