// ─── Bounded LRU + TTL cache ─────────────────────────────────────────────────
// Replaces unbounded Map() caches keyed by user-controlled values (config blobs,
// catalog URLs) so they can't grow without limit. Map preserves insertion order,
// so the oldest key is evicted once `max` is exceeded; reads refresh recency.
// Inject `now` for deterministic tests.

function makeLruCache({ max = 500, ttlMs = 0, now = () => Date.now() } = {}) {
  const map = new Map(); // key -> { v, exp }

  function get(key) {
    const e = map.get(key);
    if (!e) return undefined;
    if (e.exp && now() > e.exp) { map.delete(key); return undefined; }
    map.delete(key); map.set(key, e); // bump recency
    return e.v;
  }

  function set(key, v, ttlOverride) {
    const ttl = ttlOverride != null ? ttlOverride : ttlMs;
    if (map.has(key)) map.delete(key);
    map.set(key, { v, exp: ttl ? now() + ttl : 0 });
    while (map.size > max) map.delete(map.keys().next().value); // evict oldest
    return v;
  }

  return {
    get,
    set,
    has: (key) => get(key) !== undefined,
    delete: (key) => map.delete(key),
    clear: () => map.clear(),
    get size() { return map.size; },
  };
}

module.exports = { makeLruCache };
