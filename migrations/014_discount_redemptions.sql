-- Per-user discount-code redemption ledger. Prevents a single user from
-- redeeming the same code more than once (SEC-4 residual): the atomic uses++
-- guard already enforces the global max_uses, but without this a single user
-- could repeatedly redeem a shared multi-use code and consume all its uses.
CREATE TABLE IF NOT EXISTS discount_redemptions (
  code        TEXT NOT NULL,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  redeemed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (code, user_id)
);
