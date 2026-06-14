// ─── Auth API + session middleware ──────────────────────────────────────────
const express = require('express');
const db = require('../lib/db');
const { makeUsers } = require('../lib/users');
const { makeSessions } = require('../lib/sessions');
const { verifyPassword, hashPassword } = require('../lib/accounts');

const COOKIE = 'meb_session';
// Pre-computed valid scrypt hash of a random secret. Used as a constant-time
// decoy when the username doesn't exist, so login timing can't reveal whether
// an account exists (SEC-3).
const DUMMY_HASH = hashPassword(require('crypto').randomBytes(24).toString('hex'));

function cookieOpts() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV !== 'development',
    sameSite: 'lax',
    path: '/',
    maxAge: 30 * 24 * 60 * 60 * 1000,
  };
}

function parseCookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach(p => {
    const i = p.indexOf('=');
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}

function makeAuthRouter(opts = {}) {
  const users = makeUsers(db);
  const sessions = makeSessions(db);
  const r = express.Router();
  // Brute-force / credential-stuffing guard on the credential-bearing routes.
  // No-op passthrough if no limiter is injected (keeps unit tests simple).
  const loginLimiter = typeof opts.loginLimiter === 'function' ? opts.loginLimiter : (req, _res, next) => next();

  r.post('/register', loginLimiter, async (req, res) => {
    if (!db.isConfigured()) return res.status(503).json({ error: 'accounts unavailable' });
    const allowReg = process.env.ALLOW_PUBLIC_REGISTER;
    if (allowReg === '0' || allowReg === 'false') {
      return res.status(403).json({ error: 'registration disabled' });
    }
    const { username, password } = req.body || {};
    if (!username || !password) return res.status(400).json({ error: 'username and password required' });
    try {
      const user = await users.create(username, password, 'user');
      const { token } = await sessions.create(user.id);
      res.cookie(COOKIE, token, cookieOpts());
      res.json({ username: user.username, role: user.role });
    } catch (e) {
      if (e.code === '23505') return res.status(409).json({ error: 'username taken' });
      console.error('[auth] register failed:', e.message);
      res.status(500).json({ error: 'registration failed' });
    }
  });

  r.post('/login', loginLimiter, async (req, res) => {
    if (!db.isConfigured()) return res.status(503).json({ error: 'accounts unavailable' });
    const { username, password } = req.body || {};
    try {
      const user = await users.findByUsername(username || '');
      if (!user) {
        // Burn an equivalent scrypt cost so "no such user" and "wrong password"
        // take the same time — closes the username-enumeration timing oracle.
        verifyPassword(password || '', DUMMY_HASH);
        return res.status(401).json({ error: 'invalid credentials' });
      }
      if (!verifyPassword(password || '', user.password_hash)) {
        return res.status(401).json({ error: 'invalid credentials' });
      }
      const { token } = await sessions.create(user.id);
      await users.touchLastSeen(user.id, req.ip);
      res.cookie(COOKIE, token, cookieOpts());
      res.json({ username: user.username, role: user.role });
    } catch (e) {
      console.error('[auth] login failed:', e.message);
      res.status(500).json({ error: 'login failed' });
    }
  });

  r.post('/logout', async (req, res) => {
    const token = parseCookies(req)[COOKIE];
    try { await sessions.destroy(token); } catch {}
    res.clearCookie(COOKIE, { path: '/' });
    res.json({ ok: true });
  });

  r.get('/me', async (req, res) => {
    if (!db.isConfigured()) return res.json({ user: null, enabled: false });
    const allowReg = process.env.ALLOW_PUBLIC_REGISTER;
    const registrationOpen = allowReg !== '0' && allowReg !== 'false';
    try {
      const s = await sessions.lookup(parseCookies(req)[COOKIE]);
      res.json({
        user: s ? { username: s.username, role: s.role } : null,
        enabled: true,
        registrationOpen,
      });
    } catch (e) {
      res.json({ user: null, enabled: true, registrationOpen });
    }
  });

  return r;
}

// Middleware: attach req.user (or null) for downstream gating.
function attachUser() {
  const sessions = makeSessions(db);
  return async (req, _res, next) => {
    req.user = null;
    if (db.isConfigured()) {
      try {
        const s = await sessions.lookup(parseCookies(req)[COOKIE]);
        if (s) req.user = { id: s.user_id, username: s.username, role: s.role };
      } catch {}
    }
    next();
  };
}

module.exports = { makeAuthRouter, attachUser, COOKIE };
