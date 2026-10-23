// שלב 4: חשבונות חלקיים מצטברים, ניכויים, קנסות, הצמדה ומועד תשלום. פונקציות טהורות.
import { n, itemSale, VO_APPROVED } from './calc.js';

export const BILL_STATUS = { draft: 'טיוטה', submitted: 'הוגש', partial: 'אושר חלקית', approved: 'אושר', paid: 'שולם' };
export const BILL_APPROVED = ['partial', 'approved', 'paid'];
// קנס: הוטל ומנוכה / בערעור (מנוכה עד שיוחלט) / בוטל (לא מנוכה)
export const FINE_STATUS = { imposed: 'הוטל', appeal: 'בערעור', cancelled: 'בוטל' };
export const fineStatus = f => f.status || (f.disputed ? 'appeal' : 'imposed');
export const CUT_REASONS = ['כמות לא נמדדה / לא אושרה במדידה', 'עבודה לא הושלמה', 'ליקויים שלא תוקנו', 'מחיר או סעיף לא מאושר', 'מחוץ לחוזה (נדרשת הוראת שינוי)'];
const r2 = x => Math.round(x * 100) / 100;

// ערך מצטבר של סעיף: מדידה = כמות × מחיר; פאושלי / אחוז = אחוז מצטבר × ערך הסעיף
export const isMeasure = it => (it.billing_method || 'measure') === 'measure';
export const cumAmount = (it, cum) => isMeasure(it) ? n(cum) * n(it.unit_price) : itemSale(it) * n(cum) / 100;

// מועד תשלום: שוטף + X = סוף החודש של מועד ההגשה + X ימים
export function dueDate(dateStr, days) {
  if (!dateStr) return null;
  const d = new Date(dateStr + 'T12:00:00Z');
  const eom = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0, 12));
  eom.setUTCDate(eom.getUTCDate() + n(days));
  return eom.toISOString().slice(0, 10);
}

/**
 * חישוב כל חשבונות הפרויקט לפי הסדר (מספר חשבון).
 * מצטבר קודם של סעיף = המצטבר המאושר בחשבון הקודם (ואם עוד לא אושר, המצטבר שהוגש בו).
 * הניכויים מחושבים על הנוכחי המאושר (ובחשבון שעוד לא אושר: על הנוכחי שהוגש).
 * עיכבון נעצר בתקרה (מצטבר), אם הוגדרה.
 */
export function computeBills({ project, items, variations = [], bills, lines, fines = [], payments = [], vatPct = 18 }) {
  const P = project || {};
  const sorted = [...bills].sort((a, b) => n(a.number) - n(b.number));
  const itemById = Object.fromEntries(items.map(i => [i.id, i]));
  const voById = Object.fromEntries(variations.map(v => [v.id, v]));
  const prevCum = {}; // itemId -> מצטבר קודם
  let retentionSoFar = 0, prevGrossApproved = 0;
  const out = {};
  for (const b of sorted) {
    const bl = lines.filter(l => l.bill_id === b.id);
    const approvedStage = BILL_APPROVED.includes(b.status);
    const rows = [];
    const seen = new Set();
    for (const l of bl) {
      const it = itemById[l.boq_item_id]; if (!it) continue;
      seen.add(it.id);
      const prev = prevCum[it.id] || 0;
      const cumSub = l.cum_qty_sub == null || l.cum_qty_sub === '' ? prev : n(l.cum_qty_sub);
      const cumApp = l.cum_qty_app == null || l.cum_qty_app === '' ? null : n(l.cum_qty_app);
      const cumEff = approvedStage ? (cumApp ?? cumSub) : cumSub;
      const contractQty = isMeasure(it) ? n(it.qty) : 100;
      rows.push({ item: it, line: l, vo: it.variation_id ? voById[it.variation_id] : null, prev, cumSub, cumApp, cumEff,
        curSub: cumSub - prev, curApp: cumApp == null ? null : cumApp - prev, cut: cumApp == null ? 0 : cumSub - cumApp,
        prevAmt: cumAmount(it, prev), cumSubAmt: cumAmount(it, cumSub), cumAppAmt: cumApp == null ? null : cumAmount(it, cumApp),
        curSubAmt: cumAmount(it, cumSub) - cumAmount(it, prev), curAppAmt: cumApp == null ? null : cumAmount(it, cumApp) - cumAmount(it, prev),
        cutAmt: cumApp == null ? 0 : cumAmount(it, cumSub) - cumAmount(it, cumApp),
        over: cumSub > contractQty + 1e-9, pctDone: contractQty ? cumEff / contractQty * 100 : 0 });
    }
    // סעיפים שלא הופיעו בחשבון ממשיכים עם המצטבר הקודם (נוכחי 0)
    for (const [id, prev] of Object.entries(prevCum)) if (!seen.has(id) && itemById[id]) {
      const it = itemById[id];
      rows.push({ item: it, line: null, vo: it.variation_id ? voById[it.variation_id] : null, prev, cumSub: prev, cumApp: prev, cumEff: prev, curSub: 0, curApp: 0, cut: 0,
        prevAmt: cumAmount(it, prev), cumSubAmt: cumAmount(it, prev), cumAppAmt: cumAmount(it, prev), curSubAmt: 0, curAppAmt: 0, cutAmt: 0, over: false, pctDone: 0, carried: true });
    }
    const sumK = k => rows.reduce((a, r) => a + n(r[k]), 0);
    const curSub = sumK('curSubAmt');
    const hasApp = rows.some(r => r.curAppAmt != null);
    const curApp = hasApp ? rows.reduce((a, r) => a + (r.curAppAmt ?? r.curSubAmt), 0) : null;
    const base = approvedStage && curApp != null ? curApp : curSub;
    // הצמדה: הפרש על הנוכחי לפי מדד החשבון מול מדד הבסיס
    const indexDiff = P.indexation && n(P.base_index) > 0 && n(b.index_value) > 0 ? base * (n(b.index_value) / n(P.base_index) - 1) : 0;
    const gross = base + indexDiff;
    let retention = gross * n(P.retention_pct) / 100;
    if (P.retention_cap != null && P.retention_cap !== '' && n(P.retention_cap) > 0) retention = Math.max(0, Math.min(retention, n(P.retention_cap) - retentionSoFar));
    const insurance = gross * n(P.insurance_pct) / 100;
    const shared = gross * n(P.shared_pct) / 100;
    const bf = fines.filter(f => f.bill_id === b.id);
    const finesTotal = bf.filter(f => fineStatus(f) !== 'cancelled').reduce((a, f) => a + n(f.amount), 0);
    const finesAppeal = bf.filter(f => fineStatus(f) === 'appeal').reduce((a, f) => a + n(f.amount), 0);
    const offsets = n(b.offsets);
    const net = gross - retention - insurance - shared - finesTotal - offsets;
    const tax = Math.max(0, net) * n(P.tax_pct) / 100;
    const vat = net * n(vatPct) / 100;
    const res = {
      bill: b, rows, approvedStage, curSub, curApp, base, cut: rows.reduce((a, r) => a + n(r.cutAmt), 0),
      cumSubTotal: sumK('cumSubAmt'), cumEffTotal: rows.reduce((a, r) => a + cumAmount(r.item, r.cumEff), 0), prevTotal: sumK('prevAmt'),
      indexDiff, gross, retention, insurance, shared, fines: bf, finesTotal, finesAppeal, offsets, net, tax, payable: net - tax, vat, totalWithVat: net + vat,
      retentionCum: retentionSoFar + retention, overItems: rows.filter(r => r.over)
    };
    res.due = b.due_date || dueDate(b.submitted_date || b.bill_date, P.pay_terms_days);
    res.payments = payments.filter(x => x.bill_id === b.id);
    res.paid = res.payments.reduce((a, x) => a + n(x.amount), 0);
    res.outstanding = b.status === 'draft' ? 0 : Math.max(0, r2(net + vat - res.paid));
    out[b.id] = res;
    retentionSoFar += retention;
    // המצטבר הבא מתחיל מהמצטבר האפקטיבי של החשבון הזה
    for (const r of rows) prevCum[r.item.id] = r.cumEff;
    if (b.status !== 'draft') prevGrossApproved += base;
  }
  return { byBill: out, order: sorted.map(b => b.id), retentionTotal: retentionSoFar, cumByItem: prevCum, billedTotal: prevGrossApproved };
}

// גבייה: חשבונות שהוגשו ולא שולמו במלואם, ומה באיחור
export function collection(results, today = new Date().toISOString().slice(0, 10)) {
  const open = Object.values(results).filter(r => r.bill.status !== 'draft' && r.outstanding > 1);
  return {
    open,
    outstanding: open.reduce((a, r) => a + r.outstanding, 0),
    overdue: open.filter(r => r.due && r.due < today),
    dueSoon: open.filter(r => r.due && r.due >= today && (new Date(r.due) - new Date(today)) / 864e5 <= 14)
  };
}

// אחוז ביצוע לפי המצטבר המאושר האחרון (לסעיפי מדידה): כמות מצטברת ÷ כמות חוזית
export function progressFromBills(items, cumByItem) {
  const out = {};
  for (const it of items) if (cumByItem[it.id] != null) {
    const q = isMeasure(it) ? n(it.qty) : 100;
    if (q > 0) out[it.id] = Math.min(100, Math.round(cumByItem[it.id] / q * 1000) / 10);
  }
  return out;
}

// הוראת שינוי נכנסת לחשבון רק אם אושרה (או אושר חלקית)
export const voBillable = vo => !vo || VO_APPROVED.includes(vo.status);
