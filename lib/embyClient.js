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

let _deviceId = null;

function _generateDeviceId() {
  return crypto.randomBytes(16).toString('hex');
}

function getDeviceId() {
  if (_deviceId) return _deviceId;
  if (process.env.EMBY_DEVICE_ID) {
    _deviceId = String(process.env.EMBY_DEVICE_ID).trim();
    return _deviceId;
  }
  try {
    if (fs.existsSync(DEVICE_ID_FILE)) {
      const data = JSON.parse(fs.readFileSync(DEVICE_ID_FILE, 'utf8'));
      if (data.deviceId) {
        _deviceId = data.deviceId;
        return _deviceId;
      }
    }
  } catch { /* regenerate */ }
  _deviceId = _generateDeviceId();
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(DEVICE_ID_FILE, JSON.stringify({ deviceId: _deviceId, createdAt: new Date().toISOString() }, null, 2), 'utf8');
  } catch { /* non-critical */ }
  return _deviceId;
}

function buildMediaBrowserAuth(token = null) {
  const parts = [
    `Client="${EMBY_CLIENT}"`,
    `Device="${EMBY_DEVICE_NAME}"`,
    `DeviceId="${getDeviceId()}"`,
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
  const base = baseAndroidHeaders();
  if (server.type === 'jellyfin') {
    return {
      ...base,
      'Authorization': `MediaBrowser Token="${key}"`,
      'X-MediaBrowser-Token': key,
    };
  }
  const mbAuth = buildMediaBrowserAuth(key);
  return {
    ...base,
    'X-Emby-Client': EMBY_CLIENT,
    'X-Emby-Device-Name': EMBY_DEVICE_NAME,
    'X-Emby-Device-Id': getDeviceId(),
    'X-Emby-Client-Version': EMBY_CLIENT_VERSION,
    'X-Emby-Token': key,
    'X-Emby-Authorization': mbAuth,
    'Authorization': mbAuth,
  };
}

function buildAuthOnlyHeaders() {
  const mbAuth = buildMediaBrowserAuth();
  return {
    ...baseAndroidHeaders(),
    'Content-Type': 'application/json',
    'X-Emby-Client': EMBY_CLIENT,
    'X-Emby-Device-Name': EMBY_DEVICE_NAME,
    'X-Emby-Device-Id': getDeviceId(),
    'X-Emby-Client-Version': EMBY_CLIENT_VERSION,
    'X-Emby-Authorization': mbAuth,
    'Authorization': mbAuth,
  };
}

function getClientIdentity() {
  return {
    ua: EMBY_UA,
    client: EMBY_CLIENT,
    deviceName: EMBY_DEVICE_NAME,
    deviceId: getDeviceId(),
    clientVersion: EMBY_CLIENT_VERSION,
    mediaBrowserAuth: buildMediaBrowserAuth(),
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