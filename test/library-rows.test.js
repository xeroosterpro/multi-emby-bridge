const assert = require('assert');
const { deriveLibraryRows } = require('../server-helpers');

assert.deepStrictEqual(deriveLibraryRows({ libraryRows: ['recent','nextup'] }), ['recent','nextup']);
assert.deepStrictEqual(deriveLibraryRows({ catalogContent: 'resume' }), ['resume'], 'legacy single content');
assert.deepStrictEqual(deriveLibraryRows({ showCatalog: false }), [], 'catalog disabled → none');
assert.deepStrictEqual(deriveLibraryRows({}), ['recent'], 'default');
assert.deepStrictEqual(deriveLibraryRows({ libraryRows: ['bogus','resume'] }), ['resume'], 'drops unknown keys');
console.log('deriveLibraryRows tests passed');
