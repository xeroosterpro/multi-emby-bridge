// Static copy of lib/audioRanking taxonomy — avoids GET /api/audio-formats on load
window.MEB_AUDIO_FORMATS_DATA={formats:[
  {
    "id": "atmos",
    "token": "atm",
    "label": "Dolby Atmos",
    "cat": "object",
    "chans": "7.1 + height (object)"
  },
  {
    "id": "dtsx",
    "token": "dtx",
    "label": "DTS:X",
    "cat": "object",
    "chans": "7.1 + height (object)"
  },
  {
    "id": "truehd",
    "token": "thd",
    "label": "Dolby TrueHD",
    "cat": "lossless",
    "chans": "up to 7.1"
  },
  {
    "id": "dtshd_ma",
    "token": "dma",
    "label": "DTS-HD MA",
    "cat": "lossless",
    "chans": "up to 7.1"
  },
  {
    "id": "lpcm",
    "token": "pcm",
    "label": "LPCM",
    "cat": "lossless",
    "chans": "2.0 – 7.1"
  },
  {
    "id": "flac",
    "token": "flc",
    "label": "FLAC",
    "cat": "lossless",
    "chans": "2.0 – 7.1"
  },
  {
    "id": "ddplus",
    "token": "ddp",
    "label": "Dolby Digital+",
    "cat": "lossy",
    "chans": "up to 7.1"
  },
  {
    "id": "dts",
    "token": "dts",
    "label": "DTS",
    "cat": "lossy",
    "chans": "5.1"
  },
  {
    "id": "dd",
    "token": "dd",
    "label": "Dolby Digital",
    "cat": "lossy",
    "chans": "5.1"
  },
  {
    "id": "aac",
    "token": "aac",
    "label": "AAC",
    "cat": "lossy",
    "chans": "2.0 / 5.1"
  },
  {
    "id": "other",
    "token": "oth",
    "label": "Other",
    "cat": "other",
    "chans": "varies"
  }
],presets:[
  {
    "id": "shield_earc",
    "label": "Shield → eARC",
    "kind": "combo",
    "combo": [
      "shield",
      "soundbar"
    ],
    "settings": {
      "surroundPriority": true,
      "autoSelect": false,
      "suggestedOrder": [
        "atmos",
        "truehd",
        "ddplus",
        "dd",
        "aac",
        "other"
      ]
    },
    "note": "Dolby surround over eARC; DTS/X files hidden"
  },
  {
    "id": "shield_tv",
    "label": "Shield → TV speakers",
    "kind": "combo",
    "combo": [
      "shield",
      "tv"
    ],
    "settings": {
      "surroundPriority": true,
      "autoSelect": true,
      "suggestedOrder": [
        "atmos",
        "dtsx",
        "truehd",
        "dtshd_ma",
        "ddplus",
        "dts",
        "dd",
        "aac",
        "flac",
        "lpcm",
        "other"
      ]
    },
    "note": "Shield decodes everything; TV plays stereo downmix"
  },
  {
    "id": "appletv_earc",
    "label": "Apple TV → eARC",
    "kind": "combo",
    "combo": [
      "appletv",
      "soundbar"
    ],
    "settings": {
      "surroundPriority": true,
      "autoSelect": false,
      "suggestedOrder": [
        "atmos",
        "truehd",
        "ddplus",
        "dd",
        "aac",
        "other"
      ]
    },
    "note": "Dolby surround over eARC; DTS/X files hidden"
  },
  {
    "id": "shield_sonos",
    "label": "Shield → Sonos",
    "kind": "combo",
    "combo": [
      "shield",
      "sonos"
    ],
    "settings": {
      "surroundPriority": true,
      "autoSelect": false,
      "suggestedOrder": [
        "atmos",
        "truehd",
        "ddplus",
        "dts",
        "dd",
        "aac",
        "other"
      ]
    },
    "note": "TrueHD/Atmos + DTS 5.1; DTS:X/HD-MA/LPCM/FLAC hidden"
  },
  {
    "id": "appletv_sonos",
    "label": "Apple TV → Sonos",
    "kind": "combo",
    "combo": [
      "appletv",
      "sonos"
    ],
    "settings": {
      "surroundPriority": true,
      "autoSelect": false,
      "suggestedOrder": [
        "atmos",
        "truehd",
        "ddplus",
        "dts",
        "dd",
        "aac",
        "other"
      ]
    },
    "note": "TrueHD/Atmos + DTS 5.1; DTS:X/HD-MA/LPCM/FLAC hidden"
  },
  {
    "id": "appletv",
    "label": "Apple TV 4K",
    "supports": [
      "atmos",
      "dtsx",
      "truehd",
      "dtshd_ma",
      "lpcm",
      "flac",
      "ddplus",
      "dts",
      "dd",
      "aac",
      "other"
    ],
    "note": "HDMI passthrough when your display/soundbar supports the format"
  },
  {
    "id": "shield",
    "label": "Nvidia Shield",
    "supports": [
      "atmos",
      "dtsx",
      "truehd",
      "dtshd_ma",
      "lpcm",
      "flac",
      "ddplus",
      "dts",
      "dd",
      "aac",
      "other"
    ],
    "settings": {
      "surroundPriority": true,
      "suggestedOrder": [
        "atmos",
        "dtsx",
        "truehd",
        "dtshd_ma",
        "ddplus",
        "dts",
        "dd",
        "aac",
        "flac",
        "lpcm",
        "other"
      ]
    },
    "note": "Decodes or passthroughs all formats over HDMI"
  },
  {
    "id": "chromecast",
    "label": "Chromecast w/ Google TV",
    "supports": [
      "atmos",
      "ddplus",
      "dts",
      "dd",
      "aac",
      "flac",
      "other"
    ],
    "note": "No TrueHD / DTS-HD MA / LPCM passthrough"
  },
  {
    "id": "soundbar",
    "label": "eARC / HDMI soundbar",
    "supports": [
      "atmos",
      "truehd",
      "ddplus",
      "dd",
      "aac",
      "other"
    ],
    "note": "Dolby-only eARC — no DTS, DTS:X, DTS-HD MA, FLAC, or LPCM"
  },
  {
    "id": "sonos",
    "label": "Sonos (Arc/Beam)",
    "supports": [
      "atmos",
      "truehd",
      "ddplus",
      "dts",
      "dd",
      "aac",
      "other"
    ],
    "note": "TrueHD/Atmos + DTS 5.1 via eARC — hides DTS:X, DTS-HD MA, LPCM, FLAC"
  },
  {
    "id": "firestick",
    "label": "Fire TV 4K / Max",
    "supports": [
      "atmos",
      "ddplus",
      "dts",
      "dd",
      "aac",
      "flac",
      "other"
    ],
    "note": "No TrueHD / DTS-HD MA / LPCM passthrough"
  },
  {
    "id": "tv",
    "label": "TV built-in speakers",
    "supports": [
      "dd",
      "aac",
      "other"
    ],
    "note": "Stereo downmix — use only when the player decodes (e.g. Shield→TV)"
  },
  {
    "id": "browser",
    "label": "Web browser",
    "supports": [
      "flac",
      "dd",
      "aac",
      "other"
    ],
    "note": "Stremio web player — lossy + stereo FLAC"
  },
  {
    "id": "phone",
    "label": "Phone / tablet",
    "supports": [
      "ddplus",
      "dts",
      "dd",
      "aac",
      "flac",
      "other"
    ],
    "note": "Mobile Stremio — no lossless surround passthrough"
  }
]};
