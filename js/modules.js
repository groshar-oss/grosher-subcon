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
  fixed: { label: 'עלויות חודשיות קבועות', hint: 'מנהל עבודה, שמירה, מכולות, ביטוח וכו\': סכום קבוע לכל חודש מתאריך עד תאריך. נכנס לתזרים ולבקרה.', types: ['sub', 'dev'], tag: 'קבועות', def: {} }
};

const typeOf = p => (p?.project_type === 'dev' ? 'dev' : 'sub');
export const modulesFor = p => Object.entries(MODULES).filter(([, m]) => m.types.includes(typeOf(p)));

/** ברירת מחדל לפרויקט חדש לפי סוג */
export function defaultModules(type) {
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
  return Object.fromEntries(Object.entries(MODULES).filter(([, d]) => d.types.includes(type)).map(([k]) => [k, !!v['mod_' + k]]));
}
/** בטופס פרויקט חדש: כשמחליפים סוג, מציגים את המודולים של הסוג עם ברירת המחדל שלו */
export function syncModulesType(el, type) {
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
