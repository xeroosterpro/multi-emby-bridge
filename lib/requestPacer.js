// ─── Per-host request pacing + in-flight dedup ───────────────────────────────
const PACE_MS = Math.max(250, parseInt(process.env.EMBY_PACE_MS || '300', 10) || 300);

const lastCallByHost = new Map();
const inFlight = new Map();

const stats = {
  scheduled: 0,
  coalesced: 0,
  dropped: 0,
  pacedDelays: [],
  lastDelayMs: 0,
};

function _recordDelay(ms) {
  stats.lastDelayMs = ms;
  stats.pacedDelays.push(ms);
  if (stats.pacedDelays.length > 50) stats.pacedDelays.shift();
}

function getPacingStats() {
  const delays = stats.pacedDelays;
  const avgDelayMs = delays.length
    ? Math.round(delays.reduce((a, b) => a + b, 0) / delays.length)
    : 0;
  return {
    scheduled: stats.scheduled,
    coalesced: stats.coalesced,
    dropped: stats.dropped,
    avgDelayMs,
    lastDelayMs: stats.lastDelayMs,
    paceMs: PACE_MS,
  };
}

function resetPacingStats() {
  stats.scheduled = 0;
  stats.coalesced = 0;
  stats.dropped = 0;
  stats.pacedDelays = [];
  stats.lastDelayMs = 0;
  lastCallByHost.clear();
  inFlight.clear();
}

const _delay = (ms) => new Promise((r) => setTimeout(r, ms));

async function schedule(host, dedupKey, fn) {
  const flightKey = `${host}|${dedupKey}`;
  const existing = inFlight.get(flightKey);
  if (existing) {
    stats.coalesced++;
    return existing;
  }

  const p = (async () => {
    stats.scheduled++;
    const last = lastCallByHost.get(host) || 0;
    const wait = Math.max(0, PACE_MS - (Date.now() - last));
    if (wait > 0) {
      _recordDelay(wait);
      await _delay(wait);
    }
    lastCallByHost.set(host, Date.now());
    try {
      return await fn();
    } finally {
      inFlight.delete(flightKey);
    }
  })();

  inFlight.set(flightKey, p);
  return p;
}

// Stream-request coalescing + rapid-scroll debounce (per config)
const streamInFlight = new Map();
const streamLastKey = new Map();
const STREAM_DEBOUNCE_MS = 250;

function coalesceStream(configKey, streamKey, fn) {
  const fullKey = `${configKey}|${streamKey}`;
  const prevKey = streamLastKey.get(configKey);
  const now = Date.now();

  if (prevKey && prevKey.key !== streamKey && (now - prevKey.ts) < STREAM_DEBOUNCE_MS) {
    const oldFlight = streamInFlight.get(`${configKey}|${prevKey.key}`);
    if (oldFlight) {
      stats.dropped++;
      oldFlight.cancelled = true;
    }
  }
  streamLastKey.set(configKey, { key: streamKey, ts: now });

  const existing = streamInFlight.get(fullKey);
  if (existing && !existing.cancelled) {
    stats.coalesced++;
    return existing.promise;
  }

  const flight = { cancelled: false, promise: null };
  flight.promise = (async () => {
    try {
      const result = await fn();
      if (flight.cancelled) {
        const err = new Error('superseded');
        err.superseded = true;
        throw err;
      }
      return result;
    } finally {
      if (streamInFlight.get(fullKey) === flight) streamInFlight.delete(fullKey);
    }
  })();
  streamInFlight.set(fullKey, flight);
  return flight.promise;
}

module.exports = {
  PACE_MS,
  schedule,
  coalesceStream,
  getPacingStats,
  resetPacingStats,
};