// מודול "פריסה ארוכה": עורך עקומה ושלבים/קומות בהגדרות הפרויקט, עם תצוגה מקדימה של האחוז לכל חודש.
// הנתונים נשמרים ב-projects.spread = { curve: 'linear' | 's', floors: [{ name, from_month, to_month, weight }] }
import { esc, $, $$ } from '../util.js';
import { CURVES, projectCurve, fixedMonths } from '../modules.js';
import { monthLabel, addMonths } from '../cashflow.js';

const okM = m => /^\d{4}-\d{2}$/.test(m || '');

export function spreadBlock(p, { isNew = false, on = false } = {}) {
  const sp = p.spread || {};
  return `<div class="spreadonly card" ${on ? '' : 'hidden'} style="margin:8px 0;padding:12px">
    <h3 style="margin:0 0 6px">פריסה לאורך הפרויקט</h3>
    <p class="small mut" style="margin:0 0 8px">קובע איך היתרה לגבייה והיתרה לתשלום מתפזרות בתזרים. עם שלבים, כל שלב מקבל את המשקל שלו בחודשים שלו. בלי שלבים, לפי העקומה שנבחרה, מתאריך ההתחלה עד הסיום.</p>
    <div class="seg" id="spcurve" style="margin-bottom:8px">${Object.entries(CURVES).map(([k, l]) => `<button type="button" data-k="${k}" class="${(sp.curve || 's') === k ? 'on' : ''}">${l}</button>`).join('')}</div>
    <details ${(sp.floors || []).length ? 'open' : ''}><summary class="small"><b>שלבים / קומות</b> <span class="mut">(רשות)</span></summary>
      <div class="actions" style="margin:8px 0;flex-wrap:wrap;gap:6px">
        <label class="small">מספר קומות <input id="spn" type="number" min="1" max="80" value="" style="width:70px" dir="ltr"></label>
        <label class="small">החל מ <input id="spm" type="month" value="${esc(p.start_date ? String(p.start_date).slice(0, 7) : '')}" style="width:150px"></label>
        <label class="small">חודשים לקומה <input id="spk" type="number" min="1" max="12" value="1" style="width:60px" dir="ltr"></label>
        <button type="button" class="btn small ghost" id="spgen">יצירת קומות</button>
        <button type="button" class="btn small ghost" id="spadd">+ שלב</button></div>
      <div class="tw" style="box-shadow:none"><table><thead><tr><th>שלב / קומה</th><th>מחודש</th><th>עד חודש</th><th class="n">משקל %</th><th></th></tr></thead><tbody id="spt"></tbody></table></div>
      <p class="small mut" id="spsum"></p></details>
    <div id="spprev" style="margin-top:8px"></div>
    <input type="hidden" name="spread_json" value="${esc(JSON.stringify({ curve: sp.curve || 's', floors: sp.floors || [] }))}">
  </div>`;
}

/** חיבור העורך. נקרא מ-wireModules */
export function wireSpread(el) {
  const box = $('.spreadonly', el); if (!box) return;
  const hid = $('[name=spread_json]', box);
  let st; try { st = JSON.parse(hid.value); } catch { st = { curve: 's', floors: [] }; }
  const save = () => { hid.value = JSON.stringify(st); };
  const start = () => $('[name=start_date]', el)?.value?.slice(0, 7) || '';
  const end = () => $('[name=end_date]', el)?.value?.slice(0, 7) || '';
  const draw = () => {
    $('#spt', box).innerHTML = st.floors.map((f, i) => `<tr><td><input data-i="${i}" data-f="name" value="${esc(f.name || '')}" style="min-width:110px"></td>
      <td><input data-i="${i}" data-f="from_month" type="month" value="${esc(f.from_month || '')}" style="width:150px"></td><td><input data-i="${i}" data-f="to_month" type="month" value="${esc(f.to_month || '')}" style="width:150px"></td>
      <td class="n"><input data-i="${i}" data-f="weight" type="number" step="any" dir="ltr" value="${esc(f.weight ?? '')}" style="width:80px"></td><td><button type="button" class="btn small ghost" data-del="${i}" aria-label="מחיקה">✕</button></td></tr>`).join('')
      || '<tr><td colspan="5" class="empty small">אין שלבים. הפריסה לפי העקומה.</td></tr>';
    const tot = st.floors.reduce((a, f) => a + (Number(f.weight) || 0), 0);
    $('#spsum', box).textContent = st.floors.length ? `סה"כ משקל ${Math.round(tot * 10) / 10}%. ${Math.abs(tot - 100) > 0.5 ? 'המשקלים מנורמלים ל-100% בחישוב.' : ''}` : '';
    $$('#spt input', box).forEach(inp => inp.oninput = () => { const f = st.floors[+inp.dataset.i]; f[inp.dataset.f] = inp.dataset.f === 'weight' ? (inp.value === '' ? null : Number(inp.value)) : inp.value; save(); preview(); });
    $$('#spt [data-del]', box).forEach(b => b.onclick = () => { st.floors.splice(+b.dataset.del, 1); save(); draw(); });
    preview();
  };
  // תצוגה מקדימה: אחוז לכל חודש מתחילת הפרויקט עד הסוף
  const preview = () => {
    const ends = st.floors.map(f => f.to_month).filter(okM), starts = st.floors.map(f => f.from_month).filter(okM);
    const a = [start(), ...starts].filter(okM).sort()[0], b = [end(), ...ends].filter(okM).sort().pop();
    const host = $('#spprev', box);
    if (!a || !b || b < a) { host.innerHTML = '<p class="small mut">לתצוגה מקדימה צריך תאריך התחלה ותאריך סיום בפרויקט.</p>'; return; }
    const ms = fixedMonths({ from_month: a, to_month: b }).slice(0, 120);
    const w = projectCurve(st, ms), mx = Math.max(...w, 0.0001);
    let cum = 0;
    host.innerHTML = `<div class="small mut" style="margin-bottom:4px">אחוז מהעבודה בכל חודש (העמודה) ומצטבר (בריחוף)</div>
      <div class="spbars">${ms.map((m, i) => { cum += w[i]; return `<div title="${monthLabel(m)}: ${(w[i] * 100).toFixed(1)}% · מצטבר ${(cum * 100).toFixed(0)}%"><i style="height:${Math.max(2, w[i] / mx * 56)}px"></i>${ms.length <= 24 || i % Math.ceil(ms.length / 12) === 0 ? `<span>${monthLabel(m)}</span>` : ''}</div>`; }).join('')}</div>`;
  };
  $$('#spcurve button', box).forEach(btn => btn.onclick = () => { st.curve = btn.dataset.k; $$('#spcurve button', box).forEach(x => x.classList.toggle('on', x === btn)); save(); preview(); });
  $('#spadd', box).onclick = () => { const last = st.floors[st.floors.length - 1]; const m = last && okM(last.to_month) ? addMonths(last.to_month, 1) : start() || new Date().toISOString().slice(0, 7);
    st.floors.push({ name: `שלב ${st.floors.length + 1}`, from_month: m, to_month: m, weight: 10 }); save(); draw(); };
  $('#spgen', box).onclick = () => {
    const nF = Math.min(80, Math.max(1, Math.round(Number($('#spn', box).value) || 0))), k = Math.max(1, Math.round(Number($('#spk', box).value) || 1)), m0 = $('#spm', box).value;
    if (!nF || !okM(m0)) { $('#spsum', box).textContent = 'כדי ליצור קומות צריך מספר קומות וחודש התחלה.'; return; }
    const w = Math.round(1000 / nF) / 10;
    st.floors = Array.from({ length: nF }, (_, i) => ({ name: `קומה ${i + 1}`, from_month: addMonths(m0, i * k), to_month: addMonths(m0, i * k + k - 1), weight: w }));
    save(); draw();
  };
  ['start_date', 'end_date'].forEach(nm => $(`[name=${nm}]`, el)?.addEventListener('change', preview));
  draw();
}

/** קריאה בשמירה */
export function readSpread(v) {
  try { const s = JSON.parse(v.spread_json || 'null'); if (!s) return null;
    return { curve: s.curve === 'linear' ? 'linear' : 's', floors: (s.floors || []).filter(f => okM(f.from_month) && okM(f.to_month)).map(f => ({ name: String(f.name || '').trim() || 'שלב', from_month: f.from_month, to_month: f.to_month < f.from_month ? f.from_month : f.to_month, weight: Number(f.weight) || 0 })) };
  } catch { return null; }
}
