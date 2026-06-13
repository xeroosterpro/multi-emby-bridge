async function mapPool(items, worker, concurrency = 3) {
  if (!items.length) return [];
  const results = new Array(items.length);
  let idx = 0;
  const n = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: n }, async () => {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await worker(items[i], i);
    }
  }));
  return results;
}

module.exports = { mapPool };