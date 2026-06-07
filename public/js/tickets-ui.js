// ─── Tickets page: split-pane inbox, filters, thread, admin actions ─────────
(function () {
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const fmtDate = d => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const fmtAgo = d => {
    const s = Math.floor((Date.now() - new Date(d)) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + 'm ago';
    if (s < 86400) return Math.floor(s / 3600) + 'h ago';
    return Math.floor(s / 86400) + 'd ago';
  };
  const esc = x => String(x ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const STATUS_LABEL = { open: 'Open', in_progress: 'In Progress', closed: 'Closed', resolved: 'Resolved' };
  const CAT_LABEL = { general: 'General', streaming: 'Streaming', servers: 'Servers', billing: 'Billing', bug: 'Bug', feature: 'Feature' };
  const PRI_LABEL = { low: 'Low', normal: 'Normal', high: 'High', urgent: 'Urgent' };

  async function api(path, opts) {
    try {
      const r = await fetch(path, Object.assign({ credentials: 'same-origin', headers: { 'Content-Type': 'application/json' } }, opts || {}));
      return { status: r.status, body: await r.json().catch(() => null) };
    } catch { return { status: 0, body: null }; }
  }

  let _isAdmin = false;
  let _currentUserId = null;
  let _currentTicketId = null;
  let _filterStatus = 'all';
  let _filterCategory = 'all';
  let _searchQ = '';
  let _searchTimer = null;
  let _allTickets = [];

  function ticketCode(id) {
    return id ? 'TKT-' + String(id).replace(/-/g, '').substring(0, 6).toUpperCase() : '';
  }

  // ── Badge on nav item ───────────────────────────────────────────────────────
  function updateNavBadge(tickets) {
    const badge = document.getElementById('nav-ticket-count');
    if (!badge) return;
    const unread = tickets.filter(t => t.unread > 0).length;
    if (unread > 0) {
      badge.textContent = unread;
      badge.style.display = 'inline-flex';
    } else {
      badge.style.display = 'none';
    }
  }

  async function loadStats() {
    const { status, body: stats } = await api('/api/tickets/stats');
    if (status !== 200 || !stats) return;
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set('tkt-stat-open', stats.open);
    set('tkt-stat-progress', stats.in_progress);
    set('tkt-stat-closed', stats.closed);
    set('tkt-stat-awaiting', stats.awaiting);
  }

  function buildQuery() {
    const p = new URLSearchParams();
    if (_filterStatus && _filterStatus !== 'all') p.set('status', _filterStatus);
    if (_filterCategory && _filterCategory !== 'all') p.set('category', _filterCategory);
    if (_searchQ.trim()) p.set('q', _searchQ.trim());
    const qs = p.toString();
    return qs ? `/api/tickets?${qs}` : '/api/tickets';
  }

  function filterClientSide(tickets) {
    if (_filterStatus !== 'awaiting') return tickets;
    return tickets.filter(t => t.unread > 0 && (t.status === 'open' || t.status === 'in_progress'));
  }

  function canDeleteTicket(ticket) {
    if (!ticket) return false;
    if (_isAdmin) return true;
    if (!_currentUserId) return false;
    if (ticket.user_id) return ticket.user_id === _currentUserId;
    return true;
  }

  function ticketRowHTML(t) {
    const code = ticketCode(t.id);
    const status = t.status || 'open';
    const statusLabel = STATUS_LABEL[status] || status;
    const catLabel = CAT_LABEL[t.category] || t.category || 'General';
    const pri = t.priority && t.priority !== 'normal' ? t.priority : '';
    const active = t.id === _currentTicketId ? ' tkt-row-active' : '';
    const av = t.username ? esc(t.username[0].toUpperCase()) : '?';
    const del = canDeleteTicket(t)
      ? `<button class="tkt-row-delete" type="button" data-del="${esc(t.id)}" title="Delete ticket" aria-label="Delete ticket">×</button>`
      : '';
    return `
      <div class="tkt-row${t.unread > 0 ? ' tkt-row-unread' : ''}${active}" data-id="${esc(t.id)}">
        <div class="tkt-row-top">
          <span class="tkt-row-av">${av}</span>
          <div class="tkt-row-main">
            <div class="tkt-row-subject-line">
              ${pri ? `<span class="tkt-pri tkt-pri-${esc(pri)}">${esc(PRI_LABEL[pri] || pri)}</span>` : ''}
              <span class="tkt-subject">${esc(t.subject)}</span>
              ${t.unread > 0 ? `<span class="tkt-unread-pill">${t.unread}</span>` : ''}
            </div>
            <div class="tkt-row-preview">${code} · ${esc(catLabel)} · ${t.message_count || 0} msg${(t.message_count || 0) !== 1 ? 's' : ''}</div>
          </div>
          <span class="tkt-status-pill tkt-status-${esc(status)}">${esc(statusLabel)}</span>
          ${del}
        </div>
        <div class="tkt-row-foot">
          ${_isAdmin && t.username ? `<span class="tkt-by">${esc(t.username)}</span> · ` : ''}
          <span class="tkt-updated">${fmtAgo(t.updated_at)}</span>
        </div>
      </div>`;
  }

  function wireTicketRows(root) {
    root.querySelectorAll('.tkt-row').forEach(row => {
      row.addEventListener('click', () => openThread(row.dataset.id));
    });
    root.querySelectorAll('.tkt-row-delete').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        deleteTicket(btn.dataset.del);
      });
    });
  }

  async function deleteTicket(id) {
    const t = _allTickets.find(x => x.id === id);
    const label = t?.subject || 'this ticket';
    if (!confirm(`Delete “${label}”? This cannot be undone.`)) return;
    const r = await api(`/api/tickets/${id}`, { method: 'DELETE' });
    if (r.status === 200) {
      if (window.toast) window.toast('Ticket deleted');
      if (_currentTicketId === id) {
        _currentTicketId = null;
        showDetailPanel(false);
      }
      await loadTickets();
    } else if (window.toast) {
      window.toast((r.body && r.body.error) || 'Could not delete ticket');
    }
  }

  // ── Ticket list ─────────────────────────────────────────────────────────────
  async function loadTickets(selectId) {
    const body = document.getElementById('tkt-list-body');
    if (!body) return;
    body.innerHTML = '<div class="tkt-loading">Loading tickets…</div>';

    const [{ status, body: tickets }, _] = await Promise.all([
      api(buildQuery()),
      loadStats(),
    ]);

    if (status === 401 || status === 503) {
      document.getElementById('tkt-new-btn')?.style.setProperty('display', 'none');
      body.innerHTML = '<div class="tkt-empty">Sign in using the account icon in the sidebar to view and open support tickets.</div>';
      return;
    }
    if (!tickets || !Array.isArray(tickets)) {
      body.innerHTML = '<div class="tkt-empty">Could not load tickets.</div>';
      return;
    }

    _allTickets = tickets;
    const hcTickets = document.querySelector('.hhc-discord .hhc-num');
    if (hcTickets) hcTickets.textContent = tickets.filter(t => t.status === 'open').length;
    updateNavBadge(tickets);

    const shown = filterClientSide(tickets);
    const countEl = document.getElementById('tkt-list-count');
    if (countEl) countEl.textContent = `${shown.length} ticket${shown.length !== 1 ? 's' : ''}`;

    if (shown.length === 0) {
      body.innerHTML = `<div class="tkt-empty">
        <div class="tkt-empty-icon">🎫</div>
        <div>No tickets match your filters.</div>
        <button class="btn-soft tkt-empty-btn" type="button" id="tkt-empty-new">+ New Ticket</button>
      </div>`;
      document.getElementById('tkt-empty-new')?.addEventListener('click', openModal);
      return;
    }

    body.innerHTML = shown.map(ticketRowHTML).join('');
    wireTicketRows(body);

    if (selectId) openThread(selectId);
    else if (_currentTicketId && shown.some(t => t.id === _currentTicketId)) {
      highlightRow(_currentTicketId);
    } else if (window.matchMedia('(min-width: 900px)').matches && shown.length && !_currentTicketId) {
      openThread(shown[0].id);
    }
  }

  function highlightRow(id) {
    $$('.tkt-row').forEach(r => r.classList.toggle('tkt-row-active', r.dataset.id === id));
  }

  function showDetailPanel(showThread) {
    const empty = document.getElementById('tkt-detail-empty');
    const thread = document.getElementById('tkt-thread-view');
    const isMobile = !window.matchMedia('(min-width: 900px)').matches;
    if (empty) empty.style.display = showThread ? 'none' : 'flex';
    if (thread) {
      thread.style.display = showThread ? 'flex' : 'none';
      if (showThread) requestAnimationFrame(() => thread.classList.add('is-visible'));
      else thread.classList.remove('is-visible');
    }
    if (isMobile && showThread) {
      document.getElementById('tkt-list-panel')?.classList.add('tkt-mobile-hidden');
    } else {
      document.getElementById('tkt-list-panel')?.classList.remove('tkt-mobile-hidden');
    }
  }

  // ── Thread view ─────────────────────────────────────────────────────────────
  async function openThread(id) {
    _currentTicketId = id;
    highlightRow(id);
    showDetailPanel(true);

    const header = document.getElementById('tkt-thread-header');
    const messages = document.getElementById('tkt-messages');
    if (header) header.innerHTML = '<div class="tkt-loading">Loading…</div>';
    if (messages) messages.innerHTML = '';

    const { status, body: ticket } = await api(`/api/tickets/${id}`);
    if (!ticket || status !== 200) {
      if (header) header.innerHTML = '<div class="tkt-empty">Could not load ticket.</div>';
      return;
    }

    const code = ticketCode(ticket.id);
    const statusLabel = STATUS_LABEL[ticket.status] || ticket.status;
    const catLabel = CAT_LABEL[ticket.category] || ticket.category;

    const showDelete = canDeleteTicket(ticket);
    if (header) {
      header.innerHTML = `
        <div class="tkt-thread-top">
          <div>
            <div class="tkt-thread-subject">${esc(ticket.subject)}</div>
            <div class="tkt-thread-meta">
              <span class="tkt-id">${code}</span>
              <span class="tkt-cat-pill">${esc(catLabel)}</span>
              <span class="tkt-status-pill tkt-status-${esc(ticket.status)}">${esc(statusLabel)}</span>
              ${_isAdmin ? `<span class="tkt-thread-user">${esc(ticket.username)}</span>` : ''}
              · opened ${fmtDate(ticket.created_at)}
            </div>
          </div>
          ${showDelete ? `<button class="btn-soft tkt-delete-btn" type="button" id="tkt-delete-btn">Delete ticket</button>` : ''}
        </div>`;
      document.getElementById('tkt-delete-btn')?.addEventListener('click', () => deleteTicket(ticket.id));
    }

    if (messages) {
      messages.innerHTML = (ticket.messages || []).map((m, i) => `
        <div class="tkt-msg ${m.is_admin ? 'tkt-msg-admin' : 'tkt-msg-user'}">
          <div class="tkt-msg-av">${esc((m.username || '?')[0].toUpperCase())}</div>
          <div class="tkt-msg-content">
            <div class="tkt-msg-head">
              <span class="tkt-msg-author">${esc(m.username)}${m.is_admin ? ' <span class="tkt-admin-tag">Staff</span>' : ''}</span>
              <span class="tkt-msg-time">${fmtDate(m.created_at)}</span>
            </div>
            <div class="tkt-msg-body">${esc(m.body).replace(/\n/g, '<br>')}</div>
          </div>
        </div>`).join('');
      messages.scrollTop = messages.scrollHeight;
    }

    renderAdminActions(ticket);
    const replyBox = document.getElementById('tkt-reply-box');
    const closed = ['closed', 'resolved'].includes(ticket.status);
    if (replyBox) replyBox.style.display = closed && !_isAdmin ? 'none' : 'block';

    await refreshList();
  }

  async function refreshList() {
    const body = document.getElementById('tkt-list-body');
    if (!body || !body.querySelector('.tkt-row')) return;
    const [{ status, body: tickets }] = await Promise.all([api(buildQuery()), loadStats()]);
    if (status !== 200 || !Array.isArray(tickets)) return;
    _allTickets = tickets;
    updateNavBadge(tickets);
    const shown = filterClientSide(tickets);
    const countEl = document.getElementById('tkt-list-count');
    if (countEl) countEl.textContent = `${shown.length} ticket${shown.length !== 1 ? 's' : ''}`;
    if (!shown.length) { loadTickets(); return; }

    body.innerHTML = shown.map(ticketRowHTML).join('');
    wireTicketRows(body);
  }

  function renderAdminActions(ticket) {
    const wrap = document.getElementById('tkt-admin-actions');
    if (!wrap) return;
    wrap.innerHTML = '';

    if (_isAdmin) {
      wrap.innerHTML = `
        <select class="pick tkt-action-select" id="tkt-act-status" title="Status">
          <option value="open">Open</option>
          <option value="in_progress">In progress</option>
          <option value="resolved">Resolved</option>
          <option value="closed">Closed</option>
        </select>
        <select class="pick tkt-action-select" id="tkt-act-priority" title="Priority">
          <option value="low">Low</option>
          <option value="normal">Normal</option>
          <option value="high">High</option>
          <option value="urgent">Urgent</option>
        </select>
        <select class="pick tkt-action-select" id="tkt-act-category" title="Category">
          <option value="general">General</option>
          <option value="streaming">Streaming</option>
          <option value="servers">Servers</option>
          <option value="billing">Billing</option>
          <option value="bug">Bug</option>
          <option value="feature">Feature</option>
        </select>`;
      $('#tkt-act-status').value = ticket.status;
      $('#tkt-act-priority').value = ticket.priority || 'normal';
      $('#tkt-act-category').value = ticket.category || 'general';

      const onAdminChange = async () => {
        const r = await api(`/api/tickets/${ticket.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            status: $('#tkt-act-status').value,
            priority: $('#tkt-act-priority').value,
            category: $('#tkt-act-category').value,
          }),
        });
        if (r.status === 200) openThread(ticket.id);
      };
      $('#tkt-act-status')?.addEventListener('change', onAdminChange);
      $('#tkt-act-priority')?.addEventListener('change', onAdminChange);
      $('#tkt-act-category')?.addEventListener('change', onAdminChange);
    } else if (!['closed', 'resolved'].includes(ticket.status)) {
      const btn = document.createElement('button');
      btn.className = 'btn-soft';
      btn.type = 'button';
      btn.textContent = 'Mark resolved';
      btn.addEventListener('click', async () => {
        const r = await api(`/api/tickets/${ticket.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'resolved' }) });
        if (r.status === 200) openThread(ticket.id);
      });
      wrap.appendChild(btn);
    }
  }

  // ── Send reply ──────────────────────────────────────────────────────────────
  function setupReply() {
    const submitBtn = document.getElementById('tkt-reply-submit');
    if (!submitBtn) return;
    submitBtn.addEventListener('click', async () => {
      const body = $('#tkt-reply-body')?.value?.trim();
      const err = document.getElementById('tkt-reply-err');
      if (!body) { if (err) err.textContent = 'Please write a message.'; return; }
      if (err) err.textContent = '';
      submitBtn.disabled = true;
      submitBtn.textContent = 'Sending…';
      const r = await api(`/api/tickets/${_currentTicketId}/reply`, { method: 'POST', body: JSON.stringify({ body }) });
      submitBtn.disabled = false;
      submitBtn.textContent = 'Send Reply';
      if (r.status === 200) {
        const ta = $('#tkt-reply-body'); if (ta) ta.value = '';
        openThread(_currentTicketId);
      } else {
        if (err) err.textContent = (r.body && r.body.error) || 'Failed to send.';
      }
    });
    $('#tkt-reply-body')?.addEventListener('keydown', e => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') submitBtn.click();
    });
  }

  // ── Modal: new ticket ───────────────────────────────────────────────────────
  function openModal() {
    const modal = document.getElementById('tkt-modal');
    if (modal) modal.style.display = 'flex';
    $('#tkt-subject')?.focus();
  }
  function closeModal() {
    const modal = document.getElementById('tkt-modal');
    if (modal) modal.style.display = 'none';
    const err = document.getElementById('tkt-err'); if (err) err.textContent = '';
  }

  function setupNewTicket() {
    document.getElementById('tkt-new-btn')?.addEventListener('click', openModal);
    document.getElementById('tkt-modal-close')?.addEventListener('click', closeModal);
    document.getElementById('tkt-cancel')?.addEventListener('click', closeModal);
    document.getElementById('tkt-modal')?.addEventListener('click', e => {
      if (e.target.id === 'tkt-modal') closeModal();
    });

    const submitBtn = document.getElementById('tkt-submit');
    submitBtn?.addEventListener('click', async () => {
      const subject = $('#tkt-subject')?.value?.trim();
      const body = $('#tkt-body')?.value?.trim();
      const category = $('#tkt-category')?.value || 'general';
      const priority = $('#tkt-priority')?.value || 'normal';
      const err = document.getElementById('tkt-err');
      if (!subject) { if (err) err.textContent = 'Subject is required.'; return; }
      if (!body) { if (err) err.textContent = 'Please describe your issue.'; return; }
      if (err) err.textContent = '';
      submitBtn.disabled = true; submitBtn.textContent = 'Submitting…';
      const payload = { subject, body, category };
      if (_isAdmin) payload.priority = priority;
      const r = await api('/api/tickets', { method: 'POST', body: JSON.stringify(payload) });
      submitBtn.disabled = false; submitBtn.textContent = 'Submit Ticket';
      if (r.status === 200 && r.body) {
        if ($('#tkt-subject')) $('#tkt-subject').value = '';
        if ($('#tkt-body')) $('#tkt-body').value = '';
        closeModal();
        if (window.toast) window.toast('Ticket submitted!');
        _filterStatus = 'all';
        syncTabs();
        await loadTickets(r.body.id);
      } else {
        if (err) err.textContent = (r.body && r.body.error) || 'Could not create ticket.';
      }
    });
    $('#tkt-body')?.addEventListener('keydown', e => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') submitBtn?.click();
    });
  }

  function syncTabs() {
    $$('#tkt-tabs .tkt-tab').forEach(tab => {
      tab.classList.toggle('active', tab.dataset.status === _filterStatus);
    });
  }

  function setupFilters() {
    $$('#tkt-tabs .tkt-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        _filterStatus = tab.dataset.status || 'all';
        syncTabs();
        loadTickets();
      });
    });

    $$('#tkt-stats .tkt-stat').forEach(stat => {
      stat.addEventListener('click', () => {
        const f = stat.dataset.filter;
        if (f === 'awaiting') _filterStatus = 'awaiting';
        else if (f === 'closed') _filterStatus = 'closed';
        else _filterStatus = f;
        syncTabs();
        loadTickets();
      });
    });

    $('#tkt-cat-filter')?.addEventListener('change', e => {
      _filterCategory = e.target.value;
      loadTickets();
    });

    $('#tkt-search')?.addEventListener('input', e => {
      clearTimeout(_searchTimer);
      _searchTimer = setTimeout(() => {
        _searchQ = e.target.value;
        loadTickets();
      }, 280);
    });
  }

  // ── Back button (mobile) ────────────────────────────────────────────────────
  document.getElementById('tkt-back')?.addEventListener('click', () => {
    _currentTicketId = null;
    showDetailPanel(false);
    highlightRow(null);
    document.getElementById('tkt-list-panel')?.classList.remove('tkt-mobile-hidden');
  });

  // ── Page activation ─────────────────────────────────────────────────────────
  const origShow = window.onPageShow;
  window.onPageShow = function (name) {
    if (origShow) origShow(name);
    if (name === 'tickets') activateTicketsPage();
  };

  function activateTicketsPage() {
    closeModal();
    _currentTicketId = null;
    showDetailPanel(false);
    document.getElementById('tkt-list-panel')?.classList.remove('tkt-mobile-hidden');
    let openId = null;
    try {
      if (sessionStorage.getItem('meb_open_ticket')) {
        openId = sessionStorage.getItem('meb_open_ticket');
        sessionStorage.removeItem('meb_open_ticket');
      }
      if (sessionStorage.getItem('meb_new_ticket') === '1') {
        sessionStorage.removeItem('meb_new_ticket');
        loadTickets().then(() => openModal());
        return;
      }
    } catch {}
    loadTickets(openId || undefined);
  }

  function setupGuideLinks() {
    document.querySelectorAll('.guide-link[data-page], .guide-back[data-page]').forEach(el => {
      el.addEventListener('click', e => { e.preventDefault(); location.hash = '#/' + el.dataset.page; });
    });
  }

  document.addEventListener('DOMContentLoaded', async () => {
    setupNewTicket();
    setupReply();
    setupFilters();
    setupGuideLinks();

    try {
      const r = await fetch('/api/auth/me', { credentials: 'same-origin' });
      const d = await r.json().catch(() => null);
      if (d?.user) {
        _currentUserId = d.user.id;
        if (d.user.role === 'admin') {
          _isAdmin = true;
          const pw = document.getElementById('tkt-priority-wrap');
          if (pw) pw.style.display = '';
        }
      }
    } catch {}

    const { body: tickets } = await api('/api/tickets');
    if (Array.isArray(tickets)) updateNavBadge(tickets);

    const hash = (location.hash || '').replace(/^#\/?/, '');
    if (hash === 'tickets') setTimeout(activateTicketsPage, 0);
  });

  window.addEventListener('hashchange', () => {
    if ((location.hash || '').replace(/^#\/?/, '') === 'tickets') setTimeout(activateTicketsPage, 0);
  });
})();