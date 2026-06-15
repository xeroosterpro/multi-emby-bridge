// ─── Per-host request pacing + in-flight dedup ───────────────────────────────
const PACE_MS = Math.max(250, parseInt(process.env.EMBY_PACE_MS || '300', 10) || 300);
const STREAM_PACE_MS = Math.max(0, parseInt(process.env.EMBY_STREAM_PACE_MS || '0', 10) || 0);

const lastCallByHost = new Map();
const inFlight = new Map();
const hostChains = new Map();

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
  hostChains.clear();
}

const _delay = (ms) => new Promise((r) => setTimeout(r, ms));

function _enqueueHost(host, paceMs, fn) {
  const prev = hostChains.get(host) || Promise.resolve();
  const run = prev.then(async () => {
    stats.scheduled++;
    const last = lastCallByHost.get(host) || 0;
    const wait = Math.max(0, paceMs - (Date.now() - last));
    if (wait > 0) {
      _recordDelay(wait);
      await _delay(wait);
    }
    lastCallByHost.set(host, Date.now());
    return fn();
  });
  hostChains.set(host, run.catch(() => {}));
  return run;
}

async function schedule(host, dedupKey, fn, opts = {}) {
  const flightKey = `${host}|${dedupKey}`;
  const existing = inFlight.get(flightKey);
  if (existing) {
    stats.coalesced++;
    return existing;
  }

  const paceMs = opts.fast ? STREAM_PACE_MS : PACE_MS;

  const p = _enqueueHost(host, paceMs, async () => {
    try {
      return await fn();
    } finally {
      inFlight.delete(flightKey);
    }
  });

  inFlight.set(flightKey, p);
  return p;
}

// Stream-request coalescing + rapid-scroll debounce (per config)
const streamInFlight = new Map();
const streamLastKey = new Map();
const STREAM_DEBOUNCE_MS = 250;

function coalesceStream(configKey, streamKey, fn, opts = {}) {
  const fullKey = `${configKey}|${streamKey}`;
  const prevKey = streamLastKey.get(configKey);
  const now = Date.now();

  if (prevKey && prevKey.key !== streamKey && (now - prevKey.ts) < STREAM_DEBOUNCE_MS) {
    const oldFullKey = `${configKey}|${prevKey.key}`;
    const oldFlight = streamInFlight.get(oldFullKey);
    if (oldFlight) {
      stats.dropped++;
      oldFlight.cancelled = true;
      if (oldFlight.abort) oldFlight.abort.abort();
      if (oldFlight.reject) {
        const err = new Error('superseded');
        err.superseded = true;
        oldFlight.reject(err);
      }
    }
  }
  streamLastKey.set(configKey, { key: streamKey, ts: now });

  const existing = streamInFlight.get(fullKey);
  if (existing && !existing.cancelled) {
    stats.coalesced++;
    return existing.promise;
  }

  const abort = new AbortController();
  const flight = { cancelled: false, promise: null, abort, resolve: null, reject: null };
  flight.promise = new Promise((resolve, reject) => {
    flight.resolve = resolve;
    flight.reject = reject;
    (async () => {
      try {
        if (flight.cancelled || abort.signal.aborted) {
          const err = new Error('superseded');
          err.superseded = true;
          throw err;
        }
        resolve(await fn(abort.signal));
      } catch (err) {
        reject(err);
      } finally {
        if (streamInFlight.get(fullKey) === flight) streamInFlight.delete(fullKey);
      }
    })();
  });
  streamInFlight.set(fullKey, flight);
  return flight.promise;
}

module.exports = {
  PACE_MS,
  STREAM_PACE_MS,
  schedule,
  coalesceStream,
  getPacingStats,
  resetPacingStats,
};