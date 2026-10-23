// שלב 6: תזרים מזומנים חודשי. פונקציות טהורות.
// כניסות: תקבולים בפועל, יתרות של חשבונות שהוגשו (במועד התשלום), וחשבונות עתידיים לפי יתרת המכירה עד סוף הפרויקט.
// יציאות: הוצאות ששולמו, חשבוניות פתוחות לפי תנאי ספק, הזמנות רכש פתוחות, שכר לפי יומן העבודה (חודש אחרי), ויתרת צפי העלות.
// מע"מ מוצג בנפרד: נגבה מהקבלן הראשי, שולם לספקים, והתשלום (או ההחזר) לרשות בחודש שאחרי.
import { n, lineCost } from './calc.js';
import { dueDate } from './bills.js';

const DEF = { cash_opening: 0, cash_asof: '', cash_min: 0, supplier_terms_days: 60, vat_pct: 18 };
export const mkey = d => String(d).slice(0, 7);
export const addMonths = (m, k) => { const [y, mo] = m.split('-').map(Number); const d = new Date(Date.UTC(y, mo - 1 + k, 1)); return d.toISOString().slice(0, 7); };
export const monthsBetween = (a, b) => { const [y1, m1] = a.split('-').map(Number), [y2, m2] = b.split('-').map(Number); return (y2 - y1) * 12 + (m2 - m1); };
export const HE_MONTHS = ['ינו', 'פבר', 'מרץ', 'אפר', 'מאי', 'יונ', 'יול', 'אוג', 'ספט', 'אוק', 'נוב', 'דצמ'];
export const monthLabel = m => `${HE_MONTHS[+m.slice(5, 7) - 1]} ${m.slice(2, 4)}`;

export const CF_ROWS = {
  in_paid: 'תקבולים מהקבלן הראשי', in_billed: 'חשבונות שהוגשו (יתרה לגבייה)', in_future: 'חשבונות עתידיים (לפי יתרת המכירה)', in_retention: 'שחרור עיכבון',
  out_paid: 'הוצאות ששולמו', out_open: 'חשבוניות ספקים פתוחות', out_po: 'הזמנות רכש פתוחות', out_labor: 'שכר עובדים (מהיומן)', out_future: 'יתרת עלויות לפי צפי'
};
export const CF_IN = ['in_paid', 'in_billed', 'in_future', 'in_retention'];
export const CF_OUT = ['out_paid', 'out_open', 'out_po', 'out_labor', 'out_future'];

/**
 * projects: [{ project, summary, pd, costs }] (summary מ-summarize: billing, rows, total; pd: expenses, pos, poLines, entries)
 * opts: { settings, today: 'YYYY-MM-DD', back: 3, ahead: 12, delay: 0 (חודשי עיכוב בתשלומי הקבלן הראשי) }
 */
export function cashflow(projects, opts = {}) {
  const s = { ...DEF, ...(opts.settings || {}) };
  const vat = n(s.vat_pct) / 100;
  const today = opts.today || new Date().toISOString().slice(0, 10);
  const cur = mkey(today);
  const first = addMonths(cur, -(opts.back ?? 3)), last = addMonths(cur, opts.ahead ?? 12);
  // יתרת הפתיחה היא היתרה בבנק בתחילת החודש cash_asof (ברירת מחדל: החודש הנוכחי). מחשבים גם את החודשים שבין התאריך הזה לטווח התצוגה.
  const asof = /^\d{4}-\d{2}$/.test(s.cash_asof || '') && s.cash_asof <= last ? s.cash_asof : cur;
  // תמיד מחשבים גם את החודש שלפני הטווח, כי המע"מ שלו משולם בחודש הראשון
  const from = [asof, first, addMonths(first, -1)].sort()[0];
  const delay = Math.round(n(opts.delay) / 30);
  const months = []; for (let m = from; m <= last; m = addMonths(m, 1)) months.push(m);
  const M = Object.fromEntries(months.map(m => [m, { m, past: m < cur, rows: Object.fromEntries(Object.keys(CF_ROWS).map(k => [k, 0])), vatIn: 0, vatOut: 0, schedIn: 0, schedOut: 0, items: [] }]));
  // pre: סכום לפני מע"מ. withVat: האם יש מע"מ על הסכום
  const put = (m, key, pre, withVat, label, projectId) => {
    if (!pre) return;
    const v = withVat ? pre * vat : 0;
    const sign = key.startsWith('in_') ? 1 : -1;
    if (m < from || m > last) return; // תנועות לפני תאריך היתרה כבר כלולות בה
    const B = M[m];
    B.rows[key] += pre;
    if (sign > 0) B.vatIn += v; else B.vatOut += v;
    B.items.push({ key, pre, v, label, projectId });
  };
  const notPast = m => (m < cur ? cur : m);

  for (const { project: P, summary: S, pd } of projects) {
    const terms = n(P.pay_terms_days);
    const billing = S.billing;
    // --- כניסות ---
    const bills = billing.order.map(id => billing.byBill[id]).filter(r => r.bill.status !== 'draft');
    for (const r of bills) {
      for (const p of r.payments || []) put(mkey(p.pay_date), 'in_paid', n(p.amount) / (1 + vat), true, `תקבול חשבון ${r.bill.number}`, P.id);
      if (r.due) { const dm = mkey(r.due); if (M[dm] && dm < cur) M[dm].schedIn += r.totalWithVat; }
      if (r.outstanding > 1) put(addMonths(notPast(mkey(r.due || today)), delay), 'in_billed', r.outstanding / (1 + vat), true, `חשבון ${r.bill.number}${r.due && r.due < today ? ' (באיחור)' : ''}`, P.id);
    }
    // חשבונות עתידיים: יתרת המכירה (חוזה + הוראות שינוי מאושרות) מתחלקת עד סוף הפרויקט; הגשה בחודש שאחרי, תשלום בשוטף+X
    const sale = S.contract.sale + S.approved.sale;
    const lastBill = bills[bills.length - 1];
    const billed = lastBill ? lastBill.cumEffTotal : 0;
    const remaining = Math.max(0, sale - billed);
    const ded = (n(P.retention_pct) + n(P.insurance_pct) + n(P.shared_pct)) / 100;
    const endM = P.end_date && mkey(P.end_date) > cur ? mkey(P.end_date) : addMonths(cur, 2);
    const workMonths = []; for (let m = cur; m <= endM; m = addMonths(m, 1)) workMonths.push(m);
    if (remaining > 1 && P.status !== 'closed') for (const wm of workMonths) {
      const amt = remaining / workMonths.length;
      const due = mkey(dueDate(addMonths(wm, 1) + '-05', terms));
      put(addMonths(due, delay), 'in_future', amt * (1 - ded), true, `חשבון עתידי על ${monthLabel(wm)}`, P.id);
    }
    // שחרור עיכבון: אחרי סוף הפרויקט + תנאי התשלום
    const retTotal = Math.max(0, billing.retentionTotal - n(P.retention_released)) + remaining * n(P.retention_pct) / 100;
    if (retTotal > 1) put(addMonths(mkey(dueDate(addMonths(endM, 1) + '-05', terms)), delay), 'in_retention', retTotal, true, 'שחרור עיכבון', P.id);

    // --- יציאות ---
    const supTerms = n(s.supplier_terms_days);
    let invoicedOpen = 0;
    for (const e of pd.expenses) {
      const pre = n(e.amount), withVat = n(e.vat_pct ?? s.vat_pct) > 0;
      const due = e.pay_date || dueDate(e.doc_date, supTerms) || today;
      if (M[mkey(due)] && mkey(due) < cur) M[mkey(due)].schedOut += pre * (1 + (withVat ? vat : 0));
      if (e.status === 'paid') put(mkey(e.pay_date || e.doc_date || today), 'out_paid', pre, withVat, e.supplier_name || 'הוצאה', P.id);
      else { put(notPast(mkey(due)), 'out_open', pre, withVat, `${e.supplier_name || 'ספק'}${e.doc_no ? ' ' + e.doc_no : ''}`, P.id); invoicedOpen += pre; }
    }
    // הזמנות רכש פתוחות: יתרה שעוד לא חויבה, לפי מועד אספקה + תנאי ספק
    for (const po of pd.pos || []) {
      if (!['open', 'partial', 'delivered'].includes(po.status)) continue;
      const total = (pd.poLines || []).filter(l => l.po_id === po.id).reduce((a, l) => a + n(l.qty) * n(l.unit_price), 0);
      const inv = pd.expenses.filter(e => e.po_id === po.id).reduce((a, e) => a + n(e.amount), 0);
      const open = Math.max(0, total - inv);
      put(notPast(mkey(dueDate(po.expected_date || po.order_date || today, supTerms))), 'out_po', open, true, `הזמנה ${po.number || ''} ${po.supplier_name}`, P.id);
    }
    // שכר: עלות היומן של כל חודש משולמת בחודש שאחרי
    const laborBy = {};
    for (const e of pd.entries || []) { const m = addMonths(mkey(e.log_date), 1); laborBy[m] = (laborBy[m] || 0) + (opts.costs?.[e.id]?.cost ?? S.costs?.[e.id]?.cost ?? 0); }
    for (const [m, amt] of Object.entries(laborBy)) put(m, m < cur ? 'out_paid' : 'out_labor', amt, false, 'שכר עובדים', P.id);
    // יתרת עלויות לפי צפי: צפי לסיום − בפועל − התקשרויות, מתחלק עד סוף הפרויקט ומשולם חודש אחרי. מע"מ רק על החלק שאינו עבודה.
    const rowsInView = S.rows.filter(r => !r.item.variation_id || ['approved', 'partial'].includes(r.vo?.status));
    const rest = rowsInView.reduce((a, r) => a + Math.max(0, r.c.forecast - r.c.actual - (r.c.commit || 0)), 0);
    const lines = pd.lines || [];
    const laborShare = (() => { const t = lines.reduce((a, l) => a + lineCost(l), 0); const lab = lines.filter(l => ['labor', 'piece'].includes(l.kind)).reduce((a, l) => a + lineCost(l), 0); return t ? lab / t : 0.4; })();
    if (rest > 1 && P.status !== 'closed') for (const wm of workMonths) {
      const amt = rest / workMonths.length;
      const pm = addMonths(wm, 1);
      put(pm, 'out_future', amt * (1 - laborShare), true, `עלויות חומר וספקים (${monthLabel(wm)})`, P.id);
      put(pm, 'out_future', amt * laborShare, false, `עבודה (${monthLabel(wm)})`, P.id);
    }
  }

  // מע"מ: ההפרש בין מע"מ שנגבה לשולם משולם לרשות בחודש שאחרי (שלילי = החזר)
  for (const m of months) {
    const B = M[m];
    const prev = M[addMonths(m, -1)];
    B.vatPay = prev ? prev.vatIn - prev.vatOut : 0;
    B.inPre = CF_IN.reduce((a, k) => a + B.rows[k], 0);
    B.outPre = CF_OUT.reduce((a, k) => a + B.rows[k], 0);
    B.inTotal = B.inPre + B.vatIn;
    B.outTotal = B.outPre + B.vatOut;
    B.net = B.inTotal - B.outTotal - B.vatPay;
    B.actualIn = B.past ? B.rows.in_paid * (1 + vat) : null;
    B.actualOut = B.past ? B.outTotal : null;
  }
  // עיגון: בתחילת חודש asof היתרה = cash_opening. קדימה מוסיפים נטו, אחורה מחסירים.
  const ai = months.indexOf(asof);
  let c = n(s.cash_opening);
  for (let i = ai; i < months.length; i++) { const B = M[months[i]]; B.open = c; c += B.net; B.cum = c; }
  c = n(s.cash_opening);
  for (let i = ai - 1; i >= 0; i--) { const B = M[months[i]]; B.cum = c; c -= B.net; B.open = c; }
  const out = months.filter(m => m >= first).map(m => M[m]);
  for (const B of out) B.below = B.cum < n(s.cash_min);
  const lowest = out.reduce((a, b) => (b.cum < a.cum ? b : a), out[0]);
  return { months: out, cur, asof, opening: M[cur].open, lowest, belowMonths: out.filter(b => b.below && !b.past), settings: s };
}
