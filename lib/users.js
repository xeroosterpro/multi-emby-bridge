// ─── User repository ────────────────────────────────────────────────────────
// makeUsers(db): db is any object with async query(text, params). Injectable so
// it can be unit-tested with a fake DB (no Postgres needed for the test suite).
const accounts = require('./accounts');

function makeUsers(db) {
  return {
    async create(username, passwordHashOrPlain, role = 'user') {
      const hash = String(passwordHashOrPlain).startsWith('scrypt$')
        ? passwordHashOrPlain
        : accounts.hashPassword(passwordHashOrPlain);
      const r = await db.query(
        'INSERT INTO users(username, password_hash, role) VALUES($1,$2,$3) RETURNING *',
        [username, hash, role]
      );
      return r.rows[0];
    },
    async findByUsername(username) {
      const r = await db.query('SELECT * FROM users WHERE username=$1', [username]);
      return r.rowCount ? r.rows[0] : null;
    },
    async touchLastSeen(id, ip) {
      await db.query('UPDATE users SET last_seen_at=now(), last_ip=$2 WHERE id=$1', [id, ip || null]);
    },
    async listAll() {
      const r = await db.query('SELECT id, username, role, created_at, last_seen_at FROM users ORDER BY created_at ASC');
      return r.rows;
    },
    async setRole(id, role) {
      if (role !== 'user' && role !== 'admin') throw new Error('invalid role');
      const r = await db.query('UPDATE users SET role=$2 WHERE id=$1 RETURNING id, username, role', [id, role]);
      return r.rowCount ? r.rows[0] : null;
    },
  };
}

module.exports = { makeUsers };
