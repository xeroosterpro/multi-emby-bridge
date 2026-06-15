// ─── Tiered TTL cache for outbound Emby traffic reduction ───────────────────
const crypto = require('crypto');
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

function l1UrlForCache(urlStr) {
  try {
    const u = new URL(urlStr);
    u.searchParams.delete('api_key');
    return u.toString();
  } catch {
    return String(urlStr).replace(/([?&])api_key=[^&]*/gi, '$1').replace(/[?&]$/, '');
  }
}

function l3OptsHash(opts = {}) {
  const slice = {
    autoSelect: !!opts.autoSelect,
    sortOrder: opts.sortOrder || null,
    excludeRes: opts.excludeRes || null,
    audioRank: opts.audioRank !== false,
    audioOrder: opts.audioOrder || null,
    audioDisabled: opts.audioDisabled || [],
    labelPreset: opts.labelPreset || 'standard',
  };
  return crypto.createHash('sha256').update(JSON.stringify(slice)).digest('hex').slice(0, 12);
}

function l3Key(configKey, type, streamId, opts) {
  const { STREAM_PROFILE_VERSION } = require('./streamDefaults');
  const oh = opts ? l3OptsHash(opts) : '0';
  return `v${STREAM_PROFILE_VERSION}|${configKey}|${type}|${streamId}|${oh}`;
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
  l1UrlForCache,
  l3OptsHash,
  l3Key,
  manifestKey,
};