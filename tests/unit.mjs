// בדיקות יחידה לחישובים ולקליטת כתב כמויות: node tests/unit.mjs
import assert from 'node:assert/strict';
import * as C from '../js/calc.js';
import { parseBoq, findHeader } from '../js/import.js';
import * as Q from '../js/quota.js';
import * as B from '../js/bills.js';
import * as CF from '../js/cashflow.js';
import * as IN from '../js/intake.js';
import * as PY from '../js/payables.js';
import * as G from '../js/guide.js';

let passed = 0;
const test = (name, fn) => { try { fn(); passed++; } catch (e) { console.error('FAIL', name, '\n', e); process.exitCode = 1; } };
const near = (a, b, eps = 0.01) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test('lineCost material waste', () => {
  near(C.lineCost({ kind: 'material', qty: 1600, unit_cost: 82, waste_pct: 5 }), 137760);
  near(C.lineCost({ kind: 'piece', qty: 1600, unit_cost: 70, waste_pct: 5 }), 112000); // פחת רק לחומר
});
test('itemPlanned with overhead', () => {
  const p = C.itemPlanned([{ kind: 'piece', qty: 10, unit_cost: 100 }], 4);
  near(p.direct, 1000); near(p.total, 1040);
});
test('forecast formula', () => {
  near(C.itemForecast({ planned: 214000, actual: 124100, progressPct: 45 }), 124100 + 117700);
  near(C.itemForecast({ planned: 1000, actual: 0, progressPct: 0 }), 1000);
  near(C.itemForecast({ planned: 1000, actual: 1200, progressPct: 100 }), 1200);
  near(C.itemForecast({ planned: 1000, actual: 50, progressPct: 30, manual: 1500 }), 1500);
  near(C.itemForecast({ planned: 1000, actual: 50, progressPct: 130 }), 50); // מעל 100% נחתך
});
test('overrun levels', () => {
  assert.equal(C.overrunLevel(0).cls, '');
  assert.equal(C.overrunLevel(-2).cls, '');
  assert.equal(C.overrunLevel(0.1).cls, 'al-y');
  assert.equal(C.overrunLevel(3).cls, 'al-y');
  assert.equal(C.overrunLevel(4.2).cls, 'al-o');
  assert.equal(C.overrunLevel(5).cls, 'al-o');
  assert.equal(C.overrunLevel(7).cls, 'al-r');
  assert.equal(C.overrunLevel(13).cls, 'al-dr');
  assert.equal(C.overrunLevel(16, 15).crit, true);
  assert.equal(C.overrunLevel(14, 15).crit, false);
  assert.ok(C.overrunLevel(25).depth > C.overrunLevel(12).depth);
});
test('spend ahead of progress flags item', () => {
  const c = C.itemControl({ qty: 2000, unit_price: 134, progress_pct: 40 }, [{ kind: 'piece', qty: 1, unit_cost: 1000 }], 600, 0);
  assert.equal(c.spendAhead, true);
  near(c.spentPct, 60);
});

const proj = { overhead_pct: 0 };
const items = [
  { id: 'a', qty: 10, unit_price: 100, progress_pct: 50 },
  { id: 'b', qty: 1, unit_price: 500, progress_pct: 0, variation_id: 'v1' },
  { id: 'c', qty: 1, unit_price: 300, progress_pct: 100, variation_id: 'v2' },
  { id: 'd', qty: 1, unit_price: 200, progress_pct: 0, variation_id: 'v3' }
];
const lines = [
  { boq_item_id: 'a', kind: 'piece', qty: 1, unit_cost: 800 },
  { boq_item_id: 'b', kind: 'piece', qty: 1, unit_cost: 400 },
  { boq_item_id: 'c', kind: 'piece', qty: 1, unit_cost: 200 },
  { boq_item_id: 'd', kind: 'piece', qty: 1, unit_cost: 100 }
];
const vos = [{ id: 'v1', status: 'approved' }, { id: 'v2', status: 'executed_unapproved' }, { id: 'v3', status: 'partial', approved_amount: 150 }];

test('profit modes: contract / approved / all', () => {
  const base = { project: proj, items, lines, variations: vos, actualByItem: { a: 500, c: 250 } };
  const s1 = C.projectSummary(base, 'contract');
  near(s1.total.sale, 1000); near(s1.total.forecast, 500 + 400); near(s1.total.profit, 100);
  near(s1.excludedActual, 250); // עלות חריג שלא נכלל לא מוסתרת
  const s2 = C.projectSummary(base, 'approved');
  near(s2.total.sale, 1000 + 500 + 150); // חלקי: הסכום המאושר
  near(s2.total.forecast, 900 + 400 + 100);
  near(s2.excludedActual, 250);
  const s3 = C.projectSummary(base, 'all');
  near(s3.total.sale, 1650 + 300); near(s3.total.forecast, 1400 + 250);
  near(s3.riskAmount, 300); near(s3.excludedActual, 0);
});
test('actuals allocation: item, VO spread, general by planned weight', () => {
  const its = [{ id: 'a' }, { id: 'b' }, { id: 'v', variation_id: 'V' }];
  const ls = [{ boq_item_id: 'a', kind: 'piece', qty: 1, unit_cost: 300 }, { boq_item_id: 'b', kind: 'piece', qty: 1, unit_cost: 100 }, { boq_item_id: 'v', kind: 'piece', qty: 1, unit_cost: 50 }];
  const r = C.actualsByItem(its, ls, [{ boq_item_id: 'a', amount: 10 }, { amount: 400 }, { variation_id: 'V', amount: 20 }], 0);
  near(r.byItem.a, 10 + 300); near(r.byItem.b, 100); near(r.byItem.v, 20); near(r.unallocated, 0);
});

test('import: header, Hebrew codes, chapters, alternatives and summaries skipped', () => {
  const rows = [
    ['כתב כמויות - פרויקט דמו', '', '', '', '', ''],
    ['', '', '', '', '', ''],
    ['סעיף', 'תיאור', "יח'", 'כמות', "מחיר יח'", 'סה"כ'],
    ['פרק א.1', 'מחיצות גבס', '', '', '', ''],
    ['א.1.01', 'קיר גבס 10 ס"מ', 'מ"ר', '1,600', '195', '312,000'],
    ['א.1.02', 'קיר אקוסטי', 'מ"ר', '600', '', ''],
    ['סעיף', 'תיאור', "יח'", 'כמות', "מחיר יח'", 'סה"כ'],
    ['', 'סה"כ פרק א.1', '', '', '', '312,000'],
    ['פרק א.2', 'תקרות', '', '', '', ''],
    ['א.2.01', 'תקרה מינרלית', 'מ"ר', '2000', '134', '268,000'],
    ['', 'חלופות (אינן כלולות)', '', '', '', ''],
    ['ח.1', 'תקרת עץ', 'מ"ר', '100', '900', '90,000'],
    ['', 'ריכוז', '', '', '', '580,000']
  ];
  assert.equal(findHeader(rows).row, 2);
  const p = parseBoq(rows);
  assert.equal(p.items.length, 3);
  assert.equal(p.items[0].code, 'א.1.01');
  assert.equal(p.items[0].chapter, 'פרק א.1 מחיצות גבס');
  assert.equal(p.items[2].chapter, 'פרק א.2 תקרות');
  assert.deepEqual(p.items[1].missing, ['מחיר']);
  near(p.calcTotal, 312000 + 268000);
  near(p.fileTotal, 580000);
});
test('import: price column "עלות יח\'" and total column', () => {
  const rows = [['מס\'', 'תאור', 'יחידה', 'כמות', "עלות יח'", 'סה"כ'], ['1', 'צבע', 'מ"ר', '100', '20', '2000']];
  const p = parseBoq(rows);
  assert.equal(p.map.unit_price, 4); assert.equal(p.map.total, 5);
  near(p.items[0].unit_price, 20);
});

// ===== שלב 3 =====
const S3 = { employer_factor: 1.3, work_days_month: 22, day_hours: 9, quota_warn_pct: 80, quota_gap_pct: 10 };
test('salaried split 12/22 and 10/22 with employer factor', () => {
  const workers = [{ id: 'w', pay_type: 'salary', monthly_salary: 10000 }];
  const entries = [];
  for (let d = 1; d <= 12; d++) entries.push({ id: 'a' + d, worker_id: 'w', project_id: 'A', log_date: `2026-09-${String(d).padStart(2, '0')}`, days: 1 });
  for (let d = 13; d <= 22; d++) entries.push({ id: 'b' + d, worker_id: 'w', project_id: 'B', log_date: `2026-09-${String(d).padStart(2, '0')}`, days: 1 });
  const c = Q.entryCosts({ entries, workers, settings: S3 });
  const sumP = p => entries.filter(e => e.project_id === p).reduce((a, e) => a + c[e.id].cost, 0);
  near(sumP('A'), 13000 * 12 / 22); near(sumP('B'), 13000 * 10 / 22); near(sumP('A') + sumP('B'), 13000);
});
test('salaried partial month is not inflated', () => {
  const workers = [{ id: 'w', pay_type: 'salary', monthly_salary: 10000, cost_factor: 1 }];
  const entries = [{ id: 'x', worker_id: 'w', project_id: 'A', log_date: '2026-10-05', days: 5 }];
  near(Q.entryCosts({ entries, workers, settings: S3 }).x.cost, 10000 * 5 / 22);
});
test('daily and overtime, piece by quantity not hours', () => {
  const workers = [{ id: 'd', pay_type: 'daily', daily_rate: 450 }, { id: 'p', pay_type: 'piece', piece_rate: 0 }];
  const lines = [{ id: 'L', boq_item_id: 'I', kind: 'piece', qty: 1000, unit_cost: 11 }];
  const entries = [{ id: '1', worker_id: 'd', log_date: '2026-10-01', days: 1, ot_hours: 2 }, { id: '2', worker_id: 'p', boq_item_id: 'I', log_date: '2026-10-01', days: 1, ot_hours: 5, piece_qty: 120 }];
  const c = Q.entryCosts({ entries, workers, lines, settings: S3 });
  near(c['1'].cost, 450 + 2 * 450 / 9 * 1.25); near(c['2'].cost, 120 * 11); assert.equal(c['2'].line.id, 'L');
});
test('quota: 2 salaried costed, 3 arrived', () => {
  const items = [{ id: 'I', progress_pct: 40 }];
  const lines = [{ id: 'L', boq_item_id: 'I', kind: 'labor', labor_type: 'salary', crew: 2, qty: 30, unit_cost: 750 }];
  const workers = ['a', 'b', 'c'].map(id => ({ id, pay_type: 'salary', monthly_salary: 9000 }));
  const entries = [];
  ['2026-10-01', '2026-10-02'].forEach(d => ['a', 'b'].forEach(w => entries.push({ id: d + w, worker_id: w, boq_item_id: 'I', log_date: d, days: 1 })));
  ['a', 'b', 'c'].forEach(w => entries.push({ id: '3' + w, worker_id: w, boq_item_id: 'I', log_date: '2026-10-03', days: 1 }));
  const costs = Q.entryCosts({ entries, workers, lines, settings: S3 });
  const [r] = Q.quotaRows({ items, lines, entries, costs, workers, settings: S3 });
  assert.equal(r.status, 'over'); assert.equal(r.crewOver.length, 1); assert.equal(r.crewOver[0].count, 3); near(r.usedQty, 7);
});
test('quota: 8 of 10 daily days used at 50% progress -> early warning', () => {
  const items = [{ id: 'I', progress_pct: 50 }];
  const lines = [{ id: 'L', boq_item_id: 'I', kind: 'labor', labor_type: 'daily', qty: 10, unit_cost: 550 }];
  const workers = [{ id: 'd', pay_type: 'daily', daily_rate: 550 }];
  const entries = Array.from({ length: 8 }, (_, k) => ({ id: 'e' + k, worker_id: 'd', boq_item_id: 'I', log_date: `2026-10-0${k + 1}`, days: 1 }));
  const costs = Q.entryCosts({ entries, workers, lines, settings: S3 });
  const [r] = Q.quotaRows({ items, lines, entries, costs, workers, settings: S3 });
  assert.equal(r.status, 'warn'); near(r.qtyPct, 80); assert.ok(r.msgs.some(m => m.includes('בוצע 50%')));
  const more = entries.concat([8, 9, 10].map(k => ({ id: 'f' + k, worker_id: 'd', boq_item_id: 'I', log_date: '2026-10-1' + k, days: 1 })));
  const [r2] = Q.quotaRows({ items, lines, entries: more, costs: Q.entryCosts({ entries: more, workers, lines, settings: S3 }), workers, settings: S3 });
  assert.equal(r2.status, 'over'); near(r2.usedQty, 11);
});
test('quota: material ordered over planned incl. waste; commitments', () => {
  const items = [{ id: 'I', progress_pct: 45 }];
  const lines = [{ id: 'M', boq_item_id: 'I', kind: 'material', qty: 2000, waste_pct: 5, unit_cost: 61 }];
  const pos = [{ id: 'P1', status: 'delivered' }, { id: 'P2', status: 'open' }, { id: 'P3', status: 'cancelled' }];
  const poLines = [{ po_id: 'P1', boq_item_id: 'I', qty: 1300, unit_price: 62 }, { po_id: 'P2', boq_item_id: 'I', qty: 1000, unit_price: 61 }, { po_id: 'P3', boq_item_id: 'I', qty: 5000, unit_price: 61 }];
  const expenses = [{ po_id: 'P1', boq_item_id: 'I', kind: 'material', amount: 80600 }];
  const [r] = Q.quotaRows({ items, lines, entries: [], costs: {}, workers: [], pos, poLines, expenses, settings: S3 });
  assert.equal(r.status, 'over'); near(r.plannedQty, 2100); near(r.usedQty, 2300);
  const oc = Q.openCommitments(pos, poLines, expenses);
  near(oc.byItem.I, 61000);
  const c = C.itemControl({ qty: 2000, unit_price: 134, progress_pct: 45 }, lines, 80600, 0, oc.byItem.I);
  near(c.forecast, Math.max(80600 + 128100 * 0.55, 80600 + 61000));
});
test('quota: work logged on item without labor costing is flagged', () => {
  const items = [{ id: 'I', progress_pct: 10 }];
  const workers = [{ id: 'd', pay_type: 'daily', daily_rate: 500 }];
  const entries = [{ id: 'e', worker_id: 'd', boq_item_id: 'I', log_date: '2026-10-01', days: 1 }];
  const rows = Q.quotaRows({ items, lines: [], entries, costs: Q.entryCosts({ entries, workers, settings: S3 }), workers, settings: S3 });
  assert.equal(rows.length, 1); assert.equal(rows[0].status, 'over'); assert.equal(rows[0].line, null);
});

// ===== שלב 4 =====
const proj4 = { retention_pct: 5, insurance_pct: 0.5, shared_pct: 1.5, tax_pct: 3, pay_terms_days: 60, indexation: false };
const it4 = [{ id: 'A', qty: 1000, unit_price: 100, billing_method: 'measure' }, { id: 'B', qty: 1, unit_price: 50000, billing_method: 'lump' }];
test('bill 3: previous cumulative = cumulative of bill 2; supervisor cut shown', () => {
  const bills = [{ id: 'b1', number: 1, status: 'paid' }, { id: 'b2', number: 2, status: 'partial' }, { id: 'b3', number: 3, status: 'submitted' }];
  const lines = [
    { bill_id: 'b1', boq_item_id: 'A', cum_qty_sub: 200, cum_qty_app: 200 }, { bill_id: 'b1', boq_item_id: 'B', cum_qty_sub: 20, cum_qty_app: 20 },
    { bill_id: 'b2', boq_item_id: 'A', cum_qty_sub: 500, cum_qty_app: 450 }, { bill_id: 'b2', boq_item_id: 'B', cum_qty_sub: 40, cum_qty_app: 40 },
    { bill_id: 'b3', boq_item_id: 'A', cum_qty_sub: 700 }];
  const r = B.computeBills({ project: proj4, items: it4, bills, lines });
  const b2 = r.byBill.b2, b3 = r.byBill.b3;
  near(b2.rows.find(x => x.item.id === 'A').cut, 50); near(b2.cut, 5000);
  near(b2.base, (450 - 200) * 100 + (40 - 20) / 100 * 50000);
  const a3 = b3.rows.find(x => x.item.id === 'A');
  near(a3.prev, 450); near(a3.curSub, 250);                       // מצטבר קודם = המאושר בחשבון 2
  const bb3 = b3.rows.find(x => x.item.id === 'B'); assert.ok(bb3.carried); near(bb3.prev, 40);
  near(b3.base, 25000);
});
test('net with deductions, fine, offsets and tax withholding', () => {
  const bills = [{ id: 'b1', number: 1, status: 'approved', offsets: 1000 }];
  const lines = [{ bill_id: 'b1', boq_item_id: 'A', cum_qty_sub: 300, cum_qty_app: 300 }];
  const fines = [{ bill_id: 'b1', amount: 2500 }];
  const r = B.computeBills({ project: proj4, items: it4, bills, lines, fines, vatPct: 18 }).byBill.b1;
  const g = 30000;
  near(r.retention, 1500); near(r.insurance, 150); near(r.shared, 450); near(r.finesTotal, 2500);
  near(r.net, g - 1500 - 150 - 450 - 2500 - 1000); near(r.tax, r.net * 0.03); near(r.vat, r.net * 0.18);
});
test('indexation and retention cap', () => {
  const P = { ...proj4, indexation: true, base_index: 100, retention_cap: 2000 };
  const bills = [{ id: 'b1', number: 1, status: 'approved', index_value: 102 }, { id: 'b2', number: 2, status: 'approved', index_value: 104 }];
  const lines = [{ bill_id: 'b1', boq_item_id: 'A', cum_qty_sub: 300, cum_qty_app: 300 }, { bill_id: 'b2', boq_item_id: 'A', cum_qty_sub: 600, cum_qty_app: 600 }];
  const r = B.computeBills({ project: P, items: it4, bills, lines });
  near(r.byBill.b1.indexDiff, 600); near(r.byBill.b1.retention, 30600 * 0.05);
  near(r.byBill.b2.indexDiff, 1200); near(r.byBill.b2.retention, 2000 - 1530); near(r.retentionTotal, 2000);
});
test('due date: שוטף+60 from end of month', () => {
  assert.equal(B.dueDate('2026-10-05', 60), '2026-12-30');
  assert.equal(B.dueDate('2026-02-10', 30), '2026-03-30');
});
test('collection and progress from bills', () => {
  const bills = [{ id: 'b1', number: 1, status: 'approved', submitted_date: '2026-06-01', paid_amount: 0 }];
  const lines = [{ bill_id: 'b1', boq_item_id: 'A', cum_qty_sub: 400, cum_qty_app: 380 }];
  const r = B.computeBills({ project: proj4, items: it4, bills, lines });
  const c = B.collection(r.byBill, '2026-10-01');
  assert.equal(c.overdue.length, 1); near(c.outstanding, r.byBill.b1.net + r.byBill.b1.vat);
  near(B.progressFromBills(it4, r.cumByItem).A, 38);
});

// ===== תזרים =====
const cfProj = (over = {}) => ({
  project: { id: 'p', pay_terms_days: 30, retention_pct: 0, insurance_pct: 0, shared_pct: 0, end_date: '2026-10-31', status: 'active', ...over.project },
  summary: { contract: { sale: over.sale ?? 0 }, approved: { sale: 0 }, rows: over.rows || [], costs: over.costs || {},
    billing: over.billing || { order: [], byBill: {}, retentionTotal: 0 } },
  pd: { expenses: over.expenses || [], pos: [], poLines: [], entries: over.entries || [], lines: [] }
});
const bill = (id, status, due, net, paid = 0, cum = net) => ({ bill: { id, number: id, status }, due, totalWithVat: net * 1.18, outstanding: net * 1.18 - paid, payments: paid ? [{ pay_date: '2026-08-10', amount: paid }] : [], cumEffTotal: cum });
test('cashflow: overdue bill lands in current month, delay shifts it', () => {
  const p = cfProj({ sale: 100000, billing: { order: ['1'], byBill: { 1: bill('1', 'approved', '2026-09-30', 100000) }, retentionTotal: 0 } });
  const r = CF.cashflow([p], { today: '2026-10-15', back: 2, ahead: 4 });
  const oct = r.months.find(m => m.m === '2026-10');
  near(oct.rows.in_billed, 100000); near(oct.vatIn, 18000);
  assert.equal(r.months.find(m => m.m === '2026-09').schedIn > 0, true); // תוכנן בספטמבר ולא נגבה
  const r2 = CF.cashflow([p], { today: '2026-10-15', back: 2, ahead: 4, delay: 30 });
  near(r2.months.find(m => m.m === '2026-11').rows.in_billed, 100000);
  near(r2.months.find(m => m.m === '2026-10').rows.in_billed, 0);
});
test('cashflow: VAT paid the next month, labour paid month after log, opening balance', () => {
  const p = cfProj({ entries: [{ id: 'e1', log_date: '2026-10-05' }], costs: { e1: { cost: 5000 } },
    expenses: [{ amount: 10000, vat_pct: 18, status: 'invoice', doc_date: '2026-09-10' }] });
  const r = CF.cashflow([p], { today: '2026-10-15', back: 1, ahead: 3, settings: { cash_opening: 50000, supplier_terms_days: 30 } });
  const [sep, oct, nov, dec] = r.months;
  near(oct.rows.out_open, 10000); near(oct.vatOut, 1800); // שוטף+30 מספטמבר = 31.10
  near(nov.rows.out_labor, 5000); // שכר אוקטובר בנובמבר, בלי מע"מ
  near(nov.vatPay, -1800); // החזר מע"מ בחודש שאחרי
  near(sep.open, 50000); near(oct.cum, 50000 - 11800);
  near(dec.cum, 50000 - 11800 - 5000 + 1800);
});
test('cashflow: future billing from remaining sale, net of retention, retention released after end', () => {
  const p = cfProj({ sale: 200000, project: { retention_pct: 5, end_date: '2026-11-30' } });
  const r = CF.cashflow([p], { today: '2026-10-15', back: 0, ahead: 4 });
  const sum = k => r.months.reduce((a, m) => a + m.rows[k], 0);
  near(sum('in_future'), 190000); near(sum('in_retention'), 10000);
  assert.ok(r.months.find(m => m.m === '2026-12').rows.in_future > 0); // אוק' מוגש 5.11, שוטף+30 = 31.12
  near(r.months.find(m => m.m === '2026-10').rows.in_future, 0);
});
test('cashflow: below minimum alert', () => {
  const p = cfProj({ expenses: [{ amount: 100000, vat_pct: 0, status: 'invoice', doc_date: '2026-10-01', pay_date: '2026-11-10' }] });
  const r = CF.cashflow([p], { today: '2026-10-15', back: 0, ahead: 2, settings: { cash_opening: 60000, cash_min: 20000 } });
  assert.equal(r.belowMonths.map(m => m.m).join(), '2026-11,2026-12');
  assert.equal(r.lowest.m, '2026-11');
});

test('cashflow: opening balance anchored at cash_asof rolls forward actual months', () => {
  const p = cfProj({ expenses: [{ amount: 10000, vat_pct: 0, status: 'paid', doc_date: '2026-08-01', pay_date: '2026-08-20' }, { amount: 999999, vat_pct: 0, status: 'paid', doc_date: '2026-03-01', pay_date: '2026-03-02' }] });
  const r = CF.cashflow([p], { today: '2026-10-15', back: 1, ahead: 1, settings: { cash_opening: 100000, cash_asof: '2026-08' } });
  near(r.opening, 90000); // אוגוסט שולמו 10,000; תנועה ממרץ כבר בתוך היתרה
  near(r.months[0].open, 90000); assert.equal(r.months[0].m, '2026-09');
  const r2 = CF.cashflow([p], { today: '2026-10-15', back: 3, ahead: 1, settings: { cash_opening: 100000 } });
  near(r2.months.find(m => m.m === '2026-08').open, 110000); // אחורה: לפני ההוצאה היתרה הייתה גבוהה יותר
});

test('fines: cancelled not deducted, appeal deducted and reported', () => {
  const it = [{ id: 'A', qty: 10, unit_price: 100, billing_method: 'measure' }];
  const r = B.computeBills({ project: { retention_pct: 0 }, items: it, bills: [{ id: 'b', number: 1, status: 'approved' }], lines: [{ bill_id: 'b', boq_item_id: 'A', cum_qty_sub: 10, cum_qty_app: 10 }],
    fines: [{ bill_id: 'b', amount: 100 }, { bill_id: 'b', amount: 50, status: 'appeal' }, { bill_id: 'b', amount: 30, status: 'cancelled' }, { bill_id: 'b', amount: 7, disputed: true }], vatPct: 0 }).byBill.b;
  near(r.finesTotal, 157); near(r.finesAppeal, 57); near(r.net, 1000 - 157);
});

test('hourly worker cost', () => {
  const workers = [{ id: 'h', pay_type: 'hourly', hourly_rate: 60 }];
  const st = { day_hours: 8, employer_factor: 1.3 };
  const c = Q.entryCosts({ entries: [{ id: 'a', worker_id: 'h', log_date: '2026-10-01', days: 0.75, hours: 6, ot_hours: 2 }, { id: 'b', worker_id: 'h', log_date: '2026-10-02', days: 1 }], workers, settings: st });
  near(c.a.cost, 6 * 60 + 2 * 75); // שעה נוספת 125%, מקדם 1 לשעתי
  near(c.b.cost, 8 * 60); // בלי שעות: יום = שעות ביום עבודה
  near(c.b.dayCost, 480);
  assert.equal(Q.entryHours({ days: 0.5 }, st), 4);
});
// ===== קליטת מסמכים =====
const D = {
  projects: [{ id: 'p1', name: 'מגדל א', status: 'active', main_contractor_id: 'm1' }, { id: 'p2', name: 'סגור', status: 'closed' }],
  mcs: [{ id: 'm1', name: 'אלקו בע"מ', company_no: '512345678' }],
  vendors: [{ id: 'v1', name: 'גבס ישראל', company_no: '511111111' }],
  expenses: [{ supplier_name: 'ספק ישן', doc_no: '100', po_id: 'o1', amount: 1000 }, { supplier_name: 'גבס ישראל', doc_no: '77', amount: 5 }],
  pos: [{ id: 'o1', project_id: 'p1', number: 'PO-7', supplier_name: 'גבס ישראל', status: 'open', delivery_notes: 'DN-1' }],
  poLines: [{ id: 'l1', po_id: 'o1', description: 'לוח גבס', qty: 100, unit: 'יח', unit_price: 30, delivered_qty: 50 }],
  items: [{ id: 'i1', project_id: 'p1', code: '02.010', description: 'קיר גבס', unit: 'מ"ר' }, { id: 'i2', project_id: 'p2', code: '9', description: 'x' }],
  vos: [{ id: 'c1', project_id: 'p1', number: 'VO-01', title: 'תוספת' }],
  bills: [{ id: 'b1', project_id: 'p1', number: 3, period_to: '2026-09-30' }]
};
test('intake buildContext short ids, active projects only', () => {
  const ctx = IN.buildContext(D);
  assert.ok(ctx.text.includes('P1|מגדל א'));
  assert.ok(!ctx.text.includes('סגור'));
  assert.deepEqual(ctx.map.P1, { t: 'project', id: 'p1' });
  assert.equal(ctx.map['O1.1'].id, 'l1');
  assert.equal(Object.values(ctx.map).filter(m => m.t === 'item').length, 1);
  assert.ok(Object.values(ctx.map).some(m => m.t === 'vendor' && m.name === 'ספק ישן' && m.id === null));
  const one = IN.buildContext(D, { projectId: 'p2' });
  assert.ok(one.text.includes('P1|סגור'));
});
test('intake extractJson handles fences and text', () => {
  assert.deepEqual(IN.extractJson('הנה:\n```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(IN.extractJson('xx {"a":{"b":2}} yy'), { a: { b: 2 } });
  assert.throws(() => IN.extractJson('אין כאן'));
});
test('intake normalize maps ids, dates, totals; ignores invented ids', () => {
  const ctx = IN.buildContext(D);
  const d = IN.normalize({ doc_type: 'invoice', confidence: 1.4, project: 'P1', vendor: 'V1', doc_date: '5/10/26', po: 'O9', amount_net: '',
    lines: [{ description: 'לוח', qty: '10', unit_price: 30, item: 'I1', po_line: 'O1.1' }, { description: 'הובלה', qty: 1, unit_price: 200, item: 'I77' }] }, ctx.map);
  assert.equal(d.project_id, 'p1'); assert.equal(d.vendor_id, 'v1'); assert.equal(d.vendor_name, 'גבס ישראל');
  assert.equal(d.doc_date, '2026-10-05'); assert.equal(d.confidence, 1); assert.equal(d.po_id, null);
  assert.equal(d.lines[0].total, 300); assert.equal(d.lines[0].item_id, 'i1'); assert.equal(d.lines[0].po_line_id, 'l1'); assert.equal(d.lines[1].item_id, null);
  assert.equal(d.amount_net, 500); assert.equal(d.vat_pct, 18);
  assert.equal(IN.normalize({ doc_type: 'hack' }, ctx.map).doc_type, 'other');
  const c = IN.normalize({ doc_type: 'contract', contract: { contract_type: 'x', retention_pct: '5', guarantees: [{ kind: 'performance', pct: 10 }] } }, ctx.map);
  assert.equal(c.contract.contract_type, 'measure'); assert.equal(c.contract.retention_pct, 5); assert.equal(c.contract.guarantees[0].pct, 10);
  const w = IN.normalize({ doc_type: 'worker', worker: { name: 'א', pay_type: 'hourly', rate: '55' } }, ctx.map);
  assert.equal(w.worker.pay_type, 'hourly'); assert.equal(w.worker.rate, 55);
});
test('intake fillMatches by company number, po number, item code', () => {
  const d = IN.fillMatches({ doc_type: 'invoice', vendor_name: 'גבס-ישראל בע"מ', vendor_company_no: '', po_number: 'PO-7', lines: [{ code: '02.010', item_id: null }] }, D);
  assert.equal(d.vendor_id, 'v1'); assert.equal(d.po_id, 'o1'); assert.equal(d.project_id, 'p1'); assert.equal(d.lines[0].item_id, 'i1');
  const pl = IN.fillMatches({ lines: [{ po_line_id: 'l1', item_id: null }] }, { ...D, poLines: [{ ...D.poLines[0], boq_item_id: 'i1' }] });
  assert.equal(pl.lines[0].item_id, 'i1');
  const m = IN.fillMatches({ main_contractor_name: 'אלקו', lines: [] }, D);
  assert.equal(m.main_contractor_id, 'm1');
});
test('intake checks: duplicate, sum mismatch, over-billing, price, delivery, expiry', () => {
  const dup = IN.checks({ doc_type: 'invoice', project_id: 'p1', vendor_name: 'גבס ישראל', vendor_id: 'v1', doc_no: '77', amount_net: 100, lines: [{ total: 90 }] }, D);
  assert.ok(dup.some(w => w.includes('כבר קיימת'))); assert.ok(dup.some(w => w.includes('לא שווה')));
  const over = IN.checks({ doc_type: 'invoice', project_id: 'p1', vendor_name: 'גבס ישראל', vendor_id: 'v1', po_id: 'o1', amount_net: 1000, lines: [{ po_line_id: 'l1', qty: 60, unit_price: 32, total: 1920 }] }, D);
  assert.ok(over.some(w => w.includes('יותר ממה שסופק'))); assert.ok(over.some(w => w.includes('32 בחשבונית מול 30'))); assert.ok(over.some(w => w.includes('סופקו 50')));
  const dn = IN.checks({ doc_type: 'delivery', project_id: 'p1', vendor_name: 'גבס ישראל', vendor_id: 'v1', po_id: 'o1', doc_no: 'DN-1', lines: [{ po_line_id: 'l1', qty: 60 }] }, D);
  assert.ok(dn.some(w => w.includes('110 מתוך 100'))); assert.ok(dn.some(w => w.includes('כבר נקלטה')));
  assert.ok(IN.checks({ doc_type: 'delivery', project_id: 'p1', vendor_name: 'חדש', lines: [] }, D).some(w => w.includes('ספק חדש')));
  assert.ok(IN.checks({ doc_type: 'guarantee', guarantee: { expiry: '2020-01-01' } }, D).some(w => w.includes('עבר')));
  assert.ok(IN.checks({ doc_type: 'vo', project_id: 'p1', vo: { signed: false } }, D).some(w => w.includes('לא חתומה')));
});
test('intake fileKind', () => {
  assert.equal(IN.fileKind('a.PDF'), 'pdf'); assert.equal(IN.fileKind('x', 'image/jpeg'), 'image'); assert.equal(IN.fileKind('b.xlsx'), 'sheet');
  assert.equal(IN.fileKind('c.docx'), 'docx'); assert.equal(IN.fileKind('d.zip'), 'other');
});
test('intake prompt includes context and hint', () => {
  const pr = IN.buildPrompt(IN.buildContext(D), { hint: 'delivery', fileName: 'dn.jpg' });
  assert.ok(pr.user.includes('תעודת משלוח')); assert.ok(pr.user.includes('P1|מגדל א')); assert.ok(pr.system.includes('JSON'));
});
// ===== תשלומים לספקים =====
const PD = {
  projects: [{ id: 'p1', name: 'א' }],
  vendors: [{ id: 'v1', name: 'ספק א', kind: 'supplier', pay_terms_days: 30 }, { id: 'v2', name: 'ספק ב', kind: 'supplier' }],
  documents: [{ vendor_id: 'v1', doc_type: 'books', expiry: '2027-01-01' }, { vendor_id: 'v1', doc_type: 'tax', expiry: '2026-01-01' }],
  pos: [{ id: 'o1', project_id: 'p1', number: '5', supplier_name: 'ספק א', status: 'partial' }],
  poLines: [{ po_id: 'o1', qty: 100, unit_price: 10, delivered_qty: 40 }],
  expenses: [
    { id: 'e1', project_id: 'p1', supplier_name: 'ספק א', doc_no: '1', doc_date: '2026-09-10', amount: 600, vat_pct: 18, status: 'invoice', po_id: 'o1', kind: 'material' },
    { id: 'e2', project_id: 'p1', supplier_name: 'ספק ב', doc_no: '2', doc_date: '2026-10-05', amount: 1000, vat_pct: 18, status: 'approved', kind: 'material' },
    { id: 'e3', project_id: 'p1', supplier_name: 'ספק ב', doc_no: '3', doc_date: '2026-08-01', amount: 500, vat_pct: 18, status: 'paid', kind: 'material' },
    { id: 'e4', project_id: 'p1', supplier_name: 'לא קיים', doc_no: '4', doc_date: '2026-10-01', amount: 100, status: 'invoice', pay_date: '2026-10-25', kind: 'other' },
    { id: 'e5', project_id: 'p1', supplier_name: 'ספק ב', doc_date: '2026-10-01', amount: 100, status: 'expected', kind: 'material' }]
};
test('payables: due by vendor terms, overdue, week, warnings', () => {
  const rs = PY.payableRows(PD, { terms: 60, today: '2026-10-23' });
  assert.equal(rs.length, 3);
  const r1 = rs.find(r => r.e.id === 'e1'), r2 = rs.find(r => r.e.id === 'e2'), r4 = rs.find(r => r.e.id === 'e4');
  assert.equal(r1.due, '2026-10-30'); assert.ok(r1.thisWeek); assert.ok(!r1.overdue); // שוטף+30 מסוף ספטמבר
  assert.equal(r2.due, '2026-12-30'); // שוטף+60 כללי
  assert.equal(r4.due, '2026-10-25');
  near(r1.total, 708);
  assert.ok(r1.warn.some(w => w.includes('חויב 200'))); assert.ok(r1.warn.some(w => w.includes('ניכוי מס') && w.includes('פג')));
  assert.ok(r2.warn.some(w => w.includes('חסר'))); assert.ok(r4.warn.some(w => w.includes('אין כרטיס')));
  assert.deepEqual(rs.map(r => r.e.id), ['e4', 'e1', 'e2']);
  const late = PY.payableRows(PD, { terms: 60, today: '2026-11-05' });
  assert.ok(late.find(r => r.e.id === 'e1').overdue);
  const T = PY.payTotals(late); near(T.overdue, 708 + 118); assert.equal(T.nOverdue, 2);
});
test('payables: vendor balances', () => {
  const b = PY.vendorBalances(PD);
  const a = b.find(x => x.name === 'ספק א'), bb = b.find(x => x.name === 'ספק ב');
  assert.equal(a.ordered, 1000); assert.equal(a.invoiced, 600); assert.equal(a.open, 600); assert.equal(a.commit, 400);
  assert.equal(bb.invoiced, 1500); assert.equal(bb.paid, 500); assert.equal(bb.openVat, 1180);
});
test('guide: project steps and next step', () => {
  const pd = { project: { id: 'p1', main_contractor_id: 'm', pay_terms_days: 60 }, items: [{ id: 'i1' }, { id: 'i2' }], lines: [{ boq_item_id: 'i1' }], entries: [], pos: [], expenses: [], bills: [] };
  const s = G.projectSteps(pd, { workers: [] });
  assert.equal(s.done, 2); assert.equal(s.next.k, 'costing'); assert.equal(s.steps[2].part, '1/2');
  assert.ok(G.stepsCard(s).includes('2 מתוך 7'));
  const all = G.projectSteps({ ...pd, lines: [{ boq_item_id: 'i1' }, { boq_item_id: 'i2' }], entries: [1], pos: [1], bills: [1] }, { workers: [1] });
  assert.equal(all.next, null); assert.equal(G.stepsCard(all), '');
  assert.ok(Object.keys(G.HELP).includes('p-bills') && G.helpBtn('nope') === '');
});

test('bills: unapproved VO items are submitted but not counted for collection', () => {
  const P = { retention_pct: 5, insurance_pct: 0, shared_pct: 0, pay_terms_days: 60 };
  const items = [{ id: 'c', qty: 100, unit_price: 10 }, { id: 'v', variation_id: 'vo1', qty: 10, unit_price: 50 }, { id: 'x', variation_id: 'vo2', qty: 1, unit_price: 999 }];
  const vos = [{ id: 'vo1', status: 'submitted' }, { id: 'vo2', status: 'rejected' }];
  const bills = [{ id: 'b1', number: 1, status: 'submitted', submitted_date: '2026-09-05' }];
  const lines = [{ bill_id: 'b1', boq_item_id: 'c', cum_qty_sub: 50 }, { bill_id: 'b1', boq_item_id: 'v', cum_qty_sub: 10 }, { bill_id: 'b1', boq_item_id: 'x', cum_qty_sub: 1 }];
  let R = B.computeBills({ project: P, items, variations: vos, bills, lines, vatPct: 0 });
  let r = R.byBill.b1;
  near(r.groups.c.curSub, 500); near(r.groups.a.curSub, 0); near(r.groups.p.curSub, 500);
  near(r.curSub, 1000); near(r.base, 1000); near(r.firmBase, 500);   // rejected VO excluded entirely
  near(r.outstanding, 475);                                          // 500 - 5% retention, VO not counted
  assert.equal(R.cumByItem.v, 0); assert.equal(R.subByItem.v, 10);
  // אושר בלי למלא כמות להוראה: ההוראה לא נספרת
  r = B.computeBills({ project: P, items, variations: vos, bills: [{ ...bills[0], status: 'approved' }], lines, vatPct: 0 }).byBill.b1;
  near(r.base, 500); near(r.outstanding, 475);
  // ההוראה אושרה: בחשבון הבא היא נספרת במלואה (המצטבר הקודם המאושר שלה 0)
  const vos2 = [{ id: 'vo1', status: 'approved' }, vos[1]];
  R = B.computeBills({ project: P, items, variations: vos2, bills: [{ ...bills[0], status: 'approved' }, { id: 'b2', number: 2, status: 'submitted' }],
    lines: [lines[0], { ...lines[1], cum_qty_app: 0 }, { bill_id: 'b2', boq_item_id: 'c', cum_qty_sub: 60 }, { bill_id: 'b2', boq_item_id: 'v', cum_qty_sub: 10 }], vatPct: 0 });
  near(R.byBill.b1.base, 500); // בחשבון 1 לא מולא מאושר להוראה
  near(R.byBill.b2.groups.a.curSub, 500); near(R.byBill.b2.firmBase, 600);
});
console.log(`${passed} tests passed`);
