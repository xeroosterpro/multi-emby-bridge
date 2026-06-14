// ─── SSRF guard for user-supplied server/manifest URLs ───────────────────────
const dns = require('dns').promises;
const dnsCb = require('dns');
const net = require('net');
const http = require('http');
const https = require('https');

const BLOCKED_HOSTS = new Set([
  'localhost', 'metadata.google.internal', 'metadata.goog',
]);

function isPrivateIp(ip) {
  if (!ip) return true;
  if (net.isIPv4(ip)) {
    const parts = ip.split('.').map(Number);
    if (parts[0] === 10) return true;
    if (parts[0] === 127) return true;
    if (parts[0] === 0) return true;
    if (parts[0] === 169 && parts[1] === 254) return true;
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    if (parts[0] === 192 && parts[1] === 168) return true;
    if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) return true; // CGNAT 100.64.0.0/10
    if (parts[0] >= 224) return true; // multicast + reserved
    return false;
  }
  if (net.isIPv6(ip)) {
    const n = ip.toLowerCase();
    if (n === '::1' || n === '::') return true;
    if (n.startsWith('fe80:')) return true; // link-local
    if (n.startsWith('fc') || n.startsWith('fd')) return true; // unique local
    if (n.startsWith('::ffff:')) {
      const v4 = n.slice(7);
      if (net.isIPv4(v4)) return isPrivateIp(v4);
    }
  }
  return false;
}

function parseHttpUrl(raw) {
  if (!raw || typeof raw !== 'string') return null;
  let u;
  try { u = new URL(raw.trim()); } catch { return null; }
  if (!['http:', 'https:'].includes(u.protocol)) return null;
  if (!u.hostname) return null;
  return u;
}

async function assertSafeFetchUrl(raw, label = 'url') {
  const u = parseHttpUrl(raw);
  if (!u) throw new Error(`Invalid ${label}: must be a valid http(s) URL`);

  const host = u.hostname.toLowerCase().replace(/\.$/, '');
  if (BLOCKED_HOSTS.has(host)) throw new Error(`Blocked ${label}: host not allowed`);

  if (net.isIP(host)) {
    if (isPrivateIp(host)) throw new Error(`Blocked ${label}: private/reserved addresses are not allowed`);
    return u;
  }

  let resolved;
  try {
    resolved = await dns.lookup(host, { all: true, verbatim: true });
  } catch {
    throw new Error(`Could not resolve ${label} hostname`);
  }
  for (const r of resolved) {
    if (isPrivateIp(r.address)) {
      throw new Error(`Blocked ${label}: hostname resolves to a private/reserved address`);
    }
  }
  return u;
}

function normalizeServerUrl(raw) {
  const u = parseHttpUrl(raw);
  if (!u) return null;
  return u.origin + u.pathname.replace(/\/+$/, '');
}

// ─── Connect-time SSRF guard (closes redirect + DNS-rebinding bypass) ─────────
// assertSafeFetchUrl() validates *before* the request, but node-fetch then
// follows redirects and re-resolves DNS on each hop — an attacker can answer
// "public" at validation time and "private" at connect time (rebinding), or
// 30x-redirect to an internal IP. A custom dns.lookup on the agent re-checks the
// address the socket will actually connect to, for the initial request AND every
// redirect hop, so there's no TOCTOU window. Use with fetch's `agent` option.
function safeLookup(hostname, options, callback) {
  if (typeof options === 'function') { callback = options; options = {}; }
  dnsCb.lookup(hostname, options, (err, address, family) => {
    if (err) return callback(err);
    const addrs = Array.isArray(address) ? address : [{ address, family }];
    for (const a of addrs) {
      if (isPrivateIp(a.address)) {
        return callback(new Error(`Blocked: ${hostname} resolves to a private/reserved address`));
      }
    }
    callback(null, address, family);
  });
}

const _safeHttpAgent = new http.Agent({ lookup: safeLookup });
const _safeHttpsAgent = new https.Agent({ lookup: safeLookup });

// Pass as fetch's `agent` (node-fetch accepts a function of the parsed URL).
function safeAgent(parsedURL) {
  return parsedURL.protocol === 'https:' ? _safeHttpsAgent : _safeHttpAgent;
}

// Default redirect cap for user-server fetches.
const SAFE_REDIRECT_LIMIT = 5;

module.exports = {
  assertSafeFetchUrl, parseHttpUrl, normalizeServerUrl, isPrivateIp,
  safeLookup, safeAgent, SAFE_REDIRECT_LIMIT,
};