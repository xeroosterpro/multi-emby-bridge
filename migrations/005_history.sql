-- Going-forward payment records, billing audit trail, and per-user server uptime.

CREATE TABLE IF NOT EXISTS payments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  paypal_sale_id  TEXT UNIQUE,
  amount          NUMERIC(10,2),
  currency        TEXT DEFAULT 'USD',
  status          TEXT NOT NULL DEFAULT 'completed',
  paid_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_payments_user ON payments(user_id, paid_at DESC);

CREATE TABLE IF NOT EXISTS billing_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type        TEXT NOT NULL,
  detail      JSONB NOT NULL DEFAULT '{}'::jsonb,
  actor_id    UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_billing_events_user ON billing_events(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS server_health_log (
  id           BIGSERIAL PRIMARY KEY,
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  server_url   TEXT NOT NULL,
  label        TEXT,
  up           BOOLEAN NOT NULL,
  response_ms  INTEGER,
  checked_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_shl_user_time ON server_health_log(user_id, checked_at DESC);

CREATE TABLE IF NOT EXISTS server_uptime_daily (
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  server_url  TEXT NOT NULL,
  label       TEXT,
  day         DATE NOT NULL,
  checks      INTEGER NOT NULL DEFAULT 0,
  up_checks   INTEGER NOT NULL DEFAULT 0,
  avg_ms      INTEGER,
  PRIMARY KEY (user_id, server_url, day)
);
