-- Durable per-user request log (replaces the in-memory capped array for history).
CREATE TABLE IF NOT EXISTS request_log (
  id            BIGSERIAL PRIMARY KEY,
  user_id       UUID REFERENCES users(id) ON DELETE CASCADE,
  ts            TIMESTAMPTZ NOT NULL DEFAULT now(),
  type          TEXT,
  imdb_id       TEXT,
  content_name  TEXT,
  best_server   TEXT,
  season        INTEGER,
  episode       INTEGER,
  response_ms   INTEGER,
  found         BOOLEAN DEFAULT false
);
CREATE INDEX IF NOT EXISTS idx_request_log_user ON request_log(user_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_request_log_ts ON request_log(ts DESC);
