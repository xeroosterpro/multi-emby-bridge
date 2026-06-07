// ─── Live playback helpers (stall / buffering detection) ─────────────────────
// Emby & Jellyfin expose PlayState.PositionTicks on /Sessions — when playback
// is active but position barely moves between polls, the client is likely buffering.

const TICKS_PER_SEC = 10_000_000;

function liveSessionKey(s) {
  return [s.server || '', s.user || '', s.title || '', s.client || ''].join('|');
}

function isPlaybackStalled(prev, curr, opts = {}) {
  const minTicks = opts.minTicks ?? 2 * TICKS_PER_SEC;
  if (!prev || !curr) return false;
  if (curr.isPaused) return false;
  if (curr.positionTicks == null || prev.positionTicks == null) return false;
  const delta = curr.positionTicks - prev.positionTicks;
  if (delta < 0) return false;
  return delta < minTicks;
}

function annotateBuffering(sessions, prevMap, opts = {}) {
  const minStallPolls = opts.minStallPolls ?? 2;
  const out = [];
  const nextPrev = new Map();
  const seen = new Set();

  for (const s of sessions || []) {
    const key = liveSessionKey(s);
    seen.add(key);
    const prev = prevMap.get(key);
    let stallCount = prev?.stallCount || 0;
    if (isPlaybackStalled(prev, s, opts)) stallCount += 1;
    else if (!s.isPaused) stallCount = 0;

    nextPrev.set(key, {
      positionTicks: s.positionTicks,
      ts: Date.now(),
      stallCount,
    });

    out.push({
      ...s,
      buffering: stallCount >= minStallPolls && !s.isPaused,
      stallCount,
    });
  }

  for (const key of [...prevMap.keys()]) {
    if (!seen.has(key)) prevMap.delete(key);
  }
  prevMap.clear();
  nextPrev.forEach((v, k) => prevMap.set(k, v));

  return out;
}

module.exports = {
  TICKS_PER_SEC,
  liveSessionKey,
  isPlaybackStalled,
  annotateBuffering,
};