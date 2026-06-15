// ─── Per-key circuit breaker with exponential backoff + jitter ───────────────
// Wraps unreliable upstreams (Emby/Jellyfin servers) so a failing server is
// "fast-failed" instead of hammered on every request. This is what stops the
// re-auth storm: once a server trips the breaker, calls short-circuit for a
// growing cooldown (30s → 60s → … → 15m) instead of hitting the network and
// re-authenticating thousands of times a day.
//
// States: closed (normal) → open (cooldown, fast-fail) → half-open (one probe
// allowed) → closed on success / re-open (longer cooldown) on failure.
//
// Pure logic — inject `now`/`random` for deterministic tests.

function makeCircuitBreaker(opts = {}) {
  const failureThreshold = opts.failureThreshold ?? 3;     // consecutive fails to open
  const baseCooldownMs   = opts.baseCooldownMs   ?? 30_000;
  const maxCooldownMs    = opts.maxCooldownMs    ?? 15 * 60_000;
  const jitterRatio      = opts.jitterRatio      ?? 0.2;    // ± up to 20% jitter
  const now    = opts.now    ?? (() => Date.now());
  const random = opts.random ?? Math.random;

  const cells = new Map(); // key -> { fails, openUntil, cycles }

  function cell(key) {
    let c = cells.get(key);
    if (!c) { c = { fails: 0, openUntil: 0, cycles: 0 }; cells.set(key, c); }
    return c;
  }
  function cooldownMs(cycles) {
    const exp = Math.min(maxCooldownMs, baseCooldownMs * 2 ** Math.max(0, cycles - 1));
    return Math.round(exp + exp * jitterRatio * random());
  }
  function isOpen(c) { return c.openUntil > 0 && now() < c.openUntil; }

  return {
    // May a request (or recovery probe) proceed? False only while open in cooldown.
    allow(key) {
      const c = cells.get(key);
      return !c || !isOpen(c);
    },
    state(key) {
      const c = cells.get(key);
      if (!c || !c.openUntil) return 'closed';
      return isOpen(c) ? 'open' : 'half-open';
    },
    onSuccess(key) {
      const c = cell(key);
      c.fails = 0; c.openUntil = 0; c.cycles = 0;
    },
    onFailure(key) {
      const c = cell(key);
      if (c.openUntil && !isOpen(c)) {
        // Failed the half-open probe → escalate straight to a longer cooldown.
        c.cycles += 1; c.openUntil = now() + cooldownMs(c.cycles); c.fails = failureThreshold;
        return;
      }
      c.fails += 1;
      if (c.fails >= failureThreshold) {
        c.cycles += 1; c.openUntil = now() + cooldownMs(c.cycles);
      }
    },
    retryAfterMs(key) {
      const c = cells.get(key);
      return c && isOpen(c) ? Math.max(0, c.openUntil - now()) : 0;
    },
    // Observability: open/half-open circuits for the admin data center.
    snapshot() {
      const out = [];
      for (const [key, c] of cells) {
        const st = !c.openUntil ? 'closed' : (isOpen(c) ? 'open' : 'half-open');
        if (st !== 'closed') out.push({ key, state: st, fails: c.fails, cycles: c.cycles, retryAfterMs: this.retryAfterMs(key) });
      }
      return out;
    },
    reset(key) { if (key == null) cells.clear(); else cells.delete(key); },
  };
}

module.exports = { makeCircuitBreaker };
