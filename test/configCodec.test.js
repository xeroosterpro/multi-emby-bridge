'use strict';
const assert = require('assert');
const { decodeConfig, encodeConfig } = require('../lib/configCodec');

const sample = { servers: [{ label: 'A', url: 'https://x.com' }], sort: 'ping' };
const enc = encodeConfig(sample);
const dec = decodeConfig(enc);
assert.deepStrictEqual(dec, sample);
assert.throws(() => decodeConfig('not-valid!!!'), SyntaxError);
console.log('configCodec.test.js: all passed');