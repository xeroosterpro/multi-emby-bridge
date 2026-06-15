// ─── Stream building from PlaybackInfo MediaSources ──────────────────────────
const { apiFetch, pingServer, buildStreamUrl, canQueryServer } = require('./auth');
const { formatFileSize, detectSourceLabel, langFlag, buildBitrateBar } = require('./utils');
const { queryServerForMovie, queryServerForEpisode } = require('./search');
const audioRanking = require('./audioRanking');
const { isServerDown, normUrl } = require('./healthAlerts');
const { HEALTH_CONSECUTIVE_DOWN } = require('./healthProbe');

// ─── PlaybackInfo — get all MediaSources for a single item ───────────────────

async function fetchPlaybackInfo(server, itemId) {
  const resp = await apiFetch(server, () => {
    const url = new URL(`${server.url}/Items/${itemId}/PlaybackInfo`);
    url.searchParams.set('UserId', server.userId);
    return url;
  });
  const data = await resp.json();
  return data.MediaSources || [];
}

function mediaSourcesToStreams(server, itemId, mediaSources, labelPreset, streamOpts = {}) {
  const qualityBadgeStyle = streamOpts.qualityBadge || null;
  const flagEmojiStyle    = streamOpts.flagEmoji    || null;
  const bitrateBarStyle   = streamOpts.bitrateBar   || null;
  const subsStyle         = streamOpts.subsStyle     || 'full';
  const displayLabel = server.emoji ? `${server.emoji} ${server.label}` : server.label;
  const streams = [];

  for (const source of mediaSources) {
    const sizeBytes = source.Size || 0;
    const bitrate   = source.Bitrate || 0;
    const mediaStreams = source.MediaStreams || [];

    const videoStream  = mediaStreams.find((s) => s.Type === 'Video');
    const audioStream  = mediaStreams.find((s) => s.Type === 'Audio');
    const audioStreams = mediaStreams.filter((s) => s.Type === 'Audio');
    const subStreams   = mediaStreams.filter((s) => s.Type === 'Subtitle');

    // ── Resolution
    const resW = videoStream?.Width  || 0;
    const resH = videoStream?.Height || 0;
    const resLabel = resH
      ? (resH >= 2160 || resW >= 3840 ? '4K'
        : resH >= 1080 || resW >= 1920 ? '1080p'
        : resH >= 720  || resW >= 1280 ? '720p'
        : `${resH}p`)
      : null;

    const dimsLabel = videoStream && videoStream.Width && videoStream.Height
      ? `${videoStream.Width}x${videoStream.Height}`
      : null;

    // ── HDR
    let hdrLabel = null;
    if (videoStream) {
      const rangeType = (videoStream.VideoRangeType || videoStream.VideoRange || '').toUpperCase();
      if (rangeType === 'DOVI' || rangeType.includes('DOLBY')) hdrLabel = 'DV';
      else if (rangeType === 'HDR10PLUS' || rangeType === 'HDR10+')      hdrLabel = 'HDR10+';
      else if (rangeType === 'HDR10')                                     hdrLabel = 'HDR10';
      else if (rangeType === 'HLG')                                       hdrLabel = 'HLG';
      else if (rangeType === 'HDR')                                       hdrLabel = 'HDR';
    }

    // ── Video codec + bit depth
    let codecLabel = null;
    if (videoStream) {
      const c = (videoStream.Codec || '').toLowerCase();
      const bitDepth = videoStream.BitDepth ? ` ${videoStream.BitDepth}bit` : '';
      if (c === 'hevc' || c === 'h265')        codecLabel = `HEVC${bitDepth}`;
      else if (c === 'h264' || c === 'avc')    codecLabel = `H.264${bitDepth}`;
      else if (c === 'av1')                    codecLabel = `AV1${bitDepth}`;
      else if (c === 'vp9')                    codecLabel = `VP9${bitDepth}`;
      else if (c)                              codecLabel = videoStream.Codec.toUpperCase() + bitDepth;
    }

    // ── Audio codec + channels + quality rank
    let audioLabel = null;
    let shortAudioLabel = null;
    let audioRank = 99;
    if (audioStream) {
      const ac = (audioStream.Codec || '').toLowerCase();
      const profile = (audioStream.Profile || '').toLowerCase();
      let codecName = '';
      if (ac.includes('truehd'))                       { codecName = 'TrueHD'; audioRank = profile.includes('atmos') ? 0 : 1; }
      else if (ac === 'dts-ma' || ac === 'dtshd')      { codecName = 'DTS-MA'; audioRank = 2; }
      else if (ac.includes('dts'))                     { codecName = 'DTS'; audioRank = 3; }
      else if (ac === 'eac3')                          { codecName = 'DD+'; audioRank = profile.includes('atmos') ? 0 : 4; }
      else if (ac === 'ac3')                           { codecName = 'DD'; audioRank = 5; }
      else if (ac.includes('aac'))                     { codecName = 'AAC'; audioRank = 6; }
      else if (ac.includes('flac'))                    { codecName = 'FLAC'; audioRank = 2; }
      else if (ac.includes('pcm'))                     { codecName = 'LPCM'; audioRank = 2; }
      else if (ac)                                     { codecName = audioStream.Codec.toUpperCase(); audioRank = 7; }

      const ch = audioStream.Channels;
      const chStr = ch === 8 ? '7.1' : ch === 6 ? '5.1' : ch === 2 ? '2.0' : ch ? `${ch}ch` : '';
      audioRank = audioRank * 10 - (ch || 0);
      audioLabel = [codecName, chStr].filter(Boolean).join(' ');
      shortAudioLabel = profile.includes('atmos') ? 'Atmos' : (codecName || null);
    }

    // ── Top audio badge for quality-badge feature
    let topAudioBadge = null;
    if (audioStream) {
      const _ac = (audioStream.Codec || '').toLowerCase();
      const _prof = (audioStream.Profile || '').toLowerCase();
      if (_prof.includes('atmos')) topAudioBadge = '🔊';
      else if (_ac.includes('truehd') || _ac === 'dts-ma' || _ac === 'dtshd') topAudioBadge = '🎵';
    }

    // ── All audio tracks
    const allAudioLabel = audioStreams.length > 1
      ? audioStreams.map(s => {
          const ac = (s.Codec || '').toLowerCase();
          const ch = s.Channels;
          const chStr = ch === 8 ? '7.1' : ch === 6 ? '5.1' : ch === 2 ? '2.0' : ch ? `${ch}ch` : '';
          let name = ac.includes('truehd') ? 'TrueHD' : (ac === 'dts-ma' || ac === 'dtshd') ? 'DTS-MA'
            : ac.includes('dts') ? 'DTS' : ac === 'eac3' ? 'DD+' : ac === 'ac3' ? 'DD'
            : ac.includes('aac') ? 'AAC' : (s.Codec || '').toUpperCase();
          const rawLang = s.Language ? s.Language.toUpperCase().slice(0, 3) : '';
          const flag = langFlag(s.Language);
          const lang = flagEmojiStyle === 'none' ? ''
                     : flagEmojiStyle === 'flag' ? (flag || rawLang)
                     : flagEmojiStyle === 'both' ? (flag ? flag + rawLang : rawLang)
                     : rawLang;
          return [lang, name, chStr].filter(Boolean).join(' ');
        }).join(' · ')
      : null;

    // ── Subtitle tracks
    let subsLabel = null;
    if (subsStyle !== 'hidden' && subStreams.length > 0) {
      const uniqueLangs = [...new Set(subStreams.map(s => (s.Language || s.DisplayTitle || '?').slice(0, 3).toUpperCase()))];
      if (subsStyle === 'count') {
        subsLabel = `💬 ${uniqueLangs.length} sub${uniqueLangs.length !== 1 ? 's' : ''}`;
      } else if (subsStyle === 'icons' || flagEmojiStyle) {
        subsLabel = '💬 ' + uniqueLangs.map(l => langFlag(l) || l).join(' ');
      } else {
        subsLabel = 'Subs: ' + uniqueLangs.join(' · ');
      }
    }

    // ── Raw codec ID
    const rawCodec = videoStream ? (videoStream.Codec || '').toLowerCase() : null;
    const codecId = rawCodec === 'hevc' || rawCodec === 'h265' ? 'hevc'
      : rawCodec === 'h264' || rawCodec === 'avc' ? 'h264'
      : rawCodec === 'av1' ? 'av1'
      : rawCodec === 'vp9' ? 'vp9'
      : rawCodec ? 'other' : null;

    const audioLangCode = audioStream ? (audioStream.Language || '').toLowerCase().slice(0, 3) || null : null;
    const defaultChannels = audioStream?.Channels || 0;
    const maxChannels = audioStreams.reduce((max, s) => Math.max(max, s.Channels || 0), 0);
    const defaultAudioFormat = audioStream
      ? audioRanking.classifyAudio(audioStream.Codec, audioStream.Profile)
      : null;

    // ── Bitrate
    let bitrateLabel = bitrate ? `${(bitrate / 1e6).toFixed(1)}Mbps` : null;
    if (bitrateBarStyle === 'none') {
      bitrateLabel = null;
    } else if (bitrateBarStyle && bitrate) {
      const bar = buildBitrateBar(bitrate, bitrateBarStyle);
      bitrateLabel = bitrateBarStyle === 'bar_only' ? bar : `${bar} ${bitrateLabel}`;
    }

    // ── Source label
    const sourceLabel = detectSourceLabel(source);
    const container = source.Container ? source.Container.toUpperCase() : null;

    // ── Build name + description based on label preset
    const sizeStr = formatFileSize(sizeBytes);

    let streamName, streamDesc;
    if (labelPreset === 'compact') {
      streamName = [displayLabel, resLabel, hdrLabel, codecLabel].filter(Boolean).join(' · ');
      streamDesc = [audioLabel, bitrateLabel, sizeStr].filter(Boolean).join(' · ') || 'Unknown quality';

    } else if (labelPreset === 'detailed') {
      streamName = [displayLabel, resLabel, hdrLabel].filter(Boolean).join(' · ');
      streamDesc = [
        [codecLabel, sourceLabel].filter(Boolean).join(' · '),
        allAudioLabel || audioLabel,
        subsLabel,
        [dimsLabel, bitrateLabel, sizeStr].filter(Boolean).join(' · '),
      ].filter(Boolean).join('\n') || 'Unknown quality';

    } else if (labelPreset === 'cinema') {
      streamName = [displayLabel, resLabel, hdrLabel, sourceLabel].filter(Boolean).join(' · ');
      streamDesc = [
        codecLabel,
        allAudioLabel || audioLabel,
        subsLabel,
        sizeStr,
      ].filter(Boolean).join('\n') || 'Unknown quality';

    } else if (labelPreset === 'minimal') {
      streamName = [displayLabel, resLabel].filter(Boolean).join(' · ');
      streamDesc = sizeStr || bitrateLabel || 'Unknown quality';

    } else if (labelPreset === 'custom') {
      // Custom preset — build from user-selected field arrays
      const cnf = streamOpts.customNameFields || [];
      const cdf = streamOpts.customDescFields || [];
      const FIELD_MAP = { res: resLabel, hdr: hdrLabel, codec: codecLabel, source: sourceLabel,
        audio: audioLabel, allAudio: allAudioLabel || audioLabel, bitrate: bitrateLabel, size: sizeStr,
        subs: subsLabel, dims: dimsLabel };
      streamName = [displayLabel, ...cnf.map(function(k){ return FIELD_MAP[k]; })].filter(Boolean).join(' · ');
      streamDesc = cdf.map(function(k){ return FIELD_MAP[k]; }).filter(Boolean).join('\n') || 'Unknown quality';

    } else {
      // standard (default)
      streamName = [displayLabel, resLabel, hdrLabel].filter(Boolean).join(' · ');
      const descLines = [
        [codecLabel, sourceLabel].filter(Boolean).join(' · '),
        allAudioLabel || audioLabel,
        subsLabel,
        [container, bitrateLabel, sizeStr].filter(Boolean).join(' · '),
      ].filter(Boolean);
      streamDesc = descLines.join('\n') || 'Unknown quality';
    }

    // ── Quality badges
    if (qualityBadgeStyle) {
      const emojiBadges = [];
      if (sourceLabel === 'REMUX') emojiBadges.push('💎');
      if (resLabel === '4K')       emojiBadges.push('🎬');
      if (hdrLabel === 'DV')       emojiBadges.push('🌈');
      else if (hdrLabel)           emojiBadges.push('✨');
      if (topAudioBadge)           emojiBadges.push(topAudioBadge);

      if (qualityBadgeStyle === 'emoji' && emojiBadges.length > 0) {
        streamName = emojiBadges.join('') + ' ' + streamName;
      } else if (qualityBadgeStyle === 'tags') {
        const tags = [];
        if (sourceLabel === 'REMUX') tags.push('[REMUX]');
        if (resLabel === '4K')       tags.push('[4K]');
        if (hdrLabel === 'DV')       tags.push('[DV]');
        else if (hdrLabel === 'HDR10+') tags.push('[HDR10+]');
        else if (hdrLabel)           tags.push('[HDR]');
        if (topAudioBadge === '🔊') tags.push('[Atmos]');
        else if (topAudioBadge === '🎵') tags.push('[Lossless]');
        if (tags.length > 0) streamName = tags.join('') + ' ' + streamName;
      }
    }

    streams.push({
      url: buildStreamUrl(server, itemId, source.Id, source.Container),
      name: streamName,
      description: streamDesc,
      ...(server.thumbnail ? { thumbnail: server.thumbnail } : {}),
      _sizeBytes: sizeBytes,
      _bitrate: bitrate,
      _audioRank: audioRank,
      _mediaSourceId: source.Id,
      _resLabel: resLabel,
      _codec: codecId,
      _audioLang: audioLangCode,
      _audioFormats: [...new Set(audioStreams.map(s => audioRanking.classifyAudio(s.Codec, s.Profile)))],
      _defaultAudioFormat: defaultAudioFormat,
      _defaultChannels: defaultChannels,
      _maxChannels: maxChannels,
    });
  }
  return streams;
}

// ─── Server queries (Streambridge-matching logic) ────────────────────────────

// Build a human title for logging/dashboard. Episodes get "Series SxEy — Episode"
// (mirrors formatLiveTitle in sessions.js) so Live streaming / Watched history
// show the series, not the bare episode name like "Episode 2". Movies → Name.
function buildItemTitle(item) {
  if (!item) return null;
  if (item.SeriesName) {
    const s = item.ParentIndexNumber != null ? `S${item.ParentIndexNumber}` : '';
    const e = item.IndexNumber != null ? `E${item.IndexNumber}` : '';
    const se = (s || e) ? ` ${s}${e}` : '';
    const ep = item.Name && item.Name !== item.SeriesName ? ` — ${item.Name}` : '';
    return `${item.SeriesName}${se}${ep}`.trim();
  }
  return item.Name || null;
}

async function getStreamsFromServer(server, type, imdbId, season, episode, labelPreset, streamOpts = {}) {
  try {
    let items;
    if (type === 'movie') {
      items = await queryServerForMovie(server, imdbId);
    } else {
      items = await queryServerForEpisode(server, imdbId, season, episode);
    }

    const itemName = buildItemTitle(items[0]);

    const allStreams = [];
    const item = items[0];
    if (item) {
      try {
        const mediaSources = await fetchPlaybackInfo(server, item.Id);
        const streams = mediaSourcesToStreams(server, item.Id, mediaSources, labelPreset, streamOpts);
        allStreams.push(...streams);
      } catch (err) {
        console.error(`[${server.label}] PlaybackInfo failed for ${item.Id}:`, err.message);
        const fallback = item.MediaSources || [];
        if (fallback.length) {
          allStreams.push(...mediaSourcesToStreams(server, item.Id, fallback, labelPreset, streamOpts));
        }
      }
    }

    // Deduplicate by mediaSourceId
    const deduped = new Map(allStreams.map(s => [s._mediaSourceId, s]));
    const specSeen = new Set();
    const result = [...deduped.values()].filter(s => {
      const key = s.description;
      if (specSeen.has(key)) return false;
      specSeen.add(key);
      return true;
    });

    if (result.length === 0) {
      return [{
        name: server.label, description: 'No results found\nFile not in library',
        url: `${server.url}/no-stream-available`, _noResults: true, _noResultsType: 'not_found',
        _sizeBytes: 0, _bitrate: 0, _audioRank: 999, _mediaSourceId: `noresults:${server.label}`,
        _serverLabel: server.label, _itemName: null,
      }];
    }
    return result.map(s => ({ ...s, _serverLabel: server.label, _itemName: itemName }));
  } catch (err) {
    console.error(`[${server.label}] Query failed:`, err.message);
    return [{
      name: server.label, description: 'Server offline or unreachable',
      url: `${server.url}/no-stream-available`, _noResults: true, _noResultsType: 'offline',
      _sizeBytes: 0, _bitrate: 0, _audioRank: 999, _mediaSourceId: `offline:${server.label}`,
      _serverLabel: server.label, _itemName: null,
    }];
  }
}

function serverPriorityValue(server) {
  const p = Number(server.priority);
  return Number.isFinite(p) && p >= 1 && p <= 10 ? p : 5;
}

function sortByServerFailover(streams, comparator) {
  return streams.slice().sort((a, b) => {
    const downA = a._serverDown ? 1 : 0;
    const downB = b._serverDown ? 1 : 0;
    if (downA !== downB) return downA - downB;
    const priA = a._serverPriority != null ? a._serverPriority : 5;
    const priB = b._serverPriority != null ? b._serverPriority : 5;
    if (priA !== priB) return priA - priB;
    return comparator(a, b);
  });
}

async function getAllStreams(servers, type, imdbId, season, episode, opts = {}) {
  const { sortOrder, excludeRes, recommend, ping, audioLang, maxBitrate, prefCodec, codecMode, labelPreset, pingDetail, autoSelect, qualityBadge, flagEmoji, bitrateBar, subsStyle, customNameFields, customDescFields, audioRank, audioOrder, audioDisabled, audioRankMode, audioDisableAction, surroundPriority, healthHistory, failoverHideDown } = opts;
  const streamOpts = { qualityBadge, flagEmoji, bitrateBar, subsStyle, customNameFields: customNameFields || [], customDescFields: customDescFields || [] };

  const activeServers = servers.filter(s => s.enabled !== false && canQueryServer(s));

  const [pingResults, streamResults] = await Promise.all([
    Promise.all(ping ? activeServers.map(pingServer) : activeServers.map(() => null)),
    Promise.allSettled(activeServers.map(server => {
      const query = getStreamsFromServer(server, type, imdbId, season, episode, labelPreset, streamOpts);
      const cutoff = Math.min((server._timeout || 10000) * 2, 20000);
      return Promise.race([
        query,
        new Promise((_, reject) => setTimeout(() => reject(new Error('cutoff')), cutoff)),
      ]);
    })),
  ]);

  const allStreams = streamResults.flatMap((result, i) => {
    if (result.status === 'rejected') {
      const srv = activeServers[i];
      const isTimeout = (result.reason?.message || '').includes('cutoff');
      const urlKey = normUrl(srv.url);
      const down = healthHistory ? isServerDown(healthHistory, urlKey, HEALTH_CONSECUTIVE_DOWN) : false;
      return [{
        name: srv.label,
        description: isTimeout ? 'Server timed out' : 'Server error',
        url: `${srv.url}/no-stream-available`,
        _noResults: true,
        _noResultsType: isTimeout ? 'timeout' : 'error',
        _sizeBytes: 0, _bitrate: 0, _audioRank: 999,
        _mediaSourceId: `${isTimeout ? 'timeout' : 'error'}:${srv.label}`,
        _serverLabel: srv.label, _itemName: null,
        _serverPriority: serverPriorityValue(srv),
        _serverDown: down || true,
      }];
    }
    const streams = result.value;
    const srv = activeServers[i];
    const urlKey = normUrl(srv.url);
    const pri = serverPriorityValue(srv);
    const down = healthHistory ? isServerDown(healthHistory, urlKey, HEALTH_CONSECUTIVE_DOWN) : false;
    return streams.map(s => ({
      ...s,
      _pingMs: pingResults[i],
      _serverPriority: pri,
      _serverDown: down,
    }));
  });

  let realStreams = allStreams.filter(s => !s._noResults);
  const noResStreams = allStreams.filter(s => s._noResults);

  // Filter excluded resolutions
  if (excludeRes && excludeRes.length > 0) {
    realStreams = realStreams.filter(s => {
      const r = s._resLabel;
      if (excludeRes.includes('SD') && r !== '4K' && r !== '1080p' && r !== '720p') return false;
      if (r && excludeRes.includes(r)) return false;
      return true;
    });
  }

  if (maxBitrate) {
    realStreams = realStreams.filter(s => !s._bitrate || s._bitrate <= maxBitrate);
  }

  if (prefCodec && prefCodec !== 'any' && codecMode === 'only') {
    const filtered = realStreams.filter(s => s._codec === prefCodec);
    if (filtered.length > 0) realStreams = filtered;
  }

  // Audio ranking/filtering keys (default-off; reproduces legacy behavior when unset)
  audioRanking.attachAudioKeys(realStreams, { audioOrder, audioDisabled, audioDisableAction, surroundPriority });
  const _hideResult = audioRanking.filterDisabledHide(realStreams, { audioDisabled, audioDisableAction });
  realStreams = _hideResult.streams;

  // Sort — up servers + lower priority number first, then audio/size/bitrate rules
  const streamCmp = audioRanking.audioComparator({
    sortOrder, audioLang, prefCodec, codecMode, audioRank, audioRankMode, surroundPriority,
  });
  realStreams = sortByServerFailover(realStreams, streamCmp);

  if (failoverHideDown) {
    noResStreams.splice(0, noResStreams.length, ...noResStreams.filter(s => !s._serverDown));
  }

  // Mark fastest server
  if (ping) {
    const distinctPings = [...new Set(realStreams.map(s => s._pingMs).filter(p => p != null))];
    if (distinctPings.length > 1) {
      const minPing = Math.min(...distinctPings);
      realStreams = realStreams.map(s =>
        s._pingMs === minPing ? { ...s, name: `⚡ ${s.name}` } : s
      );
    }
  }

  // Mark recommended
  if (recommend && realStreams.length > 0) {
    realStreams[0] = { ...realStreams[0], name: `★ ${realStreams[0].name}` };
  }

  // Ping detail
  if (ping && pingDetail) {
    realStreams = realStreams.map(s =>
      s._pingMs != null ? { ...s, description: `${s.description}\n📡 ${s._pingMs}ms` } : s
    );
  }

  // Auto-select
  if (autoSelect && realStreams.length > 0) {
    realStreams = [realStreams[0]];
  }

  // Build log metadata
  const contentName = allStreams.map(s => s._itemName).find(n => n != null) || null;
  const bestStream = realStreams[0] || null;
  const bestServer = bestStream ? {
    label:   bestStream._serverLabel,
    size:    bestStream._sizeBytes,
    bitrate: bestStream._bitrate,
  } : null;

  const serverStatus = servers.map((srv, i) => {
    const pingMs = pingResults[i] ?? null;
    const srvStreams = allStreams.filter(s => s._serverLabel === srv.label);
    if (!srvStreams.length) return { label: srv.label, emoji: srv.emoji || null, type: srv.type || 'emby', status: 'timeout', pingMs };
    const placeholder = srvStreams.find(s => s._noResults);
    if (placeholder) return { label: srv.label, emoji: srv.emoji || null, type: srv.type || 'emby', status: placeholder._noResultsType || 'not_found', pingMs };
    const real = srvStreams.filter(s => !s._noResults);
    const best = real[0];
    const resLabels = [...new Set(real.map(s => s._resLabel).filter(Boolean))];
    const resCounts = {};
    real.forEach(s => { if (s._resLabel) resCounts[s._resLabel] = (resCounts[s._resLabel] || 0) + 1; });
    return {
      label: srv.label, emoji: srv.emoji || null, type: srv.type || 'emby',
      status: 'found', count: real.length, size: best?._sizeBytes || 0,
      bitrate: best?._bitrate || 0, resLabels, resCounts, pingMs,
    };
  });

  const meta = { contentName, bestServer, serverStatus };

  const finalStreams = [...realStreams, ...noResStreams]
    .map(({ _sizeBytes, _bitrate, _audioRank, _mediaSourceId, _noResults, _noResultsType, _resLabel, _pingMs, _codec, _audioLang, _serverLabel, _itemName, _audioFormats, _defaultAudioFormat, _defaultChannels, _maxChannels, _audioIdx, _isDisabledClass, _demoted, _resRank, _channelRank, ...stream }) => stream);

  return { streams: finalStreams, meta };
}

module.exports = {
  fetchPlaybackInfo,
  mediaSourcesToStreams,
  getStreamsFromServer,
  getAllStreams,
  buildItemTitle,
  serverPriorityValue,
  sortByServerFailover,
};
