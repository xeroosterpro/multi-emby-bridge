const { parseStreamId, setCatalogCache, shuffleMetas, dedupMetas } = require('../lib/utils');

const { getAllStreams } = require('../lib/streams');
const { prepareStreamServers, canQueryServer } = require('../lib/auth');
const { upgradeStreamProfile } = require('../lib/streamDefaults');
const { fetchExternalCatalog } = require('../lib/catalogs');
const { healthHistory } = require('../lib/health');
const { makeUserConfig } = require('../lib/userConfig');
const { decodeConfig } = require('../lib/configCodec');

const { get: cacheGet, set: cacheSet, l3Key, manifestKey } = require('../lib/embyCache');
const { coalesceStream } = require('../lib/requestPacer');
const { recordCacheHit } = require('../lib/apiTraffic');

function registerStremioRoutes(app, deps) {
  const { streamLimiter, requestLogMemory, dbLib } = deps;
  const { addLogEntry } = requestLogMemory;

  // Users whose onboarding "testedStream" flag is already set. Avoids a DB
  // read + write on every successful stream request once a user has been
  // through onboarding (LOG-2). In-memory only; rebuilt lazily after restart.
  const _onboardingTested = new Set();

  function buildManifest(cfg) {
    const names = (cfg.servers || []).map((s) => s.label).join(', ');
    return {
      id: 'com.multiemby.bridge',
      version: '1.0.0',
      name: 'Stream Hub',
      description: `Streams from: ${names || 'configured servers'}`,
      types: ['movie', 'series'],
      catalogs: [],
      resources: ['stream'],
      idPrefixes: ['tt'],
      behaviorHints: { configurable: false, configurationRequired: false },
    };
  }

  app.get('/:config/manifest.json', (req, res) => {
    let cfg;
    try {
      cfg = upgradeStreamProfile(decodeConfig(req.params.config)).cfg;
    } catch {
      return res.status(400).json({ error: 'Invalid config' });
    }
    const mKey = manifestKey(req.params.config);
    const cached = cacheGet('manifest', mKey);
    res.setHeader('Link', '</configure#/install>; rel="successor-version"');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    if (cached) {
      recordCacheHit('manifest', 'Stremio manifest poll (cached)');
      return res.json(cached);
    }
    const payload = buildManifest(cfg);
    cacheSet('manifest', mKey, payload);
    res.json(payload);
  });

  app.get('/:config/configure', (req, res) => {
    res.redirect('/configure');
  });

  async function handleExternalCatalog(req, res, cfg, type) {
    const idx = parseInt(req.params.id.replace('extcat-', ''), 10);
    const extList = (cfg.externalCatalogs || []).filter(c => c.enabled !== false);
    const entry = extList[idx];
    if (!entry) return res.json({ metas: [] });
    try {
      const allMetas = await fetchExternalCatalog(
        entry, cfg.rpdbKey || null, cfg.traktClientId || process.env.TRAKT_CLIENT_ID || null,
        cfg.catalogLang || null, cfg.tmdbApiKey || process.env.TMDB_API_KEY || null
      );
      let metas = allMetas.filter(m => m.type === type);
      if (entry.shuffle) metas = shuffleMetas(metas);
      const dmx = cfg.noDupes ? dedupMetas(metas, req.params.config) : metas;
      setCatalogCache(res);
      return res.json({ metas: dmx });
    } catch (err) {
      console.error('External catalog error:', err.message);
      return res.json({ metas: [] });
    }
  }

  app.get('/:config/catalog/:type/:id/:extra.json', streamLimiter, async (req, res) => {
    setCatalogCache(res);
    let cfg;
    try { cfg = upgradeStreamProfile(decodeConfig(req.params.config)).cfg; } catch { return res.json({ metas: [] }); }
    const { type } = req.params;
    if (!['movie', 'series'].includes(type)) return res.json({ metas: [] });
    if (req.params.id && req.params.id.startsWith('extcat-')) {
      return handleExternalCatalog(req, res, cfg, type);
    }
    return res.json({ metas: [] });
  });

  app.get('/:config/catalog/:type/:id.json', streamLimiter, async (req, res) => {
    setCatalogCache(res);
    let cfg;
    try { cfg = upgradeStreamProfile(decodeConfig(req.params.config)).cfg; } catch { return res.json({ metas: [] }); }
    const { type } = req.params;
    if (!['movie', 'series'].includes(type)) return res.json({ metas: [] });
    if (req.params.id && req.params.id.startsWith('extcat-')) {
      return handleExternalCatalog(req, res, cfg, type);
    }
    return res.json({ metas: [] });
  });

  app.get('/:config/stream/:type/:id.json', streamLimiter, async (req, res) => {
    let cfg;
    try {
      cfg = upgradeStreamProfile(decodeConfig(req.params.config)).cfg;
    } catch {
      return res.json({ streams: [] });
    }
    const { type, id } = req.params;
    const { imdbId, season, episode } = parseStreamId(type, id);
    if (!imdbId || !imdbId.startsWith('tt')) return res.json({ streams: [] });
    const configKey = req.params.config;
    const deviceUserKey = req._mebUserId || configKey;
    const streamOpts = {
      autoSelect: cfg.autoSelect === true,
      sortOrder: cfg.sortOrder,
      excludeRes: cfg.excludeRes,
      audioRank: cfg.audioRank !== false,
      audioOrder: cfg.audioOrder || undefined,
      audioDisabled: cfg.audioDisabled || [],
      labelPreset: cfg.labelPreset,
    };
    const streamCacheKey = l3Key(configKey, type, id, streamOpts);
    const cachedResult = cacheGet('L3', streamCacheKey);
    if (cachedResult) {
      recordCacheHit('L3', 'Stremio play — cached stream list');
      return res.json({ streams: cachedResult.streams });
    }
    const timeoutMs = (cfg.timeout && cfg.timeout >= 2000 && cfg.timeout <= 10000) ? cfg.timeout : 10000;
    const candidateServers = (cfg.servers || []).filter(
      (s) => s && s.url && s.enabled !== false && canQueryServer(s)
    );
    if (candidateServers.length === 0) return res.json({ streams: [] });
    const servers = (await prepareStreamServers(candidateServers))
      .map(s => ({ ...s, _timeout: timeoutMs, _fastPace: true, _deviceUserKey: deviceUserKey }));
    if (servers.length === 0) return res.json({ streams: [] });
    const _t0 = Date.now();
    try {
      const runLookup = async (signal) => {
        if (signal?.aborted) {
          const err = new Error('superseded');
          err.superseded = true;
          throw err;
        }
        return getAllStreams(servers, type, imdbId, season, episode, {
        sortOrder: cfg.sortOrder,
        excludeRes: cfg.excludeRes,
        recommend: cfg.recommend,
        ping: cfg.ping,
        audioLang: cfg.audioLang,
        maxBitrate: cfg.maxBitrate,
        prefCodec: cfg.prefCodec,
        codecMode: cfg.codecMode,
        labelPreset: cfg.labelPreset,
        pingDetail: cfg.pingDetail,
        autoSelect: cfg.autoSelect === true,
        qualityBadge: cfg.qualityBadge === true ? 'emoji' : (cfg.qualityBadge || null),
        flagEmoji: cfg.flagEmoji === true ? 'flag' : (cfg.flagEmoji || null),
        bitrateBar: cfg.bitrateBar === true ? 'blocks' : (cfg.bitrateBar || null),
        subsStyle: cfg.hideSubs === true ? 'hidden' : (cfg.subsStyle || 'full'),
        customNameFields: cfg.customNameFields || [],
        customDescFields: cfg.customDescFields || [],
        audioRank: cfg.audioRank !== false,
        audioOrder: cfg.audioOrder || undefined,
        audioDisabled: cfg.audioDisabled || [],
        audioRankMode: cfg.audioRankMode || 'audioFirst',
        audioDisableAction: cfg.audioDisableAction || 'hide',
        surroundPriority: cfg.surroundPriority === true,
        healthHistory,
        failoverHideDown: cfg.failoverHideDown === true,
        });
      };

      let streams, meta;
      try {
        const result = await coalesceStream(configKey, `${type}/${id}`, runLookup);
        streams = result.streams;
        meta = result.meta;
      } catch (err) {
        if (err.superseded) {
          const stale = cacheGet('L3', streamCacheKey);
          if (stale?.streams?.length) return res.json({ streams: stale.streams });
          return res.json({ streams: [] });
        }
        throw err;
      }

      if (cfg.showSummary) {
        const found = meta.serverStatus.filter(s => s.status === 'found');
        const total = found.reduce((n, s) => n + (s.count || 0), 0);
        const style = cfg.summaryStyle || 'compact';
        const trunc = (str, n) => str.length > n ? str.slice(0, n - 1) + '…' : str;
        const eLabel = (s, maxLen) => {
          const prefix = s.emoji ? s.emoji + ' ' : '';
          return prefix + trunc(s.label, maxLen - prefix.length);
        };
        let summaryName, lines;
        if (style === 'detailed') {
          summaryName = `📊 ${total} streams · ${found.length} found`;
          lines = meta.serverStatus.map(s => {
            const l = eLabel(s, 14);
            if (s.status === 'found') {
              const res = s.resLabels?.length ? ' · ' + s.resLabels.join('·') : '';
              return `✅ ${l} — ${s.count}${res}`;
            }
            if (s.status === 'not_found') return `❌ ${l} — none`;
            if (s.status === 'timeout') return `⏱ ${l} — timeout`;
            return `🔴 ${l} — offline`;
          });
        } else if (style === 'minimal') {
          summaryName = `${total} streams · ${found.length} servers`;
          lines = meta.serverStatus.map(s => {
            const l = eLabel(s, 14);
            if (s.status === 'found') {
              const res = s.resLabels?.length ? ` (${s.resLabels[0]})` : '';
              return `${l}: ${s.count}${res}`;
            }
            if (s.status === 'not_found') return `${l}: —`;
            if (s.status === 'timeout') return `${l}: timeout`;
            return `${l}: offline`;
          });
        } else if (style === 'bar') {
          summaryName = `📊 Results · ${total} streams`;
          const maxCount = Math.max(...found.map(s => s.count), 1);
          lines = meta.serverStatus.map(s => {
            const l = eLabel(s, 10);
            if (s.status === 'found') {
              const filled = Math.max(1, Math.round((s.count / maxCount) * 4));
              const bar = '█'.repeat(filled) + '░'.repeat(4 - filled);
              return `${l} ${bar} ${s.count}`;
            }
            if (s.status === 'not_found') return `${l} ░░░░ ✗`;
            if (s.status === 'timeout') return `${l} ⏱`;
            return `${l} 🔴`;
          });
        } else {
          summaryName = `📊 ${total} streams · ${found.length} servers`;
          lines = meta.serverStatus.map(s => {
            const l = eLabel(s, 14);
            if (s.status === 'found') {
              const res = s.resLabels?.length ? ' · ' + s.resLabels.join('·') : '';
              return `✅ ${l} · ${s.count}${res}`;
            }
            if (s.status === 'not_found') return `❌ ${l}`;
            if (s.status === 'timeout') return `⏱ ${l}`;
            return `🔴 ${l}`;
          });
        }
        streams.unshift({
          name: total > 0 ? summaryName : '📊 No streams found',
          description: lines.join('\n'),
          url: `${req.protocol}://${req.get('host')}/stream-summary`,
        });
      }

      const found = (meta.serverStatus || []).some(s => s.status === 'found');
      addLogEntry({
        userId: req._mebUserId || null,
        ts: new Date().toISOString(),
        type,
        imdbId,
        season: season || null,
        episode: episode || null,
        contentName: meta.contentName,
        bestServer: meta.bestServer,
        serverStatus: meta.serverStatus,
        found,
        ms: Date.now() - _t0,
      });
      if (found && req._mebUserId && dbLib.isConfigured() && !_onboardingTested.has(req._mebUserId)) {
        const uid = req._mebUserId;
        makeUserConfig(dbLib).getEditable(uid).then(cur => {
          if (cur.config && cur.config.onboarding && cur.config.onboarding.testedStream) {
            _onboardingTested.add(uid);
            return;
          }
          // getEditable adds hasApiKey/hasUsername/hasPassword flags to servers;
          // strip them so they don't pollute the stored config_json blob.
          const servers = Array.isArray(cur.config && cur.config.servers)
            ? cur.config.servers.map(({ hasApiKey, hasUsername, hasPassword, ...s }) => s)
            : (cur.config && cur.config.servers);
          const merged = {
            ...(cur.config || {}),
            ...(servers ? { servers } : {}),
            onboarding: { ...(cur.config && cur.config.onboarding), testedStream: true },
          };
          return makeUserConfig(dbLib).save(uid, merged).then(() => { _onboardingTested.add(uid); });
        }).catch((e) => { console.warn('[stream] onboarding update failed:', e.message); });
      }
      cacheSet('L3', streamCacheKey, { streams, meta });
      res.json({ streams });
    } catch (err) {
      console.error('Stream handler error:', err);
      res.status(500).json({ streams: [], error: 'Internal server error' });
    }
  });
}

module.exports = { registerStremioRoutes };