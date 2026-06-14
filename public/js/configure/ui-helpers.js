// configure/ui-helpers.js — shared DOM/format helpers used across configure modules

function fmtBytes(b) {
  if (!b) return null;
  if (b >= 1e9) return `${(b/1e9).toFixed(1)}GB`;
  if (b >= 1e6) return `${(b/1e6).toFixed(0)}MB`;
  return `${Math.round(b/1e3)}KB`;
}

function encodeConfig(obj) {
  return btoa(unescape(encodeURIComponent(JSON.stringify(obj))))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

async function safeJson(resp) {
  try { return await resp.json(); }
  catch { return { error: `Server returned non-JSON (HTTP ${resp.status}).` }; }
}

function showError(msg) {
  const e = document.getElementById('global-error');
  if (!e) return;
  e.textContent = msg;
  e.style.display = 'block';
}

function hideError() {
  const e = document.getElementById('global-error');
  if (e) e.style.display = 'none';
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function monthlyCost(cost, period) {
  const c = Number(cost);
  if (!Number.isFinite(c) || c <= 0) return 0;
  if (period === 'monthly')   return c;
  if (period === 'quarterly') return c / 3;
  if (period === 'yearly')    return c / 12;
  return 0;
}

window.fmtBytes = fmtBytes;
window.encodeConfig = encodeConfig;
window.safeJson = safeJson;
window.showError = showError;
window.hideError = hideError;
window.escHtml = escHtml;
window.monthlyCost = monthlyCost;