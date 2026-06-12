const { normalizeServerUrl } = require('./urlSafety');

function normKey(url) {
  const n = normalizeServerUrl(url);
  return n ? n.toLowerCase() : String(url || '').replace(/\/+$/, '').toLowerCase();
}

function originKey(url) {
  try {
    const n = normalizeServerUrl(url) || url;
    return new URL(n).origin.toLowerCase();
  } catch {
    return null;
  }
}

/** Find a saved server row by normalized URL, origin, or label. */
function findServerEntry(servers, url, label) {
  const list = (servers || []).filter(s => s && s.enabled !== false);
  const key = normKey(url);
  let match = list.find(s => normKey(s.url) === key);
  if (match) return match;

  const origin = originKey(url);
  if (origin) {
    const originMatches = list.filter(s => originKey(s.url) === origin);
    if (originMatches.length === 1) return originMatches[0];
  }

  const lbl = String(label || '').trim().toLowerCase();
  if (lbl) {
    match = list.find(s => String(s.label || '').trim().toLowerCase() === lbl);
    if (match) return match;
  }
  return null;
}

module.exports = { findServerEntry, normKey, originKey };