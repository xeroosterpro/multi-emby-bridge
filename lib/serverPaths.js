// ─── Emby/Jellyfin URL path helpers (shared by sessions, streams, probes) ───
const { normalizeServerUrl } = require('./urlSafety');

function serverBaseUrl(url) {
  return normalizeServerUrl(url) || String(url || '').replace(/\/+$/, '');
}

function apiPathVariants(baseUrl, resourcePath) {
  const base = serverBaseUrl(baseUrl);
  const path = resourcePath.startsWith('/') ? resourcePath : `/${resourcePath}`;
  const out = [];
  const add = (p) => {
    try { out.push(new URL(`${base}${p}`)); } catch { /* skip */ }
  };
  add(path);
  if (!/\/emby$/i.test(base) && !path.startsWith('/emby/')) {
    add(`/emby${path}`);
  }
  return out;
}

module.exports = { serverBaseUrl, apiPathVariants };