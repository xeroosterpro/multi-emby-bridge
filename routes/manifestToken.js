const { encodeConfig } = require('../lib/configCodec');
const { upgradeStreamProfile } = require('../lib/streamDefaults');
const { makeUserConfig } = require('../lib/userConfig');
const { makeManifestStore } = require('../lib/manifestStore');
const { makeBilling } = require('../lib/billing');

function registerManifestToken(app, { dbLib, paypal }) {
  app.use('/u/:token', async (req, res, next) => {
    if (req.method !== 'GET') return next();
    if (!dbLib.isConfigured()) return res.status(404).json({ error: 'not found' });
    try {
      const rec = await makeManifestStore(dbLib).lookup(req.params.token);
      if (!rec) return res.status(410).json({ error: 'link invalid or revoked' });
      if (paypal.isConfigured()) {
        let allowed = await makeBilling(dbLib).hasAccess(rec.user_id);
        if (!allowed) {
          const ur = await dbLib.query('SELECT role FROM users WHERE id=$1', [rec.user_id]);
          allowed = ur.rowCount > 0 && ur.rows[0].role === 'admin';
        }
        if (!allowed) return res.status(402).json({ error: 'subscription required' });
      }
      let cfg = await makeUserConfig(dbLib).getForServe(rec.user_id);
      if (!cfg) return res.status(404).json({ error: 'no configuration saved' });
      cfg = upgradeStreamProfile(cfg).cfg;
      req._mebUserId = rec.user_id;
      const rest = req.url === '/' ? '/manifest.json' : req.url;
      req.url = '/' + encodeConfig(cfg) + rest;
      return app.handle(req, res);
    } catch (e) {
      console.error('[u/token] error:', e.message);
      return res.status(500).json({ error: 'server error' });
    }
  });
}

module.exports = { registerManifestToken };