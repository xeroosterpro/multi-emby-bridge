-- Encrypt per-server Emby/Jellyfin credentials at rest (apiKey, username, password).
ALTER TABLE user_config ADD COLUMN IF NOT EXISTS servers_enc TEXT;