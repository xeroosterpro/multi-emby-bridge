-- Idempotency ledger for inbound PayPal webhooks. PayPal retries deliveries
-- (and may send the same event more than once); recording each event id lets us
-- skip duplicates so a payment/activation/comp is never applied twice.
CREATE TABLE IF NOT EXISTS processed_webhooks (
  event_id     TEXT PRIMARY KEY,
  event_type   TEXT,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
