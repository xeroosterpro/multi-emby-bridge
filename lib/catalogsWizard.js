// Pure helpers for catalogs wizard (Node + browser via catalogs-wizard.js)

const WIZARD_STEPS = ['connect', 'library', 'discover', 'review'];

const KEY_PROVIDERS = ['trakt', 'tmdb', 'mdblist', 'rpdb'];

function parseStepFromHash(hash, search) {
  const qs = new URLSearchParams((search || '').replace(/^\?/, ''));
  const fromQuery = qs.get('step');
  if (fromQuery && WIZARD_STEPS.includes(fromQuery)) return fromQuery;
  const m = (hash || '').match(/[?&]step=(\w+)/);
  if (m && WIZARD_STEPS.includes(m[1])) return m[1];
  return 'connect';
}

function deriveKeyStatus(value, tested) {
  const v = (value || '').trim();
  if (!v) return 'unset';
  if (tested === true) return 'ok';
  if (tested === false) return 'bad';
  return 'set';
}

function countEnabledRows(rows) {
  return (rows || []).filter(r => r && r.enabled !== false).length;
}

function stepIndex(step) {
  const i = WIZARD_STEPS.indexOf(step);
  return i >= 0 ? i : 0;
}

function isStepComplete(step, state) {
  if (!state) return false;
  switch (step) {
    case 'connect':
      return !!(state.tmdbApiKey || state.traktClientId || state.mdblistApiKey);
    case 'library':
      return state.showCatalog !== false;
    case 'discover':
      return countEnabledRows(state.externalCatalogs) > 0;
    case 'review':
      return countEnabledRows(state.externalCatalogs) > 0;
    default:
      return false;
  }
}

module.exports = {
  WIZARD_STEPS,
  KEY_PROVIDERS,
  parseStepFromHash,
  deriveKeyStatus,
  countEnabledRows,
  stepIndex,
  isStepComplete,
};