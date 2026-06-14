// configure/servers-config.js — collect enabled servers for manifest / API payloads

function collectConfig(silent = false) {
  const blocks = document.querySelectorAll('.server-block');
  if (blocks.length === 0) {
    if (!silent) showError('Add at least one server.');
    return null;
  }
  const servers = [];
  for (const block of blocks) {
    if (!block.querySelector('.f-enabled').checked) continue;
    const label = block.querySelector('.f-label').value.trim();
    const type = block.querySelector('.f-type').value;
    const url = block.querySelector('.f-url').value.trim().replace(/\/+$/, '');
    const apiKey = block.querySelector('.f-apikey').value.trim();
    const userId = block.querySelector('.f-userid').value.trim();
    const username = block.querySelector('.f-username').value.trim();
    const password = block.querySelector('.f-password').value;
    if (!label || !url || !apiKey || !userId) {
      if (!silent) showError('All fields (Name, URL, API Key, User ID) must be filled for every enabled server.');
      return null;
    }
    const thumbnail = block.querySelector('.f-thumbnail')?.value.trim() || '';
    const emoji = block.querySelector('.f-emoji')?.value.trim() || '';
    const entry = { label, type, url, apiKey, userId };
    if (thumbnail) entry.thumbnail = thumbnail;
    if (emoji) entry.emoji = emoji;
    if (username && password) { entry.username = username; entry.password = password; }
    const costRaw = block.querySelector('.f-cost')?.value.trim() || '';
    const costPeriod = block.querySelector('.f-cost-period')?.value || 'none';
    const cost = costRaw === '' ? NaN : Number(costRaw);
    if (!Number.isNaN(cost) && cost > 0 && costPeriod !== 'none') { entry.cost = cost; entry.costPeriod = costPeriod; }
    const pri = parseInt(block.querySelector('.f-priority')?.value || '5', 10);
    if (pri >= 1 && pri <= 10 && pri !== 5) entry.priority = pri;
    servers.push(entry);
  }
  if (servers.length === 0) {
    if (!silent) showError('At least one server must be enabled.');
    return null;
  }
  return { servers };
}

function populateFromConfig(config) {
  document.getElementById('servers-container').innerHTML = '';
  nextId = 0;
  for (const server of (config.servers || [])) addServer(server, { skipRefresh: true });
  if (_isServersPageActive()) renderServersPage({ force: true });
}

window.collectConfig = collectConfig;
window.populateFromConfig = populateFromConfig;