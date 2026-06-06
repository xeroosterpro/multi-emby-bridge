// ─── Tickets page: list, create, thread view, admin actions ─────────────────
(function () {
  const $ = s => document.querySelector(s);
  const fmtDate = d => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const fmtAgo = d => { const s = Math.floor((Date.now() - new Date(d)) / 1000); if (s < 60) return 'just now'; if (s < 3600) return Math.floor(s/60) + 'm ago'; if (s < 86400) return Math.floor(s/3600) + 'h ago'; return Math.floor(s/86400) + 'd ago'; };
  const esc = x => String(x ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

  async function api(path, opts) {
    try {
      const r = await fetch(path, Object.assign({ credentials: 'same-origin', headers: { 'Content-Type': 'application/json' } }, opts || {}));
      return { status: r.status, body: await r.json().catch(() => null) };
    } catch { return { status: 0, body: null }; }
  }

  let _isAdmin = false;
  let _currentTicketId = null;

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

  // ── Ticket list ─────────────────────────────────────────────────────────────
  async function loadTickets() {
    const body = document.getElementById('tkt-list-body');
    if (!body) return;
    body.innerHTML = '<div class="tkt-loading">Loading…</div>';
    const { status, body: tickets } = await api('/api/tickets');
    if (status === 401 || status === 503) {
      body.innerHTML = '<div class="tkt-empty">Sign in to view your tickets.</div>';
      return;
    }
    if (!tickets || !Array.isArray(tickets)) {
      body.innerHTML = '<div class="tkt-empty">Could not load tickets.</div>';
      return;
    }

    // Update home page count
    const hcTickets = document.querySelector('.hhc-discord .hhc-num');
    if (hcTickets) hcTickets.textContent = tickets.filter(t => t.status === 'open').length;
    updateNavBadge(tickets);

    if (tickets.length === 0) {
      body.innerHTML = `<div class="tkt-empty">
        <div class="tkt-empty-icon">🎫</div>
        <div>No tickets yet — click <strong>New Ticket</strong> if you need help.</div>
      </div>`;
      return;
    }

    body.innerHTML = tickets.map(t => `
      <div class="tkt-row ${t.unread > 0 ? 'tkt-row-unread' : ''}" data-id="${esc(t.id)}">
        <div class="tkt-row-status">
          <span class="tkt-dot tkt-dot-${esc(t.status)}"></span>
        </div>
        <div class="tkt-row-info">
          <div class="tkt-row-subject">${esc(t.subject)}${t.unread > 0 ? ` <span class="tkt-unread-pill">${t.unread} new</span>` : ''}</div>
          <div class="tkt-row-meta">
            ${_isAdmin && t.username ? `<span class="tkt-username">${esc(t.username)}</span> · ` : ''}
            <span class="tkt-status-label tkt-status-${esc(t.status)}">${t.status}</span>
            · ${t.message_count} message${t.message_count !== 1 ? 's' : ''}
            · ${fmtAgo(t.updated_at)}
          </div>
        </div>
        <div class="tkt-row-arrow">›</div>
      </div>`).join('');

    body.querySelectorAll('.tkt-row').forEach(row => {
      row.addEventListener('click', () => openThread(row.dataset.id));
    });
  }

  // ── Thread view ─────────────────────────────────────────────────────────────
  async function openThread(id) {
    _currentTicketId = id;
    const listView = document.getElementById('tkt-list-view');
    const threadView = document.getElementById('tkt-thread-view');
    if (!listView || !threadView) return;

    threadView.style.display = 'block';
    listView.style.display = 'none';

    const header = document.getElementById('tkt-thread-header');
    const messages = document.getElementById('tkt-messages');
    if (header) header.innerHTML = '<div class="tkt-loading">Loading…</div>';
    if (messages) messages.innerHTML = '';

    const { status, body: ticket } = await api(`/api/tickets/${id}`);
    if (!ticket || status !== 200) {
      if (header) header.innerHTML = '<div class="tkt-empty">Could not load ticket.</div>';
      return;
    }

    if (header) header.innerHTML = `
      <div class="tkt-thread-subject">${esc(ticket.subject)}</div>
      <div class="tkt-thread-meta">
        ${_isAdmin ? `<span class="tkt-username">${esc(ticket.username)}</span> · ` : ''}
        <span class="tkt-status-label tkt-status-${esc(ticket.status)}">${ticket.status}</span>
        · opened ${fmtDate(ticket.created_at)}
      </div>`;

    if (messages) {
      messages.innerHTML = (ticket.messages || []).map(m => `
        <div class="tkt-msg ${m.is_admin ? 'tkt-msg-admin' : 'tkt-msg-user'}">
          <div class="tkt-msg-head">
            <span class="tkt-msg-author">${esc(m.username)}${m.is_admin ? ' <span class="tkt-admin-tag">Staff</span>' : ''}</span>
            <span class="tkt-msg-time">${fmtDate(m.created_at)}</span>
          </div>
          <div class="tkt-msg-body">${esc(m.body).replace(/\n/g, '<br>')}</div>
        </div>`).join('');
      messages.scrollTop = messages.scrollHeight;
    }

    // Admin controls
    const adminActions = document.getElementById('tkt-admin-actions');
    if (adminActions) {
      adminActions.innerHTML = '';
      if (_isAdmin) {
        const toggleBtn = document.createElement('button');
        toggleBtn.className = 'btn-soft';
        toggleBtn.type = 'button';
        toggleBtn.textContent = ticket.status === 'open' ? 'Close Ticket' : 'Reopen Ticket';
        toggleBtn.addEventListener('click', async () => {
          const newStatus = ticket.status === 'open' ? 'closed' : 'open';
          const r = await api(`/api/tickets/${id}`, { method: 'PATCH', body: JSON.stringify({ status: newStatus }) });
          if (r.status === 200) { ticket.status = newStatus; openThread(id); loadTickets(); }
        });
        adminActions.appendChild(toggleBtn);
      }
      const replyBox = document.getElementById('tkt-reply-box');
      if (replyBox) replyBox.style.display = ticket.status === 'closed' && !_isAdmin ? 'none' : 'block';
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
        loadTickets();
      } else {
        if (err) err.textContent = (r.body && r.body.error) || 'Failed to send.';
      }
    });

    // Ctrl+Enter to submit
    $('#tkt-reply-body')?.addEventListener('keydown', e => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') submitBtn.click();
    });
  }

  // ── New ticket form ─────────────────────────────────────────────────────────
  function setupNewTicket() {
    const newBtn = document.getElementById('tkt-new-btn');
    const form = document.getElementById('tkt-form');
    const cancelBtn = document.getElementById('tkt-cancel');
    const submitBtn = document.getElementById('tkt-submit');

    newBtn?.addEventListener('click', () => {
      if (form) { form.style.display = form.style.display === 'none' ? 'block' : 'none'; }
    });
    cancelBtn?.addEventListener('click', () => {
      if (form) form.style.display = 'none';
      const err = document.getElementById('tkt-err'); if (err) err.textContent = '';
    });
    submitBtn?.addEventListener('click', async () => {
      const subject = $('#tkt-subject')?.value?.trim();
      const body = $('#tkt-body')?.value?.trim();
      const err = document.getElementById('tkt-err');
      if (!subject) { if (err) err.textContent = 'Subject is required.'; return; }
      if (!body) { if (err) err.textContent = 'Please describe your issue.'; return; }
      if (err) err.textContent = '';
      submitBtn.disabled = true; submitBtn.textContent = 'Submitting…';
      const r = await api('/api/tickets', { method: 'POST', body: JSON.stringify({ subject, body }) });
      submitBtn.disabled = false; submitBtn.textContent = 'Submit Ticket';
      if (r.status === 200 && r.body) {
        if ($('#tkt-subject')) $('#tkt-subject').value = '';
        if ($('#tkt-body')) $('#tkt-body').value = '';
        if (form) form.style.display = 'none';
        if (window.toast) window.toast('Ticket submitted!');
        await loadTickets();
        openThread(r.body.id);
      } else {
        if (err) err.textContent = (r.body && r.body.error) || 'Could not create ticket.';
      }
    });

    // Ctrl+Enter in body
    $('#tkt-body')?.addEventListener('keydown', e => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') submitBtn?.click();
    });
  }

  // ── Back button ─────────────────────────────────────────────────────────────
  document.getElementById('tkt-back')?.addEventListener('click', () => {
    document.getElementById('tkt-list-view').style.display = 'block';
    document.getElementById('tkt-thread-view').style.display = 'none';
    _currentTicketId = null;
    loadTickets();
  });

  // ── Re-load when page becomes active ───────────────────────────────────────
  const origShow = window.onPageShow;
  window.onPageShow = function (name) {
    if (origShow) origShow(name);
    if (name === 'tickets') {
      document.getElementById('tkt-list-view').style.display = 'block';
      document.getElementById('tkt-thread-view').style.display = 'none';
      document.getElementById('tkt-form') && (document.getElementById('tkt-form').style.display = 'none');
      _currentTicketId = null;
      loadTickets();
    }
  };

  // ── Guide page: wire internal links ────────────────────────────────────────
  function setupGuideLinks() {
    document.querySelectorAll('.guide-link[data-page], .guide-back[data-page]').forEach(el => {
      el.addEventListener('click', e => { e.preventDefault(); location.hash = '#/' + el.dataset.page; });
    });
  }

  // ── Boot ───────────────────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', async () => {
    setupNewTicket();
    setupReply();
    setupGuideLinks();

    // Detect admin role for UI decisions
    try {
      const r = await fetch('/api/auth/me', { credentials: 'same-origin' });
      const d = await r.json().catch(() => null);
      if (d && d.user && d.user.role === 'admin') _isAdmin = true;
    } catch {}

    // Pre-load ticket count for nav badge on home page load
    const { body: tickets } = await api('/api/tickets');
    if (Array.isArray(tickets)) updateNavBadge(tickets);
  });
})();
