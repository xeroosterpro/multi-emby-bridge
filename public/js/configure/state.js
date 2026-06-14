// configure/state.js
// ── State ─────────────────────────────────────────────────────────────────
const LS_KEY_BASE = 'meb_config_v1';
const LS_LAST_BASE = 'meb-last-config';
const LS_ACTIVE_USER = 'meb_active_user';
const LS_LEGACY_KEYS = [LS_KEY_BASE, LS_LAST_BASE, 'meb-libstats-cache'];

function getActiveUsername() {
  try { return sessionStorage.getItem(LS_ACTIVE_USER) || ''; } catch { return ''; }
}

function lsKey() {
  const u = getActiveUsername();
  return u ? `${LS_KEY_BASE}:${u}` : LS_KEY_BASE;
}

function lsLastKey() {
  const u = getActiveUsername();
  return u ? `${LS_LAST_BASE}:${u}` : LS_LAST_BASE;
}

function setActiveUsername(username) {
  try {
    if (username) sessionStorage.setItem(LS_ACTIVE_USER, username);
    else sessionStorage.removeItem(LS_ACTIVE_USER);
  } catch { /* */ }
}

function purgeLegacyGlobalConfig() {
  LS_LEGACY_KEYS.forEach(k => { try { localStorage.removeItem(k); } catch {} });
}

function hasCompleteServers(servers) {
  return (servers || []).some(s => s?.url && s?.apiKey && s?.userId);
}

let nextId = 0;
// nextCatId owned by catalogs-wizard.js

// Library-stats cache: key = url|apiKey|userId -> {movies,shows,episodes,ms,ts}
let _libStatsCache = {};
let _dashboardInFlight = false;
let _accountConfigPromise = null;
let _accountServersCache = null;
let _dashLoadGen = 0;
let _libHydrateGen = 0;
let _dashLastFullLoad = 0;
let _dashBusy = false;

const EMBY_LOGO = '<img class="brandimg" src="/img/emby.png" alt="Emby" decoding="async">';
const JELLYFIN_LOGO = '<img class="brandimg" src="/img/jellyfin.png" alt="Jellyfin" decoding="async">';


window.getActiveUsername = getActiveUsername;
window.lsKey = lsKey;
window.lsLastKey = lsLastKey;
window.setActiveUsername = setActiveUsername;
window.purgeLegacyGlobalConfig = purgeLegacyGlobalConfig;
window.hasCompleteServers = hasCompleteServers;
Object.defineProperty(window, 'nextId', { get() { return nextId; }, set(v) { nextId = v; } });
