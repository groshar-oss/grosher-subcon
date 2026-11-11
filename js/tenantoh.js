// תקורות קבועות של הקבלן (משרד, הנהלה, רכב, ביטוח שנתי...): שורות חודשיות ברמת הלקוח, לא של פרויקט.
// בכל חודש הסכום מתחלק בין הפרויקטים שפעילים באותו חודש לפי היקף המכירה של כל אחד. פונקציות טהורות.
const num = v => { const x = Number(v); return isFinite(x) ? x : 0; };
const ym = m => { const [y, mo] = String(m).split('-').map(Number); return y * 12 + mo - 1; };
const ymStr = k => `${Math.floor(k / 12)}-${String(k % 12 + 1).padStart(2, '0')}`;
const okM = m => /^\d{4}-\d{2}$/.test(m || '');
export const addM = (m, k) => ymStr(ym(m) + k);

/** שורות התקורה התקינות מהגדרות הלקוח */
export const ohLines = st => (st?.fixed_oh || []).filter(l => num(l.amount) > 0 && okM(l.from_month) && (!l.to_month || (okM(l.to_month) && l.to_month >= l.from_month)));

/** סכום התקורה בחודש m (לפני מע"מ) */
export const ohInMonth = (lines, m) => lines.filter(l => l.from_month <= m && (!l.to_month || l.to_month >= m)).reduce((a, l) => a + num(l.amount), 0);

/** חודשי הפעילות של פרויקט: מתאריך ההתחלה עד הסיום. בלי תאריך סיום: עד שני חודשים קדימה (כמו בתזרים), ובפרויקט סגור עד חודש הסגירה */
export function activeRange(p, cur) {
  const from = p.start_date ? String(p.start_date).slice(0, 7) : p.created_at ? String(p.created_at).slice(0, 7) : '0000-01';
  let to = p.end_date ? String(p.end_date).slice(0, 7) : p.status === 'closed' ? String(p.updated_at || p.created_at || cur).slice(0, 7) : addM(cur, 2);
  if (to < from) to = from;
  return { from, to };
}

/**
 * lines: ohLines(settings). projects: [{ id, name, sale, start_date, end_date, status, created_at }] (רק פרויקטי קבלן משנה / ביצוע).
 * cur: החודש הנוכחי. מחזיר: חודשים (סכום, חלוקה לכל פרויקט, לא משויך), וסיכום לכל פרויקט (עד היום / בהמשך).
 */
export function allocateOH(lines, projects, cur) {
  const empty = { months: [], byProject: {}, total: 0, unalloc: 0, toDate: 0 };
  if (!lines.length) return empty;
  const P = projects.filter(p => num(p.sale) > 0).map(p => ({ ...p, ...activeRange(p, cur) }));
  const first = lines.map(l => l.from_month).sort()[0];
  // אופק: שנה קדימה, או סוף הפרויקט / התקורה המאוחר ביותר
  const last = [addM(cur, 12), ...P.map(p => p.to), ...lines.map(l => l.to_month).filter(Boolean)].sort().pop();
  const byProject = Object.fromEntries(projects.map(p => [p.id, { total: 0, toDate: 0, future: 0 }]));
  const months = [];
  let total = 0, unalloc = 0, toDate = 0;
  for (let k = ym(first); k <= ym(last); k++) {
    const m = ymStr(k), amt = ohInMonth(lines, m);
    if (!amt) continue;
    const act = P.filter(p => p.from <= m && p.to >= m), w = act.reduce((a, p) => a + num(p.sale), 0);
    const alloc = {};
    for (const p of act) { const x = amt * num(p.sale) / w; alloc[p.id] = x; const b = byProject[p.id]; b.total += x; if (m <= cur) b.toDate += x; else b.future += x; }
    const un = w ? 0 : amt;
    months.push({ m, amount: amt, alloc, unalloc: un, active: act.length, past: m < cur });
    total += amt; unalloc += un; if (m <= cur) toDate += amt;
  }
  return { months, byProject, total, unalloc, toDate, first, last };
}

/** היקף המכירה של פרויקט מנתוני הלקוח: חוזה + הוראות שינוי מאושרות, בלי סעיפי תקורה פנימיים */
export function projectSale(data, pid) {
  const ok = new Set((data.vos || []).filter(v => v.project_id === pid && ['approved', 'partial'].includes(v.status)).map(v => v.id));
  return (data.items || []).filter(i => i.project_id === pid && !i.is_overhead && (!i.variation_id || ok.has(i.variation_id))).reduce((a, i) => a + num(i.qty) * num(i.unit_price), 0);
}

/** חלוקה לכל פרויקטי הקבלן (לא יזם) מתוך נתוני הלקוח */
export function tenantOH(data, st, cur) {
  const lines = ohLines(st);
  const projects = (data.projects || []).filter(p => p.project_type !== 'dev').map(p => ({ ...p, sale: projectSale(data, p.id) }));
  return { lines, projects, ...allocateOH(lines, projects, cur) };
}
