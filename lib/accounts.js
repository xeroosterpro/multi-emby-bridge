// ─── User account helpers: password hashing + session tokens ────────────────
// Pure Node crypto (scrypt) — no native deps. Phase 2 wires these into the DB.
// Stored password format: "scrypt$<N>$<r>$<p>$<salt_b64>$<hash_b64>".

const crypto = require('crypto');

const N = 16384, R = 8, P = 1, KEYLEN = 64, SALT_BYTES = 16;

function hashPassword(password) {
  if (typeof password !== 'string' || password.length === 0) throw new Error('password required');
  const salt = crypto.randomBytes(SALT_BYTES);
  const dk = crypto.scryptSync(password, salt, KEYLEN, { N, r: R, p: P });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${dk.toString('base64')}`;
}

function verifyPassword(password, stored) {
  try {
    const parts = String(stored).split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
    const [, n, r, p, saltB, hashB] = parts;
    const salt = Buffer.from(saltB, 'base64');
    const expected = Buffer.from(hashB, 'base64');
    const dk = crypto.scryptSync(password, salt, expected.length, { N: +n, r: +r, p: +p });
    return dk.length === expected.length && crypto.timingSafeEqual(dk, expected);
  } catch {
    return false;
  }
}

// Session token: return the raw token to the client (cookie), store only its hash.
function generateSessionToken() {
  return crypto.randomBytes(32).toString('base64url');
}
function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

module.exports = { hashPassword, verifyPassword, generateSessionToken, hashToken };
