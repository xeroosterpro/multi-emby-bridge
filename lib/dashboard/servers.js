function normUrl(url) {
  return String(url || '').replace(/\/+$/, '');
}

function filterLiveServers(cfg) {
  if (!cfg || !Array.isArray(cfg.servers)) return [];
  return cfg.servers.filter(s => s && s.url && s.apiKey && s.userId && s.enabled !== false);
}

function summarizeServers(servers) {
  return (servers || []).map(s => ({
    url: s.url,
    label: s.label || '',
    type: s.type || 'emby',
    cost: s.cost ?? null,
    costPeriod: s.costPeriod || null,
    userId: s.userId,
  }));
}

module.exports = { normUrl, filterLiveServers, summarizeServers };