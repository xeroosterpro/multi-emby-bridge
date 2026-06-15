// Stremio-facing stream defaults — tuned for multi-server setups (one-tap play, compact labels).
const STREAM_PROFILE_VERSION = 4;

const STREMIO_STREAM_DEFAULTS = {
  autoSelect: false,
  labelPreset: 'compact',
  audioRank: true,
  audioRankMode: 'audioFirst',
  audioDisableAction: 'hide',
  showSummary: true,
  summaryStyle: 'compact',
  recommend: true,
  ping: false,
  pingDetail: false,
};

function needsStreamProfileUpgrade(cfg) {
  return !cfg || (cfg.streamProfile | 0) < STREAM_PROFILE_VERSION;
}

function applyMissingStreamDefaults(cfg) {
  const out = { ...cfg };
  for (const [k, v] of Object.entries(STREMIO_STREAM_DEFAULTS)) {
    if (out[k] === undefined) out[k] = v;
  }
  if ((out.streamProfile | 0) < STREAM_PROFILE_VERSION) out.streamProfile = STREAM_PROFILE_VERSION;
  return out;
}

function upgradeStreamProfile(cfg) {
  if (!needsStreamProfileUpgrade(cfg)) return { cfg, changed: false };
  return { cfg: applyMissingStreamDefaults(cfg), changed: true };
}

module.exports = {
  STREAM_PROFILE_VERSION,
  STREMIO_STREAM_DEFAULTS,
  needsStreamProfileUpgrade,
  applyMissingStreamDefaults,
  upgradeStreamProfile,
};