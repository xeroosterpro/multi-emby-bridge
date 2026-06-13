const VALID_SCOPES = new Set(['full', 'live', 'stats', 'health', 'conn']);

function parseScope(raw) {
  const scope = String(raw || 'full').toLowerCase();
  return VALID_SCOPES.has(scope) ? scope : 'full';
}

function scopeNeeds(scope, part) {
  if (scope === 'full') return true;
  return scope === part;
}

module.exports = { VALID_SCOPES, parseScope, scopeNeeds };