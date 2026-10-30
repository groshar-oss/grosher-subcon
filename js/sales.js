// מכירות וליווי בנקאי ליזם. פונקציות טהורות: לוח תשלומים, תחזית מכירות לפי קצב, מצב תנאי הליווי וסימולציית מסגרת האשראי.
// כל הסכומים כולל מע"מ, כמו בהכנסות היזם.
import { n } from './calc.js';
import { mkey, addMonths } from './cashflow.js';

export const UNIT_STATUS = { available: 'פנויה', reserved: 'שמורה', sold: 'נמכרה' };
const okM = m => /^\d{4}-\d{2}$/.test(m || '');
const r0 = v => Math.round(v);

/** לוח תשלומים ברירת מחדל: חתימה, שלד, גמרים, מסירה. תאריכים לפי הפרויקט */
export function defaultPlan(p) {
  const s = p?.start_date ? mkey(p.start_date) : mkey(new Date().toISOString());
  const e = p?.end_date ? mkey(p.end_date) : addMonths(s, 30);
  const len = Math.max(1, monthsBetween(s, e));
  return [
    { label: 'בחתימה', pct: 20, offset: 0, month: '' },
    { label: 'גמר שלד', pct: 30, offset: null, month: addMonths(s, Math.round(len * 0.45)) },
    { label: 'גמרים', pct: 30, offset: null, month: addMonths(s, Math.round(len * 0.8)) },
    { label: 'מסירה', pct: 20, offset: null, month: e }
  ];
}
export const monthsBetween = (a, b) => { const [y1, m1] = a.split('-').map(Number), [y2, m2] = b.split('-').map(Number); return (y2 - y1) * 12 + (m2 - m1); };
export const salesConf = p => ({ pace: 0, from_month: '', forecast: true, plan: null, ...(p?.sales || {}) });
export const planOf = p => (salesConf(p).plan?.length ? salesConf(p).plan : defaultPlan(p));
export const planPct = plan => (plan || []).reduce((a, l) => a + n(l.pct), 0);

/** מועד כל תשלום לפי חודש המכירה: לפי היסט בחודשים מהחתימה, או לפי אבן דרך (ואם עברה, בחודש החתימה) */
export function planDue(plan, saleMonth) {
  return (plan || []).filter(l => n(l.pct) > 0).map(l => {
    const m = okM(l.month) ? (l.month < saleMonth ? saleMonth : l.month) : addMonths(saleMonth, Math.max(0, Math.round(n(l.offset))));
    return { label: l.label || 'תשלום', pct: n(l.pct), month: m };
  });
}

/** שורות "הכנסות היזם" לדירה שנמכרה. received: שורות שכבר התקבלו (לא נוצרות שוב) */
export function unitIncomeRows(u, plan, received = []) {
  const price = n(u.sale_price), sm = mkey(u.sale_date || new Date().toISOString());
  const have = new Set(received.map(r => r.description));
  return planDue(plan, sm).map(l => ({ source: 'buyer', payer: u.buyer || 'רוכש', description: `${u.name} · ${l.label}`, due_date: (l.month === sm && u.sale_date ? u.sale_date : l.month + '-10'),
    amount: r0(price * l.pct / 100), status: 'expected', unit_id: u.id })).filter(r => !have.has(r.description));
}

/** סיכום מכירות */
export function salesSummary(units, income = []) {
  const sold = units.filter(u => u.status === 'sold'), res = units.filter(u => u.status === 'reserved'), free = units.filter(u => u.status === 'available');
  const byUnit = {};
  for (const i of income.filter(i => i.unit_id)) { const b = byUnit[i.unit_id] ||= { got: 0, open: 0 }; if (i.status === 'received') b.got += n(i.received_amount ?? i.amount); else b.open += n(i.amount); }
  const soldValue = sold.reduce((a, u) => a + n(u.sale_price), 0);
  const unsoldValue = [...res, ...free].reduce((a, u) => a + n(u.list_price), 0);
  const soldArea = sold.reduce((a, u) => a + n(u.area), 0);
  const collected = sold.reduce((a, u) => a + (byUnit[u.id]?.got || 0), 0);
  // ערבויות חוק המכר: כל מה שהרוכש שילם מעל 7% ממחיר הדירה
  const guarantees = sold.reduce((a, u) => a + Math.max(0, (byUnit[u.id]?.got || 0) - n(u.sale_price) * 0.07), 0);
  return { count: units.length, sold: sold.length, reserved: res.length, available: free.length, soldValue, unsoldValue, totalValue: soldValue + unsoldValue,
    collected, open: soldValue - collected, perSqm: soldArea ? soldValue / soldArea : 0, guarantees, byUnit,
    listOfSold: sold.reduce((a, u) => a + n(u.list_price), 0) };
}

/** תחזית מכירות לדירות שעוד לא נמכרו: לפי קצב (דירות לחודש) מחודש התחלה. שמורות קודם. */
export function forecastSales(p, units, cur) {
  const c = salesConf(p), pace = n(c.pace);
  if (!(pace > 0)) return [];
  const start = okM(c.from_month) && c.from_month > cur ? c.from_month : cur;
  const queue = [...units.filter(u => u.status === 'reserved'), ...units.filter(u => u.status === 'available')].filter(u => n(u.list_price) > 0);
  const plan = planOf(p), out = [];
  queue.forEach((u, k) => {
    const sm = addMonths(start, Math.floor(k / pace));
    for (const l of planDue(plan, sm)) out.push({ month: l.month, saleMonth: sm, amount: n(u.list_price) * l.pct / 100, label: `${u.name} · ${l.label} (מכירה צפויה ${sm})`, unitId: u.id });
  });
  return out;
}

/** חודש מכירה צפוי לכל דירה פנויה (לתצוגה) */
export function forecastMonths(p, units, cur) {
  const f = forecastSales(p, units, cur), m = {};
  for (const x of f) m[x.unitId] ||= x.saleMonth;
  return m;
}

export const bankConf = p => ({ line: 0, equity_pct: 20, equity_amount: null, presale_pct: 30, presale_basis: 'value', rate_pct: 6, fee_pct: 1, ...(p?.bank || {}) });

/**
 * מצב תנאי הליווי והסימולציה.
 * months: חודשי התזרים של הפרויקט (מ-devCashflow, בלי שורות הבנק). units/income: של הפרויקט. costTotal: צפי העלות (כולל מע"מ)
 * מימון כל חודש: תקבולי רוכשים והון עצמי קודם, אחר כך עודף שנצבר בחשבון הליווי, ורק אז משיכה מהבנק (אחרי שהתנאים מתקיימים, עד גובה המסגרת).
 * מה שחסר: הון עצמי נוסף. עודף בחודש מחזיר קודם את האשראי.
 */
export function bankSim(p, { months, units, income, cur, costTotal }) {
  const b = bankConf(p), s = salesSummary(units, income);
  const equityReq = b.equity_amount != null && b.equity_amount !== '' ? n(b.equity_amount) : costTotal * n(b.equity_pct) / 100;
  const equityIn = income.filter(i => i.source === 'equity' && i.status === 'received').reduce((a, i) => a + n(i.received_amount ?? i.amount), 0);
  const total = s.totalValue;
  const presaleReq = b.presale_basis === 'units' ? Math.ceil(units.length * n(b.presale_pct) / 100) : total * n(b.presale_pct) / 100;
  const presaleNow = b.presale_basis === 'units' ? s.sold : s.soldValue;
  // מכירות לפי חודש (בפועל + תחזית) לבדיקת התנאי לאורך הזמן
  const fc = salesConf(p).forecast !== false ? forecastSales(p, units, cur) : [];
  const fSold = {}; const seen = new Set();
  for (const x of fc) { if (seen.has(x.unitId)) continue; seen.add(x.unitId); const u = units.find(y => y.id === x.unitId);
    fSold[x.saleMonth] = fSold[x.saleMonth] || { v: 0, c: 0 }; fSold[x.saleMonth].v += n(u.list_price); fSold[x.saleMonth].c += 1; }
  const rate = n(b.rate_pct) / 100 / 12, line = n(b.line);
  let credit = 0, surplus = 0, eqCum = equityIn, preCum = presaleNow, peak = 0, peakM = null, interest = 0, gapTotal = 0, firstDraw = null, metM = null, drawTotal = 0;
  const rows = [];
  for (const M of months.filter(m => !m.past)) {
    const out = M.outTotal, buyers = M.rows.in_buyer + (M.rows.in_forecast || 0) + M.rows.in_other, eq = M.rows.in_equity;
    { const f = fSold[M.m]; if (f) preCum += b.presale_basis === 'units' ? f.c : f.v; }
    // הון עצמי צפוי (שורות שלא התקבלו) נספר לתנאי
    eqCum += M.rows.in_equity && M.m >= cur ? income.filter(i => i.source === 'equity' && i.status !== 'received' && mkey(i.due_date || '') === M.m).reduce((a, i) => a + n(i.amount), 0) : 0;
    const met = eqCum + 1 >= equityReq && preCum + 0.5 >= presaleReq;
    if (met && !metM) metM = M.m;
    const int = credit * rate; interest += int;
    let net = buyers + eq - out - int, draw = 0, repay = 0, gap = 0;
    if (net >= 0) { repay = Math.min(net, credit); credit -= repay; surplus += net - repay; }
    else {
      let need = -net; const fromSur = Math.min(surplus, need); surplus -= fromSur; need -= fromSur;
      if (need > 0 && met) { draw = Math.min(need, Math.max(0, line - credit)); credit += draw; need -= draw; drawTotal += draw; if (draw && !firstDraw) firstDraw = M.m; }
      gap = need; gapTotal += gap;
    }
    if (credit > peak) { peak = credit; peakM = M.m; }
    rows.push({ m: M.m, out, buyers, equity: eq, interest: int, draw, repay, credit, surplus, gap, met });
  }
  return { conf: b, equityReq, equityIn, equityOk: equityIn + 1 >= equityReq, presaleReq, presaleNow, presaleOk: presaleNow + 0.5 >= presaleReq, metNow: equityIn + 1 >= equityReq && presaleNow + 0.5 >= presaleReq,
    metM, firstDraw, peak, peakM, interest, fee: line * n(b.fee_pct) / 100, gapTotal, drawTotal, rows, lineUse: line ? peak / line : 0, s };
}
