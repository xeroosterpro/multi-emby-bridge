// ─── Authenticated user routes: stored config, encrypted keys, manifest token ──
const express = require('express');
const QRCode = require('qrcode');
const db = require('../lib/db');
const { makeUserConfig } = require('../lib/userConfig');
const { makeManifestStore } = require('../lib/manifestStore');
const { makeServerHistory } = require('../lib/serverHistory');
const { makeRequestLog } = require('../lib/requestLog');
const { makeLiveSessions } = require('../lib/sessions');

function manifestUrl(req, token) {
  const proto = (req.headers['x-forwarded-proto'] || req.protocol || 'https').split(',')[0];
  return `${proto}://${req.get('host')}/u/${token}/manifest.json`;
}

function makeUserRouter() {
  const uc = makeUserConfig(db);
  const store = makeManifestStore(db);
  const r = express.Router();
  const serverHistory = makeServerHistory(db);
  const requestLog = makeRequestLog(db);
  const liveSessions = makeLiveSessions();
  r.use(express.json({ limit: '1mb' }));

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
    try { await uc.save(req.user.id, req.body || {}); res.json({ ok: true }); }
    catch (e) { console.error('[user/config:post]', e.message); res.status(500).json({ error: 'save failed' }); }
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

  r.get('/activity', requireAuth, async (req, res) => {
    try {
      const recent = await requestLog.forUser(req.user.id, 15);
      let live = [];
      try {
        const cfg = await uc.getForServe(req.user.id);
        if (cfg && Array.isArray(cfg.servers)) live = await liveSessions.forUser(cfg.servers);
      } catch (e) { /* best-effort */ }
      res.json({ recent, live });
    } catch (e) { console.error('[user/activity]', e.message); res.status(500).json({ error: 'activity failed' }); }
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
