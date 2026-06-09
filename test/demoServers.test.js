// Run with: node test/demoServers.test.js
const { isDemoServer, stripDemoServers } = require('../lib/demoServers');

let passed = 0, failed = 0;
const A = (c, m) => { c ? (console.log(`  ✓ ${m}`), passed++) : (console.error(`  ✗ ${m}`), failed++); };

A(isDemoServer({ url: 'https://emby.cloud.example.com', label: 'Anything' }), 'demo by example.com url');
A(isDemoServer({ url: 'https://jellyfin.home.lab:8096' }), 'demo by home.lab url');
A(isDemoServer({ url: 'https://192.168.1.42:8096' }), 'demo by nas ip url');
A(isDemoServer({ url: 'https://real.server.com', label: 'Cloud Emby' }), 'demo by label');
A(!isDemoServer({ url: 'https://arctv.example.com', label: 'ARCTV' }), 'real server passes');

const mixed = [
  { url: 'https://emby.cloud.example.com', label: 'Cloud Emby' },
  { url: 'https://real.host/emby', label: 'ARCTV' },
];
A(stripDemoServers(mixed).length === 1, 'stripDemoServers keeps real only');

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);