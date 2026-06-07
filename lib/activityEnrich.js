// ─── Correlate live Sessions with request-log rows ───────────────────────────
// Watched history is title + time only; we match live Sessions to flag ▶ now
// without naming which server is playing.

function normalizeTitle(t) {
  return String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function titlesMatch(a, b) {
  const x = normalizeTitle(a);
  const y = normalizeTitle(b);
  if (!x || !y) return false;
  if (x === y) return true;
  if (x.length >= 4 && y.length >= 4 && (x.includes(y) || y.includes(x))) return true;
  const xWords = x.split(' ').filter(w => w.length > 2);
  const yWords = new Set(y.split(' ').filter(w => w.length > 2));
  if (!xWords.length || !yWords.size) return false;
  const overlap = xWords.filter(w => yWords.has(w)).length;
  return overlap >= Math.min(2, Math.ceil(xWords.length * 0.6));
}

function liveMatchRank(s) {
  const tier = { sessions: 0, 'user-playing': 1, 'browser-sessions': 2, bridge: 3 };
  const base = tier[s?.source] ?? 4;
  const confirmed = s?.source !== 'bridge' || !!s?.serverConfirmed;
  return base + (confirmed ? 0 : 0.5);
}

function matchLiveToEntry(entry, liveSessions) {
  if (!entry?.title || !Array.isArray(liveSessions)) return null;
  let best = null;
  let bestRank = 99;
  for (const s of liveSessions) {
    const candidates = [s.title, s.rawTitle, s.seriesName].filter(Boolean);
    if (!candidates.some(c => titlesMatch(entry.title, c))) continue;
    const rank = liveMatchRank(s);
    if (rank < bestRank) { best = s; bestRank = rank; }
  }
  return best;
}

function confirmedPlayingServer(playing) {
  if (!playing) return null;
  if (playing.source !== 'bridge') return playing.server || null;
  return playing.serverConfirmed ? (playing.server || null) : null;
}

function availableServersFromStatus(serverStatus) {
  if (!Array.isArray(serverStatus)) return [];
  return serverStatus
    .filter(s => s && s.status === 'found' && s.label)
    .map(s => s.label);
}

// Collapse repeat stream lookups of the same content into one row. Stremio fires
// several stream requests per episode (hover, click, retries, multiple devices),
// each logged as its own request_log row — left raw, the same episode floods the
// "Watched history" list. Input MUST be newest-first (requestLog.forUser is
// ORDER BY ts DESC); we keep the first (most recent) row per title/season/episode
// and tally the rest as lookupCount.
function recentContentKey(entry) {
  return [
    normalizeTitle(entry?.title),
    entry?.season ?? '',
    entry?.episode ?? '',
  ].join('|');
}

function dedupeRecentByContent(recent) {
  const byKey = new Map();
  for (const entry of recent || []) {
    if (!entry || !entry.title) continue;
    const key = recentContentKey(entry);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, { ...entry, lookupCount: 1 });
    } else {
      existing.lookupCount += 1;
    }
  }
  return [...byKey.values()];
}

function enrichRecentEntries(recent, liveSessions) {
  return (recent || []).map((entry) => {
    const playing = matchLiveToEntry(entry, liveSessions);
    const availableOn = availableServersFromStatus(entry.serverStatus);
    return {
      ...entry,
      availableOn: playing?.availableOn?.length ? playing.availableOn : availableOn,
      isLiveNow: !!playing,
      liveClient: playing?.client || null,
    };
  });
}

module.exports = {
  normalizeTitle,
  titlesMatch,
  liveMatchRank,
  matchLiveToEntry,
  confirmedPlayingServer,
  availableServersFromStatus,
  enrichRecentEntries,
  recentContentKey,
  dedupeRecentByContent,
};