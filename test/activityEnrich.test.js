// Run with: node test/activityEnrich.test.js
const {
  titlesMatch,
  matchLiveToEntry,
  enrichRecentEntries,
  dedupeRecentByContent,
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

const multiIdle = enrichRecentEntries(bridgeOnly, []);
A(multiIdle[0].isLiveNow === false, 'idle row not marked live');

const singleBridge = enrichRecentEntries([{
  title: 'Battleship', server: 'BK', serverStatus: [{ label: 'BK', status: 'found' }],
}], [{
  source: 'bridge', title: 'Battleship', server: 'BK', serverConfirmed: true, availableOn: ['BK'],
}]);
A(singleBridge[0].isLiveNow === true, 'single-server bridge marks live');

// ─── dedupeRecentByContent: collapse repeat stream lookups into one row ───────
// requestLog rows arrive newest-first; Stremio fires several lookups per episode.
const dupRecent = [
  { title: 'Severance', season: 1, episode: 3, server: 'BK', ts: '2026-06-06T23:00:05Z' },
  { title: 'Severance', season: 1, episode: 3, server: 'BK', ts: '2026-06-06T23:00:03Z' },
  { title: 'Severance', season: 1, episode: 3, server: 'BK', ts: '2026-06-06T23:00:01Z' },
  { title: 'Severance', season: 1, episode: 2, server: 'BK', ts: '2026-06-06T22:59:00Z' },
];
const distinct = dedupeRecentByContent(dupRecent);
A(distinct.length === 2, 'collapses duplicate lookups to one row per episode');
A(distinct[0].episode === 3 && distinct[0].ts === '2026-06-06T23:00:05Z', 'keeps most-recent ts for the episode');
A(distinct[0].lookupCount === 3, 'counts how many lookups collapsed');
A(distinct[1].episode === 2, 'distinct episodes preserved, newest-first');

const movieDup = dedupeRecentByContent([
  { title: 'Dune', ts: '2026-06-06T23:00:05Z' },
  { title: 'Dune', ts: '2026-06-06T23:00:00Z' },
]);
A(movieDup.length === 1 && movieDup[0].lookupCount === 2, 'movie lookups (no season/episode) collapse too');

const normDup = dedupeRecentByContent([
  { title: 'The Wild Robot', ts: '2026-06-06T23:00:05Z' },
  { title: 'the wild robot!', ts: '2026-06-06T23:00:00Z' },
]);
A(normDup.length === 1, 'normalizes title (case/punctuation) for dedup');

const sameEpDiffShow = dedupeRecentByContent([
  { title: 'Severance', season: 1, episode: 1, ts: '2026-06-06T23:00:05Z' },
  { title: 'Andor', season: 1, episode: 1, ts: '2026-06-06T23:00:00Z' },
]);
A(sameEpDiffShow.length === 2, 'same S/E on different shows stay separate');

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);