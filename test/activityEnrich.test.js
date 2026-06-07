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

const bridgeOnly = [{
  title: 'Triple Audible', server: 'ARCTV', serverStatus: [
    { label: 'ARCTV', status: 'found' },
    { label: 'Milkyway', status: 'found' },
  ],
}];
const bridgeLive = [{
  source: 'bridge', title: 'Triple Audible', pickedServer: 'ARCTV',
  availableOn: ['ARCTV', 'Milkyway'], serverConfirmed: false, server: null,
}];
const bridgeEnriched = enrichRecentEntries(bridgeOnly, bridgeLive);
A(bridgeEnriched[0].isLiveNow === true, 'bridge match marks live');
A(bridgeEnriched[0].playingServer == null, 'multi-server bridge does not fake playing server');
A(bridgeEnriched[0].liveUncertain === true, 'flags uncertain attribution');
A(bridgeEnriched[0].displayServer == null, 'multi-server live omits display server');

const multiIdle = enrichRecentEntries(bridgeOnly, []);
A(multiIdle[0].displayServer == null, 'multi-server idle omits ranked pick as display server');

const singleBridge = enrichRecentEntries([{
  title: 'Battleship', server: 'BK', serverStatus: [{ label: 'BK', status: 'found' }],
}], [{
  source: 'bridge', title: 'Battleship', server: 'BK', serverConfirmed: true, availableOn: ['BK'],
}]);
A(singleBridge[0].playingServer === 'BK', 'single-server bridge is confirmed');

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);