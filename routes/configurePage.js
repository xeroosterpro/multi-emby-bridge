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
      app.get('/health', (req, res) => res.json({ status: 'ok' }));
      app.get('/healthz', (req, res) => res.json({ status: 'ok' }));
    },
  };
}

module.exports = { makeConfigurePageRouter };