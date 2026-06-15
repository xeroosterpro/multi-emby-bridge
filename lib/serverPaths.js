// ─── Emby/Jellyfin URL path helpers (shared by sessions, streams, probes) ───
const { normalizeServerUrl } = require('./urlSafety');

const _apiPrefix = new Map(); // host -> 'plain' | 'emby'

function serverBaseUrl(url) {
  return normalizeServerUrl(url) || String(url || '').replace(/\/+$/, '');
}

function hostFromBase(baseUrl) {
  try { return new URL(serverBaseUrl(baseUrl)).host; } catch { return null; }
}

/** Remember which URL prefix worked for a host (plain vs /emby). */
function noteApiPathSuccess(baseUrl, pathname) {
  const host = hostFromBase(baseUrl);
  if (!host) return;
  const p = String(pathname || '');
  if (p.startsWith('/emby/') || p === '/emby') _apiPrefix.set(host, 'emby');
  else _apiPrefix.set(host, 'plain');
}

function apiPathVariants(baseUrl, resourcePath) {
  const base = serverBaseUrl(baseUrl);
  const path = resourcePath.startsWith('/') ? resourcePath : `/${resourcePath}`;
  const out = [];
  const add = (p) => {
    try { out.push(new URL(`${base}${p}`)); } catch { /* skip */ }
  };
  const host = hostFromBase(base);
  const pref = host ? _apiPrefix.get(host) : null;
  if (pref === 'emby') {
    add(`/emby${path}`);
    return out;
  }
  if (pref === 'plain') {
    add(path);
    return out;
  }
  add(path);
  if (!/\/emby$/i.test(base) && !path.startsWith('/emby/')) {
    add(`/emby${path}`);
  }
  return out;
}

module.exports = { serverBaseUrl, apiPathVariants, noteApiPathSuccess, hostFromBase };