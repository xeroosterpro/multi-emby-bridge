-- Persist health monitoring state (servers + ping history) across restarts.
-- Single-row blob keyed by 'state'; mirrors the in-memory model in lib/health.js.
CREATE TABLE IF NOT EXISTS health_state (
  id          TEXT PRIMARY KEY,
  data        JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
