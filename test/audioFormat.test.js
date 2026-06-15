'use strict';
const assert = require('assert');
const { pickAudioStream, formatAudioLabels } = require('../lib/audioFormat');

function A(cond, msg) {
  assert.ok(cond, msg);
  console.log('  ✓', msg);
}

(function main() {
  const streams = [
    { Type: 'Audio', Index: 1, Codec: 'aac', Channels: 2 },
    { Type: 'Audio', Index: 2, Codec: 'truehd', Channels: 8, Profile: 'Atmos' },
  ];
  const picked = pickAudioStream(streams, { DefaultAudioStreamIndex: 2 });
  A(picked.Codec === 'truehd', 'picks DefaultAudioStreamIndex track');

  const labels = formatAudioLabels(picked);
  A(labels.shortAudioLabel === 'Atmos', 'Atmos short label');
  A(labels.audioLabel.includes('TrueHD'), 'audio label uses classified codec');

  console.log('\naudioFormat.test.js: all passed');
})();