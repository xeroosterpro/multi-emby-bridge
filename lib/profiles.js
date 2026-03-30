// ─── Profile management ──────────────────────────────────────────────────────
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const PROFILES_FILE = path.join(DATA_DIR, 'profiles.json');

let profilesCache = null;

function hashPassword(password, salt) {
  return crypto.createHmac('sha256', salt).update(password).digest('hex');
}

function loadProfiles() {
  if (profilesCache) return profilesCache;
  try {
    if (fs.existsSync(PROFILES_FILE)) {
      profilesCache = JSON.parse(fs.readFileSync(PROFILES_FILE, 'utf8'));
    } else {
      profilesCache = {};
    }
  } catch {
    profilesCache = {};
  }
  return profilesCache;
}

function saveProfiles(profiles) {
  profilesCache = profiles;
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(PROFILES_FILE, JSON.stringify(profiles, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.error('Could not write profiles file:', err.message);
    return false;
  }
}

module.exports = {
  hashPassword,
  loadProfiles,
  saveProfiles,
};
