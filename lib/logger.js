// ─── Lightweight structured JSON logger (zero dependencies) ──────────────────
// Emits one JSON object per line (Railway/most platforms ingest this natively).
// Pino-compatible surface — logger.info(msg) / logger.info({fields}, msg) /
// logger.child({reqId}) — so it can be swapped for pino later with no call-site
// changes. Chosen over a dependency to keep the production attack/footprint
// surface minimal. Levels gated by LOG_LEVEL (debug|info|warn|error|silent).

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 99 };

// Keys whose values must never hit the logs (api keys, passwords, tokens, …).
const REDACT_KEY = /^(api_?key|password|pw|pass|token|secret|authorization|cookie|x-emby-token|x-mediabrowser-token|client_secret|paypal_secret|config_enc_key)$/i;

function redact(value, depth = 0) {
  if (value == null || depth > 5) return value;
  if (value instanceof Error) return { message: value.message, stack: value.stack, code: value.code, status: value.status };
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = REDACT_KEY.test(k) ? '[redacted]' : redact(v, depth + 1);
    return out;
  }
  return value;
}

function safeStringify(obj) {
  const seen = new WeakSet();
  try {
    return JSON.stringify(obj, (k, v) => {
      if (typeof v === 'object' && v !== null) { if (seen.has(v)) return '[circular]'; seen.add(v); }
      if (typeof v === 'bigint') return v.toString();
      return v;
    });
  } catch { return JSON.stringify({ level: 'error', msg: 'log serialize failed' }); }
}

function createLogger(opts = {}) {
  const bindings = opts.bindings || {};
  const now = opts.now || (() => new Date().toISOString());
  const out = opts.write || ((line) => process.stdout.write(line + '\n'));
  const err = opts.errWrite || ((line) => process.stderr.write(line + '\n'));
  const threshold = LEVELS[(opts.level || process.env.LOG_LEVEL || 'info').toLowerCase()] ?? LEVELS.info;

  function log(level, a1, a2) {
    if (LEVELS[level] < threshold) return;
    let fields = {}, msg;
    if (typeof a1 === 'string') { msg = a1; }
    else if (a1 && typeof a1 === 'object') { fields = a1; msg = a2; }
    const rec = { level, time: now(), ...bindings, ...redact(fields), ...(msg != null ? { msg: String(msg) } : {}) };
    const line = safeStringify(rec);
    (level === 'error' || level === 'warn' ? err : out)(line);
  }

  return {
    debug: (a, b) => log('debug', a, b),
    info: (a, b) => log('info', a, b),
    warn: (a, b) => log('warn', a, b),
    error: (a, b) => log('error', a, b),
    child: (b) => createLogger({ ...opts, bindings: { ...bindings, ...b } }),
  };
}

const logger = createLogger();

module.exports = { logger, createLogger, redact };
