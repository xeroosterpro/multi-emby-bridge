// ─── Billing: subscription access rule, comps, discount codes ───────────────
// Source of truth for access. PayPal (Phase 5 routes) writes status here; the
// /u/:token gate reads hasAccess(). Comps + codes work without PayPal.
function makeBilling(db, events = null) {
  const emit = (userId, type, detail = {}, actorId = null) => {
    if (events && typeof events.addEvent === 'function') {
      Promise.resolve(events.addEvent({ userId, type, detail, actorId })).catch(() => {});
    }
  };
  function rowHasAccess(row) {
    if (!row) return false;
    if (row.status === 'comped') return true;
    if (row.status === 'active') {
      return row.current_period_end ? new Date(row.current_period_end).getTime() > Date.now() : true;
    }
    return false;
  }

  return {
    async get(userId) {
      const r = await db.query('SELECT * FROM subscriptions WHERE user_id=$1', [userId]);
      return r.rowCount ? r.rows[0] : { user_id: userId, status: 'none', current_period_end: null };
    },
    async hasAccess(userId) {
      const r = await db.query('SELECT * FROM subscriptions WHERE user_id=$1', [userId]);
      return rowHasAccess(r.rowCount ? r.rows[0] : null);
    },
    async comp(userId, actorId) {
      await db.query(
        `INSERT INTO subscriptions(user_id, provider, status, updated_at)
         VALUES($1,'comp','comped',now())
         ON CONFLICT (user_id) DO UPDATE SET provider='comp', status='comped', updated_at=now()`,
        [userId]
      );
      emit(userId, 'comped', {}, actorId || null);
    },
    async cancel(userId, actorId) {
      await db.query(`UPDATE subscriptions SET status='cancelled', updated_at=now() WHERE user_id=$1`, [userId]);
      emit(userId, 'cancelled', {}, actorId || null);
    },
    async setStatusFromPaypal(userId, paypalSubId, status, periodEnd) {
      await db.query(
        `INSERT INTO subscriptions(user_id, provider, paypal_subscription_id, status, current_period_end, updated_at)
         VALUES($1,'paypal',$2,$3,$4,now())
         ON CONFLICT (user_id) DO UPDATE SET provider='paypal', paypal_subscription_id=$2, status=$3, current_period_end=$4, updated_at=now()`,
        [userId, paypalSubId, status, periodEnd || null]
      );
      emit(userId, status === 'active' ? 'activated' : status, { paypalSubId, periodEnd });
    },

    async setByPaypalSub(paypalSubId, status, periodEnd) {
      const r = await db.query(
        `UPDATE subscriptions SET status=$2, current_period_end=COALESCE($3, current_period_end), updated_at=now()
         WHERE paypal_subscription_id=$1`,
        [paypalSubId, status, periodEnd || null]
      );
      return r.rowCount > 0;
    },

    // discount codes
    async createCode(code, type, maxUses, createdBy) {
      await db.query(
        `INSERT INTO discount_codes(code, type, max_uses, created_by) VALUES($1,$2,$3,$4)`,
        [String(code).toUpperCase(), type, maxUses || null, createdBy || null]
      );
    },
    async listCodes() {
      const r = await db.query('SELECT code, type, active, max_uses, uses, created_at FROM discount_codes ORDER BY created_at DESC');
      return r.rows;
    },
    async deactivateCode(code) {
      await db.query('UPDATE discount_codes SET active=false WHERE code=$1', [String(code).toUpperCase()]);
    },
    async deleteCode(code) {
      const r = await db.query('DELETE FROM discount_codes WHERE code=$1', [String(code).toUpperCase()]);
      return r.rowCount > 0;
    },
    // Returns { applied:true, type } or { applied:false, reason }.
    async redeemCode(userId, code) {
      const norm = String(code || '').toUpperCase();
      // Per-user guard: claim the (code,user) slot first. ON CONFLICT DO NOTHING
      // returns no row if this user already redeemed this code, so one user can't
      // drain a shared multi-use code by redeeming it repeatedly (SEC-4 residual).
      const claim = await db.query(
        `INSERT INTO discount_redemptions(code, user_id) VALUES($1,$2)
           ON CONFLICT (code, user_id) DO NOTHING RETURNING code`,
        [norm, userId]
      );
      if (!claim.rowCount) {
        const exists = await db.query('SELECT 1 FROM discount_codes WHERE code=$1', [norm]);
        return { applied: false, reason: exists.rowCount ? 'already redeemed' : 'invalid code' };
      }
      // Atomic global claim: the WHERE clause enforces active + remaining uses
      // inside one UPDATE, so concurrent redeems can't push `uses` past `max_uses`.
      const r = await db.query(
        `UPDATE discount_codes SET uses = uses + 1
           WHERE code=$1 AND active=true AND (max_uses IS NULL OR uses < max_uses)
           RETURNING code, type`,
        [norm]
      );
      if (!r.rowCount) {
        // Roll back the per-user claim so a later valid attempt isn't blocked
        // (and so a non-existent/invalid code leaves no phantom redemption).
        await db.query('DELETE FROM discount_redemptions WHERE code=$1 AND user_id=$2', [norm, userId]);
        const cur = await db.query('SELECT active, max_uses, uses FROM discount_codes WHERE code=$1', [norm]);
        if (!cur.rowCount) return { applied: false, reason: 'invalid code' };
        const c = cur.rows[0];
        if (!c.active) return { applied: false, reason: 'code inactive' };
        if (c.max_uses != null && c.uses >= c.max_uses) return { applied: false, reason: 'code fully used' };
        return { applied: false, reason: 'invalid code' };
      }
      const c = r.rows[0];
      if (c.type === 'comp_100') { await this.comp(userId); emit(userId, 'code_redeemed', { code: c.code, type: c.type }); return { applied: true, type: c.type, comped: true }; }
      // percent_50 / first_month_free affect PayPal checkout pricing (handled at subscribe time)
      emit(userId, 'code_redeemed', { code: c.code, type: c.type });
      return { applied: true, type: c.type, comped: false };
    },
  };
}

module.exports = { makeBilling };
