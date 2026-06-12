// Run with: node test/activityEnrich.test.js
const {
  titlesMatch,
  matchLiveToEntry,
  enrichRecentEntries,
  dedupeRecentByContent,
  recentMatchesLive,
  mergeActivityHistory,
  mergeLiveIntoRecent,
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

// Legacy rows with identical generic titles ("Episode 2") but different series
// must NOT collapse — disambiguate by imdbId when present.
const genericCollision = dedupeRecentByContent([
  { title: 'Episode 2', imdbId: 'tt100', season: 1, episode: 2, ts: '2026-06-06T23:00:05Z' },
  { title: 'Episode 2', imdbId: 'tt200', season: 1, episode: 2, ts: '2026-06-06T23:00:00Z' },
]);
A(genericCollision.length === 2, 'same generic title + S/E but different imdbId stay separate');

const sameImdbCollapses = dedupeRecentByContent([
  { title: 'Episode 2', imdbId: 'tt100', season: 1, episode: 2, ts: '2026-06-06T23:00:05Z' },
  { title: 'Episode 2', imdbId: 'tt100', season: 1, episode: 2, ts: '2026-06-06T23:00:00Z' },
]);
A(sameImdbCollapses.length === 1 && sameImdbCollapses[0].lookupCount === 2, 'same imdbId + S/E collapses');

// ─── recentMatchesLive: history "▶ now" must agree with the Live panel set ───
// The Live panel set (bundle.live) is already suppressed/real-session-aware, so
// a history row should show "▶ now" iff it corresponds to an entry in that set.
const liveSet = [
  { title: 'Michael Jackson: The Verdict S1E2 — Episode 2', season: 1, episode: 2, source: 'bridge' },
  { title: 'Dune: Part Two', source: 'sessions' },
];
A(recentMatchesLive({ title: 'Michael Jackson: The Verdict S1E2 — Episode 2', season: 1, episode: 2 }, liveSet) === true,
  'history row matches the same episode in the live set');
A(recentMatchesLive({ title: 'Michael Jackson: The Verdict S1E3 — Episode 3', season: 1, episode: 3 }, liveSet) === false,
  'a different episode of the same series is NOT marked live');
A(recentMatchesLive({ title: 'Dune: Part Two' }, liveSet) === true, 'movie matches by title');
A(recentMatchesLive({ title: 'Severance S1E1', season: 1, episode: 1 }, liveSet) === false, 'unrelated title not live');
A(recentMatchesLive({ title: 'Anything' }, []) === false, 'empty live set → never live');
A(recentMatchesLive({ title: 'Anything' }, null) === false, 'missing live set → never live');

console.log('\nmergeLiveIntoRecent:');
const liveOnly = mergeLiveIntoRecent([], [{
  title: 'The Great British Bake Off S15E3', season: 15, episode: 3,
  server: 'BK', source: 'sessions', serverType: 'emby',
}]);
A(liveOnly.length === 1 && liveOnly[0].kind === 'live', 'prepends live session with no history row');
A(liveOnly[0].title.includes('Bake Off'), 'live row keeps title');

const withHistory = mergeLiveIntoRecent(
  [{ title: 'Dune: Part Two', ts: '2026-06-08T10:00:00Z', source: 'bridge' }],
  [{ title: 'Dune: Part Two', source: 'sessions', server: 'ARCTV' }],
);
A(withHistory.length === 1, 'does not duplicate when history already matches live');

const bridgeSkipped = mergeLiveIntoRecent([], [{
  title: 'Bridge Guess', source: 'bridge', server: 'BK',
}]);
A(bridgeSkipped.length === 0, 'skips bridge-only live rows');

console.log('\nmergeActivityHistory:');
const merged = mergeActivityHistory(
  [{ title: 'Bee Movie', ts: '2026-06-07T10:00:00Z', server: 'ARCTV', source: 'bridge' }],
  [{ title: 'Bee Movie', ts: '2026-06-08T12:00:00Z', server: 'ARCTV', source: 'server', kind: 'played', serverType: 'emby' }],
);
A(merged.length === 1, 'merges bridge + server same title');
A(merged[0].sources.includes('bridge') && merged[0].sources.includes('server'), 'merged row has both sources');
A(merged[0].ts === '2026-06-08T12:00:00Z', 'keeps newer server timestamp');

const resumeMerge = mergeActivityHistory([], [{
  title: 'Breaking Bad S1E1', season: 1, episode: 1, ts: '2026-06-08T08:00:00Z',
  source: 'server', kind: 'resume', progressPct: 42, server: 'Milkyway', serverType: 'emby',
}]);
A(resumeMerge[0].kind === 'resume' && resumeMerge[0].progressPct === 42, 'server resume preserved');

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);