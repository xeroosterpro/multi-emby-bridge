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
  let bestFormat = formats[0];
  let bestIdx = order.indexOf(bestFormat);
  if (bestIdx < 0) bestIdx = order.length;
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

module.exports = {
  AUDIO_FORMATS, DEFAULT_ORDER,
  idsToTokens, tokensToIds, resolveOrder, resRank, classifyAudio,
  buildAudioKeys, attachAudioKeys,
};
