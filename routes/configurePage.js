const fs = require('fs');
const path = require('path');
const { applyConfigureSecurityHeaders } = require('../lib/security');

function makeConfigurePageRouter({ buildId, rootDir }) {
  let _configureHtmlCache = null;
  let _configureHtmlBuild = null;

  function getConfigureHtml() {
    if (_configureHtmlCache && _configureHtmlBuild === buildId) return _configureHtmlCache;
    const raw = fs.readFileSync(path.join(rootDir, 'public', 'configure.html'), 'utf8');
    let html = raw.replace(/(src="\/js\/[^"]+\.js)(\?[^"]*)?(")/g, `$1?v=${buildId}$3`);
    html = html.replace('</head>', `<script>window.BUILD_ID = "${buildId || 'dev'}"; window.__BUILD_ID__ = "${buildId || 'dev'}"; </script></head>`);
    const short = (buildId || 'dev').slice(0, 7);
    const full = buildId || 'dev';
    html = html.replace(/data-build="BUILD_ID_HERE"/g, `data-build="${full}"`);
    html = html.replace(/>BUILD_ID_HERE</g, `>${short}<`);
    _configureHtmlCache = html;
    _configureHtmlBuild = buildId;
    return _configureHtmlCache;
  }

  return {
    getConfigureHtml,
    register(app) {
      app.get('/', (req, res) => res.redirect('/configure'));
      app.get('/configure', (req, res) => {
        applyConfigureSecurityHeaders(res);
        res.set('Cache-Control', 'no-cache');
        res.type('html').send(getConfigureHtml());
      });
      // Liveness: fast, dependency-free (Railway's healthcheck points here, so it
      // must NOT depend on the DB or it could restart-loop on a transient blip).
      app.get('/health', (req, res) => res.json({ status: 'ok' }));
      app.get('/healthz', (req, res) => res.json({ status: 'ok' }));
      // Readiness: deep check for monitoring/alerting — verifies DB connectivity.
      app.get('/health/ready', async (req, res) => {
        const db = require('../lib/db');
        const out = { status: 'ok', build: buildId || 'dev', uptimeSec: Math.round(process.uptime()) };
        if (db.isConfigured()) {
          try {
            const t0 = Date.now();
            await db.query('SELECT 1');
            out.db = { ok: true, ms: Date.now() - t0 };
          } catch (e) {
            out.status = 'degraded';
            out.db = { ok: false, error: e.message };
            return res.status(503).json(out);
          }
        } else {
          out.db = { ok: false, configured: false };
        }
        res.json(out);
      });
    },
  };
}

module.exports = { makeConfigurePageRouter };