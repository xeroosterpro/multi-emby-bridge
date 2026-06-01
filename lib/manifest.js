// ─── Per-user manifest tokens (subscription-gated + revocable) ───────────────
// Pure token logic + a pluggable store. Phase 1/in-house uses an in-memory store;
// Phase 2 swaps in a Postgres-backed store with the SAME interface:
//   issue(userId) -> token        (creates a new active token)
//   lookup(token) -> record|null  (null if unknown or revoked)
//   revoke(token) -> bool
//   regenerate(userId) -> token   (revokes the user's active tokens, issues a new one)
//
// A record is { token, userId, createdAt, revokedAt }.

const crypto = require('crypto');

// 24 random bytes → 32-char url-safe token. Unguessable; never derived from username.
function generateToken() {
  return crypto.randomBytes(24).toString('base64url');
}

function isValidTokenFormat(t) {
  return typeof t === 'string' && /^[A-Za-z0-9_-]{20,}$/.test(t);
}

function createMemoryStore() {
  const tokens = new Map(); // token -> record

  function issue(userId) {
    const token = generateToken();
    tokens.set(token, { token, userId, createdAt: Date.now(), revokedAt: null });
    return token;
  }
  function lookup(token) {
    const r = tokens.get(token);
    return r && !r.revokedAt ? r : null;
  }
  function revoke(token) {
    const r = tokens.get(token);
    if (!r || r.revokedAt) return false;
    r.revokedAt = Date.now();
    return true;
  }
  function regenerate(userId) {
    for (const r of tokens.values()) {
      if (r.userId === userId && !r.revokedAt) r.revokedAt = Date.now();
    }
    return issue(userId);
  }
  return { issue, lookup, revoke, regenerate, _all: () => [...tokens.values()] };
}

// Anti-sharing gate. STUBBED until the billing phase: returns true so the addon
// is usable while the rest is built. Phase 5 replaces the body with a real check:
//   subscription.status in ('active','comped') && current_period_end in the future.
function hasActiveAccess(/* subscriptionRecord */) {
  return true;
}

module.exports = { generateToken, isValidTokenFormat, createMemoryStore, hasActiveAccess };
