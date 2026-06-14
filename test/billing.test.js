// ─── Unit tests for lib/billing.js (fake DB) ────────────────────────────────
// Run with: node test/billing.test.js
const { makeBilling } = require('../lib/billing');
let passed = 0, failed = 0;
const A = (c, m) => { c ? (console.log(`  ✓ ${m}`), passed++) : (console.error(`  ✗ ${m}`), failed++); };

function fakeDb() {
  const subs = new Map(); const codes = new Map(); const redemptions = new Set();
  return { async query(text, params) {
    if (/INSERT INTO discount_redemptions/i.test(text)) {
      const key = `${params[0]}|${params[1]}`;
      if (redemptions.has(key)) return { rows: [], rowCount: 0 }; // ON CONFLICT DO NOTHING
      redemptions.add(key);
      return { rows: [{ code: params[0] }], rowCount: 1 };
    }
    if (/DELETE FROM discount_redemptions/i.test(text)) {
      redemptions.delete(`${params[0]}|${params[1]}`);
      return { rows: [], rowCount: 1 };
    }
    if (/SELECT 1 FROM discount_codes WHERE code/i.test(text)) {
      const r = codes.get(params[0]); return { rows: r ? [{ '?column?': 1 }] : [], rowCount: r ? 1 : 0 };
    }
    if (/SELECT \* FROM subscriptions WHERE user_id/i.test(text)) { const r = subs.get(params[0]); return { rows: r ? [r] : [], rowCount: r ? 1 : 0 }; }
    if (/INSERT INTO subscriptions/i.test(text)) {
      const uid = params[0];
      if (/'comp','comped'/.test(text)) subs.set(uid, { user_id: uid, status: 'comped', current_period_end: null });
      else subs.set(uid, { user_id: uid, provider: 'paypal', paypal_subscription_id: params[1], status: params[2], current_period_end: params[3] });
      return { rowCount: 1, rows: [] };
    }
    if (/UPDATE subscriptions SET status='cancelled'/i.test(text)) { const r = subs.get(params[0]); if (r) r.status = 'cancelled'; return { rowCount: 1 }; }
    if (/SELECT active, max_uses, uses FROM discount_codes WHERE code/i.test(text)) { const r = codes.get(params[0]); return { rows: r ? [r] : [], rowCount: r ? 1 : 0 }; }
    if (/SELECT \* FROM discount_codes WHERE code/i.test(text)) { const r = codes.get(params[0]); return { rows: r ? [r] : [], rowCount: r ? 1 : 0 }; }
    if (/INSERT INTO discount_codes/i.test(text)) { codes.set(params[0], { code: params[0], type: params[1], active: true, max_uses: params[2], uses: 0 }); return { rowCount: 1 }; }
    // Atomic claim: only succeed when active and under max_uses (mirrors real SQL).
    if (/UPDATE discount_codes SET uses = uses \+ 1/i.test(text)) {
      const c = codes.get(params[0]);
      const ok = c && c.active && (c.max_uses == null || c.uses < c.max_uses);
      if (!ok) return { rows: [], rowCount: 0 };
      c.uses++;
      return { rows: [{ code: c.code, type: c.type }], rowCount: 1 };
    }
    if (/UPDATE discount_codes SET uses=uses\+1/i.test(text)) { const c = codes.get(params[0]); if (c) c.uses++; return { rowCount: 1 }; }
    if (/UPDATE discount_codes SET active=false/i.test(text)) { const c = codes.get(params[0]); if (c) c.active = false; return { rowCount: 1 }; }
    if (/SELECT .* FROM discount_codes ORDER BY/i.test(text)) { return { rows: [...codes.values()], rowCount: codes.size }; }
    if (/INSERT INTO billing_events/i.test(text)) { return { rowCount: 1 }; }
    return { rows: [], rowCount: 0 };
  } };
}

(async () => {
  const b = makeBilling(fakeDb());
  const FUTURE = new Date(Date.now() + 86400000).toISOString();
  const PAST = new Date(Date.now() - 86400000).toISOString();

  A(await b.hasAccess('u1') === false, 'no subscription → no access');
  await b.setStatusFromPaypal('u1', 'I-SUB1', 'active', FUTURE);
  A(await b.hasAccess('u1') === true, 'active + future period → access');
  await b.setStatusFromPaypal('u1', 'I-SUB1', 'active', PAST);
  A(await b.hasAccess('u1') === false, 'active but expired → no access');
  await b.comp('u2');
  A(await b.hasAccess('u2') === true, 'comped → access (no expiry)');
  await b.cancel('u1');
  A(await b.hasAccess('u1') === false, 'cancelled → no access');

  await b.createCode('FAMILY100', 'comp_100', 2, 'admin');
  const res = await b.redeemCode('u3', 'family100'); // case-insensitive
  A(res.applied && res.comped, 'comp_100 code comps the user');
  A(await b.hasAccess('u3') === true, 'redeeming comp code grants access');
  A((await b.redeemCode('u4', 'NOPE')).applied === false, 'invalid code rejected');

  // SEC-4 residual: same user cannot redeem the same code twice
  const dup = await b.redeemCode('u3', 'FAMILY100');
  A(dup.applied === false && dup.reason === 'already redeemed', 'same user cannot re-redeem a code');
  // ...and a different user can still redeem the remaining use
  const u6 = await b.redeemCode('u6', 'FAMILY100');
  A(u6.applied === true, 'a different user can still redeem the remaining use');

  await b.deactivateCode('FAMILY100');
  A((await b.redeemCode('u5', 'FAMILY100')).applied === false, 'deactivated code rejected');

  // events: pass an event sink and verify status changes emit audit rows
  const events = [];
  const b2 = makeBilling(fakeDb(), { addEvent: (e) => events.push(e) });
  await b2.comp('u9');
  A(events.some(e => e.type === 'comped' && e.userId === 'u9'), 'comp emits a comped billing event');
  await b2.cancel('u9');
  A(events.some(e => e.type === 'cancelled'), 'cancel emits a cancelled billing event');

  console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
})();
