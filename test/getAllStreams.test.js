'use strict';
const assert = require('assert');
const path = require('path');

function stubModule(name, exports) {
  const id = path.resolve(__dirname, '..', 'lib', name + '.js');
  require.cache[id] = { id, filename: id, loaded: true, exports };
}

stubModule('auth', {
  apiFetch: async () => ({ json: async () => ({ MediaSources: [] }) }),
  pingServer: async () => 12,
  buildStreamUrl: (server, itemId, sourceId) => `${server.url}/stream/${itemId}/${sourceId}`,
  canQueryServer: () => true,
});

stubModule('search', {
  queryServerForMovie: async (server) => [{
    Id: `item-${server.label}`,
    Name: 'Movie',
    MediaSources: [{
      Id: `src-${server.label}`,
      Size: 5e9,
      Bitrate: 15e6,
      Container: 'mkv',
      MediaStreams: [
        { Type: 'Video', Codec: 'hevc', Width: 1920, Height: 1080 },
        { Type: 'Audio', Codec: 'aac', Channels: 2, Language: 'eng' },
      ],
    }],
  }],
  queryServerForEpisode: async () => [],
});

const { getAllStreams } = require('../lib/streams');

function A(cond, msg) {
  assert.ok(cond, msg);
  console.log('  ✓', msg);
}

(async function main() {
  const servers = [
    { url: 'https://a.example.com', label: 'ServerA', userId: 'u1', apiKey: 'k1', enabled: true },
    { url: 'https://b.example.com', label: 'ServerB', userId: 'u2', apiKey: 'k2', enabled: true },
  ];
  const result = await getAllStreams(servers, 'movie', 'tt1234567', null, null, {
    labelPreset: 'compact',
    audioRank: true,
    ping: false,
  });
  A(result.streams.length >= 2, 'merges streams from multiple servers');
  A(result.streams.every((s) => s.url && s.name), 'streams have url and name');
  A(result.meta.serverStatus.length === 2, 'tracks per-server status');
  console.log('\ngetAllStreams.test.js: all passed');
})().catch((e) => { console.error(e); process.exit(1); });