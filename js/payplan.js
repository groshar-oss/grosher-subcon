// לוחות תשלומים: הזמנה מול קבלן משנה / ספק (מקדמה, אבני דרך, חודשי, עיכבון), ולוח תקבולים מוסכם מהמזמין.
// פונקציות טהורות. חודשים בפורמט YYYY-MM.
const num = v => { const x = Number(v); return isFinite(x) ? x : 0; };
const okM = m => /^\d{4}-\d{2}$/.test(m || '');
const ym = m => { const [y, mo] = String(m).split('-').map(Number); return y * 12 + mo - 1; };
const ymStr = k => `${Math.floor(k / 12)}-${String(k % 12 + 1).padStart(2, '0')}`;
const addM = (m, k) => ymStr(ym(m) + k);

export const PLAN_KINDS = { once: 'תשלום אחד', milestones: 'מקדמה ואבני דרך', monthly: 'חודשי לפי התקדמות' };

/** האם להזמנה יש לוח תשלומים אמיתי (לא ברירת המחדל) */
export const hasPlan = pp => !!pp && (pp.kind === 'milestones' || pp.kind === 'monthly' || num(pp.advance_pct) > 0 || num(pp.retention_pct) > 0);

/**
 * פריסת ההזמנה לחלקים לפי מועד הזכאות (לפני תנאי התשלום).
 * pp: { kind, advance_pct, advance_month, rows: [{ name, pct, month }], from_month, to_month, retention_pct, retention_month }
 * base: החודש לברירת מחדל (אספקה צפויה / תאריך הזמנה). endMonth: לשחרור עיכבון כשאין חודש.
 * מחזיר [{ month, amount, label, ret }] שסכומם = total
 */
export function poPieces(pp, total, base, endMonth) {
  pp = pp || {}; total = num(total);
  if (!total) return [];
  const out = [];
  const adv = total * Math.min(100, Math.max(0, num(pp.advance_pct))) / 100;
  if (adv) out.push({ month: okM(pp.advance_month) ? pp.advance_month : base, amount: adv, label: 'מקדמה' });
  const rest = total - adv;
  const retPct = Math.min(100, Math.max(0, num(pp.retention_pct))) / 100;
  const body = [];
  if (pp.kind === 'milestones') {
    const rows = (pp.rows || []).filter(r => num(r.pct) > 0);
    // האחוזים של אבני הדרך הם מכלל ההזמנה. אם הם לא משלימים ל-100% (עם המקדמה), ההפרש נכנס לאבן הדרך האחרונה
    rows.forEach(r => body.push({ month: okM(r.month) ? r.month : base, amount: total * num(r.pct) / 100, label: r.name || 'אבן דרך' }));
    const got = body.reduce((a, b) => a + b.amount, 0);
    if (!body.length) body.push({ month: base, amount: rest, label: 'יתרה' });
    else if (Math.abs(rest - got) > 0.5) body[body.length - 1].amount += rest - got;
  } else if (pp.kind === 'monthly' && okM(pp.from_month) && okM(pp.to_month) && pp.to_month >= pp.from_month) {
    const ms = []; for (let k = ym(pp.from_month); k <= ym(pp.to_month); k++) ms.push(ymStr(k));
    ms.forEach(m => body.push({ month: m, amount: rest / ms.length, label: 'חשבון חודשי' }));
  } else body.push({ month: base, amount: rest, label: 'תשלום' });
  // עיכבון: נוכה מכל תשלום (חוץ מהמקדמה) ומשתחרר בסוף
  let ret = 0;
  for (const b of body) { const r = b.amount * retPct; b.amount -= r; ret += r; }
  out.push(...body);
  if (ret > 0.005) out.push({ month: okM(pp.retention_month) ? pp.retention_month : addM(endMonth || base, 1), amount: ret, label: 'שחרור עיכבון', ret: true });
  return out.filter(p => p.amount > 0.005);
}

/** מה שעוד לא חויב: מורידים את מה שכבר חויב בחשבוניות מהחלקים לפי הסדר (קודם המוקדמים, עיכבון בסוף) */
export function openPieces(pieces, invoiced) {
  let left = num(invoiced);
  const sorted = [...pieces].sort((a, b) => (a.ret ? 1 : 0) - (b.ret ? 1 : 0) || a.month.localeCompare(b.month));
  const out = [];
  for (const p of sorted) { const take = Math.min(left, p.amount); left -= take; if (p.amount - take > 0.5) out.push({ ...p, amount: p.amount - take }); }
  return out;
}

/** לוח תקבולים מוסכם מהמזמין: [{ name, pct, month }]. מחזיר חלקים לפי סכום המכירה */
export function incomePieces(plan, sale) {
  const rows = (plan?.rows || []).filter(r => num(r.pct) > 0 && okM(r.month));
  return rows.map(r => ({ month: r.month, amount: num(sale) * num(r.pct) / 100, label: r.name || 'אבן דרך', pct: num(r.pct) }));
}
export const incomePct = plan => (plan?.rows || []).filter(r => num(r.pct) > 0 && okM(r.month)).reduce((a, r) => a + num(r.pct), 0);
