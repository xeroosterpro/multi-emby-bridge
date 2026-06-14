const express = require('express');
const path = require('path');
const { createRateLimiter } = require('./utils');
const { getBuildId } = require('./buildId');
const { makeRequestLogMemory } = require('./requestLogMemory');
const { makeRequestLog } = require('./requestLog');
const { makeSiteSettings } = require('./siteSettings');
const dbLib = require('./db');
const paypal = require('./paypal');
const { makeAuthRouter, attachUser } = require('../routes/auth');
const { makeUserRouter } = require('../routes/user');
const { makeAdminRouter } = require('../routes/admin');
const { makeBillingRouter } = require('../routes/billing');
const { makeNewsRouter } = require('../routes/news');
const { makeTicketsRouter } = require('../routes/tickets');
const { makeConfigurePageRouter } = require('../routes/configurePage');
const { registerManifestToken } = require('../routes/manifestToken');
const { registerBridgeApi } = require('../routes/bridgeApi');
const { registerStremioRoutes } = require('../routes/stremio');

function createApp(options = {}) {
  const rootDir = options.rootDir || path.join(__dirname, '..');
  const PORT = options.port || process.env.PORT || 7000;
  const DATA_DIR = options.dataDir || process.env.DATA_DIR || path.join(rootDir, 'data');
  const BUILD_ID = options.buildId || getBuildId();

  const app = express();
  app.set('trust proxy', 1);

  const apiLimiter = createRateLimiter(60 * 1000, (req) => (req.user ? 180 : 60));
  const bundleLimiter = createRateLimiter(60 * 1000, (req) => (req.user ? 120 : 30));
  const streamLimiter = createRateLimiter(60 * 1000, 120);
  const authLimiter = createRateLimiter(60 * 1000, 10);
  const limiters = { apiLimiter, bundleLimiter, streamLimiter, authLimiter };

  const requestLogDb = makeRequestLog(dbLib);
  const requestLogMemory = makeRequestLogMemory({
    dataDir: DATA_DIR,
    dbLib,
    requestLogDb,
  });
  const siteSettings = makeSiteSettings();

  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  app.use(express.json({ limit: '1mb' }));
  app.use(express.static(path.join(rootDir, 'public'), {
    maxAge: '12h',
    etag: true,
    lastModified: true,
  }));

  app.use(attachUser());
  app.use('/api/auth', makeAuthRouter({ loginLimiter: authLimiter }));
  app.use('/api/user', makeUserRouter());
  app.use('/api/admin', makeAdminRouter({ getRequestLog: () => requestLogMemory.getRequestLog() }));
  app.use('/api/billing', makeBillingRouter());
  app.use('/api/news', makeNewsRouter());
  app.use('/api/tickets', makeTicketsRouter());

  const deps = {
    rootDir,
    BUILD_ID,
    DATA_DIR,
    dbLib,
    paypal,
    requestLogDb,
    siteSettings,
    requestLogMemory,
    limiters,
    streamLimiter,
  };

  registerManifestToken(app, deps);
  makeConfigurePageRouter({ buildId: BUILD_ID, rootDir }).register(app);
  registerBridgeApi(app, deps);
  registerStremioRoutes(app, deps);

  app.use((err, req, res, _next) => {
    if (err.type === 'entity.parse.failed') {
      return res.status(400).json({ error: 'Invalid JSON in request body.' });
    }
    if (err.message === 'stream is not readable') {
      console.warn('[body] unreadable stream:', req.method, req.path);
      return res.status(400).json({ error: 'Request body could not be read.' });
    }
    console.error('Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  });

  return { app, PORT, deps };
}

module.exports = { createApp };