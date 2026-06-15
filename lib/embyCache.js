// ─── Tiered TTL cache for outbound Emby traffic reduction ───────────────────
const { makeLruCache } = require('./lruCache');

const TTL_MS = 60 * 60 * 1000; // 60 minutes

const tiers = {
  L1: makeLruCache({ max: 512, ttlMs: TTL_MS }),
  L2: makeLruCache({ max: 400, ttlMs: TTL_MS }),
  L3: makeLruCache({ max: 200, ttlMs: TTL_MS }),
  manifest: makeLruCache({ max: 64, ttlMs: TTL_MS }),
};

const hitCounts = { L1: 0, L2: 0, L3: 0, manifest: 0 };

function get(tier, key) {
  const v = tiers[tier].get(key);
  if (v !== undefined) hitCounts[tier] = (hitCounts[tier] || 0) + 1;
  return v;
}

function set(tier, key, value, ttlOverride) {
  return tiers[tier].set(key, value, ttlOverride);
}

function getStats() {
  return {
    L1: { hits: hitCounts.L1, ttlMs: TTL_MS, size: tiers.L1.size },
    L2: { hits: hitCounts.L2, ttlMs: TTL_MS, size: tiers.L2.size },
    L3: { hits: hitCounts.L3, ttlMs: TTL_MS, size: tiers.L3.size },
    manifest: { hits: hitCounts.manifest, ttlMs: TTL_MS, size: tiers.manifest.size },
  };
}

function clearAll() {
  for (const t of Object.keys(tiers)) tiers[t].clear();
  hitCounts.L1 = 0;
  hitCounts.L2 = 0;
  hitCounts.L3 = 0;
  hitCounts.manifest = 0;
}

function l1Key(serverKey, url) {
  return `${serverKey}|${url}`;
}

function l3Key(configKey, type, streamId) {
  const { STREAM_PROFILE_VERSION } = require('./streamDefaults');
  return `v${STREAM_PROFILE_VERSION}|${configKey}|${type}|${streamId}`;
}

function manifestKey(configKey) {
  return configKey;
}

module.exports = {
  TTL_MS,
  get,
  set,
  getStats,
  clearAll,
  l1Key,
  l3Key,
  manifestKey,
};