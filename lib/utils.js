// ─── Pure utility functions ──────────────────────────────────────────────────

function parseStreamId(type, id) {
  if (type === 'movie') {
    return { imdbId: id, season: null, episode: null };
  }
  const parts = String(id || '').split(':');
  const season = parseInt(parts[1], 10);
  const episode = parseInt(parts[2], 10);
  return {
    imdbId: parts[0],
    season: Number.isFinite(season) ? season : null,
    episode: Number.isFinite(episode) ? episode : null,
  };
}

function formatFileSize(bytes) {
  if (!bytes) return null;
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(2)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`;
  return `${(bytes / 1e3).toFixed(0)} KB`;
}

function detectSourceLabel(source) {
  const str = ((source.Path || '') + ' ' + (source.Name || '')).toLowerCase();
  if (str.includes('remux'))                            return 'REMUX';
  if (str.includes('web-dl') || str.includes('webdl'))  return 'WEB-DL';
  if (str.includes('webrip'))                           return 'WEB-RIP';
  if (str.includes('bluray') || str.includes('blu-ray')) return 'BluRay';
  if (str.includes('hdtv'))                             return 'HDTV';
  return null;
}

// ─── Language → flag emoji lookup ────────────────────────────────────────────
const LANG_FLAGS = {
  eng: '🇺🇸', en: '🇺🇸',
  rus: '🇷🇺', ru: '🇷🇺',
  fra: '🇫🇷', fre: '🇫🇷', fr: '🇫🇷',
  deu: '🇩🇪', ger: '🇩🇪', de: '🇩🇪',
  spa: '🇪🇸', es: '🇪🇸',
  jpn: '🇯🇵', ja: '🇯🇵',
  zho: '🇨🇳', chi: '🇨🇳', cmn: '🇨🇳', zh: '🇨🇳',
  kor: '🇰🇷', ko: '🇰🇷',
  ita: '🇮🇹', it: '🇮🇹',
  por: '🇵🇹', pob: '🇧🇷', pt: '🇵🇹',
  ara: '🇸🇦', ar: '🇸🇦',
  hin: '🇮🇳', hi: '🇮🇳',
  tur: '🇹🇷', tr: '🇹🇷',
  pol: '🇵🇱', pl: '🇵🇱',
  nld: '🇳🇱', dut: '🇳🇱', nl: '🇳🇱',
  swe: '🇸🇪', sv: '🇸🇪',
  nor: '🇳🇴', no: '🇳🇴',
  dan: '🇩🇰', da: '🇩🇰',
  fin: '🇫🇮', fi: '🇫🇮',
  ces: '🇨🇿', cze: '🇨🇿', cs: '🇨🇿',
  slk: '🇸🇰', slo: '🇸🇰', sk: '🇸🇰',
  hun: '🇭🇺', hu: '🇭🇺',
  ron: '🇷🇴', rum: '🇷🇴', ro: '🇷🇴',
  bul: '🇧🇬', bg: '🇧🇬',
  hrv: '🇭🇷', hr: '🇭🇷',
  srp: '🇷🇸', sr: '🇷🇸',
  ukr: '🇺🇦', uk: '🇺🇦',
  heb: '🇮🇱', he: '🇮🇱',
  ell: '🇬🇷', gre: '🇬🇷', el: '🇬🇷',
  vie: '🇻🇳', vi: '🇻🇳',
  tha: '🇹🇭', th: '🇹🇭',
  ind: '🇮🇩', idn: '🇮🇩', id: '🇮🇩',
  msa: '🇲🇾', may: '🇲🇾', ms: '🇲🇾',
};

function langFlag(code) {
  return LANG_FLAGS[(code || '').toLowerCase()] || null;
}

// Bitrate quality bar (5 chars scaled to 0/5/10/20/35 Mbps)
function buildBitrateBar(bps, style = 'blocks') {
  if (!bps) return '';
  const mbps = bps / 1e6;
  const filled = (mbps > 0 ? 1 : 0) + (mbps >= 5 ? 1 : 0) + (mbps >= 10 ? 1 : 0) + (mbps >= 20 ? 1 : 0) + (mbps >= 35 ? 1 : 0);
  const n = Math.min(filled, 5);
  const e = 5 - n;
  if (style === 'segments') return '▰'.repeat(n) + '▱'.repeat(e);
  return '█'.repeat(n) + '░'.repeat(e); // blocks (default)
}

// ─── Provider ID validation (matches Streambridge _isMatchingProviderId) ─────

function isMatchingProviderId(providerIds, imdbId) {
  if (!providerIds || !imdbId) return false;
  const val = providerIds.Imdb || providerIds.imdb || providerIds.IMDB || '';
  if (!val) return false;
  if (val === imdbId) return true;
  if (val.toLowerCase() === imdbId.toLowerCase()) return true;
  const normalize = (id) => id.replace(/^tt0*/i, '');
  return normalize(val) === normalize(imdbId);
}

// ─── Small pure helpers extracted from server.js for cleanliness ─────────────
// (rate limiting, catalog response headers, dedup for metas, shuffle)

function createRateLimiter(windowMs, maxRequests) {
  const hits = new Map();
  // Cleanup every windowMs
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of hits) {
      if (now - entry.start > windowMs) hits.delete(key);
    }
  }, windowMs);

  return (req, res, next) => {
    const ip = req.ip || req.connection?.remoteAddress || 'unknown';
    const max = typeof maxRequests === 'function' ? maxRequests(req) : maxRequests;
    const key = req.user?.id ? `user:${req.user.id}` : `ip:${ip}`;
    const now = Date.now();
    let entry = hits.get(key);
    if (!entry || now - entry.start > windowMs) {
      entry = { start: now, count: 0 };
      hits.set(key, entry);
    }
    entry.count++;
    if (entry.count > max) {
      return res.status(429).json({ error: 'Too many requests' });
    }
    next();
  };
}

function setCatalogCache(res) {
  res.set('Cache-Control', 'public, max-age=300, stale-while-revalidate=60');
}

function shuffleMetas(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Cross-row deduplication cache (60s TTL per config key)
const _dedupCache = new Map();
function getDedupSeen(key) {
  let e = _dedupCache.get(key);
  if (!e || Date.now() - e.ts > 60000) {
    e = { ts: Date.now(), seen: new Set() };
    _dedupCache.set(key, e);
  }
  return e.seen;
}
function dedupMetas(metas, key) {
  const seen = getDedupSeen(key);
  const out = metas.filter(m => !seen.has(m.id));
  out.forEach(m => seen.add(m.id));
  return out;
}

module.exports = {
  parseStreamId,
  formatFileSize,
  detectSourceLabel,
  LANG_FLAGS,
  langFlag,
  buildBitrateBar,
  isMatchingProviderId,
  createRateLimiter,
  setCatalogCache,
  shuffleMetas,
  getDedupSeen,
  dedupMetas,
};
