// ─── Audio format taxonomy, classification, ranking & presets ────────────────
// Pure module (no I/O). Single source of truth for audio formats, shared by the
// stream sorter (lib/streams.js) and the configure UI (via GET /api/audio-formats).

// Canonical ordered list — default priority, top = highest.
const AUDIO_FORMATS = [
  { id: 'atmos',    token: 'atm', label: 'Dolby Atmos',   cat: 'object',   chans: '7.1 + height (object)' },
  { id: 'dtsx',     token: 'dtx', label: 'DTS:X',         cat: 'object',   chans: '7.1 + height (object)' },
  { id: 'truehd',   token: 'thd', label: 'Dolby TrueHD',  cat: 'lossless', chans: 'up to 7.1' },
  { id: 'dtshd_ma', token: 'dma', label: 'DTS-HD MA',     cat: 'lossless', chans: 'up to 7.1' },
  { id: 'lpcm',     token: 'pcm', label: 'LPCM',          cat: 'lossless', chans: '2.0 – 7.1' },
  { id: 'flac',     token: 'flc', label: 'FLAC',          cat: 'lossless', chans: '2.0 – 7.1' },
  { id: 'ddplus',   token: 'ddp', label: 'Dolby Digital+',cat: 'lossy',    chans: 'up to 7.1' },
  { id: 'dts',      token: 'dts', label: 'DTS',           cat: 'lossy',    chans: '5.1' },
  { id: 'dd',       token: 'dd',  label: 'Dolby Digital', cat: 'lossy',    chans: '5.1' },
  { id: 'aac',      token: 'aac', label: 'AAC',           cat: 'lossy',    chans: '2.0 / 5.1' },
  { id: 'other',    token: 'oth', label: 'Other',         cat: 'other',    chans: 'varies' },
];

const DEFAULT_ORDER = AUDIO_FORMATS.map(f => f.id);
const ID_BY_TOKEN = Object.fromEntries(AUDIO_FORMATS.map(f => [f.token, f.id]));
const TOKEN_BY_ID = Object.fromEntries(AUDIO_FORMATS.map(f => [f.id, f.token]));

function idsToTokens(ids) {
  return (ids || []).map(id => TOKEN_BY_ID[id]).filter(Boolean);
}
function tokensToIds(tokens) {
  return (tokens || []).map(t => ID_BY_TOKEN[t]).filter(Boolean);
}

// Always returns all 11 ids: the user's valid order first, then any missing ids
// in default order. Garbage/empty -> DEFAULT_ORDER.
function resolveOrder(audioOrderTokens) {
  const fromUser = tokensToIds(audioOrderTokens);
  if (fromUser.length === 0) return DEFAULT_ORDER.slice();
  const seen = new Set(fromUser);
  return [...fromUser, ...DEFAULT_ORDER.filter(id => !seen.has(id))];
}

function resRank(resLabel) {
  if (resLabel === '4K') return 0;
  if (resLabel === '1080p') return 1;
  if (resLabel === '720p') return 2;
  return 3;
}

// Map a single audio track's codec + profile to a canonical format id.
// Inputs may be null/undefined; output is always one of the 11 ids.
function classifyAudio(codec, profile) {
  const c = (codec || '').toLowerCase();
  const p = (profile || '').toLowerCase();
  const isAtmos = p.includes('atmos');

  if (c.includes('truehd')) return isAtmos ? 'atmos' : 'truehd';
  if (c.includes('eac3') || c.includes('eac-3') || c.includes('e-ac-3')) return isAtmos ? 'atmos' : 'ddplus';
  if (c.includes('dts') || c === 'dca') {
    if (p.includes('dts:x') || p.includes('dtsx') || p.includes('dts-x')) return 'dtsx';
    if (c.includes('ma') || c === 'dtshd' || p.includes('ma') || p.includes('master')) return 'dtshd_ma';
    return 'dts';
  }
  if (c.includes('pcm')) return 'lpcm';
  if (c.includes('flac')) return 'flac';
  if (c === 'ac3' || c.includes('ac-3')) return 'dd';
  if (c.includes('aac')) return 'aac';
  return 'other';
}

// Compute per-file audio sort keys given the effective order + disabled set.
// "Best track" = the file's format with the lowest (best) index in `order`.
function buildAudioKeys(stream, order, disabledSet) {
  const formats = stream._audioFormats || [];
  if (formats.length === 0) {
    return { bestFormat: null, audioIdx: 99, isDisabledClass: false };
  }
  let bestFormat = null;
  let bestIdx = Infinity;
  for (const f of formats) {
    let idx = order.indexOf(f);
    if (idx < 0) idx = order.length;
    if (idx < bestIdx) { bestIdx = idx; bestFormat = f; }
  }
  return {
    bestFormat,
    audioIdx: bestIdx,
    isDisabledClass: disabledSet.has(bestFormat),
  };
}

// Mutate each stream with _audioIdx, _isDisabledClass, _demoted, _resRank.
function attachAudioKeys(streams, opts) {
  const order = resolveOrder(opts.audioOrder);
  const disabledSet = new Set(tokensToIds(opts.audioDisabled));
  const demote = opts.audioDisableAction === 'bottom';
  for (const s of streams) {
    const k = buildAudioKeys(s, order, disabledSet);
    s._audioIdx = k.audioIdx;
    s._isDisabledClass = k.isDisabledClass;
    s._demoted = (k.isDisabledClass && demote) ? 1 : 0;
    s._resRank = resRank(s._resLabel);
  }
  return streams;
}

// Replicates lib/streams.js legacy sortOrder behavior exactly.
function compareSortOrder(a, b, sortOrder) {
  if (sortOrder === 'audio') {
    const d = (a._audioRank || 99) - (b._audioRank || 99);
    return d !== 0 ? d : (b._sizeBytes || 0) - (a._sizeBytes || 0);
  }
  if (sortOrder === 'bitrate') {
    const d = (b._bitrate || 0) - (a._bitrate || 0);
    return d !== 0 ? d : (b._sizeBytes || 0) - (a._sizeBytes || 0);
  }
  const sizeDiff = (b._sizeBytes || 0) - (a._sizeBytes || 0);
  if (sizeDiff !== 0) return sizeDiff;
  const audioDiff = (a._audioRank || 99) - (b._audioRank || 99);
  if (audioDiff !== 0) return audioDiff;
  return (b._bitrate || 0) - (a._bitrate || 0);
}

// Full comparator. Requires attachAudioKeys() to have run on every stream.
// Tier order: 0 demoted -> 1 language -> 2 preferred codec -> 3 ranking mode -> 4 legacy sort.
// Language (tier 1) and codec (tier 2) preserve the existing getAllStreams behavior.
function audioComparator(opts) {
  const { sortOrder, audioLang, prefCodec, codecMode, audioRank, audioRankMode } = opts;
  return (a, b) => {
    // Tier 0 — demoted (disabled-class with action=bottom) always sinks.
    if (a._demoted !== b._demoted) return a._demoted - b._demoted;

    // Tier 1 — preferred audio language (existing behavior).
    if (audioLang && audioLang !== 'any') {
      const aL = (a._audioLang || '').startsWith(audioLang) ? 0 : 1;
      const bL = (b._audioLang || '').startsWith(audioLang) ? 0 : 1;
      if (aL !== bL) return aL - bL;
    }

    // Tier 2 — preferred codec, prefer mode (existing behavior).
    if (prefCodec && prefCodec !== 'any' && codecMode !== 'only') {
      const aC = a._codec === prefCodec ? 0 : 1;
      const bC = b._codec === prefCodec ? 0 : 1;
      if (aC !== bC) return aC - bC;
    }

    // Tier 3 — audio ranking (only when master toggle on).
    if (audioRank) {
      if (audioRankMode === 'resFirst') {
        if (a._resRank !== b._resRank) return a._resRank - b._resRank;
        if (a._audioIdx !== b._audioIdx) return a._audioIdx - b._audioIdx;
        return compareSortOrder(a, b, sortOrder);
      }
      if (audioRankMode === 'tiebreak') {
        const s = compareSortOrder(a, b, sortOrder);
        if (s !== 0) return s;
        return a._audioIdx - b._audioIdx;
      }
      // audioFirst (default)
      if (a._audioIdx !== b._audioIdx) return a._audioIdx - b._audioIdx;
      return compareSortOrder(a, b, sortOrder);
    }

    // Tier 4 — legacy default sort (unchanged).
    return compareSortOrder(a, b, sortOrder);
  };
}

// Hide-mode filter. Requires attachAudioKeys() to have run. Returns the filtered
// list, or — if hiding would empty the list — the original list with hiddenFallback.
function filterDisabledHide(streams, opts) {
  const disabled = tokensToIds(opts.audioDisabled);
  if (disabled.length === 0 || opts.audioDisableAction === 'bottom') {
    return { streams, hiddenFallback: false };
  }
  const kept = streams.filter(s => !s._isDisabledClass);
  if (kept.length === 0 && streams.length > 0) {
    return { streams, hiddenFallback: true };
  }
  return { streams: kept, hiddenFallback: false };
}

const ALL_IDS = DEFAULT_ORDER; // reference for "supports everything"

// supports = format ids the device can reliably decode/passthrough.
const AUDIO_PRESETS = [
  { id: 'appletv',    label: 'Apple TV 4K',             supports: ALL_IDS.slice() },
  { id: 'shield',     label: 'Nvidia Shield',           supports: ALL_IDS.slice() },
  { id: 'chromecast', label: 'Chromecast w/ Google TV', supports: ['atmos','ddplus','dts','dd','aac','flac','other'] },
  { id: 'soundbar',   label: 'Generic eARC soundbar',   supports: ['atmos','dtsx','truehd','dtshd_ma','flac','ddplus','dts','dd','aac','other'] }, // omits lpcm: multi-ch LPCM passthrough over eARC is inconsistent across brands
  { id: 'sonos',      label: 'Sonos (Arc/Beam)',        supports: ['atmos','truehd','flac','ddplus','dts','dd','aac','other'] },
  { id: 'firestick',  label: 'Firestick 4K / Max',      supports: ['atmos','ddplus','dts','dd','aac','flac','other'] },
  { id: 'browser',    label: 'Web browser',             supports: ['flac','dd','aac','other'] },
  { id: 'phone',      label: 'Phone / tablet',          supports: ['ddplus','dts','dd','aac','flac','other'] },
];

// Resolve selected device(s) to { order, disabled, action } in URL tokens.
// Multi-select: a format is disabled if ANY selected device lacks it. Multi
// defaults to action 'bottom' so disparate devices don't gut the library.
function resolvePreset(deviceIds) {
  const ids = (deviceIds || []).filter(d => AUDIO_PRESETS.some(p => p.id === d));
  if (ids.length === 0) return null;
  const presets = ids.map(d => AUDIO_PRESETS.find(p => p.id === d));
  const supportedByAll = DEFAULT_ORDER.filter(fmt => presets.every(p => p.supports.includes(fmt)));
  const supportedSet = new Set(supportedByAll);
  const disabledIds = DEFAULT_ORDER.filter(fmt => !supportedSet.has(fmt));
  // Order: enabled (default order) first, then disabled (default order).
  const orderIds = [...supportedByAll, ...disabledIds];
  return {
    order: idsToTokens(orderIds),
    disabled: idsToTokens(disabledIds),
    action: ids.length > 1 ? 'bottom' : 'hide',
  };
}

module.exports = {
  AUDIO_FORMATS, DEFAULT_ORDER,
  idsToTokens, tokensToIds, resolveOrder, resRank, classifyAudio,
  buildAudioKeys, attachAudioKeys,
  compareSortOrder, audioComparator,
  filterDisabledHide,
  AUDIO_PRESETS, resolvePreset,
};
