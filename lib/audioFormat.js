// ─── Shared audio track selection + display labels ───────────────────────────
const audioRanking = require('./audioRanking');

const FORMAT_DISPLAY = {
  atmos: 'Atmos',
  dtsx: 'DTS:X',
  truehd: 'TrueHD',
  dtshd_ma: 'DTS-MA',
  lpcm: 'LPCM',
  flac: 'FLAC',
  ddplus: 'DD+',
  dts: 'DTS',
  dd: 'DD',
  aac: 'AAC',
  other: null,
};

function channelStr(channels) {
  const ch = channels | 0;
  if (ch === 8) return '7.1';
  if (ch === 6) return '5.1';
  if (ch === 2) return '2.0';
  if (ch) return `${ch}ch`;
  return '';
}

function pickAudioStream(mediaStreams, source) {
  const audioStreams = (mediaStreams || []).filter((s) => s.Type === 'Audio');
  if (!audioStreams.length) return null;
  const idx = source?.DefaultAudioStreamIndex;
  if (idx != null) {
    const byIndex = audioStreams.find((s) => s.Index === idx);
    if (byIndex) return byIndex;
  }
  return audioStreams[0];
}

function formatAudioLabels(audioStream) {
  if (!audioStream) {
    return { audioLabel: null, shortAudioLabel: null, audioRank: 99, codecName: null };
  }
  const formatId = audioRanking.classifyAudio(audioStream.Codec, audioStream.Profile);
  const profile = (audioStream.Profile || '').toLowerCase();
  const baseCodec = (audioStream.Codec || '').toLowerCase();
  let codecName = FORMAT_DISPLAY[formatId];
  if (formatId === 'atmos' && baseCodec.includes('truehd')) codecName = 'TrueHD Atmos';
  else if (formatId === 'atmos' && (baseCodec.includes('eac') || baseCodec.includes('ac3'))) codecName = 'DD+ Atmos';
  if (!codecName && audioStream.Codec) codecName = audioStream.Codec.toUpperCase();
  if (formatId === 'other' && audioStream.Codec) codecName = audioStream.Codec.toUpperCase();

  const chStr = channelStr(audioStream.Channels);
  const audioRankMap = {
    atmos: 0, truehd: 1, dtshd_ma: 2, dtsx: 0, ddplus: 4, dts: 3, dd: 5, aac: 6, flac: 2, lpcm: 2, other: 7,
  };
  let audioRank = audioRankMap[formatId] != null ? audioRankMap[formatId] : 7;
  if (profile.includes('atmos') && formatId !== 'atmos') audioRank = 0;
  audioRank = audioRank * 10 - (audioStream.Channels || 0);

  const audioLabel = [codecName, chStr].filter(Boolean).join(' ');
  const shortAudioLabel = formatId === 'atmos' || profile.includes('atmos')
    ? 'Atmos'
    : (codecName || null);

  return { audioLabel, shortAudioLabel, audioRank, codecName };
}

function formatTrackLabel(stream, flagEmojiStyle) {
  const { audioLabel } = formatAudioLabels(stream);
  if (!audioLabel) return '';
  const rawLang = stream.Language ? stream.Language.toUpperCase().slice(0, 3) : '';
  const { langFlag } = require('./utils');
  const flag = langFlag(stream.Language);
  const lang = flagEmojiStyle === 'none' ? ''
    : flagEmojiStyle === 'flag' ? (flag || rawLang)
      : flagEmojiStyle === 'both' ? (flag ? flag + rawLang : rawLang)
        : rawLang;
  return [lang, audioLabel].filter(Boolean).join(' ');
}

module.exports = {
  pickAudioStream,
  formatAudioLabels,
  formatTrackLabel,
  channelStr,
  FORMAT_DISPLAY,
};