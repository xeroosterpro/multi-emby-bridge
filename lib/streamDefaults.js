// Stremio-facing stream defaults — tuned for multi-server setups (one-tap play, compact labels).
const STREAM_PROFILE_VERSION = 2;

const STREMIO_STREAM_DEFAULTS = {
  autoSelect: true,
  labelPreset: 'compact',
  audioRank: true,
  audioRankMode: 'audioFirst',
  audioDisableAction: 'hide',
  showSummary: true,
  summaryStyle: 'compact',
  recommend: true,
  ping: true,
  pingDetail: false,
};

function needsStreamProfileUpgrade(cfg) {
  return !cfg || (cfg.streamProfile | 0) < STREAM_PROFILE_VERSION;
}

function upgradeStreamProfile(cfg) {
  if (!needsStreamProfileUpgrade(cfg)) return { cfg, changed: false };
  return {
    cfg: { ...cfg, ...STREMIO_STREAM_DEFAULTS, streamProfile: STREAM_PROFILE_VERSION },
    changed: true,
  };
}

module.exports = {
  STREAM_PROFILE_VERSION,
  STREMIO_STREAM_DEFAULTS,
  needsStreamProfileUpgrade,
  upgradeStreamProfile,
};