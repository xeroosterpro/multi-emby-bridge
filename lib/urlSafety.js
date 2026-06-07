// ─── SSRF guard for user-supplied server/manifest URLs ───────────────────────
const dns = require('dns').promises;
const net = require('net');

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

module.exports = { assertSafeFetchUrl, parseHttpUrl, normalizeServerUrl, isPrivateIp };