const { historyForUrls } = require('../health');
const { normUrl } = require('./servers');

function buildHealthRows(servers, healthHistory, healthServers) {
  const urlSet = new Set();
  for (const s of servers || []) {
    const u = normUrl(s.url);
    if (u) urlSet.add(u);
  }
  return historyForUrls(urlSet);
}

module.exports = { buildHealthRows };