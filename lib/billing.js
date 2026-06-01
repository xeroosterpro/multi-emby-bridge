// ─── Billing: subscription access rule, comps, discount codes ───────────────
// Source of truth for access. PayPal (Phase 5 routes) writes status here; the
// /u/:token gate reads hasAccess(). Comps + codes work without PayPal.
function makeBilling(db) {
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
    async comp(userId) {
      await db.query(
        `INSERT INTO subscriptions(user_id, provider, status, updated_at)
         VALUES($1,'comp','comped',now())
         ON CONFLICT (user_id) DO UPDATE SET provider='comp', status='comped', updated_at=now()`,
        [userId]
      );
    },
    async cancel(userId) {
      await db.query(`UPDATE subscriptions SET status='cancelled', updated_at=now() WHERE user_id=$1`, [userId]);
    },
    async setStatusFromPaypal(userId, paypalSubId, status, periodEnd) {
      await db.query(
        `INSERT INTO subscriptions(user_id, provider, paypal_subscription_id, status, current_period_end, updated_at)
         VALUES($1,'paypal',$2,$3,$4,now())
         ON CONFLICT (user_id) DO UPDATE SET provider='paypal', paypal_subscription_id=$2, status=$3, current_period_end=$4, updated_at=now()`,
        [userId, paypalSubId, status, periodEnd || null]
      );
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
    // Returns { applied:true, type } or { applied:false, reason }.
    async redeemCode(userId, code) {
      const r = await db.query('SELECT * FROM discount_codes WHERE code=$1', [String(code || '').toUpperCase()]);
      if (!r.rowCount) return { applied: false, reason: 'invalid code' };
      const c = r.rows[0];
      if (!c.active) return { applied: false, reason: 'code inactive' };
      if (c.max_uses != null && c.uses >= c.max_uses) return { applied: false, reason: 'code fully used' };
      await db.query('UPDATE discount_codes SET uses=uses+1 WHERE code=$1', [c.code]);
      if (c.type === 'comp_100') { await this.comp(userId); return { applied: true, type: c.type, comped: true }; }
      // percent_50 / first_month_free affect PayPal checkout pricing (handled at subscribe time)
      return { applied: true, type: c.type, comped: false };
    },
  };
}

module.exports = { makeBilling };
