// שלב 7: מסמכים עם תוקף, ערבויות וחשבון סופי. פונקציות טהורות.
import { n } from './calc.js';

export const VENDOR_KINDS = { supplier: 'ספק חומרים', contractor: 'קבלן / קבלן משנה', service: 'נותן שירות' };
export const DOC_TYPES = { insurance: 'ביטוח', license: 'רישיון קבלן', books: 'אישור ניהול ספרים', tax: 'אישור ניכוי מס במקור', safety: 'בטיחות / הדרכה', other: 'אחר' };
// מסמכים שחובה לפי סוג (מסמך שפג תוקפו נחשב חסר)
export const REQUIRED = { supplier: ['books', 'tax'], contractor: ['insurance', 'license', 'books', 'tax'], service: ['books', 'tax'] };
export const OWN_REQUIRED = ['insurance', 'license', 'books', 'tax'];
export const GUAR_KINDS = { performance: 'ביצוע', advance: 'מקדמה', warranty: 'בדק / טיב', tender: 'מכרז', other: 'אחר' };
export const SOON_DAYS = 30;

const days = (a, b) => Math.round((new Date(a) - new Date(b)) / 864e5);
// מצב תוקף: ok / soon (עד 30 יום) / expired / open (בלי תאריך תפוגה)
export function expiryState(expiry, today) {
  if (!expiry) return 'open';
  if (expiry < today) return 'expired';
  return days(expiry, today) <= SOON_DAYS ? 'soon' : 'ok';
}
export const daysLeft = (expiry, today) => expiry ? days(expiry, today) : null;

// מצב מסמכים של בעל מסמכים: לכל סוג חובה המסמך התקף האחרון
export function docStatus(docs, required, today) {
  const byType = {};
  for (const d of docs) { const cur = byType[d.doc_type]; if (!cur || String(d.expiry || '9999') > String(cur.expiry || '9999')) byType[d.doc_type] = d; }
  const missing = [], expired = [], soon = [];
  for (const t of required) {
    const d = byType[t];
    if (!d) { missing.push(t); continue; }
    const s = expiryState(d.expiry, today);
    if (s === 'expired') expired.push(d); else if (s === 'soon') soon.push(d);
  }
  // מסמכים לא חובה שפג/פג בקרוב
  for (const d of Object.values(byType)) if (!required.includes(d.doc_type)) { const s = expiryState(d.expiry, today); if (s === 'soon') soon.push(d); }
  return { missing, expired, soon, ok: !missing.length && !expired.length, byType };
}

export function vendorStatus(vendor, documents, today) {
  return docStatus(documents.filter(d => d.vendor_id === vendor.id), REQUIRED[vendor.kind] || [], today);
}

// ספק לפי שם (להוצאות ולהזמנות שנרשמו בשם בלבד)
export const findVendor = (vendors, name) => { const k = String(name || '').trim(); return k ? vendors.find(v => v.name.trim() === k) : null; };

export function guaranteeState(g, today) {
  if (g.status === 'returned') return 'returned';
  return expiryState(g.expiry, today);
}

// חשבון סופי: תנאים, עיכבון לשחרור וסוף תקופת הבדק
export function finalBill(project, retentionTotal) {
  const P = project || {};
  const missing = [];
  if (!P.as_made_ok) missing.push('תוכניות As-Made הוגשו ואושרו');
  if (!P.rejects_ok) missing.push('כל הליקויים (רג\'קטים) נסגרו');
  if (!P.completion_date) missing.push('תאריך מסירה / תעודת השלמה');
  const toRelease = Math.max(0, n(retentionTotal) - n(P.retention_released));
  let warrantyEnd = null;
  if (P.completion_date) { const d = new Date(P.completion_date + 'T12:00:00Z'); d.setUTCMonth(d.getUTCMonth() + n(P.warranty_months ?? 12)); warrantyEnd = d.toISOString().slice(0, 10); }
  return { ready: !missing.length, missing, toRelease, warrantyEnd };
}

// ייבוא ספר טלפונים מאקסל: מזהה עמודות לפי שם הכותרת
const ALIAS = {
  name: ['שם מלא', 'שם', 'איש קשר', 'name', 'full name'], first: ['שם פרטי', 'first name'], last: ['שם משפחה', 'last name'],
  company: ['חברה', 'שם חברה', 'ארגון', 'עסק', 'company'], role: ['תפקיד', 'role', 'title'],
  phone: ['נייד', 'טלפון נייד', 'סלולרי', 'טלפון', 'phone', 'mobile'], phone2: ['טלפון נוסף', 'טלפון משרד', 'טלפון 2', 'משרד'],
  email: ['אימייל', 'דוא"ל', 'דואל', 'מייל', 'email', 'e-mail'], notes: ['הערות', 'notes']
};
const norm = s => String(s ?? '').trim().toLowerCase().replace(/["'״׳]/g, '"');
export const phoneKey = p => String(p || '').replace(/\D/g, '').replace(/^972/, '0');
export function parseContacts(rows) {
  let hi = -1, map = null;
  for (let i = 0; i < Math.min(rows.length, 15) && hi < 0; i++) {
    const m = {};
    rows[i].forEach((c, j) => { const v = norm(c); for (const [k, al] of Object.entries(ALIAS)) if (m[k] == null && al.some(a => v === norm(a))) m[k] = j; });
    if ((m.name != null || m.first != null) && (m.phone != null || m.email != null || m.company != null)) { hi = i; map = m; }
  }
  if (hi < 0) return { ok: false, contacts: [] };
  const get = (r, k) => map[k] == null ? '' : String(r[map[k]] ?? '').trim();
  const contacts = [];
  for (const r of rows.slice(hi + 1)) {
    const name = get(r, 'name') || [get(r, 'first'), get(r, 'last')].filter(Boolean).join(' ');
    if (!name) continue;
    contacts.push({ name, company: get(r, 'company') || null, role: get(r, 'role') || null, phone: get(r, 'phone') || null, phone2: get(r, 'phone2') || null, email: get(r, 'email') || null, notes: get(r, 'notes') || null });
  }
  return { ok: true, contacts, map };
}
// כפילות: אותו נייד, או אותו שם באותה חברה
export function isDup(a, list) {
  const pk = phoneKey(a.phone);
  return list.some(b => (pk && pk.length >= 9 && phoneKey(b.phone) === pk) || (norm(a.name) === norm(b.name) && norm(a.company) === norm(b.company)));
}
