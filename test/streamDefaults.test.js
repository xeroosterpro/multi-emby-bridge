const { upgradeStreamProfile, applyMissingStreamDefaults, needsStreamProfileUpgrade, STREMIO_STREAM_DEFAULTS } = require('../lib/streamDefaults');

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) { console.log(`  ✓ ${msg}`); passed++; }
  else { console.error(`  ✗ ${msg}`); failed++; }
}

console.log('\nstreamDefaults');
{
  assert(needsStreamProfileUpgrade({}), 'empty config needs upgrade');
  assert(needsStreamProfileUpgrade({ streamProfile: 1 }), 'v1 needs upgrade');
  assert(needsStreamProfileUpgrade({ streamProfile: 2 }), 'v2 needs upgrade to v3');
  assert(!needsStreamProfileUpgrade({ streamProfile: 3 }), 'v3 does not need upgrade');

  const { cfg, changed } = upgradeStreamProfile({ servers: [{ label: 'A' }], labelPreset: 'standard' });
  assert(changed, 'upgrade reports changed');
  assert(cfg.autoSelect === true, 'autoSelect on');
  assert(cfg.labelPreset === 'standard', 'preserves explicit labelPreset on upgrade');
  assert(cfg.audioRank === true, 'audio rank on');
  assert(cfg.showSummary === true && cfg.summaryStyle === 'compact', 'compact summary');
  assert(cfg.ping === false && cfg.recommend === true, 'ping off, recommend on');
  assert(cfg.streamProfile === 3, 'profile version set');

  const again = upgradeStreamProfile(cfg);
  assert(!again.changed, 'second upgrade is no-op');
  assert(again.cfg.labelPreset === 'standard', 'preserves settings');

  const merged = applyMissingStreamDefaults({
    streamProfile: 1,
    audioRank: false,
    audioRankMode: 'tiebreak',
    sortOrder: 'bitrate',
  });
  assert(merged.streamProfile === 3, 'bumps stream profile');
  assert(merged.audioRank === false, 'keeps saved audioRank');
  assert(merged.audioRankMode === 'tiebreak', 'keeps saved audioRankMode');
  assert(merged.sortOrder === 'bitrate', 'keeps unrelated fields');
  assert(merged.labelPreset === 'compact', 'fills missing labelPreset');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);