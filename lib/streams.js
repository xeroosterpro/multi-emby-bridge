// ─── Stream building from PlaybackInfo MediaSources ──────────────────────────
const { apiFetch, pingServer, buildStreamUrl } = require('./auth');
const { formatFileSize, detectSourceLabel, langFlag, buildBitrateBar } = require('./utils');
const { queryServerForMovie, queryServerForEpisode } = require('./search');

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
    });
  }
  return streams;
}

// ─── Server queries (Streambridge-matching logic) ────────────────────────────

async function getStreamsFromServer(server, type, imdbId, season, episode, labelPreset, streamOpts = {}) {
  try {
    let items;
    if (type === 'movie') {
      items = await queryServerForMovie(server, imdbId);
    } else {
      items = await queryServerForEpisode(server, imdbId, season, episode);
    }

    const itemName = items[0]?.Name || null;

    const allStreams = [];
    const playbackResults = await Promise.allSettled(
      items.map(async (item) => {
        try {
          const mediaSources = await fetchPlaybackInfo(server, item.Id);
          return { itemId: item.Id, mediaSources };
        } catch (err) {
          console.error(`[${server.label}] PlaybackInfo failed for ${item.Id}:`, err.message);
          return { itemId: item.Id, mediaSources: item.MediaSources || [] };
        }
      })
    );

    for (const result of playbackResults) {
      if (result.status === 'fulfilled') {
        const { itemId, mediaSources } = result.value;
        const streams = mediaSourcesToStreams(server, itemId, mediaSources, labelPreset, streamOpts);
        allStreams.push(...streams);
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

async function getAllStreams(servers, type, imdbId, season, episode, opts = {}) {
  const { sortOrder, excludeRes, recommend, ping, audioLang, maxBitrate, prefCodec, codecMode, labelPreset, pingDetail, autoSelect, qualityBadge, flagEmoji, bitrateBar, subsStyle, customNameFields, customDescFields } = opts;
  const streamOpts = { qualityBadge, flagEmoji, bitrateBar, subsStyle, customNameFields: customNameFields || [], customDescFields: customDescFields || [] };

  const [pingResults, streamResults] = await Promise.all([
    Promise.all(ping ? servers.map(pingServer) : servers.map(() => null)),
    Promise.allSettled(servers.map(server => {
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
      const srv = servers[i];
      const isTimeout = (result.reason?.message || '').includes('cutoff');
      return [{
        name: srv.label,
        description: isTimeout ? 'Server timed out' : 'Server error',
        url: `${srv.url}/no-stream-available`,
        _noResults: true,
        _noResultsType: isTimeout ? 'timeout' : 'error',
        _sizeBytes: 0, _bitrate: 0, _audioRank: 999,
        _mediaSourceId: `${isTimeout ? 'timeout' : 'error'}:${srv.label}`,
        _serverLabel: srv.label, _itemName: null,
      }];
    }
    const streams = result.value;
    return streams.map(s => ({ ...s, _pingMs: pingResults[i] }));
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

  // Sort
  realStreams.sort((a, b) => {
    if (audioLang && audioLang !== 'any') {
      const aL = (a._audioLang || '').startsWith(audioLang) ? 0 : 1;
      const bL = (b._audioLang || '').startsWith(audioLang) ? 0 : 1;
      if (aL !== bL) return aL - bL;
    }
    if (prefCodec && prefCodec !== 'any' && codecMode !== 'only') {
      const aC = a._codec === prefCodec ? 0 : 1;
      const bC = b._codec === prefCodec ? 0 : 1;
      if (aC !== bC) return aC - bC;
    }
    if (sortOrder === 'audio') {
      const d = (a._audioRank || 99) - (b._audioRank || 99);
      return d !== 0 ? d : (b._sizeBytes || 0) - (a._sizeBytes || 0);
    }
    if (sortOrder === 'bitrate') {
      const d = (b._bitrate || 0) - (a._bitrate || 0);
      return d !== 0 ? d : (b._sizeBytes || 0) - (a._sizeBytes || 0);
    }
    const sizeDiff = (b._sizeBytes || 0) - (a._sizeBytes || 0);
    if (sizeDiff !== 0) return sizeDiff;
    const audioDiff = (a._audioRank || 99) - (b._audioRank || 99);
    if (audioDiff !== 0) return audioDiff;
    return (b._bitrate || 0) - (a._bitrate || 0);
  });

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
    .map(({ _sizeBytes, _bitrate, _audioRank, _mediaSourceId, _noResults, _noResultsType, _resLabel, _pingMs, _codec, _audioLang, _serverLabel, _itemName, ...stream }) => stream);

  return { streams: finalStreams, meta };
}

module.exports = {
  fetchPlaybackInfo,
  mediaSourcesToStreams,
  getStreamsFromServer,
  getAllStreams,
};
