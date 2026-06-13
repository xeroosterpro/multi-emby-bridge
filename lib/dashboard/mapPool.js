async function mapPool(items, worker, concurrency = 3, itemTimeoutMs = 25000) {
  if (!items.length) return [];
  const results = new Array(items.length);
  let idx = 0;
  const n = Math.min(concurrency, items.length);

  const withTimeout = async (item, i) => {
    if (!itemTimeoutMs || itemTimeoutMs <= 0) return worker(item, i);
    let timer;
    try {
      return await Promise.race([
        worker(item, i),
        new Promise((_, rej) => {
          timer = setTimeout(() => {
            const t = new Error('Connection timed out');
            t.name = 'AbortError';
            rej(t);
          }, itemTimeoutMs);
        }),
      ]);
    } catch (e) {
      // Normalize timeout-shaped errors for callers that expect 'Connection timed out'
      if (e && (e.name === 'AbortError' || /timeout/i.test(e.message || ''))) {
        const t = new Error('Connection timed out');
        t.name = 'AbortError';
        throw t;
      }
      throw e;
    } finally {
      if (timer) clearTimeout(timer);
    }
  };

  await Promise.all(Array.from({ length: n }, async () => {
    while (idx < items.length) {
      const i = idx++;
      try {
        results[i] = await withTimeout(items[i], i);
      } catch (e) {
        // Worker is expected to return a failure shape; rethrow only for truly unexpected
        // Let the specific worker (testOneConnection / fetchOneLibrary) turn it into {ok:false, error}
        // If it still throws, surface a normalized failure so bundle never hard-crashes.
        const label = items[i] && (items[i].label || items[i].url) || '?';
        results[i] = {
          url: items[i] && items[i].url,
          label,
          ok: false,
          error: (e && e.message) || 'Connection timed out',
        };
      }
    }
  }));
  return results;
}

module.exports = { mapPool };