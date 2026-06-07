// ─── Infer "playing now" from recent bridge stream lookups ───────────────────
// When Emby/Jellyfin Sessions API is unreachable from the addon host (common on
// reseller boxes that block datacenter IPs), Stremio still hits the bridge for
// stream lists. Recent successful lookups are a practical live signal.

const {
  titlesMatch,
  normalizeTitle,
  availableServersFromStatus,
} = require('./activityEnrich');

// A stream lookup only means "Stremio asked for streams" — opening an episode,
// not necessarily playing it. There is no "stop" signal (streams go direct to
// Emby, and /Sessions is often blocked on reseller boxes), so this window is the
// only lever for clearing a stopped stream. Keep it short (90s) so a stop clears
// quickly instead of lingering for minutes.
const DEFAULT_BRIDGE_LIVE_MS = 90 * 1000;

function resolveBridgePlayback(entry) {
  const pickedServer = entry?.server || (entry?.bestFile && entry.bestFile.label) || null;
  const availableOn = availableServersFromStatus(entry?.serverStatus);
  let server = null;
  let serverConfirmed = false;

  if (availableOn.length === 1) {
    server = availableOn[0];
    serverConfirmed = true;
  } else if (availableOn.length > 1) {
    server = null;
    serverConfirmed = false;
  } else if (pickedServer) {
    server = pickedServer;
    serverConfirmed = false;
  }

  return { pickedServer, server, availableOn, serverConfirmed };
}

function inferLiveFromRecent(recent, opts = {}) {
  const maxAgeMs = opts.maxAgeMs ?? DEFAULT_BRIDGE_LIVE_MS;
  const now = Date.now();
  const seen = new Map();

  for (const entry of recent || []) {
    if (!entry?.found || !entry.title) continue;
    const ts = entry.ts ? new Date(entry.ts).getTime() : 0;
    if (!ts) continue;
    const age = now - ts;
    if (age < 0 || age > maxAgeMs) continue;

    const resolved = resolveBridgePlayback(entry);
    if (!resolved.pickedServer && !resolved.server && !resolved.availableOn.length) continue;

    const key = [entry.title, entry.season ?? '', entry.episode ?? ''].join('|');
    if (seen.has(key)) continue;

    seen.set(key, {
      server: resolved.server,
      pickedServer: resolved.pickedServer,
      availableOn: resolved.availableOn,
      serverConfirmed: resolved.serverConfirmed,
      title: entry.title,
      rawTitle: entry.title,
      season: entry.season ?? null,
      episode: entry.episode ?? null,
      user: null,
      client: 'Stremio',
      device: null,
      positionTicks: null,
      runTimeTicks: null,
      progressPct: null,
      isPaused: false,
      playMethod: null,
      isTranscoding: false,
      sessionId: null,
      source: 'bridge',
      inferredAgeMs: age,
    });
  }

  return [...seen.values()];
}

function liveEntryKey(s) {
  return [s.server || '', s.title || '', s.user || '', s.source || ''].join('|');
}

function mergeLiveSources(lists, opts = {}) {
  const prefer = opts.preferSources || ['sessions', 'user-playing', 'browser-sessions', 'bridge'];
  const rank = new Map(prefer.map((s, i) => [s, i]));
  const map = new Map();

  for (const list of lists) {
    for (const s of list || []) {
      if (!s?.title) continue;
      const key = liveEntryKey(s);
      const prev = map.get(key);
      if (!prev) {
        map.set(key, s);
        continue;
      }
      const prevRank = rank.get(prev.source) ?? 99;
      const nextRank = rank.get(s.source) ?? 99;
      if (nextRank < prevRank) map.set(key, s);
      else if (nextRank === prevRank && s.source === 'sessions' && prev.source !== 'sessions') {
        map.set(key, s);
      }
    }
  }

  const out = [...map.values()];
  const sessionTitles = new Set(
    out.filter(s => s.source !== 'bridge')
      .map(s => normalizeTitle(s.title))
      .filter(Boolean)
  );
  return out.filter(s => {
    if (s.source !== 'bridge') return true;
    return !sessionTitles.has(normalizeTitle(s.title));
  });
}

function attachBridgeLive(live, recent, opts = {}) {
  const inferred = inferLiveFromRecent(recent, opts);
  return mergeLiveSources([live, inferred], opts);
}

// Candidate server labels a bridge-inferred entry could be playing on.
function bridgeCandidateServers(s) {
  if (Array.isArray(s.availableOn) && s.availableOn.length) return s.availableOn;
  return [s.server, s.pickedServer].filter(Boolean);
}

// Drop bridge-inferred rows once we have ground truth. When the browser
// successfully probed a server (probe.ok) it returned that server's real session
// list — so a bridge row whose every candidate server was successfully probed,
// yet isn't a confirmed session, is a stale browse and must go. Rows on servers
// we could NOT reach are kept: that's the legitimate fallback this feature exists
// for. Non-bridge (real session) rows are always kept.
function suppressReachableBridge(live, probes) {
  const reachable = new Set((probes || []).filter(p => p && p.ok).map(p => p.server));
  if (!reachable.size) return (live || []).slice();
  return (live || []).filter(s => {
    if (!s || s.source !== 'bridge') return true;
    const candidates = bridgeCandidateServers(s);
    if (!candidates.length) return true; // unknown server → keep as fallback
    const allReachable = candidates.every(c => reachable.has(c));
    return !allReachable; // every candidate ground-truthed but not playing → drop
  });
}

module.exports = {
  DEFAULT_BRIDGE_LIVE_MS,
  resolveBridgePlayback,
  inferLiveFromRecent,
  liveEntryKey,
  mergeLiveSources,
  attachBridgeLive,
  bridgeCandidateServers,
  suppressReachableBridge,
  titlesMatch,
};