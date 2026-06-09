-- Admin Data Center: token audit, server intel snapshots, bridge host metrics.

CREATE TABLE IF NOT EXISTS token_events (
  id          BIGSERIAL PRIMARY KEY,
  server_url  TEXT NOT NULL,
  user_id     TEXT,
  label       TEXT,
  ok          BOOLEAN NOT NULL DEFAULT false,
  status      INTEGER,
  message     TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_token_events_time ON token_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_token_events_url ON token_events(server_url, created_at DESC);

CREATE TABLE IF NOT EXISTS intel_snapshots (
  id          BIGSERIAL PRIMARY KEY,
  server_key  TEXT NOT NULL,
  user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
  server_url  TEXT NOT NULL,
  label       TEXT,
  payload     JSONB NOT NULL DEFAULT '{}'::jsonb,
  probed_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_intel_snapshots_key_time ON intel_snapshots(server_key, probed_at DESC);
CREATE INDEX IF NOT EXISTS idx_intel_snapshots_probed ON intel_snapshots(probed_at DESC);

CREATE TABLE IF NOT EXISTS bridge_metrics (
  id              BIGSERIAL PRIMARY KEY,
  cpu_percent     INTEGER,
  sys_mem_pct     INTEGER,
  rss_bytes       BIGINT,
  heap_used_bytes BIGINT,
  load_avg1       NUMERIC(6,2),
  uptime_sec      INTEGER,
  sampled_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bridge_metrics_time ON bridge_metrics(sampled_at DESC);