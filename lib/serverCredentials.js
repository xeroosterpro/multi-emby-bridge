const { assertSafeFetchUrl, normalizeServerUrl } = require('./urlSafety');
const { findServerEntry } = require('./serverMatch');
const { makeUserConfig } = require('./userConfig');

async function resolveServerCredentials(req, body, dbLib) {
  const { url, type, apiKey, userId, username, password, label } = body || {};
  if (!url) return { status: 400, error: 'url is required' };
  let safeUrl;
  try {
    await assertSafeFetchUrl(url, 'server url');
    safeUrl = normalizeServerUrl(url);
    if (!safeUrl) return { status: 400, error: 'Invalid server url' };
  } catch (e) {
    return { status: 400, error: e.message };
  }
  const server = {
    url: safeUrl,
    type: type || 'emby',
    apiKey: String(apiKey || '').trim(),
    userId: String(userId || '').trim(),
    username: username || '',
    password: password || '',
    label: label || '',
  };
  if (req.user && dbLib.isConfigured()) {
    try {
      const cfg = await makeUserConfig(dbLib).getForServe(req.user.id);
      const match = findServerEntry(cfg?.servers, safeUrl, label);
      if (match) {
        if (match.apiKey) server.apiKey = match.apiKey;
        if (match.userId) server.userId = match.userId;
        if (match.type) server.type = match.type;
        if (match.username) server.username = match.username;
        if (match.password) server.password = match.password;
        if (match.label) server.label = match.label;
        if (match.url) server.url = normalizeServerUrl(match.url) || server.url;
      }
    } catch (e) { console.warn('[resolveServerCredentials] stored config merge failed:', e.message); }
  }
  if (!server.apiKey || !server.userId) {
    return { status: 400, error: 'url, apiKey and userId are required.' };
  }
  return { server };
}

module.exports = { resolveServerCredentials };