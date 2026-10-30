// פרויקט יזם: הכנסות (רוכשים, בנק מלווה, הון עצמי) ותזרים חודשי מול הוצאות. פונקציות טהורות. כל הסכומים כולל מע"מ.
import { n } from './calc.js';
import { mkey, addMonths, monthLabel } from './cashflow.js';
import { COMMITTED } from './dev.js';
import { has, indexRate, fixedMonths, spreadWeights, spreadEnd } from './modules.js';

export const INCOME_SOURCES = { buyer: 'רוכשים', bank: 'בנק מלווה', equity: 'הון עצמי', other: 'אחר' };
export const DCF_ROWS = {
  in_buyer: 'תקבולים מרוכשים', in_bank: 'משיכות מהבנק המלווה', in_equity: 'הון עצמי', in_other: 'הכנסות אחרות',
  out_paid: 'תשלומים ששולמו', out_open: 'חשבונות שאושרו ועוד לא שולמו', out_contract: 'יתרת התקשרויות (לפי לו"ז)', out_index: 'הפרש הצמדה צפוי', out_fixed: 'עלויות חודשיות קבועות', out_rest: 'יתרת תקציב שטרם נסגרה', out_delay: 'עלות עיכוב בלו"ז'
};
export const DCF_IN = ['in_buyer', 'in_bank', 'in_equity', 'in_other'];
export const DCF_OUT = ['out_paid', 'out_open', 'out_contract', 'out_index', 'out_fixed', 'out_rest', 'out_delay'];
const termsMonths = d => Math.max(0, Math.ceil(n(d) / 30));

/**
 * projects: [{ project, s (devSummary), pd }]
 * opts: { settings, today, back, ahead, incomeDelay (ימים), schedDelay (חודשים), delayCost (₪ לחודש עיכוב, לפני מע"מ), indexSeries: [] }
 */
export function devCashflow(projects, opts = {}) {
  const st = { cash_opening: 0, cash_asof: '', cash_min: 0, supplier_terms_days: 45, vat_pct: 18, ...(opts.settings || {}) };
  const vat = 1 + n(st.vat_pct) / 100;
  const today = opts.today || new Date().toISOString().slice(0, 10);
  const cur = mkey(today);
  const first = addMonths(cur, -(opts.back ?? 3)), last = addMonths(cur, opts.ahead ?? 12);
  const asof = /^\d{4}-\d{2}$/.test(st.cash_asof || '') && st.cash_asof <= last ? st.cash_asof : cur;
  const from = asof < first ? asof : first;
  const incDelay = Math.round(n(opts.incomeDelay) / 30), sched = Math.round(n(opts.schedDelay));
  const months = []; for (let m = from; m <= last; m = addMonths(m, 1)) months.push(m);
  const M = Object.fromEntries(months.map(m => [m, { m, past: m < cur, rows: Object.fromEntries(Object.keys(DCF_ROWS).map(k => [k, 0])), items: [] }]));
  const put = (m, key, amt, label, projectId, late = false) => {
    if (!amt || m < from || m > last) return;
    M[m].rows[key] += amt; M[m].items.push({ key, amt, label, projectId, late });
  };
  const notPast = m => (m < cur ? cur : m);
  let incomeTotal = 0, incomeReceived = 0, costTotal = 0, budgetTotal = 0, overdueIncome = [];

  for (const { project: P, s, pd } of projects) {
    budgetTotal += s.total.budget * vat; costTotal += s.total.forecast * vat;
    const se = spreadEnd(P);
    const endM0 = [P.end_date && mkey(P.end_date) > cur ? mkey(P.end_date) : addMonths(cur, 3), se && se > cur ? se : ''].sort().pop();
    const endM = addMonths(endM0, sched);
    const workMonths = []; for (let m = cur; m <= endM; m = addMonths(m, 1)) workMonths.push(m);
    // עיכוב בלו"ז מותח את העקומה; בלי מודול פריסה: שווה בכל חודש
    const W = sched && has(P, 'spread') ? (() => { const base = []; for (let m = cur; m <= endM0; m = addMonths(m, 1)) base.push(m); const b = spreadWeights(P, base);
      return workMonths.map((_, i) => { const x = i * (base.length / workMonths.length), j = Math.floor(x); return (b[Math.min(j, b.length - 1)] || 0); }).map((v, _, a) => v / a.reduce((s, y) => s + y, 0)); })() : spreadWeights(P, workMonths);
    const spread = (total, key, label, terms) => { if (total <= 1) return; for (const [wi, wm] of workMonths.entries()) put(addMonths(wm, terms), key, total * W[wi], `${label} (${monthLabel(wm)})`, P.id); };
    // --- הכנסות ---
    for (const i of pd.income || []) {
      const key = 'in_' + (i.source || 'other');
      const label = `${i.payer || INCOME_SOURCES[i.source] || ''}${i.description ? ' · ' + i.description : ''}`;
      incomeTotal += n(i.status === 'received' ? i.received_amount ?? i.amount : i.amount);
      if (i.status === 'received') { incomeReceived += n(i.received_amount ?? i.amount); put(mkey(i.received_date || i.due_date || today), key, n(i.received_amount ?? i.amount), label, P.id); continue; }
      let m = mkey(i.due_date || today);
      const late = (i.due_date || today) < today;
      if (late) overdueIncome.push({ ...i, project: P });
      // עיכוב בלו"ז: הכנסות שתלויות בהתקדמות (רוכשים ובנק) זזות יחד עם הלו"ז
      if (!late && sched && ['buyer', 'bank'].includes(i.source)) m = addMonths(m, sched);
      put(addMonths(notPast(m), incDelay), key, n(i.amount), label + (late ? ' (באיחור)' : ''), P.id, late);
    }
    // --- הוצאות ---
    const cById = Object.fromEntries((pd.contracts || []).map(c => [c.id, c]));
    const termsOf = e => cById[e.contract_id]?.pay_terms_days ?? st.supplier_terms_days;
    for (const e of pd.expenses || []) {
      if (e.status === 'expected') continue;
      const amt = n(e.amount) * (1 + n(e.vat_pct ?? st.vat_pct) / 100);
      if (e.status === 'paid') put(mkey(e.pay_date || e.doc_date || today), 'out_paid', amt, e.supplier_name || 'תשלום', P.id);
      else put(notPast(addMonths(mkey(e.doc_date || today), termsMonths(termsOf(e)))), 'out_open', amt, `${e.supplier_name || 'ספק'}${e.doc_no ? ' ' + e.doc_no : ''}`, P.id);
    }
    // יתרת התקשרויות חתומות שעוד לא חויבה: לפי לו"ז הפרויקט ותנאי התשלום של כל התקשרות
    for (const c of s.contracts.filter(c => COMMITTED.includes(c.contract.status))) {
      const left = Math.max(0, c.amount - c.invoiced);
      spread(left * vat, 'out_contract', `${c.contract.vendor_name || ''} · ${c.contract.title}`, termsMonths(c.contract.pay_terms_days ?? st.supplier_terms_days));
      // התקשרות צמודה: הפרש לפי המדד האחרון שפורסם מול מדד הבסיס של ההתקשרות. לא נספר כחריגה
      const r = has(P, 'index') && c.contract.indexation ? indexRate(c.contract.base_index, opts.indexSeries || pd.indexSeries || [], cur) : 0;
      if (r) spread(left * vat * r, 'out_index', `הצמדה ${(r * 100).toFixed(1)}% · ${c.contract.vendor_name || ''}`, termsMonths(c.contract.pay_terms_days ?? st.supplier_terms_days));
    }
    // עלויות חודשיות קבועות מהחודש הנוכחי, לפי תנאי התשלום לספקים
    if (has(P, 'fixed')) for (const fc of pd.fixedCosts || []) for (const fm of fixedMonths(fc, cur))
      put(addMonths(fm, termsMonths(st.supplier_terms_days)), 'out_fixed', n(fc.amount) * (fc.vat === false ? 1 : vat), `${fc.name}${fc.supplier_name ? ' · ' + fc.supplier_name : ''} (${monthLabel(fm)})`, P.id);
    // מה שבצפי ועוד לא נסגר בהתקשרות (סעיפים בהערכה, צפי ידני מעל ההתקשרות)
    const rest = s.rows.reduce((a, r) => a + Math.max(0, r.forecast - Math.max(r.committed, r.invoiced)), 0);
    spread(rest * vat, 'out_rest', 'יתרת תקציב', termsMonths(st.supplier_terms_days));
    // עלות קבועה לכל חודש עיכוב (פיקוח, ניהול, שמירה, מימון)
    if (sched && n(opts.delayCost)) for (let k = 1; k <= sched; k++) put(addMonths(endM0, k), 'out_delay', n(opts.delayCost) * vat, `עלות עיכוב חודש ${k}`, P.id);
  }
  for (const m of months) {
    const B = M[m];
    B.inTotal = DCF_IN.reduce((a, k) => a + B.rows[k], 0);
    B.outTotal = DCF_OUT.reduce((a, k) => a + B.rows[k], 0);
    B.net = B.inTotal - B.outTotal;
  }
  const ai = months.indexOf(asof);
  let c = n(st.cash_opening);
  for (let i = ai; i < months.length; i++) { const B = M[months[i]]; B.open = c; c += B.net; B.cum = c; }
  c = n(st.cash_opening);
  for (let i = ai - 1; i >= 0; i--) { const B = M[months[i]]; B.cum = c; c -= B.net; B.open = c; }
  const out = months.filter(m => m >= first).map(m => M[m]);
  for (const B of out) { B.below = B.cum < n(st.cash_min); B.outOverIn = !B.past && B.outTotal > B.inTotal + 1; }
  const fut = out.filter(b => !b.past);
  return { months: out, cur, asof, settings: st, opening: M[cur].open, belowMonths: fut.filter(b => b.below), overMonths: fut.filter(b => b.outOverIn),
    lowest: fut.reduce((a, b) => (b.cum < a.cum ? b : a), fut[0]), incomeTotal, incomeReceived, costTotal, budgetTotal, overdueIncome };
}

/** התרעות תזרים ליזם: חודש שבו ההוצאות עולות על ההכנסות, יתרה מתחת למינימום, תקבול באיחור */
export function devCashAlerts(cf, { horizon = 6 } = {}) {
  const lim = addMonths(cf.cur, horizon - 1), out = [];
  const over = cf.overMonths.filter(b => b.m <= lim);
  if (over.length) { const worst = over.reduce((a, b) => (b.net < a.net ? b : a), over[0]);
    out.push({ type: 'cash_out_over_in', title: `הוצאות מעל הכנסות ב${monthLabel(over[0].m)}`, detail: `${over.length} חודשים ב-${horizon} הקרובים · הפער הגדול ב${monthLabel(worst.m)}`, amount: worst.net }); }
  const below = cf.belowMonths.filter(b => b.m <= lim);
  if (below.length) { const low = below.reduce((a, b) => (b.cum < a.cum ? b : a), below[0]);
    out.push({ type: 'cash_below_min', crit: true, title: `יתרה מתחת למינימום ב${monthLabel(below[0].m)}`, detail: `הנמוכה ב${monthLabel(low.m)} · מינימום ${Math.round(n(cf.settings.cash_min)).toLocaleString('en-US')} ₪`, amount: low.cum }); }
  for (const i of cf.overdueIncome) out.push({ type: 'income_overdue', title: `תקבול באיחור: ${i.payer || INCOME_SOURCES[i.source]}`, detail: `${i.project.name} · היה צפוי ב-${String(i.due_date).split('-').reverse().join('.')}`, amount: n(i.amount), projectId: i.project.id });
  return out;
}
