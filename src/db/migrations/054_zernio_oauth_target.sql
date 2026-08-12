ALTER TABLE zernio_oauth_pending
  ADD COLUMN IF NOT EXISTS account_name TEXT;
