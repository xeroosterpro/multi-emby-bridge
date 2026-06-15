// ─── One-time-safe import of saved servers from a prior account (e.g. Eli) ───
const db = require('./db');
const { makeUsers } = require('./users');
const { makeUserConfig } = require('./userConfig');
const { upgradeStreamProfile } = require('./streamDefaults');

const PREFERRED_SOURCES = ['Eli', 'eli'];

function completeServers(servers) {
  return (servers || []).filter(s => s && s.url && s.apiKey && s.userId);
}

async function migrateLegacyServersToAdmin(adminUserId) {
  if (!db.isConfigured() || !adminUserId) return { migrated: false, reason: 'no_db' };

  const uc = makeUserConfig(db);
  const adminCfg = await uc.getForServe(adminUserId);
  if (completeServers(adminCfg?.servers).length > 0) {
    return { migrated: false, reason: 'admin_has_servers', count: completeServers(adminCfg.servers).length };
  }

  const users = makeUsers(db);
  let sourceId = null;
  let sourceName = null;

  for (const name of PREFERRED_SOURCES) {
    const u = await users.findByUsername(name);
    if (!u || u.id === adminUserId) continue;
    const cfg = await uc.getForServe(u.id);
    if (completeServers(cfg?.servers).length > 0) {
      sourceId = u.id;
      sourceName = u.username;
      break;
    }
  }

  if (!sourceId) {
    const r = await db.query(
      `SELECT u.id, u.username,
              COALESCE(jsonb_array_length(uc.config_json->'servers'), 0) AS server_count
       FROM users u
       JOIN user_config uc ON uc.user_id = u.id
       WHERE u.id != $1
       ORDER BY server_count DESC
       LIMIT 1`,
      [adminUserId],
    );
    if (r.rowCount && Number(r.rows[0].server_count) > 0) {
      sourceId = r.rows[0].id;
      sourceName = r.rows[0].username;
    }
  }

  if (!sourceId) {
    console.log('[migrate] no legacy server config found to import');
    return { migrated: false, reason: 'no_source' };
  }

  const sourceCfg = await uc.getForServe(sourceId);
  const servers = completeServers(sourceCfg?.servers);
  if (!servers.length) {
    return { migrated: false, reason: 'source_empty' };
  }

  const { cfg } = upgradeStreamProfile({ ...sourceCfg, servers });
  await uc.save(adminUserId, cfg);
  console.log(`[migrate] imported ${servers.length} server(s) from '${sourceName}' into admin`);
  return { migrated: true, from: sourceName, count: servers.length, labels: servers.map(s => s.label) };
}

module.exports = { migrateLegacyServersToAdmin, completeServers };