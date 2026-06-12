// Run with: node test/serverWatchHistory.test.js
const { mapServerItem, progressFromItem } = require('../lib/serverWatchHistory');
const { apiPathVariants } = require('../lib/serverPaths');

let passed = 0, failed = 0;
const A = (c, m) => { c ? (console.log(`  ✓ ${m}`), passed++) : (console.error(`  ✗ ${m}`), failed++); };

const server = { label: 'ARCTV', url: 'https://host/emby', type: 'emby', userId: 'u1' };

const ep = mapServerItem({
  Type: 'Episode', Name: 'Pilot', SeriesName: 'Breaking Bad',
  ParentIndexNumber: 1, IndexNumber: 1,
  ProviderIds: { Imdb: 'tt0903747' },
  UserData: { LastPlayedDate: '2026-06-08T10:00:00Z', PlayedPercentage: 35 },
  RunTimeTicks: 10000000000,
}, server, 'resume');

A(ep.title.includes('Breaking Bad') && ep.title.includes('S1E1'), 'episode title formatted');
A(ep.kind === 'resume' && ep.progressPct === 35, 'resume progress');
A(ep.source === 'server' && ep.serverType === 'emby', 'server metadata');

const movie = mapServerItem({
  Type: 'Movie', Name: 'Dune',
  UserData: { LastPlayedDate: '2026-06-07T10:00:00Z' },
}, server, 'played');
A(movie.title === 'Dune' && movie.kind === 'played', 'movie played row');

A(progressFromItem({ UserData: { PlayedPercentage: 88 } }, 'played') === 88, 'played pct');

const resumePaths = apiPathVariants('https://host.example.com/emby', '/Users/u1/Items/Resume');
A(resumePaths.length >= 1, 'resume endpoint has path variants');
A(resumePaths.some(u => String(u).includes('/Items/Resume')), 'resume variant includes Resume path');
A(resumePaths.some(u => String(u).includes('/emby/Users/')), 'resume variant includes /emby prefix when needed');

const playedPaths = apiPathVariants('https://cloud.example.com', '/Users/u1/PlayedItems');
A(playedPaths.some(u => String(u).includes('/PlayedItems')), 'played items path variant');
A(playedPaths.some(u => String(u).includes('/emby/Users/')), 'played items adds /emby prefix for bare host');

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);