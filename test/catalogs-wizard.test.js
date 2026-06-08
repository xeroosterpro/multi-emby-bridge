// Run with: node test/catalogs-wizard.test.js
const {
  WIZARD_STEPS,
  parseStepFromHash,
  deriveKeyStatus,
  countEnabledRows,
  stepIndex,
  isStepComplete,
} = require('../lib/catalogsWizard');

let passed = 0, failed = 0;
const A = (c, m) => { c ? (console.log(`  ✓ ${m}`), passed++) : (console.error(`  ✗ ${m}`), failed++); };

A(WIZARD_STEPS.length === 4, 'four wizard steps');
A(parseStepFromHash('#/catalogs?step=discover', '') === 'discover', 'parse step from hash query');
A(parseStepFromHash('#/catalogs', '?step=review') === 'review', 'parse step from search');
A(parseStepFromHash('#/catalogs', '') === 'connect', 'default step connect');

A(deriveKeyStatus('', null) === 'unset', 'empty key unset');
A(deriveKeyStatus('abc', true) === 'ok', 'tested key ok');
A(deriveKeyStatus('abc', false) === 'bad', 'failed key bad');
A(deriveKeyStatus('abc', null) === 'set', 'untested key set');

A(countEnabledRows([{ enabled: true }, { enabled: false }, {}]) === 2, 'count enabled rows');
A(stepIndex('review') === 3, 'review is step 3');

A(isStepComplete('connect', { tmdbApiKey: 'x' }), 'connect done with tmdb');
A(!isStepComplete('discover', { externalCatalogs: [] }), 'discover needs rows');
A(isStepComplete('discover', { externalCatalogs: [{ name: 'A' }] }), 'discover done with row');

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);