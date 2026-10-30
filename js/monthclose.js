// סגירת חודש: כל החודשים עד החודש האחרון שנסגר נעולים. בפועל (הוצאות, תקבולים שהתקבלו, יומן עבודה) של חודש סגור לא משתנה;
// תיקון נרשם כשורה חדשה בחודש פתוח ומסומן "תיקון לחודש X".
import { mkey, addMonths, monthLabel } from './cashflow.js';

export const closedThrough = closes => (closes || []).map(c => c.month).sort().pop() || '';
export const isClosedDate = (d, through) => !!(d && through && String(d).slice(0, 7) <= through);
export const corrLabel = m => `תיקון ל${monthLabel(m)}`;
/** החודש הבא לסגירה: אחרי האחרון שנסגר, ואם לא נסגר כלום, החודש הקודם. אי אפשר לסגור את החודש הנוכחי */
export function nextToClose(through, today) {
  const cur = mkey(today), m = through ? addMonths(through, 1) : addMonths(cur, -1);
  return m < cur ? m : null;
}
const today = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
export const todayStr = today;
/** תאריך הרישום של שורת תיקון: היום (תמיד בחודש פתוח) */
export const correctionDate = () => today();
