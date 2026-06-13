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
  // Prefer imdbId — it uniquely identifies the series/movie, so two different
  // shows that happen to share a generic title ("Episode 2") and S/E won't merge.
  // Fall back to the normalized title for rows logged without an imdbId.
  const base = entry?.imdbId || normalizeTitle(entry?.title);
  return [
    base,
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

// Does a watched-history row correspond to something in the live set? Used so the
// history "▶ now" tag is computed against the SAME (suppressed/real-session) live
// list the Live panel shows, instead of a separate, looser bridge self-match.
// Titles now embed SxEy, but we still guard on season/episode so two episodes of
// the same series can't cross-match via the fuzzy word-overlap in titlesMatch.
function recentMatchesLive(entry, liveList) {
  if (!entry || !entry.title || !Array.isArray(liveList)) return false;
  const entryHasSE = entry.season != null && entry.episode != null;
  for (const s of liveList) {
    if (!s) continue;
    if (entryHasSE && s.season != null && s.episode != null) {
      if (Number(s.season) !== Number(entry.season) || Number(s.episode) !== Number(entry.episode)) continue;
    }
    const candidates = [s.title, s.rawTitle, s.seriesName].filter(Boolean);
    if (candidates.some(c => titlesMatch(entry.title, c))) return true;
  }
  return false;
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

function normalizeBridgeEntry(entry) {
  return {
    ...entry,
    source: 'bridge',
    kind: entry.kind || 'lookup',
    serverType: entry.serverType || null,
    progressPct: entry.progressPct ?? null,
    sources: entry.sources || ['bridge'],
  };
}

// Inject live server sessions into the Recent activity list when they have no
// matching history row (e.g. currently playing on Emby/Jellyfin but not in watch log).
function mergeLiveIntoRecent(recent, live, opts = {}) {
  const limit = opts.limit || 30;
  const list = [...(recent || [])];
  const liveSessions = (live || []).filter(s => s && (s.title || s.rawTitle || s.seriesName));

  for (const session of liveSessions) {
    const title = session.title || session.rawTitle || session.seriesName;
    if (!title) continue;
    if (list.some(entry => recentMatchesLive(entry, [session]))) continue;
    list.unshift({
      title: session.title || title,
      season: session.season ?? null,
      episode: session.episode ?? null,
      server: session.server || session.pickedServer || null,
      source: 'server',
      kind: 'live',
      ts: new Date().toISOString(),
      serverType: session.serverType || null,
      sources: ['server'],
    });
  }

  const seen = new Set();
  const deduped = [];
  for (const entry of list) {
    if (!entry?.title) continue;
    const key = recentContentKey(entry);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(entry);
    if (deduped.length >= limit) break;
  }
  return deduped;
}

function mergeActivityHistory(bridgeRecent, serverEntries, opts = {}) {
  const limit = opts.limit || 24;
  const byKey = new Map();

  function upsert(entry) {
    if (!entry?.title) return;
    const key = recentContentKey(entry);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, {
        ...entry,
        lookupCount: entry.source === 'bridge' ? (entry.lookupCount || 1) : 0,
        sources: [...(entry.sources || [entry.source].filter(Boolean))],
      });
      return;
    }
    if (entry.source === 'bridge') existing.lookupCount = (existing.lookupCount || 0) + (entry.lookupCount || 1);
    for (const s of (entry.sources || [entry.source])) {
      if (s && !existing.sources.includes(s)) existing.sources.push(s);
    }
    const ets = existing.ts ? new Date(existing.ts).getTime() : 0;
    const nts = entry.ts ? new Date(entry.ts).getTime() : 0;
    if (nts >= ets) {
      existing.ts = entry.ts || existing.ts;
      if (entry.server) existing.server = entry.server;
    }
    if (entry.kind === 'resume') {
      existing.kind = 'resume';
      if (entry.progressPct != null) existing.progressPct = entry.progressPct;
    } else if (entry.kind === 'played' && existing.kind !== 'resume') {
      existing.kind = 'played';
    }
    if (entry.source === 'server') {
      existing.serverType = entry.serverType || existing.serverType;
      existing.server = entry.server || existing.server;
      if (entry.imdbId && !existing.imdbId) existing.imdbId = entry.imdbId;
    }
    if (entry.source === 'bridge' && !existing.server && entry.server) existing.server = entry.server;
  }

  for (const e of bridgeRecent || []) upsert(normalizeBridgeEntry(e));
  for (const e of serverEntries || []) upsert({ ...e, sources: ['server'] });

  return [...byKey.values()]
    .sort((a, b) => {
      const resumeBoost = (k) => (k === 'resume' ? 1 : 0);
      const rb = resumeBoost(b.kind) - resumeBoost(a.kind);
      if (rb !== 0 && (!a.ts || !b.ts)) return rb;
      return (new Date(b.ts || 0).getTime()) - (new Date(a.ts || 0).getTime());
    })
    .slice(0, limit);
}

module.exports = {
  normalizeTitle,
  titlesMatch,
  liveMatchRank,
  matchLiveToEntry,
  availableServersFromStatus,
  enrichRecentEntries,
  recentContentKey,
  dedupeRecentByContent,
  recentMatchesLive,
  normalizeBridgeEntry,
  mergeActivityHistory,
  mergeLiveIntoRecent,
};