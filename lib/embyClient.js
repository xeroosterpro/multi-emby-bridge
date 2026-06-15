// ─── NVIDIA Shield Emby for Android client identity ─────────────────────────
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const EMBY_UA = 'Emby/2.1.19 (Android; Android 10; SHIELD Android TV Build/QTZ.200703.040)';
const EMBY_CLIENT = 'Emby for Android';
const EMBY_DEVICE_NAME = 'NVIDIA SHIELD Android TV';
const EMBY_CLIENT_VERSION = '2.1.19';

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const DEVICE_ID_FILE = path.join(DATA_DIR, 'device-id.json');

let _legacyDeviceId = null;
const _deviceIdByUser = new Map();

function _generateDeviceId() {
  return crypto.randomBytes(16).toString('hex');
}

function _loadLegacyDeviceId() {
  if (_legacyDeviceId) return _legacyDeviceId;
  if (process.env.EMBY_DEVICE_ID) {
    _legacyDeviceId = String(process.env.EMBY_DEVICE_ID).trim();
    return _legacyDeviceId;
  }
  try {
    if (fs.existsSync(DEVICE_ID_FILE)) {
      const data = JSON.parse(fs.readFileSync(DEVICE_ID_FILE, 'utf8'));
      if (data.deviceId) {
        _legacyDeviceId = data.deviceId;
        return _legacyDeviceId;
      }
    }
  } catch { /* regenerate */ }
  _legacyDeviceId = _generateDeviceId();
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(DEVICE_ID_FILE, JSON.stringify({ deviceId: _legacyDeviceId, createdAt: new Date().toISOString() }, null, 2), 'utf8');
  } catch { /* non-critical */ }
  return _legacyDeviceId;
}

function getDeviceId(userKey) {
  if (!userKey) return _loadLegacyDeviceId();
  const key = String(userKey);
  if (_deviceIdByUser.has(key)) return _deviceIdByUser.get(key);
  const id = crypto.createHash('sha256').update(key).digest('hex').slice(0, 32);
  _deviceIdByUser.set(key, id);
  return id;
}

function buildMediaBrowserAuth(token = null, userKey = null) {
  const parts = [
    `Client="${EMBY_CLIENT}"`,
    `Device="${EMBY_DEVICE_NAME}"`,
    `DeviceId="${getDeviceId(userKey)}"`,
    `Version="${EMBY_CLIENT_VERSION}"`,
  ];
  if (token) parts.push(`Token="${token}"`);
  return `MediaBrowser ${parts.join(', ')}`;
}

function baseAndroidHeaders() {
  return {
    'User-Agent': EMBY_UA,
    'accept-encoding': 'gzip',
    'accept-language': 'en-US',
    'connection': 'Keep-Alive',
  };
}

function buildOutboundHeaders(server, getApiKey) {
  const key = getApiKey(server);
  const userKey = server._deviceUserKey || server.userId || null;
  const base = baseAndroidHeaders();
  if (server.type === 'jellyfin') {
    return {
      ...base,
      'Authorization': `MediaBrowser Token="${key}"`,
      'X-MediaBrowser-Token': key,
    };
  }
  const deviceId = getDeviceId(userKey);
  const mbAuth = buildMediaBrowserAuth(key, userKey);
  return {
    ...base,
    'X-Emby-Client': EMBY_CLIENT,
    'X-Emby-Device-Name': EMBY_DEVICE_NAME,
    'X-Emby-Device-Id': deviceId,
    'X-Emby-Client-Version': EMBY_CLIENT_VERSION,
    'X-Emby-Token': key,
    'X-Emby-Authorization': mbAuth,
    'Authorization': mbAuth,
  };
}

function buildAuthOnlyHeaders(userKey = null) {
  const mbAuth = buildMediaBrowserAuth(null, userKey);
  const deviceId = getDeviceId(userKey);
  return {
    ...baseAndroidHeaders(),
    'Content-Type': 'application/json',
    'X-Emby-Client': EMBY_CLIENT,
    'X-Emby-Device-Name': EMBY_DEVICE_NAME,
    'X-Emby-Device-Id': deviceId,
    'X-Emby-Client-Version': EMBY_CLIENT_VERSION,
    'X-Emby-Authorization': mbAuth,
    'Authorization': mbAuth,
  };
}

function getClientIdentity(userKey = null) {
  return {
    ua: EMBY_UA,
    client: EMBY_CLIENT,
    deviceName: EMBY_DEVICE_NAME,
    deviceId: getDeviceId(userKey),
    clientVersion: EMBY_CLIENT_VERSION,
    mediaBrowserAuth: buildMediaBrowserAuth(null, userKey),
  };
}

// Back-compat aliases used elsewhere
const SHIELD_UA = EMBY_UA;
const EMBY_CLIENT_HEADER = buildMediaBrowserAuth();

module.exports = {
  EMBY_UA,
  EMBY_CLIENT,
  EMBY_DEVICE_NAME,
  EMBY_CLIENT_VERSION,
  SHIELD_UA,
  EMBY_CLIENT_HEADER,
  getDeviceId,
  buildMediaBrowserAuth,
  buildOutboundHeaders,
  buildAuthOnlyHeaders,
  getClientIdentity,
  baseAndroidHeaders,
};