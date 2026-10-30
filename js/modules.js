// מודולים בפרויקט: כל פרויקט מדליק רק מה שרלוונטי אליו. כיבוי מסתיר בלבד, הנתונים נשמרים.
// projects.modules = { workers: true, purchase: true, ... }. פרויקט ישן בלי הגדרה: החלקים הקיימים דלוקים, החדשים כבויים.

export const MODULES = {
  // חלקים שהיו בכל פרויקט, עכשיו לבחירה
  workers: { label: 'עובדים ויומן עבודה', hint: 'ימי עבודה, נוכחות ועלות עובדים מהיומן. לא צריך כשעובדים רק עם קבלני קבלנות.', types: ['sub'], tag: 'יומן', old: true, def: { sub: true } },
  purchase: { label: 'הזמנות רכש ותעודות משלוח', hint: 'הזמנות לספקים, אספקה, והתאמה לחשבוניות.', types: ['sub'], tag: 'רכש', old: true, def: { sub: true } },
  guarantees: { label: 'ערבויות', hint: 'ערבויות בנקאיות עם תוקף והתרעה לפני שפג.', types: ['sub', 'dev'], tag: 'ערבויות', old: true, def: {} },
  fines: { label: 'קנסות בחשבונות', hint: 'קנסות וניכויים מיוחדים שהקבלן הראשי מוריד בחשבון.', types: ['sub'], tag: 'קנסות', old: true, def: {} },
  // מודולים חדשים: כבויים כברירת מחדל
  index: { label: 'הצמדה למדד', hint: 'מדד בסיס לפרויקט, מדד חודשי משותף לכל הפרויקטים, והפרש הצמדה בחשבונות ובתזרים. ההפרש לא נספר כחריגה.', types: ['sub', 'dev'], tag: 'מדד', def: {} },
  spread: { label: 'פריסה ארוכה (קומות ועקומת S)', hint: 'לפרויקט ארוך: ההכנסות והעלויות העתידיות בתזרים מתפזרות לפי עקומת S או לפי לו"ז של קומות ושלבים, במקום סכום שווה בכל חודש.', types: ['sub', 'dev'], tag: 'פריסה', def: {} },
  sales: { label: 'מכירות דירות', hint: 'מלאי דירות, רוכשים ולוח תשלומים. דירה שנמכרת יוצרת לבד את תשלומי הרוכש בהכנסות, וקצב מכירות צפוי נכנס לתזרים.', types: ['dev'], tag: 'מכירות', def: {} },
  bank: { label: 'ליווי בנקאי', hint: 'מסגרת אשראי, הון עצמי נדרש ותנאי מכירות מוקדמות. סימולציה חודשית של משיכות, החזרים וריבית, והעברת המשיכות לתזרים.', types: ['dev'], tag: 'ליווי', def: {} },
  fixed: { label: 'עלויות חודשיות קבועות', hint: 'מנהל עבודה, שמירה, מכולות, ביטוח וכו\': סכום קבוע לכל חודש מתאריך עד תאריך. נכנס לתזרים ולבקרה.', types: ['sub', 'dev'], tag: 'קבועות', def: {} }
};

// פרויקט ביצוע עובד כמו קבלן משנה, עם אותם מודולים
const typeOf = p => (p?.project_type === 'dev' ? 'dev' : 'sub');
export const modulesFor = p => Object.entries(MODULES).filter(([, m]) => m.types.includes(typeOf(p)));

/** ברירת מחדל לפרויקט חדש לפי סוג */
export function defaultModules(type) {
  if (type === 'exec') type = 'sub';
  return Object.fromEntries(Object.entries(MODULES).filter(([, m]) => m.types.includes(type)).map(([k, m]) => [k, !!m.def[type]]));
}

/** מצב כל המודולים בפרויקט. פרויקט בלי הגדרה (מלפני חבילה 18): חלקים קיימים דלוקים, הצמדה לפי השדה הישן */
export function mods(p) {
  const t = typeOf(p), m = p?.modules && typeof p.modules === 'object' ? p.modules : null;
  const out = {};
  for (const [k, d] of Object.entries(MODULES)) {
    if (!d.types.includes(t)) { out[k] = false; continue; }
    if (m && k in m) out[k] = !!m[k];
    else if (d.old) out[k] = true;
    else if (k === 'index') out[k] = !!p?.indexation;
    else out[k] = false;
  }
  return out;
}
export const has = (p, k) => !!mods(p)[k];

/** תגיות קטנות לרשימת הפרויקטים: רק מודולים חדשים שדלוקים, וחלקים קיימים שכובו */
export function moduleTags(p) {
  const m = mods(p);
  return modulesFor(p).filter(([k, d]) => (d.old ? false : m[k])).map(([, d]) => `<span class="chip violet mtag">${d.tag}</span>`).join(' ');
}

/** חלק "מודולים בפרויקט" בטופס הפרויקט */
export function modulesFieldset(p, { isNew = false } = {}) {
  const row = (k, d, on, type) => `<label class="modrow" data-mtypes="${d.types.join(' ')}" ${d.types.includes(type) ? '' : 'hidden'}><input type="checkbox" name="mod_${k}" ${on ? 'checked' : ''}>
    <span><b>${d.label}</b><small>${d.hint}</small></span></label>`;
  const type = typeOf(p), cur = isNew ? defaultModules(type) : mods(p);
  return `<fieldset class="card mods"><legend class="small"><b>מודולים בפרויקט</b></legend>
    <p class="small mut" style="margin:0 0 8px">מדליקים רק מה שרלוונטי לפרויקט. כיבוי מסתיר את הלשונית והשדות, הנתונים נשמרים וחוזרים אם מדליקים שוב.</p>
    <div class="modgrid">${Object.entries(MODULES).map(([k, d]) => row(k, d, isNew ? defaultModules(d.types.includes(type) ? type : d.types[0])[k] : cur[k], type)).join('')}</div></fieldset>`;
}
/** קריאת הסימונים מהטופס */
export function readModules(v, type) {
  if (type === 'exec') type = 'sub';
  return Object.fromEntries(Object.entries(MODULES).filter(([, d]) => d.types.includes(type)).map(([k]) => [k, !!v['mod_' + k]]));
}
/** בטופס פרויקט חדש: כשמחליפים סוג, מציגים את המודולים של הסוג עם ברירת המחדל שלו */
export function syncModulesType(el, type) {
  if (type === 'exec') type = 'sub';
  const def = defaultModules(type);
  el.querySelectorAll('.modrow').forEach(r => { const ok = r.dataset.mtypes.split(' ').includes(type); r.hidden = !ok; const i = r.querySelector('input'); if (ok && r.dataset.touched !== '1') i.checked = !!def[i.name.slice(4)]; });
}
/** ערבות מוצגת רק אם מודול הערבויות דלוק בפרויקט שלה (ערבות בלי פרויקט תמיד מוצגת) */
export const guarVisible = data => { const byId = Object.fromEntries((data.projects || []).map(p => [p.id, p])); return g => !g.project_id || !byId[g.project_id] || has(byId[g.project_id], 'guarantees'); };

// ---- מדד ----
/** המדד האחרון שפורסם עד חודש מסוים (כולל). series: [{ month: 'YYYY-MM', value }] */
export function latestIndex(series = [], upto = '9999-12') {
  let best = null;
  for (const s of series) if (s.month <= upto && Number(s.value) > 0 && (!best || s.month > best.month)) best = s;
  return best;
}
/** שיעור ההצמדה (0.021 = 2.1%) לפי מדד בסיס והמדד האחרון. אין בסיס או מדד: 0 */
export function indexRate(base, series, upto) {
  const b = Number(base) || 0, l = latestIndex(series, upto);
  return b > 0 && l ? Number(l.value) / b - 1 : 0;
}

// ---- עלויות חודשיות קבועות ----
const ym = m => { const [y, mo] = String(m).split('-').map(Number); return y * 12 + mo - 1; };
const ymStr = k => `${Math.floor(k / 12)}-${String(k % 12 + 1).padStart(2, '0')}`;
/** רשימת החודשים של עלות קבועה, אפשר לחתוך מחודש מסוים */
export function fixedMonths(fc, from = '0000-01') {
  const out = [], a = Math.max(ym(fc.from_month), ym(from)), b = ym(fc.to_month);
  for (let k = a; k <= b; k++) out.push(ymStr(k));
  return out;
}
export const fixedTotal = fc => (Number(fc.amount) || 0) * fixedMonths(fc).length;
/** מה שנשאר מהחודש הנוכחי והלאה */
export const fixedLeft = (fc, cur) => (Number(fc.amount) || 0) * fixedMonths(fc, cur).length;

// ---- פריסה ארוכה ----
export const CURVES = { linear: 'שווה בכל חודש', s: 'עקומת S (איטי בהתחלה ובסוף)' };
const smooth = x => x <= 0 ? 0 : x >= 1 ? 1 : 3 * x * x - 2 * x * x * x;
/** משקל לכל חודש בכל הפרויקט (סכום 1). שלבים/קומות: כל שלב מתחלק שווה בחודשים שלו לפי המשקל שלו. אחרת: עקומה מתחילת הפרויקט עד הסוף */
export function projectCurve(spread, allMonths) {
  const n = allMonths.length; if (!n) return [];
  const floors = (spread?.floors || []).filter(f => /^\d{4}-\d{2}$/.test(f.from_month || '') && /^\d{4}-\d{2}$/.test(f.to_month || '') && f.to_month >= f.from_month && Number(f.weight) > 0);
  let w;
  if (floors.length) {
    const tot = floors.reduce((a, f) => a + Number(f.weight), 0);
    w = allMonths.map(() => 0);
    for (const f of floors) { const ms = fixedMonths(f); for (const m of ms) { const i = allMonths.indexOf(m < allMonths[0] ? allMonths[0] : m > allMonths[n - 1] ? allMonths[n - 1] : m); w[i] += Number(f.weight) / tot / ms.length; } }
  } else if (spread?.curve === 's') w = allMonths.map((_, i) => smooth((i + 1) / n) - smooth(i / n));
  else w = allMonths.map(() => 1 / n);
  return w;
}
/**
 * משקלים לחודשים שנשארו (סכום 1). p: הפרויקט, months: החודשים מהיום עד הסוף.
 * בלי מודול הפריסה (או בלי תאריך התחלה ועקומה): שווה בכל חודש, כמו קודם.
 */
export function spreadWeights(p, months) {
  const flat = months.map(() => 1 / (months.length || 1));
  if (!months.length || !has(p, 'spread')) return flat;
  const sp = p.spread || {};
  const first = [p.start_date ? String(p.start_date).slice(0, 7) : months[0], ...(sp.floors || []).map(f => f.from_month).filter(Boolean)].sort()[0];
  const last = [months[months.length - 1], ...(sp.floors || []).map(f => f.to_month).filter(Boolean)].sort().pop();
  const all = fixedMonths({ from_month: first < months[0] ? first : months[0], to_month: last });
  const w = projectCurve(sp, all);
  // היתרה מתחלקת לפי צורת העקומה בחודשים שנשארו (מניחים שהפרויקט בלו"ז)
  const out = months.map(m => { const i = all.indexOf(m); return i < 0 ? 0 : w[i]; });
  const tot = out.reduce((a, x) => a + x, 0);
  return tot > 0 ? out.map(x => x / tot) : flat;
}
/** סוף הלו"ז לפי השלבים (אם השלבים נגמרים אחרי תאריך הסיום) */
export const spreadEnd = p => has(p, 'spread') ? ((p.spread?.floors || []).map(f => f.to_month).filter(m => /^\d{4}-\d{2}$/.test(m || '')).sort().pop() || null) : null;
