// Run with: node test/activityEnrich.test.js
const {
  titlesMatch,
  matchLiveToEntry,
  enrichRecentEntries,
} = require('../lib/activityEnrich');

let passed = 0;
let failed = 0;
const A = (c, m) => { c ? (console.log(`  ✓ ${m}`), passed++) : (console.error(`  ✗ ${m}`), failed++); };

A(titlesMatch('Dune: Part Two', 'Dune Part Two'), 'fuzzy title match');
A(titlesMatch('Breaking Bad S1E3', 'Breaking Bad S01E03 — Fly'), 'series title overlap');

const live = [
  { server: 'Milkyway', title: 'Oppenheimer', rawTitle: 'Oppenheimer' },
];
const entry = { title: 'Oppenheimer', server: 'ARCTV', serverStatus: [
  { label: 'ARCTV', status: 'found' },
  { label: 'Milkyway', status: 'found' },
] };
const match = matchLiveToEntry(entry, live);
A(match && match.server === 'Milkyway', 'live session overrides bridge pick');

const enriched = enrichRecentEntries([entry], live);
A(enriched[0].playingServer === 'Milkyway', 'enriched playingServer');
A(enriched[0].pickedServer === 'ARCTV', 'enriched pickedServer');
A(enriched[0].displayServer === 'Milkyway', 'displayServer prefers live');
A(enriched[0].isLiveNow === true, 'isLiveNow flag');
A(enriched[0].availableOn.length === 2, 'availableOn lists found servers');

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);