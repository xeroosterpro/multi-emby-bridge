// ─── Payments + billing audit trail persistence ────────────────────────────
// makePayments(db): record going-forward payments (idempotent on paypal_sale_id)
// and append/read billing_events. All methods no-op-safe under a fake DB in tests.
function makePayments(db) {
  return {
    async record({ userId, paypalSaleId = null, amount = null, currency = 'USD', status = 'completed', paidAt = null }) {
      await db.query(
        `INSERT INTO payments(user_id, paypal_sale_id, amount, currency, status, paid_at)
         VALUES($1,$2,$3,$4,$5,COALESCE($6, now()))
         ON CONFLICT (paypal_sale_id) DO NOTHING`,
        [userId, paypalSaleId, amount, currency, status, paidAt]
      );
    },
    async listForUser(userId) {
      const r = await db.query(
        `SELECT id, amount, currency, status, paid_at FROM payments WHERE user_id=$1 ORDER BY paid_at DESC`,
        [userId]
      );
      return r.rows;
    },
    async addEvent({ userId, type, detail = {}, actorId = null }) {
      await db.query(
        `INSERT INTO billing_events(user_id, type, detail, actor_id) VALUES($1,$2,$3,$4)`,
        [userId, type, JSON.stringify(detail), actorId]
      );
    },
    async listEvents(userId) {
      const r = await db.query(
        `SELECT id, type, detail, actor_id, created_at FROM billing_events WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100`,
        [userId]
      );
      return r.rows;
    },
  };
}

module.exports = { makePayments };
