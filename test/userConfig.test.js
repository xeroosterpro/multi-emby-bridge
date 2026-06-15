// ─── Unit tests for lib/userConfig.js (fake DB + ephemeral key) ─────────────
// Run with: node test/userConfig.test.js
process.env.CONFIG_ENC_KEY = require('../lib/crypto').generateKey();
const { makeUserConfig } = require('../lib/userConfig');

let passed = 0, failed = 0;
const A = (c, m) => { c ? (console.log(`  ✓ ${m}`), passed++) : (console.error(`  ✗ ${m}`), failed++); };

function fakeDb() {
  const byUser = new Map();
  const counts = { writes: 0 };
  return { async query(text, params) {
    if (/INSERT INTO user_config/i.test(text)) {
      counts.writes++;
      const [uid, blob, trakt, tmdb, mdblist, serversEnc] = params;
      byUser.set(uid, {
        user_id: uid,
        config_json: blob,
        trakt_enc: trakt,
        tmdb_enc: tmdb,
        mdblist_enc: mdblist,
        servers_enc: serversEnc,
      });
      return { rows: [], rowCount: 1 };
    }
    if (/SELECT \* FROM user_config/i.test(text)) {
      const row = byUser.get(params[0]);
      return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
    }
    return { rows: [], rowCount: 0 };
  }, _raw: byUser, _counts: counts };
}

(async () => {
  const db = fakeDb();
  const uc = makeUserConfig(db);
  const full = {
    servers: [{ label: 'A', url: 'https://emby.example.com', apiKey: 'EMBYKEY', userId: 'u1', username: 'admin', password: 'secret' }],
    traktClientId: 'TRAKT123',
    tmdbApiKey: 'TMDBKEY',
    mdblistApiKey: 'MDB',
    sort: 'size',
  };
  await uc.save('u1', full);

  const stored = db._raw.get('u1');
  const blob = JSON.parse(stored.config_json);
  A(!blob.traktClientId, 'catalog keys NOT stored in plaintext config_json');
  A(blob.servers[0].label === 'A', 'non-key server config retained in blob');
  A(!blob.servers[0].apiKey, 'server apiKey NOT stored in plaintext config_json');
  A(stored.trakt_enc && !stored.trakt_enc.includes('TRAKT123'), 'trakt key stored encrypted (ciphertext)');
  A(stored.servers_enc && !stored.servers_enc.includes('EMBYKEY'), 'server creds stored encrypted');

  const serve = await uc.getForServe('u1');
  A(serve.traktClientId === 'TRAKT123', 'getForServe decrypts trakt key');
  A(serve.servers[0].apiKey === 'EMBYKEY', 'getForServe decrypts server apiKey');
  A(serve.servers[0].password === 'secret', 'getForServe decrypts server password');

  const edit = await uc.getEditable('u1');
  A(edit.keys.trakt === true && edit.keys.tmdb === true && edit.keys.mdblist === true, 'getEditable reports catalog key presence');
  A(edit.config.traktClientId === undefined, 'getEditable never exposes catalog key values');
  A(edit.config.servers[0].hasApiKey === true, 'getEditable reports hasApiKey flag');
  A(edit.config.servers[0].apiKey === 'EMBYKEY', 'getEditable returns server apiKey for configure UI');
  A(edit.config.servers[0].username === 'admin', 'getEditable returns server username for configure UI');
  A(edit.config.servers[0].password === 'secret', 'getEditable returns server password for configure UI');

  // Merge-on-save: partial update without creds should retain stored secrets
  await uc.save('u1', { servers: [{ label: 'Renamed', url: 'https://emby.example.com', userId: 'u1' }], sort: 'ping' });
  const serve2 = await uc.getForServe('u1');
  A(serve2.servers[0].label === 'Renamed', 'save updates non-secret server fields');
  A(serve2.servers[0].apiKey === 'EMBYKEY', 'save retains stored apiKey when omitted from client payload');

  const none = await uc.getEditable('nobody');
  A(none.keys.trakt === false, 'missing user → keys all false');

  // SEC-2 regression: getForServe must NOT re-save once creds are already
  // encrypted (no plaintext in the stored blob, servers_enc present).
  const writesBefore = db._counts.writes;
  await uc.getForServe('u1');
  await uc.getForServe('u1');
  A(db._counts.writes === writesBefore, 'getForServe does not re-save on the hot path once migrated');

  console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
})();