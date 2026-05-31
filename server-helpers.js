const ROW_NAMES = { recent: 'Recently Added', resume: 'Continue Watching', nextup: 'Next Up', favorites: 'Favorites' };
const VALID = Object.keys(ROW_NAMES);

function deriveLibraryRows(cfg) {
  cfg = cfg || {};
  if (cfg.showCatalog === false) return [];
  if (Array.isArray(cfg.libraryRows)) {
    const rows = cfg.libraryRows.filter(k => VALID.includes(k));
    return rows.length ? rows : ['recent'];
  }
  if (cfg.catalogContent && VALID.includes(cfg.catalogContent)) return [cfg.catalogContent];
  return ['recent'];
}

module.exports = { ROW_NAMES, VALID, deriveLibraryRows };
