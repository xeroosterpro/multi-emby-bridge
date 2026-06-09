// ─── Demo / placeholder servers (tour, stale localStorage) — never count as real ─
const DEMO_SERVER_URL_RE = /emby\.cloud\.example\.com|jellyfin\.home\.lab(?::8096)?|192\.168\.1\.42(?::8096)?/i;

const DEMO_SERVER_LABELS = new Set(['Cloud Emby', 'Home Jellyfin', 'Backup NAS']);

const DEMO_URL_SQL = `emby\\.cloud\\.example\\.com|jellyfin\\.home\\.lab(:8096)?|192\\.168\\.1\\.42(:8096)?`;
const DEMO_LABEL_SQL = `'Cloud Emby', 'Home Jellyfin', 'Backup NAS'`;

/** Postgres filter — keep real servers only */
const DEMO_SERVER_SQL_EXCLUDE = `server_url !~* '${DEMO_URL_SQL}'
  AND COALESCE(label, '') NOT IN (${DEMO_LABEL_SQL})`;

/** Postgres filter — match demo/placeholder rows for deletion */
const DEMO_SERVER_SQL_MATCH = `server_url ~* '${DEMO_URL_SQL}'
  OR COALESCE(label, '') IN (${DEMO_LABEL_SQL})`;

function isDemoServer(server) {
  if (!server) return false;
  const label = String(server.label || '').trim();
  if (DEMO_SERVER_LABELS.has(label)) return true;
  const url = String(server.url || server.serverUrl || server.server_url || '');
  return DEMO_SERVER_URL_RE.test(url);
}

function stripDemoServers(servers) {
  return (servers || []).filter(s => s && !isDemoServer(s));
}

module.exports = {
  DEMO_SERVER_URL_RE,
  DEMO_SERVER_LABELS,
  DEMO_SERVER_SQL_EXCLUDE,
  DEMO_SERVER_SQL_MATCH,
  isDemoServer,
  stripDemoServers,
};