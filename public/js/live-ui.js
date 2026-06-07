// Shared live-session row rendering for dashboard + server detail modal.
(function () {
  function normUrl(url) {
    return (url || '').replace(/\/+$/, '').toLowerCase();
  }

  function esc(t) {
    return String(t == null ? '' : t)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function formatBridgeServerLabel(s) {
    if (!s) return '';
    if (s.source === 'bridge') return (s.serverConfirmed && s.server) ? s.server : '';
    return s.server || '';
  }

  function formatLiveMetaLine(s) {
    const parts = [];
    const server = formatBridgeServerLabel(s);
    if (server) parts.push(server);
    if (s.user) parts.push(s.user);
    const client = s.client || s.device || '';
    if (client) parts.push(client);
    return parts.join(' · ');
  }

  function filterLiveByServer(live, opts) {
    const label = (opts && opts.label) || '';
    const url = normUrl(opts && opts.url);
    return (live || []).filter(s => {
      if (label && s.server === label) return true;
      if (url && s.serverUrl && normUrl(s.serverUrl) === url) return true;
      return false;
    });
  }

  function renderLiveRows(sessions, opts) {
    opts = opts || {};
    const list = sessions || [];
    if (!list.length) return opts.emptyHtml || '<div class="da-empty">Nothing playing on this server right now.</div>';
    return list.map(s => {
      const tags = [];
      if (s.buffering) tags.push('<span class="da-buffer-tag">Buffering</span>');
      else if (s.isPaused) tags.push('<span class="da-pause-tag">Paused</span>');
      else if (s.isTranscoding) tags.push('<span class="da-tx-tag">Transcode</span>');
      else if (s.playMethod === 'DirectStream' || s.playMethod === 'DirectPlay') tags.push('<span class="da-direct-tag">Direct</span>');
      const progress = s.progressPct != null
        ? `<span class="da-progress" title="${s.progressPct}%"><span class="da-progress-bar" style="width:${s.progressPct}%"></span></span>`
        : '';
      const metaLine = formatLiveMetaLine(s);
      return `<div class="da-row da-live${s.buffering ? ' da-buffering' : ''}${s.isPaused ? ' da-paused' : ''}">
        <span class="da-main">
          <span class="da-dot${s.buffering ? ' da-dot-warn' : (s.isPaused ? ' da-dot-pause' : '')}"></span>
          <span class="da-title-wrap">
            <span class="da-title" title="${esc(s.title)}"><strong>${esc(s.title)}</strong>${tags.join('')}</span>
            ${progress}
          </span>
        </span>
        <span class="da-dim da-meta">${metaLine ? esc(metaLine) : '<span class="da-meta-mute">Stremio</span>'}</span>
      </div>`;
    }).join('');
  }

  window.MEBLiveUI = {
    normUrl,
    esc,
    formatLiveMetaLine,
    filterLiveByServer,
    renderLiveRows,
  };
})();