// תשלומים לספקים: חשבוניות פתוחות לפי מועד תשלום, אזהרות לפני תשלום, ויתרה לכל ספק.
// פונקציות טהורות (בלי DOM), כדי שאפשר לבדוק אותן לבד.
import { n } from './calc.js';
import { dueDate } from './bills.js';
import { REQUIRED, DOC_TYPES, docStatus, findVendor } from './docs.js';

export const PAY_METHODS = { transfer: 'העברה בנקאית', check: 'שיק', cash: 'מזומן', card: 'כרטיס אשראי', offset: 'קיזוז', other: 'אחר' };
export const OPEN_STATUS = ['invoice', 'approved'];
const addDays = (d, k) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + k); return x.toISOString().slice(0, 10); };
export const withVat = (e, vat = 18) => Math.round(n(e.amount) * (1 + n(e.vat_pct ?? vat) / 100) * 100) / 100;

// מועד תשלום: תאריך שנקבע ידנית, אחרת שוטף + ימים לפי הספק או ההגדרה הכללית
export function payDue(e, vendor, terms = 60) {
  if (e.pay_date) return e.pay_date;
  const t = vendor?.pay_terms_days ?? terms;
  return dueDate(e.doc_date, t) || null;
}

// חיוב מעל אספקה בהזמנה: כמה חויב על ההזמנה מול מה שסופק
function poCheck(po, data) {
  const ls = (data.poLines || []).filter(l => l.po_id === po.id);
  const delivered = ls.reduce((a, l) => a + n(l.delivered_qty) * n(l.unit_price), 0);
  const ordered = ls.reduce((a, l) => a + n(l.qty) * n(l.unit_price), 0);
  const invoiced = (data.expenses || []).filter(e => e.po_id === po.id && e.status !== 'expected').reduce((a, e) => a + n(e.amount), 0);
  return { delivered, ordered, invoiced };
}

export function payableRows(data, { terms = 60, vat = 18, today } = {}) {
  const t = today || new Date().toISOString().slice(0, 10);
  const week = addDays(t, 7);
  const pname = id => (data.projects || []).find(p => p.id === id)?.name || '';
  const vcache = new Map();
  const vstat = v => { if (!vcache.has(v.id)) vcache.set(v.id, docStatus((data.documents || []).filter(d => d.vendor_id === v.id), REQUIRED[v.kind] || [], t)); return vcache.get(v.id); };
  const rows = [];
  for (const e of (data.expenses || []).filter(e => OPEN_STATUS.includes(e.status) && e.kind !== 'labor')) {
    const vendor = findVendor(data.vendors || [], e.supplier_name);
    const due = payDue(e, vendor, terms);
    const warn = [];
    if (e.po_id) { const po = (data.pos || []).find(p => p.id === e.po_id); if (po) { const c = poCheck(po, data);
      if (c.delivered > 0 && c.invoiced > c.delivered + 1) warn.push(`הזמנה ${po.number || ''}: חויב ${Math.round(c.invoiced - c.delivered).toLocaleString('en-US')} ₪ יותר ממה שסופק`);
      else if (c.delivered === 0 && c.ordered > 0) warn.push(`הזמנה ${po.number || ''}: עוד לא נרשמה אספקה`); } }
    if (vendor) { const s = vstat(vendor);
      for (const d of s.expired) warn.push(`${DOC_TYPES[d.doc_type]} של הספק פג תוקף`);
      for (const k of s.missing) warn.push(`חסר ${DOC_TYPES[k]} של הספק`); }
    else if (e.supplier_name) warn.push('אין כרטיס ספק (אי אפשר לבדוק אישורים)');
    if ((data.expenses || []).some(x => x.id !== e.id && x.doc_no && x.doc_no === e.doc_no && (x.supplier_name || '').trim() === (e.supplier_name || '').trim())) warn.push(`מספר חשבונית ${e.doc_no} מופיע פעמיים אצל הספק`);
    rows.push({ e, vendor, project: pname(e.project_id), due, overdue: !!due && due < t, thisWeek: !!due && due >= t && due <= week, total: withVat(e, vat), warn });
  }
  return rows.sort((a, b) => String(a.due || '9999').localeCompare(String(b.due || '9999')));
}

export function payTotals(rows) {
  const sum = rs => Math.round(rs.reduce((a, r) => a + r.total, 0) * 100) / 100;
  return { all: sum(rows), overdue: sum(rows.filter(r => r.overdue)), week: sum(rows.filter(r => r.thisWeek)), approved: sum(rows.filter(r => r.e.status === 'approved')),
    nOverdue: rows.filter(r => r.overdue).length, nWeek: rows.filter(r => r.thisWeek).length, nWarn: rows.filter(r => r.warn.length).length };
}

// יתרה לפי ספק (לפני מע"מ): הוזמן, חויב, שולם, פתוח לתשלום, והתקשרות פתוחה (הוזמן ועוד לא חויב)
export function vendorBalances(data, { vat = 18 } = {}) {
  const map = new Map();
  const get = name => { const k = String(name || '').trim() || 'ללא שם'; if (!map.has(k)) map.set(k, { name: k, vendor: findVendor(data.vendors || [], k), ordered: 0, invoiced: 0, paid: 0, open: 0, openVat: 0, commit: 0, n: 0 }); return map.get(k); };
  for (const po of (data.pos || []).filter(p => p.status !== 'cancelled')) {
    const g = get(po.supplier_name); const c = poCheck(po, data);
    g.ordered += c.ordered; if (!['closed'].includes(po.status)) g.commit += Math.max(0, c.ordered - c.invoiced);
  }
  for (const e of (data.expenses || []).filter(e => e.status !== 'expected' && e.kind !== 'labor' && e.supplier_name)) {
    const g = get(e.supplier_name); g.n++;
    g.invoiced += n(e.amount);
    if (e.status === 'paid') g.paid += n(e.amount); else { g.open += n(e.amount); g.openVat += withVat(e, vat); }
  }
  return [...map.values()].map(g => ({ ...g, ordered: Math.round(g.ordered), invoiced: Math.round(g.invoiced), paid: Math.round(g.paid), open: Math.round(g.open), openVat: Math.round(g.openVat), commit: Math.round(g.commit) }))
    .sort((a, b) => b.openVat - a.openVat || b.invoiced - a.invoiced);
}
