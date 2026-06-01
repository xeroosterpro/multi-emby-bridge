// ─── Authenticated user routes: stored config, encrypted keys, manifest token ──
const express = require('express');
const db = require('../lib/db');
const { makeUserConfig } = require('../lib/userConfig');
const { makeManifestStore } = require('../lib/manifestStore');

function manifestUrl(req, token) {
  const proto = (req.headers['x-forwarded-proto'] || req.protocol || 'https').split(',')[0];
  return `${proto}://${req.get('host')}/u/${token}/manifest.json`;
}

function makeUserRouter() {
  const uc = makeUserConfig(db);
  const store = makeManifestStore(db);
  const r = express.Router();
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

  return r;
}

module.exports = { makeUserRouter };
