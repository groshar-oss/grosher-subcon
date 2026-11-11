// בדיקות יחידה לפרויקט יזם (חבילה 12): node tests/dev-unit.mjs
import assert from 'node:assert/strict';
import { devSummary, devAlerts, baselineSnapshot, isDev } from '../js/dev.js';
import { demoData } from '../js/demo.js';
import { demoClients } from '../js/demo-clients.js';
let i = 0; const uuid = () => 'id-' + (++i);
let passed = 0; const test = (name, fn) => { try { fn(); passed++; } catch (e) { console.error('FAIL', name, '\n', e); process.exitCode = 1; } };
const near = (a, b, eps = 0.6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
const T = demoData(uuid);
const p = T.projects.find(isDev);
const f = k => T[k].filter(x => x.project_id === p.id);
const ALL = () => ({ project: p, items: f('boq_items'), contracts: f('contracts'), cLines: f('contract_lines'), expenses: f('expenses'), cos: f('change_orders'), coLines: f('co_lines'), cbills: f('cbills'), cbLines: f('cbill_lines') });
const S = devSummary(ALL());
const row = code => S.rows.find(r => r.item.code === code);

test('demo has a dev tenant and project', () => { assert.ok(p); assert.equal(T.tenants.length, 2); });
test('budget total', () => near(S.total.budget, f('boq_items').reduce((a, x) => a + x.qty * x.unit_price, 0)));
test('item with contract: forecast = committed', () => { const r = row('04.03'); near(r.committed, 1450 * 5600); near(r.forecast, 1450 * 5600); assert.equal(r.estimate, false); near(r.dev, (5600 - 5400) / 5400 * 100, 0.01); });
test('item without contract: estimate = budget', () => { const r = row('05.03'); assert.equal(r.estimate, true); near(r.forecast, r.budget); });
test('draft contract not committed', () => { const r = row('05.02'); assert.equal(r.committed, 0); near(r.draft, 11800 * 335); assert.equal(r.estimate, true); });
test('forecast not below invoiced (fees paid above budget)', () => { const r = row('02.01'); near(r.forecast, 3410000); assert.ok(r.dev > 6); });
test('line without item goes outside budget', () => { assert.equal(S.outside.length, 1); near(S.outside[0].amount, 1200 * 180); });
test('baseline compare', () => { const r = row('05.02'); near(r.base, 11800 * 300); near(r.budget, 11800 * 330); assert.ok(S.hasBaseline); assert.ok(S.total.devBase > 0); });
test('unallocated expense counted in total', () => { near(S.total.unalloc, 216000 + 96000); });
test('contract rows: invoiced, paid, balance (from contractor bills + approved CO)', () => { const c = S.contracts.find(x => x.contract.number === 'C-04'); near(c.base, 9800 * 1620 + 4200 * 1820 + 1450 * 5600 + 21000 * 158); near(c.coAmt, 120 * 1620 + 18 * 5600); near(c.amount, c.base + c.coAmt); near(c.invoiced, 12026000); near(c.paid, 8108000); near(c.balance, c.amount - 8108000); });
test('total forecast composition', () => near(S.total.forecast, S.rows.reduce((a, r) => a + r.forecast, 0) + S.total.outside + S.total.unalloc));
test('manual forecast wins but not below invoiced', () => {
  const items = f('boq_items').map(x => x.code === '05.03' ? { ...x, forecast_manual: 2000000 } : x.code === '01.01' ? { ...x, forecast_manual: 100 } : x);
  const s = devSummary({ ...ALL(), items });
  near(s.rows.find(r => r.item.code === '05.03').forecast, 2000000); near(s.rows.find(r => r.item.code === '01.01').forecast, 870000 + 145000);
});
test('alerts', () => {
  const A = devAlerts(S, { critPct: 15, vendorsWithContracts: new Set(f('contracts').map(c => c.vendor_name)) });
  const types = A.map(a => a.type);
  for (const t of ['commit_over_budget', 'outside_budget', 'expense_no_item', 'total_over_baseline', 'vendor_no_contract']) assert.ok(types.includes(t), t);
  assert.ok(A.some(a => a.type === 'commit_over_budget' && a.item.code === '06.01'));
  assert.ok(A.some(a => a.type === 'vendor_no_contract' && a.title.includes('עיריית')));
});
test('baseline snapshot skips VO items', () => { const b = baselineSnapshot([{ id: 'a', qty: 2, unit_price: 5 }, { id: 'b', qty: 1, unit_price: 9, variation_id: 'v' }]); assert.deepEqual(b, { items: { a: 10 }, total: 10 }); });
test('demo clients include dev tenant with contracts', () => { const D = demoClients(uuid); assert.equal(D.tenants.length, 4); assert.ok(D.contracts.length >= 7); assert.ok(D.contract_lines.length >= 10); });

// ===== חבילה 13: הוראות שינוי וחשבונות קבלנים =====
import { contractBills, devFlow, flowAlerts, coTotals, coPrice, dupInvoice, docGate, coApproved } from '../js/devflow.js';
const C4 = f('contracts').find(c => c.number === 'C-04');
const R4 = () => contractBills({ contract: C4, cLines: f('contract_lines'), cos: f('change_orders'), coLines: f('co_lines'), bills: f('cbills'), bLines: f('cbill_lines') });
test('bill chain: prev = approved cumulative of previous bill', () => { const R = R4(); assert.equal(R.bills.length, 4); near(R.bills[0].gross, 3662000); near(R.bills[1].gross, 8108000 - 3662000); near(R.bills[2].grossCum, 12026000); near(R.bills[2].cut, 100 * 1620); });
test('bill 4: gross, claimed, retention, advance, net', () => { const b = R4().bills[3]; near(b.gross, 4449200); near(b.claimed, 4959900); near(b.retention, 4449200 * 0.05); near(b.advance, 444920); near(b.net, 3781820); near(b.vat, 3781820 * 0.18); });
test('bill 4 flags: price diff + unapproved CO (not paid)', () => { const b = R4().bills[3]; const t = b.flags.map(x => x.type).sort(); assert.deepEqual(t, ['price_diff', 'unapproved_co']); const r = b.rows.find(r => r.co?.number === 'CO-02'); assert.equal(r.amtCur, 0); assert.ok(r.blocked); });
test('approved price = contract price even when contractor asks more', () => { const r = R4().bills[3].rows.find(r => r.code === '04.03'); near(r.amtCur, (820 - 640) * 5600); near(r.claimedCur, 820 * 5750 - 640 * 5600); });
test('advance offset capped by advance left', () => {
  const c = { id: 'k', retention_pct: 0, advance_amount: 100, advance_offset_pct: 50 }, cl = [{ id: 'l', contract_id: 'k', qty: 10, unit_price: 100 }];
  const bills = [{ id: 'b1', contract_id: 'k', number: 1 }, { id: 'b2', contract_id: 'k', number: 2 }], bl = [{ cbill_id: 'b1', contract_line_id: 'l', cum_qty_sub: 1 }, { cbill_id: 'b2', contract_line_id: 'l', cum_qty_sub: 5 }];
  const R = contractBills({ contract: c, cLines: cl, bills, bLines: bl }); near(R.bills[0].advance, 50); near(R.bills[1].advance, 50); near(R.bills[1].net, 400 - 50);
});
test('over qty and over contract flags', () => {
  const c = { id: 'k' }, cl = [{ id: 'l', contract_id: 'k', qty: 10, unit_price: 100 }];
  const R = contractBills({ contract: c, cLines: cl, bills: [{ id: 'b', contract_id: 'k', number: 1 }], bLines: [{ cbill_id: 'b', contract_line_id: 'l', cum_qty_sub: 12 }] });
  assert.deepEqual(R.bills[0].flags.map(x => x.type).sort(), ['over_contract', 'over_qty']);
});
test('indexation diff', () => { const c = { id: 'k', indexation: true, base_index: 100 }, cl = [{ id: 'l', contract_id: 'k', qty: 10, unit_price: 100 }];
  const R = contractBills({ contract: c, cLines: cl, bills: [{ id: 'b', contract_id: 'k', number: 1, index_value: 104 }], bLines: [{ cbill_id: 'b', contract_line_id: 'l', cum_qty_sub: 5 }] }); near(R.bills[0].indexDiff, 20); });
test('CO totals and 4 prices', () => { const co = f('change_orders').find(c => c.number === 'CO-01'); const t = coTotals(co, f('co_lines')); near(t.requested, 120 * 1700 + 18 * 5900); near(t.approved, 120 * 1620 + 18 * 5600); near(t.sale, 120 * 1650 + 18 * 5400); near(t.gapSale, t.sale - t.approved); assert.equal(coPrice({ price_contract: 7 }), 7); assert.equal(coPrice({ price_contract: 7, price_approved: 5 }), 5); assert.equal(coPrice({}), null); });
test('CO stages + alerts', () => {
  const F = devFlow(ALL()); const st = Object.fromEntries(F.cos.map(x => [x.co.number, x.stage]));
  assert.deepEqual(st, { 'CO-01': 'executed', 'CO-02': 'executed', 'CO-03': 'pricing', 'CO-04': 'approved', 'CO-05': 'rejected' });
  const A = flowAlerts(F, { today: '2026-10-29' }); const t = a => A.filter(x => x.type === a).map(x => x.co?.number || x.bill?.number);
  assert.deepEqual(t('co_exec_unapproved'), ['CO-02']); assert.deepEqual(t('co_needs_analysis'), ['CO-03']); assert.deepEqual(t('co_not_billed'), ['CO-04']); assert.equal(t('cbill_open').length, 2);
  assert.equal(flowAlerts(F, { today: '2026-08-01' }).filter(x => x.type === 'co_not_billed').length, 0);
});
test('CO becomes billed then paid with bill 4', () => {
  const D = ALL(); D.cbills = D.cbills.map(b => b.number === 4 && b.contract_id === C4.id ? { ...b, status: 'approved' } : b);
  let x = devFlow(D).cos.find(x => x.co.number === 'CO-01'); assert.equal(x.stage, 'billed'); assert.equal(x.billing.firstBill.number, 4);
  D.cbills = D.cbills.map(b => b.number === 4 && b.contract_id === C4.id ? { ...b, status: 'paid' } : b);
  x = devFlow(D).cos.find(x => x.co.number === 'CO-01'); assert.equal(x.stage, 'paid');
  const s = devSummary(D); near(s.contracts.find(c => c.contract.id === C4.id).invoiced, 12026000 + 4449200);
});
test('CO double billing flagged', () => {
  const D = ALL(); const l = D.co_lines || D.coLines; const coL = l.find(x => x.description.startsWith('בטון נוסף'));
  D.cbLines = D.cbLines.map(b => b.co_line_id === coL.id ? { ...b, cum_qty_sub: 240 } : b);
  const F = devFlow(D); assert.ok(F.cos.find(x => x.co.number === 'CO-01').billing.over);
  assert.ok(flowAlerts(F, {}).some(a => a.type === 'co_over_billed'));
});
test('approved CO raises committed of its item; pending shown apart', () => { const r = row('04.01'); near(r.committed, 9800 * 1620 + 120 * 1620 + 18 * 5600); near(r.co, 120 * 1620 + 18 * 5600); near(row('04.02').coPending, 35 * 1950); near(S.total.coPending, 35 * 1950 + 140 * 780); });
test('item invoiced from last approved bill, paid from last paid bill', () => { near(row('04.01').invoiced, 4200 * 1620); near(row('04.01').paid, 3000 * 1620); near(row('04.04').invoiced, 0); });
test('expenses from bills not double counted', () => { assert.ok(f('expenses').some(e => e.cbill_id)); near(S.total.unalloc, 216000 + 96000); });
test('duplicate invoice', () => {
  const cs = [{ id: 'a', vendor_name: 'X' }, { id: 'b', vendor_name: 'Y' }];
  const bills = [{ id: '1', contract_id: 'a', number: 1, invoice_no: '55' }, { id: '2', contract_id: 'a', number: 2, invoice_no: '55' }, { id: '3', contract_id: 'b', number: 1, invoice_no: '55' }];
  assert.ok(dupInvoice(bills[1], cs[0], bills, cs, [])); assert.equal(dupInvoice(bills[2], cs[1], bills, cs, []), null);
  assert.ok(dupInvoice({ id: '9', invoice_no: '77' }, cs[1], bills, cs, [{ doc_no: '77', supplier_name: 'Y' }]));
});
test('doc gate', () => { assert.deepEqual(docGate({ invoice_legal: true }, { missing: [], expired: [] }), []); const g = docGate({ invoice_legal: false }, { missing: ['tax'], expired: [{ doc_type: 'insurance' }] }); assert.equal(g.length, 3); });
test('CO approved needs date', () => { assert.equal(coApproved({ stage: 'approved' }), false); assert.equal(coApproved({ stage: 'executed', approved_date: '2026-01-01' }), true); assert.equal(coApproved({ stage: 'rejected', approved_date: '2026-01-01' }), false); });

// ===== חבילה 14: הכנסות ותזרים יזם =====
import { devCashflow, devCashAlerts } from '../js/devcash.js';
const TEN = T.tenants.find(x => x.id === p.tenant_id);
const CF = (o = {}) => devCashflow([{ project: p, s: S, pd: { income: f('dev_income'), expenses: f('expenses'), contracts: f('contracts') } }], { settings: TEN.settings, today: '2026-10-30', ahead: 12, ...o });
test('cash: opening anchored to bank balance', () => { const c = CF(); near(c.opening, 4500000); assert.equal(c.cur, '2026-10'); });
test('cash: received income in past month, overdue income in current month', () => { const c = CF(); const sep = c.months.find(m => m.m === '2026-09'); near(sep.rows.in_bank, 6000000); const oct = c.months.find(m => m.m === '2026-10'); near(oct.rows.in_buyer, 480000); assert.ok(oct.items.some(i => i.late)); });
test('cash: approved unpaid bill due by contract terms', () => { const c = CF(); const tot = c.months.reduce((a, m) => a + m.rows.out_open, 0); const unpaid = f('expenses').filter(e => ['approved', 'invoice'].includes(e.status)).reduce((a, e) => a + e.amount * 1.18, 0); near(tot, unpaid, 5); });
test('cash: future spend = contract balance + rest, with VAT', () => { const c = CF({ ahead: 24 }); const fut = c.months.reduce((a, m) => a + m.rows.out_contract + m.rows.out_rest, 0);
  const exp = S.contracts.filter(x => ['signed', 'closed'].includes(x.contract.status)).reduce((a, x) => a + Math.max(0, x.amount - x.invoiced), 0) + S.rows.reduce((a, r) => a + Math.max(0, r.forecast - Math.max(r.committed, r.invoiced)), 0);
  assert.ok(fut > exp * 1.18 * 0.85 && fut <= exp * 1.18 + 1, `${fut} vs ${exp * 1.18}`); });
test('cash: alerts out>in and below min', () => { const A = devCashAlerts(CF()); const t = A.map(a => a.type); assert.ok(t.includes('cash_out_over_in')); assert.ok(t.includes('cash_below_min')); assert.ok(t.includes('income_overdue')); });
test('cash: income delay shifts expected income', () => { const a = CF(), b = CF({ incomeDelay: 60 }); near(a.months.find(m => m.m === '2026-11').rows.in_buyer, 900000); near(b.months.find(m => m.m === '2027-01').rows.in_buyer, 900000 + 0); near(b.months.find(m => m.m === '2026-11').rows.in_buyer, 0); });
test('cash: schedule delay stretches spend and adds delay cost', () => { const a = CF(), b = CF({ schedDelay: 3, delayCost: 100000, ahead: 24 });
  assert.ok(b.months.find(m => m.m === '2026-12').rows.out_contract < a.months.find(m => m.m === '2026-12').rows.out_contract);
  near(b.months.reduce((x, m) => x + m.rows.out_delay, 0), 300000 * 1.18); assert.equal(a.months.reduce((x, m) => x + m.rows.out_delay, 0), 0); });
test('cash: VAT included once in expenses', () => { const c = CF(); const jul = c.months.find(m => m.m === '2026-07'); const paid = f('expenses').filter(e => e.status === 'paid' && (e.pay_date || e.doc_date).startsWith('2026-07')).reduce((a, e) => a + e.amount * 1.18, 0); near(jul.rows.out_paid, paid, 2); });
console.log(passed + ' dev tests passed');
