const { parseStreamId, setCatalogCache, shuffleMetas, dedupMetas } = require('../lib/utils');
const { searchServersForCatalog, getRecentlyAdded } = require('../lib/search');
const { getAllStreams } = require('../lib/streams');
const { upgradeStreamProfile } = require('../lib/streamDefaults');
const { fetchExternalCatalog } = require('../lib/catalogs');
const { healthHistory } = require('../lib/health');
const { makeUserConfig } = require('../lib/userConfig');
const { decodeConfig } = require('../lib/configCodec');
const { ROW_NAMES, deriveLibraryRows } = require('../server-helpers');

function registerStremioRoutes(app, deps) {
  const { streamLimiter, requestLogMemory, dbLib } = deps;
  const { addLogEntry } = requestLogMemory;

  // Users whose onboarding "testedStream" flag is already set. Avoids a DB
  // read + write on every successful stream request once a user has been
  // through onboarding (LOG-2). In-memory only; rebuilt lazily after restart.
  const _onboardingTested = new Set();

  app.get('/:config/manifest.json', (req, res) => {
    let cfg;
    try {
      cfg = upgradeStreamProfile(decodeConfig(req.params.config)).cfg;
    } catch {
      return res.status(400).json({ error: 'Invalid config' });
    }
    res.setHeader('Link', '</configure#/install>; rel="successor-version"');
    const names = (cfg.servers || []).map((s) => s.label).join(', ');
    res.json({
      id: 'com.multiemby.bridge',
      version: '1.0.0',
      name: 'Stream Hub',
      description: `Streams from: ${names || 'configured servers'}`,
      types: ['movie', 'series'],
      catalogs: [],
      resources: ['stream'],
      idPrefixes: ['tt'],
      behaviorHints: { configurable: true, configurationRequired: true },
    });
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
    const extraStr = decodeURIComponent(req.params.extra || '');
    const searchMatch = extraStr.match(/^search=(.+)$/);
    const query = searchMatch ? searchMatch[1].trim() : null;
    let cfg;
    try { cfg = upgradeStreamProfile(decodeConfig(req.params.config)).cfg; } catch { return res.json({ metas: [] }); }
    const { type } = req.params;
    if (!['movie', 'series'].includes(type)) return res.json({ metas: [] });
    const servers = (cfg.servers || []).filter(s => s.url && s.apiKey && s.userId);
    if (servers.length === 0) return res.json({ metas: [] });
    if (req.params.id && req.params.id.startsWith('extcat-')) {
      return handleExternalCatalog(req, res, cfg, type);
    }
    try {
      if (query) {
        const metas = await searchServersForCatalog(servers, type, query, 8000, cfg.rpdbKey || null, cfg.catalogLang || null);
        const dme = cfg.noDupes ? dedupMetas(metas, req.params.config) : metas;
        setCatalogCache(res);
        res.json({ metas: dme });
      } else {
        const libKey = (req.params.id && req.params.id.indexOf('myemby-') === 0)
          ? req.params.id.slice('myemby-'.length)
          : (cfg.catalogContent || 'recent');
        const metas = await getRecentlyAdded(servers, type, 8000, cfg.rpdbKey || null, libKey, cfg.catalogLang || null);
        const dme = cfg.noDupes ? dedupMetas(metas, req.params.config) : metas;
        setCatalogCache(res);
        res.json({ metas: dme });
      }
    } catch (err) {
      console.error('Catalog error:', err.message);
      res.json({ metas: [] });
    }
  });

  app.get('/:config/catalog/:type/:id.json', streamLimiter, async (req, res) => {
    let cfg;
    try { cfg = upgradeStreamProfile(decodeConfig(req.params.config)).cfg; } catch { return res.json({ metas: [] }); }
    const { type } = req.params;
    if (!['movie', 'series'].includes(type)) return res.json({ metas: [] });
    const servers = (cfg.servers || []).filter(s => s.url && s.apiKey && s.userId);
    if (servers.length === 0) return res.json({ metas: [] });
    if (req.params.id && req.params.id.startsWith('extcat-')) {
      return handleExternalCatalog(req, res, cfg, type);
    }
    try {
      const libKey = (req.params.id && req.params.id.indexOf('myemby-') === 0)
        ? req.params.id.slice('myemby-'.length)
        : (cfg.catalogContent || 'recent');
      const metas = await getRecentlyAdded(servers, type, 8000, cfg.rpdbKey || null, libKey, cfg.catalogLang || null);
      setCatalogCache(res);
      res.json({ metas });
    } catch (err) {
      console.error('Catalog browse error:', err.message);
      res.json({ metas: [] });
    }
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
    const timeoutMs = (cfg.timeout && cfg.timeout >= 2000 && cfg.timeout <= 10000) ? cfg.timeout : 10000;
    const servers = (cfg.servers || [])
      .filter(s => s.url && s.apiKey && s.userId)
      .map(s => ({ ...s, _timeout: timeoutMs }));
    if (servers.length === 0) return res.json({ streams: [] });
    const _t0 = Date.now();
    try {
      const { streams, meta } = await getAllStreams(servers, type, imdbId, season, episode, {
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
        autoSelect: cfg.autoSelect,
        qualityBadge: cfg.qualityBadge === true ? 'emoji' : (cfg.qualityBadge || null),
        flagEmoji: cfg.flagEmoji === true ? 'flag' : (cfg.flagEmoji || null),
        bitrateBar: cfg.bitrateBar === true ? 'blocks' : (cfg.bitrateBar || null),
        subsStyle: cfg.hideSubs === true ? 'hidden' : (cfg.subsStyle || 'full'),
        customNameFields: cfg.customNameFields || [],
        customDescFields: cfg.customDescFields || [],
        audioRank: cfg.audioRank === true,
        audioOrder: cfg.audioOrder || undefined,
        audioDisabled: cfg.audioDisabled || [],
        audioRankMode: cfg.audioRankMode || 'audioFirst',
        audioDisableAction: cfg.audioDisableAction || 'hide',
        surroundPriority: cfg.surroundPriority === true,
        healthHistory,
        failoverHideDown: cfg.failoverHideDown === true,
      });

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
      res.json({ streams });
    } catch (err) {
      console.error('Stream handler error:', err);
      res.status(500).json({ streams: [], error: 'Internal server error' });
    }
  });
}

module.exports = { registerStremioRoutes };