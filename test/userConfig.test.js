// ─── Unit tests for lib/userConfig.js (fake DB + ephemeral key) ─────────────
// Run with: node test/userConfig.test.js
process.env.CONFIG_ENC_KEY = require('../lib/crypto').generateKey();
const { makeUserConfig } = require('../lib/userConfig');

let passed = 0, failed = 0;
const A = (c, m) => { c ? (console.log(`  ✓ ${m}`), passed++) : (console.error(`  ✗ ${m}`), failed++); };

function fakeDb() {
  const byUser = new Map();
  return { async query(text, params) {
    if (/INSERT INTO user_config/i.test(text)) {
      const [uid, blob, trakt, tmdb, mdblist] = params;
      byUser.set(uid, { user_id: uid, config_json: blob, trakt_enc: trakt, tmdb_enc: tmdb, mdblist_enc: mdblist });
      return { rows: [], rowCount: 1 };
    }
    if (/SELECT \* FROM user_config/i.test(text)) {
      const row = byUser.get(params[0]);
      return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
    }
    return { rows: [], rowCount: 0 };
  }, _raw: byUser };
}

(async () => {
  const db = fakeDb();
  const uc = makeUserConfig(db);
  const full = { servers: [{ label: 'A' }], traktClientId: 'TRAKT123', tmdbApiKey: 'TMDBKEY', mdblistApiKey: 'MDB', sort: 'size' };
  await uc.save('u1', full);

  const stored = db._raw.get('u1');
  A(!JSON.parse(stored.config_json).traktClientId, 'keys NOT stored in plaintext config_json');
  A(stored.config_json.includes('servers'), 'non-key config retained in blob');
  A(stored.trakt_enc && !stored.trakt_enc.includes('TRAKT123'), 'trakt key stored encrypted (ciphertext)');

  const serve = await uc.getForServe('u1');
  A(serve.traktClientId === 'TRAKT123', 'getForServe decrypts trakt key');
  A(serve.tmdbApiKey === 'TMDBKEY', 'getForServe decrypts tmdb key');
  A(serve.servers[0].label === 'A', 'getForServe retains non-key config');

  const edit = await uc.getEditable('u1');
  A(edit.keys.trakt === true && edit.keys.tmdb === true && edit.keys.mdblist === true, 'getEditable reports key presence');
  A(edit.config.traktClientId === undefined, 'getEditable never exposes key values');

  const none = await uc.getEditable('nobody');
  A(none.keys.trakt === false, 'missing user → keys all false');

  console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
})();
