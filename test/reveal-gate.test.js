const assert = require('assert');
const { shouldAnimate } = require('../public/js/reveal.js');

let pass = 0;
function t(name, fn) { fn(); console.log('  ✓ ' + name); pass++; }

t('animates when motion not reduced', () => assert.strictEqual(shouldAnimate({ reduced: false, forced: false }), true));
t('suppressed when reduced and not forced', () => assert.strictEqual(shouldAnimate({ reduced: true, forced: false }), false));
t('forced wins over reduced', () => assert.strictEqual(shouldAnimate({ reduced: true, forced: true }), true));
t('forced with no reduced still animates', () => assert.strictEqual(shouldAnimate({ reduced: false, forced: true }), true));
console.log(pass + ' tests: ' + pass + ' passed, 0 failed');
