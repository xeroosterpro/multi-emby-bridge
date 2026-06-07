const { upgradeStreamProfile, needsStreamProfileUpgrade, STREMIO_STREAM_DEFAULTS } = require('../lib/streamDefaults');

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
  assert(!needsStreamProfileUpgrade({ streamProfile: 2 }), 'v2 does not need upgrade');

  const { cfg, changed } = upgradeStreamProfile({ servers: [{ label: 'A' }], labelPreset: 'standard' });
  assert(changed, 'upgrade reports changed');
  assert(cfg.autoSelect === true, 'autoSelect on');
  assert(cfg.labelPreset === 'compact', 'compact labels');
  assert(cfg.audioRank === true, 'audio rank on');
  assert(cfg.showSummary === true && cfg.summaryStyle === 'compact', 'compact summary');
  assert(cfg.ping === true && cfg.recommend === true, 'ping + recommend on');
  assert(cfg.streamProfile === 2, 'profile version set');

  const again = upgradeStreamProfile(cfg);
  assert(!again.changed, 'second upgrade is no-op');
  assert(again.cfg.labelPreset === 'compact', 'preserves settings');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);