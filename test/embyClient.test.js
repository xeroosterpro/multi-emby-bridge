'use strict';
const assert = require('assert');
const {
  EMBY_UA, EMBY_CLIENT, buildOutboundHeaders, buildAuthOnlyHeaders, getDeviceId,
} = require('../lib/embyClient');

function A(cond, msg) {
  assert.ok(cond, msg);
  console.log('  ✓', msg);
}

(function main() {
  A(EMBY_UA.includes('SHIELD Android TV'), 'UA contains Shield');
  A(EMBY_CLIENT === 'Emby for Android', 'client is Emby for Android');
  const id = getDeviceId();
  A(id && id.length >= 16, 'device id generated');
  const userA = getDeviceId('user-a');
  const userB = getDeviceId('user-b');
  A(userA !== userB, 'per-user device ids differ');
  A(getDeviceId('user-a') === userA, 'per-user device id is stable');
  const headers = buildOutboundHeaders({ type: 'emby', apiKey: 'test-key', userId: 'u1' }, () => 'test-key');
  A(headers['X-Emby-Client'] === 'Emby for Android', 'X-Emby-Client set');
  A(headers['X-Emby-Device-Name'] === 'NVIDIA SHIELD Android TV', 'device name set');
  A(headers['X-Emby-Device-Id'] === getDeviceId('u1'), 'device id in headers uses userId');
  A(headers['accept-encoding'] === 'gzip', 'lowercase accept-encoding');
  const authH = buildAuthOnlyHeaders();
  A(authH['Content-Type'] === 'application/json', 'auth headers include content-type');
  console.log('\nembyClient.test.js: all passed');
})();