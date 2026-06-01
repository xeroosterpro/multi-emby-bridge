-- Subscriptions (source of truth for access) + admin-managed discount codes.
CREATE TABLE IF NOT EXISTS subscriptions (
  user_id                UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  provider               TEXT NOT NULL DEFAULT 'paypal' CHECK (provider IN ('paypal','comp')),
  paypal_subscription_id TEXT,
  status                 TEXT NOT NULL DEFAULT 'none'
                           CHECK (status IN ('none','active','cancelled','past_due','comped')),
  current_period_end     TIMESTAMPTZ,
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS discount_codes (
  code        TEXT PRIMARY KEY,
  type        TEXT NOT NULL CHECK (type IN ('comp_100','percent_50','first_month_free')),
  active      BOOLEAN NOT NULL DEFAULT true,
  max_uses    INTEGER,
  uses        INTEGER NOT NULL DEFAULT 0,
  created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
