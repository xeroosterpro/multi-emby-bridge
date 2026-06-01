// ─── AES-256-GCM encryption for API keys at rest ────────────────────────────
// Stored format: "<iv_b64>:<authTag_b64>:<ciphertext_b64>". GCM provides both
// confidentiality and tamper detection (decrypt throws if the blob was altered).
//
// The master key comes from the CONFIG_ENC_KEY env var (32 bytes, base64).
// Generate one with: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"

const crypto = require('crypto');

const ALGO = 'aes-256-gcm';
const IV_BYTES = 12;
const KEY_BYTES = 32;

function generateKey() {
  return crypto.randomBytes(KEY_BYTES).toString('base64');
}

function resolveKey(key) {
  if (key) {
    const buf = Buffer.isBuffer(key) ? key : Buffer.from(key, 'base64');
    if (buf.length !== KEY_BYTES) throw new Error(`encryption key must be ${KEY_BYTES} bytes`);
    return buf;
  }
  const raw = process.env.CONFIG_ENC_KEY;
  if (!raw) throw new Error('CONFIG_ENC_KEY not set');
  const buf = Buffer.from(raw, 'base64');
  if (buf.length !== KEY_BYTES) throw new Error(`CONFIG_ENC_KEY must be ${KEY_BYTES} bytes (base64)`);
  return buf;
}

function encrypt(plaintext, key) {
  const k = resolveKey(key);
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGO, k, iv);
  const enc = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString('base64'), tag.toString('base64'), enc.toString('base64')].join(':');
}

function decrypt(blob, key) {
  const k = resolveKey(key);
  const parts = String(blob).split(':');
  if (parts.length !== 3) throw new Error('malformed ciphertext');
  const [ivB, tagB, dataB] = parts;
  const decipher = crypto.createDecipheriv(ALGO, k, Buffer.from(ivB, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB, 'base64'));
  const dec = Buffer.concat([decipher.update(Buffer.from(dataB, 'base64')), decipher.final()]);
  return dec.toString('utf8');
}

module.exports = { encrypt, decrypt, generateKey, ALGO, KEY_BYTES };
