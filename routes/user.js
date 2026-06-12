// ─── Authenticated user routes: stored config, encrypted keys, manifest token ──
const express = require('express');
const QRCode = require('qrcode');
const db = require('../lib/db');
const { makeUserConfig } = require('../lib/userConfig');
const { makeManifestStore } = require('../lib/manifestStore');
const { makeServerHistory } = require('../lib/serverHistory');
const { makeRequestLog } = require('../lib/requestLog');
const { makeLiveSessions } = require('../lib/sessions');
const { enrichRecentEntries, dedupeRecentByContent, mergeActivityHistory } = require('../lib/activityEnrich');
const { fetchServerWatchHistory } = require('../lib/serverWatchHistory');
const { attachBridgeLive } = require('../lib/bridgeLive');
const { healthHistory } = require('../lib/health');
const { detectDownServers, filterSnoozed } = require('../lib/healthAlerts');

function manifestUrl(req, token) {
  const proto = (req.headers['x-forwarded-proto'] || req.protocol || 'https').split(',')[0];
  return `${proto}://${req.get('host')}/u/${token}/manifest.json`;
}

function filterLiveServers(cfg) {
  if (!cfg || !Array.isArray(cfg.servers)) return [];
  return cfg.servers.filter(s => s && s.url && s.apiKey && s.userId && s.enabled !== false);
}

const _watchHistCache = new Map();
const WATCH_HIST_CACHE_MS = 90000;

async function getCachedServerWatch(userId, servers, quick) {
  const hit = _watchHistCache.get(userId);
  if (hit && Date.now() - hit.at < WATCH_HIST_CACHE_MS) return hit.entries;
  const entries = await fetchServerWatchHistory(servers, { timeoutMs: quick ? 8000 : 5500, limitPerEndpoint: 20 });
  _watchHistCache.set(userId, { at: Date.now(), entries });
  return entries;
}

const _liveDetailCache = new Map();
const LIVE_DETAIL_CACHE_MS = 15000; // short cache so repeated dash polls / bundle fetches are instant

function mapLiveProbes(probes) {
  return (probes || []).map(p => ({
    server: p.server,
    ok: !!p.ok,
    count: p.count || 0,
    ms: p.ms || 0,
    error: p.error || null,
    method: p.method || null,
  }));
}

const { isDemoServer, stripDemoServers } = require('../lib/demoServers');

function hasCompleteServers(servers) {
  return (servers || []).some(s => s?.url && s?.apiKey && s?.userId);
}

/** Strip tour/demo placeholders; block stale cache from seeding new accounts. */
function sanitizeConfigSave(curConfig, incoming) {
  const body = { ...(incoming || {}) };
  if (Array.isArray(body.servers)) body.servers = stripDemoServers(body.servers);
  const hadServers = hasCompleteServers(curConfig?.servers);
  if (!hadServers && Array.isArray(body.servers) && hasCompleteServers(body.servers)) {
    body.servers = stripDemoServers(body.servers);
  }
  return body;
}

function makeUserRouter() {
  const uc = makeUserConfig(db);
  const store = makeManifestStore(db);
  const r = express.Router();
  const serverHistory = makeServerHistory(db);
  const requestLog = makeRequestLog(db);
  const liveSessions = makeLiveSessions();

  async function loadLiveForUser(userId, recentForBridge) {
    const cfg = await uc.getForServe(userId);
    const servers = filterLiveServers(cfg);
    if (!servers.length) return { servers, live: [], liveProbes: [] };

    // Use short cache for smooth/fast repeated loads of live (dash polls, bundle refreshes)
    const hit = _liveDetailCache.get(userId);
    if (hit && Date.now() - hit.at < LIVE_DETAIL_CACHE_MS) {
      return hit.data;
    }

    const detailed = await liveSessions.forUserDetailed(servers);
    let live = detailed.live || [];
    if (!live.length && Array.isArray(recentForBridge) && recentForBridge.length) {
      live = attachBridgeLive(live, recentForBridge);
    }
    const data = {
      servers,
      live,
      liveProbes: mapLiveProbes(detailed.probes),
    };
    _liveDetailCache.set(userId, { at: Date.now(), data });
    return data;
  }

  function requireAuth(req, res, next) {
    if (!db.isConfigured()) return res.status(503).json({ error: 'accounts unavailable' });
    if (!req.user) return res.status(401).json({ error: 'not signed in' });
    next();
  }

  // config blob + which keys are set (never the key values)
  r.get('/config', requireAuth, async (req, res) => {
    try { res.json(await uc.getEditable(req.user.id)); }
    catch (e) { console.error('[user/config:get]', e.message); res.status(500).json({ error: 'load failed' }); }
  });
  // save config + encrypt keys
  r.post('/config', requireAuth, async (req, res) => {
    try {
      const cur = await uc.getEditable(req.user.id);
      const body = sanitizeConfigSave(cur.config, req.body || {});
      await uc.save(req.user.id, body);
      res.json({ ok: true });
    }
    catch (e) { console.error('[user/config:post]', e.message); res.status(500).json({ error: 'save failed' }); }
  });

  // Merge top-level keys into stored config (onboarding, alertPrefs, etc.)
  r.post('/config-patch', requireAuth, async (req, res) => {
    try {
      const patch = req.body || {};
      const cur = await uc.getEditable(req.user.id);
      const merged = { ...(cur.config || {}), ...patch };
      if (Array.isArray(merged.servers)) merged.servers = stripDemoServers(merged.servers);
      await uc.save(req.user.id, merged);
      res.json({ ok: true });
    } catch (e) {
      console.error('[user/config-patch]', e.message);
      res.status(500).json({ error: 'patch failed' });
    }
  });

  // current manifest URL (or null)
  r.get('/manifest', requireAuth, async (req, res) => {
    try { const t = await store.current(req.user.id); res.json({ url: t ? manifestUrl(req, t) : null }); }
    catch (e) { console.error('[user/manifest:get]', e.message); res.status(500).json({ error: 'lookup failed' }); }
  });
  // generate / regenerate (invalidates the old link)
  r.post('/manifest', requireAuth, async (req, res) => {
    try { const t = await store.regenerate(req.user.id); res.json({ url: manifestUrl(req, t) }); }
    catch (e) { console.error('[user/manifest:post]', e.message); res.status(500).json({ error: 'generate failed' }); }
  });

  r.get('/server-history', requireAuth, async (req, res) => {
    try { res.json(await serverHistory.listForUser(req.user.id)); }
    catch (e) { console.error('[user/server-history]', e.message); res.status(500).json({ error: 'history failed' }); }
  });

  r.get('/live-sessions', requireAuth, async (req, res) => {
    try {
      let recent = [];
      try {
        recent = await requestLog.forUser(req.user.id, 30);
      } catch { /* optional */ }
      const { servers, live, liveProbes } = await loadLiveForUser(req.user.id, recent);
      res.json({
        hasServers: servers.length > 0,
        serverCount: servers.length,
        live,
        liveProbes,
      });
    } catch (e) {
      console.error('[user/live-sessions]', e.message);
      res.status(500).json({ error: 'live sessions failed' });
    }
  });

  r.get('/activity', requireAuth, async (req, res) => {
    try {
      let live = [];
      let liveProbes = [];
      let servers = [];
      let recent = [];
      const quick = req.query.quick === '1' || req.query.quick === 'true';
      try {
        const labels = new Set();
        let rawRecent = [];
        const cfg = await uc.getForServe(req.user.id);
        const filteredServers = filterLiveServers(cfg);
        servers = filteredServers;
        if (filteredServers.length) {
          filteredServers.forEach(s => { if (s.label) labels.add(s.label.trim()); });
          const filtered = (await requestLog.forUser(req.user.id, 80))
            .filter(e => !e.server || labels.has(e.server) || (e.serverStatus || []).some(s => labels.has(s.label)));
          const bridgeRecent = dedupeRecentByContent(filtered);
          let serverWatch = [];
          try {
            serverWatch = await getCachedServerWatch(req.user.id, filteredServers, quick);
          } catch (e) { console.error('[user/activity:serverWatch]', e.message); }
          rawRecent = mergeActivityHistory(bridgeRecent, serverWatch, { limit: 30 });
        }
        if (quick) {
          live = attachBridgeLive([], rawRecent);
          if (servers.length) recent = enrichRecentEntries(rawRecent, live);
        } else {
          const loaded = await loadLiveForUser(req.user.id, rawRecent);
          servers = loaded.servers;
          live = loaded.live;
          liveProbes = loaded.liveProbes;
          if (servers.length) recent = enrichRecentEntries(rawRecent, live);
        }
      } catch (e) {
        console.error('[user/activity:inner]', e.message);
      }
      res.json({
        hasServers: servers.length > 0,
        serverCount: servers.length,
        live,
        liveProbes,
        recent,
      });
    } catch (e) { console.error('[user/activity]', e.message); res.status(500).json({ error: 'activity failed' }); }
  });

  r.get('/server-alerts', requireAuth, async (req, res) => {
    try {
      const cfg = await uc.getForServe(req.user.id);
      const servers = filterLiveServers(cfg);
      if (!servers.length) return res.json({ down: [] });
      const { HEALTH_CONSECUTIVE_DOWN, detectionWindowMinutes } = require('../lib/health');
      const raw = detectDownServers(healthHistory, servers, { consecutive: HEALTH_CONSECUTIVE_DOWN });
      const snoozed = (cfg && cfg.alertPrefs && cfg.alertPrefs.snoozed) || {};
      const down = filterSnoozed(raw, snoozed);
      res.json({
        down,
        detectionMinutes: detectionWindowMinutes(HEALTH_CONSECUTIVE_DOWN),
      });
    } catch (e) {
      console.error('[user/server-alerts]', e.message);
      res.status(500).json({ error: 'alerts failed' });
    }
  });

  r.get('/manifest-qr', requireAuth, async (req, res) => {
    try {
      const token = await store.current(req.user.id);
      if (!token) return res.status(404).json({ error: 'no manifest yet' });
      const url = manifestUrl(req, token);
      const dataUrl = await QRCode.toDataURL(url, { width: 240, margin: 1, color: { dark: '#0a0a12', light: '#ffffff' } });
      res.json({ dataUrl, url });
    } catch (e) { console.error('[user/manifest-qr]', e.message); res.status(500).json({ error: 'qr failed' }); }
  });

  return r;
}

module.exports = { makeUserRouter };