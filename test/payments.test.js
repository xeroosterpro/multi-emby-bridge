// Run with: node test/payments.test.js
const { makePayments } = require('../lib/payments');
let passed = 0, failed = 0;
const A = (c, m) => { c ? (console.log(`  ✓ ${m}`), passed++) : (console.error(`  ✗ ${m}`), failed++); };

function fakeDb() {
  const payments = []; const events = [];
  return {
    async query(text, params) {
      if (/INSERT INTO payments/i.test(text)) {
        const saleId = params[1];
        if (saleId && payments.some(p => p.paypal_sale_id === saleId)) return { rows: [], rowCount: 0 }; // ON CONFLICT DO NOTHING
        payments.push({ user_id: params[0], paypal_sale_id: saleId, amount: params[2], currency: params[3], status: params[4], paid_at: params[5] || new Date().toISOString() });
        return { rows: [], rowCount: 1 };
      }
      if (/SELECT .* FROM payments WHERE user_id/i.test(text)) {
        return { rows: payments.filter(p => p.user_id === params[0]), rowCount: payments.length };
      }
      if (/INSERT INTO billing_events/i.test(text)) {
        events.push({ user_id: params[0], type: params[1], detail: params[2], actor_id: params[3] });
        return { rows: [], rowCount: 1 };
      }
      if (/SELECT .* FROM billing_events WHERE user_id/i.test(text)) {
        return { rows: events.filter(e => e.user_id === params[0]), rowCount: events.length };
      }
      return { rows: [], rowCount: 0 };
    },
    _payments: payments, _events: events,
  };
}

(async () => {
  const db = fakeDb();
  const p = makePayments(db);

  await p.record({ userId: 'u1', paypalSaleId: 'S1', amount: 4, currency: 'USD' });
  A(db._payments.length === 1, 'record inserts a payment');
  await p.record({ userId: 'u1', paypalSaleId: 'S1', amount: 4 }); // duplicate sale id
  A(db._payments.length === 1, 'duplicate paypal_sale_id is ignored (idempotent)');

  const list = await p.listForUser('u1');
  A(list.length === 1, 'listForUser returns the user payments');

  await p.addEvent({ userId: 'u1', type: 'activated', detail: { sub: 'I-1' } });
  await p.addEvent({ userId: 'u1', type: 'admin_override', actorId: 'admin1', detail: { status: 'active' } });
  A(db._events.length === 2, 'addEvent appends billing_events');
  A(db._events[1].actor_id === 'admin1', 'admin event records actor_id');

  const events = await p.listEvents('u1');
  A(events.length === 2, 'listEvents returns the user events');

  console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
})();
