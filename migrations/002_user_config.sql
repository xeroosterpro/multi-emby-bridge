-- Per-user stored config (non-sensitive blob) + API keys encrypted at rest.
CREATE TABLE IF NOT EXISTS user_config (
  user_id        UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  config_json    JSONB NOT NULL DEFAULT '{}'::jsonb,
  trakt_enc      TEXT,
  tmdb_enc       TEXT,
  mdblist_enc    TEXT,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Per-user manifest tokens (revocable). One active (revoked_at IS NULL) per user.
CREATE TABLE IF NOT EXISTS manifest_tokens (
  token       TEXT PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_manifest_tokens_user ON manifest_tokens(user_id);
