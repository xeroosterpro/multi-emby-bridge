// configure/profile-credentials.js — profile save/load, import/export, credential fetch, server tests

// ── Profile ───────────────────────────────────────────────────────────────
function setProfileButtons(disabled) {
  document.querySelectorAll('.btn-profile').forEach(b => b.disabled = disabled);
}

async function saveProfile() {
  const username = document.getElementById('p-username').value.trim();
  const password = document.getElementById('p-password').value;
  const statusEl = document.getElementById('profile-status');
  if (!username) { statusEl.textContent = 'Enter a profile name first.'; statusEl.className = 'profile-status error'; return; }
  if (!password) { statusEl.textContent = 'Enter a password to protect your profile.'; statusEl.className = 'profile-status error'; return; }
  const config = collectConfig();
  if (!config) return;
  setProfileButtons(true);
  statusEl.textContent = 'Saving...'; statusEl.className = 'profile-status info';
  try {
    const resp = await fetch('/api/profile/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password, config }) });
    const data = await safeJson(resp);
    if (!resp.ok) throw new Error(data.error || 'Unknown error');
    statusEl.textContent = `Done — ${data.message}`; statusEl.className = 'profile-status success';
  } catch (err) {
    statusEl.textContent = err.message; statusEl.className = 'profile-status error';
  } finally { setProfileButtons(false); }
}

async function loadProfile() {
  const username = document.getElementById('p-username').value.trim();
  const password = document.getElementById('p-password').value;
  const statusEl = document.getElementById('profile-status');
  if (!username) { statusEl.textContent = 'Enter your profile name first.'; statusEl.className = 'profile-status error'; return; }
  if (!password) { statusEl.textContent = 'Enter your password.'; statusEl.className = 'profile-status error'; return; }
  setProfileButtons(true);
  statusEl.textContent = 'Loading...'; statusEl.className = 'profile-status info';
  try {
    const resp = await fetch('/api/profile/load', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
    const data = await safeJson(resp);
    if (!resp.ok) throw new Error(data.error || 'Unknown error');
    populateFromConfig(data.config);
    const ago = data.updatedAt ? ` (saved ${new Date(data.updatedAt).toLocaleDateString()})` : '';
    statusEl.textContent = `Profile loaded${ago}`; statusEl.className = 'profile-status success';
  } catch (err) {
    statusEl.textContent = err.message; statusEl.className = 'profile-status error';
  } finally { setProfileButtons(false); }
}

// ── Import / Export ───────────────────────────────────────────────────────
function exportConfig() {
  const state = collectFormState();
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'stream-hub-config.json';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function importConfig(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const state = JSON.parse(e.target.result);
      localStorage.setItem(lsKey(), JSON.stringify(state));
      location.reload();
    } catch { alert('Invalid config file.'); }
  };
  reader.readAsText(file);
  event.target.value = '';
}

// ── Saved-login warning ──
function updateCredWarning(id) {
  const block = document.getElementById(`server-${id}`);
  if (!block) return;
  const el = document.getElementById(`cred-warning-${id}`);
  if (!el) return;
  const apiKey = block.querySelector('.f-apikey').value.trim();
  const username = block.querySelector('.f-username').value.trim();
  const password = block.querySelector('.f-password').value;
  if (apiKey && !(username && password)) {
    el.innerHTML = '⚠️ No login saved — this API key will expire and the addon cannot auto-renew it. '
      + 'Enter your <b>Username</b> + <b>Password</b> above and click “Fetch API Key & User ID” so tokens refresh automatically.';
    el.style.display = '';
  } else {
    el.style.display = 'none';
  }
}

// ── Credential fetch ──────────────────────────────────────────────────────
async function fetchCredentials(id) {
  const block = document.getElementById(`server-${id}`);
  const url = block.querySelector('.f-url').value.trim().replace(/\/+$/, '');
  const username = block.querySelector('.f-username').value.trim();
  const password = block.querySelector('.f-password').value;
  const statusEl = document.getElementById(`cred-status-${id}`);
  const btn = block.querySelector('.btn-fetch');
  if (!url) { statusEl.textContent = 'Enter the Server URL first.'; statusEl.className = 'cred-status error'; return; }
  if (!username) { statusEl.textContent = 'Enter your username.'; statusEl.className = 'cred-status error'; return; }
  btn.disabled = true; btn.textContent = 'Fetching...';
  statusEl.textContent = ''; statusEl.className = 'cred-status';
  try {
    const resp = await fetch('/api/fetch-credentials', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url, username, password }) });
    const data = await safeJson(resp);
    if (!resp.ok) throw new Error(data.error || 'Unknown error');
    block.querySelector('.f-apikey').value = data.apiKey;
    block.querySelector('.f-userid').value = data.userId;
    updateCredWarning(id);
    statusEl.textContent = 'Credentials fetched!'; statusEl.className = 'cred-status success';
    autoSave();
    refreshServerCard(block).then(() => renderServersPage());
  } catch (err) {
    statusEl.textContent = err.message; statusEl.className = 'cred-status error';
  } finally { btn.disabled = false; btn.textContent = 'Fetch API Key & User ID'; }
}

// ── Test connection ───────────────────────────────────────────────────────
async function testConnection(id) {
  const block = document.getElementById(`server-${id}`);
  const url = block.querySelector('.f-url').value.trim().replace(/\/+$/, '');
  const type = block.querySelector('.f-type').value;
  const apiKey = block.querySelector('.f-apikey').value.trim();
  const userId = block.querySelector('.f-userid').value.trim();
  const statusEl = document.getElementById(`test-status-${id}`);
  const btn = block.querySelector('.btn-test');
  const dot = document.getElementById(`status-dot-${id}`);
  if (!url) { statusEl.textContent = 'Enter the Server URL first.'; statusEl.className = 'test-status error'; return; }
  if (!apiKey || !userId) { statusEl.textContent = 'Enter API Key and User ID first.'; statusEl.className = 'test-status error'; return; }
  btn.disabled = true; btn.textContent = 'Testing...';
  statusEl.textContent = ''; statusEl.className = 'test-status';
  try {
    const username = block.querySelector('.f-username')?.value.trim() || '';
    const password = block.querySelector('.f-password')?.value || '';
    const resp = await fetch('/api/test-connection', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, type, apiKey, userId, username, password }) });
    const data = await safeJson(resp);
    if (data.apiKey) _applyRefreshedApiKey(block, data.apiKey);
    if (data.ok) {
      statusEl.textContent = data.message; statusEl.className = 'test-status success';
      if (dot) dot.className = 'server-status-dot online';
    } else {
      statusEl.textContent = data.error; statusEl.className = 'test-status error';
      if (dot) dot.className = 'server-status-dot offline';
    }
  } catch (err) {
    statusEl.textContent = err.message; statusEl.className = 'test-status error';
    if (dot) dot.className = 'server-status-dot offline';
  } finally { btn.disabled = false; btn.textContent = 'Test Connection'; }
}

// ── Library stats ─────────────────────────────────────────────────────────
async function loadLibraryStats(id) {
  const block = document.getElementById(`server-${id}`);
  const url = block.querySelector('.f-url').value.trim().replace(/\/+$/, '');
  const type = block.querySelector('.f-type').value;
  const apiKey = block.querySelector('.f-apikey').value.trim();
  const userId = block.querySelector('.f-userid').value.trim();
  const statsEl = document.getElementById(`stats-${id}`);
  const btn = block.querySelector('.btn-stats');
  if (!url) { statsEl.textContent = 'Enter Server URL first.'; statsEl.className = 'stats-display error'; return; }
  if (!apiKey || !userId) { statsEl.textContent = 'Enter API Key + User ID first.'; statsEl.className = 'stats-display error'; return; }
  btn.disabled = true; btn.textContent = 'Loading...';
  statsEl.textContent = ''; statsEl.className = 'stats-display';
  try {
    const username = block.querySelector('.f-username')?.value.trim() || '';
    const password = block.querySelector('.f-password')?.value || '';
    const resp = await fetch('/api/library-stats', {
      method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, type, apiKey, userId, username, password, label: block.querySelector('.f-label')?.value.trim() || '' }),
    });
    const data = await safeJson(resp);
    if (data.apiKey) _applyRefreshedApiKey(block, data.apiKey);
    if (data.error) { statsEl.textContent = data.error; statsEl.className = 'stats-display error'; }
    else {
      statsEl.className = 'stats-display';
      statsEl.innerHTML = `
        <span class="stats-badge"><span>Movies:</span><span>${data.movies.toLocaleString()}</span></span>
        <span class="stats-badge"><span>Shows:</span><span>${data.shows.toLocaleString()}</span></span>
        <span class="stats-badge"><span>Episodes:</span><span>${data.episodes.toLocaleString()}</span></span>`;
    }
  } catch (err) {
    statsEl.textContent = err.message; statsEl.className = 'stats-display error';
  } finally { btn.disabled = false; btn.textContent = 'Library Stats'; }
}

window.saveProfile = saveProfile;
window.loadProfile = loadProfile;
window.exportConfig = exportConfig;
window.importConfig = importConfig;
window.updateCredWarning = updateCredWarning;
window.fetchCredentials = fetchCredentials;
window.testConnection = testConnection;
window.loadLibraryStats = loadLibraryStats;