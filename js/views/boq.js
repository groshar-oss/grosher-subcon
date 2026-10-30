// כתב כמויות (כולל קליטה מאקסל) ותמחיר ביצוע
import { h, esc, $, $$, modal, field, select, toast, money, pct, num, confirmBox, numOrNull } from '../util.js';
import { db } from '../db.js';
import { S, can, render, logChange, settings } from '../app.js';
import { n, COST_KINDS, itemSale, itemPlanned, lineCost } from '../calc.js';
import { LABOR_TYPES } from '../quota.js';
import { readWorkbook, bestSheet, parseBoq, COLS, loadXLSX } from '../import.js';
import { groupBy } from './project.js';

const BILLING = { measure: 'מדידה', lump: 'פאושלי', percent: 'אחוז ביצוע' };
const UNITS = ['מ"ר', 'מ"א', "יח'", "קומפ'", 'מ"ק', 'טון', 'ק"ג', 'יום', 'שעה', 'ליטר'];

// ===== כתב כמויות =====
export function tabBoq(P, variationId = null, { dev = false } = {}) {
  const items = P.pd.items.filter(i => (i.variation_id || null) === variationId);
  const word = dev ? 'תקציב' : 'כתב כמויות';
  const total = items.reduce((s, i) => s + itemSale(i), 0);
  const el = h(`<div>
    ${can.edit() ? `<div class="actions" style="margin-bottom:12px"><button class="btn" id="add">+ סעיף</button>${variationId ? '' : `<button class="btn ghost" id="imp">${dev ? 'קליטת תקציב מאקסל' : 'קליטה מאקסל'}</button>`}${variationId ? '' : '<input type="file" id="file" accept=".xlsx,.xls,.csv" hidden>'}<button class="btn ghost" id="exp">ייצוא לאקסל</button></div>` : ''}
    <div class="tw"><table><thead><tr><th>קוד</th><th>תיאור</th><th>יח'</th><th class="n">כמות</th><th class="n">${dev ? 'מחיר תקציב' : "מחיר יח'"}</th><th class="n">סה"כ</th><th class="hide-m">${dev ? '' : 'חיוב'}</th>${can.edit() ? '<th></th>' : ''}</tr></thead><tbody id="tb"></tbody></table></div></div>`);
  const tb = $('#tb', el);
  const cols = can.edit() ? 8 : 7;
  if (!items.length) tb.innerHTML = `<tr><td colspan="${cols}" class="empty">אין סעיפים. ${variationId ? '' : `אפשר להוסיף ידנית או לקלוט קובץ אקסל של ה${word}${dev ? ' (למשל מתוכנת התמחור)' : ''}.`}</td></tr>`;
  for (const [ch, rs] of groupBy(items, i => i.chapter || 'ללא פרק')) {
    if (!variationId) tb.insertAdjacentHTML('beforeend', `<tr class="sec"><td colspan="${cols}">${esc(ch)} <span class="mut small">· ${money(rs.reduce((s, i) => s + itemSale(i), 0))}</span></td></tr>`);
    for (const i of rs) {
      const miss = !n(i.qty) || !n(i.unit_price);
      tb.insertAdjacentHTML('beforeend', `<tr${miss ? ' class="al-r"' : ''}><td>${esc(i.code || '')}</td><td class="wrap">${esc(i.description)}${miss ? ' <span class="chip red">חסר מחיר או כמות</span>' : ''}</td><td>${esc(i.unit || '')}</td>
        <td class="n">${num(i.qty)}</td><td class="n">${money(i.unit_price, { unit: true })}</td><td class="n">${money(itemSale(i))}</td><td class="hide-m">${dev ? '' : BILLING[i.billing_method] || ''}</td>
        ${can.edit() ? `<td><button class="btn small ghost" data-ed="${i.id}">עריכה</button> <button class="btn small ghost" data-del="${i.id}" aria-label="מחיקה">✕</button></td>` : ''}</tr>`);
    }
  }
  if (items.length) tb.insertAdjacentHTML('beforeend', `<tr class="tot"><td></td><td>סה"כ ${variationId ? 'הוראת שינוי' : word} (${items.length} סעיפים)</td><td></td><td></td><td></td><td class="n">${money(total)}</td><td class="hide-m"></td>${can.edit() ? '<td></td>' : ''}</tr>`);

  $('#add', el)?.addEventListener('click', () => itemDialog(P, null, variationId));
  $$('[data-ed]', el).forEach(b => b.onclick = () => itemDialog(P, items.find(i => i.id === b.dataset.ed), variationId));
  $$('[data-del]', el).forEach(b => b.onclick = async () => {
    const it = items.find(i => i.id === b.dataset.del);
    const hasExp = P.pd.expenses.some(e => e.boq_item_id === it.id);
    if (!(await confirmBox('מחיקת סעיף', `למחוק את "${it.description}"? התמחיר שלו יימחק.${hasExp ? ' הוצאות שמשויכות אליו יעברו ל"כללי לפרויקט".' : ''}`, 'מחיקה', true))) return;
    await db.remove('boq_items', it.id);
    await logChange({ project_id: P.id, entity: 'boq_item', entity_id: it.id, label: `${it.code || ''} ${it.description}`, field: 'מחיקת סעיף', old_value: itemSale(it), new_value: null });
    toast('הסעיף נמחק'); render();
  });
  $('#exp', el)?.addEventListener('click', () => exportBoq(P, items));
  const file = $('#file', el);
  $('#imp', el)?.addEventListener('click', () => file.click());
  file?.addEventListener('change', async () => { if (file.files[0]) await importFlow(P, file.files[0]); file.value = ''; });
  return el;
}

export async function itemDialog(P, it, variationId = null) {
  const chapters = [...new Set(P.pd.items.map(i => i.chapter).filter(Boolean))];
  const body = `<datalist id="chl">${chapters.map(c => `<option value="${esc(c)}">`).join('')}</datalist><datalist id="unl">${UNITS.map(u => `<option value="${esc(u)}">`).join('')}</datalist>
    <div class="grid g2">${field('פרק', 'chapter', it?.chapter ?? (variationId ? 'הוראות שינוי' : chapters.at(-1) || ''), { attrs: 'list="chl"' })}${field('קוד סעיף', 'code', it?.code, { attrs: 'dir="auto"' })}</div>
    ${field('תיאור', 'description', it?.description, { req: true })}
    <div class="grid g3">${field('יחידה', 'unit', it?.unit, { attrs: 'list="unl"' })}${field('כמות', 'qty', it?.qty, { type: 'number' })}${field('מחיר יחידה ₪', 'unit_price', it?.unit_price, { type: 'number' })}</div>
    ${select('שיטת חיוב', 'billing_method', BILLING, it?.billing_method || 'measure')}
    ${it ? field('סיבת השינוי (אם שינית כמות או מחיר)', 'reason', '') : ''}`;
  const v = await modal({ title: it ? 'עריכת סעיף' : 'סעיף חדש', body, validate: d => {
    if (!d.description.trim()) return 'חסר תיאור';
    if (!n(d.qty) || !n(d.unit_price)) return null; // מותר, יסומן באדום
    return null;
  } });
  if (!v) return;
  const row = { chapter: v.chapter.trim() || null, code: v.code.trim() || null, description: v.description.trim(), unit: v.unit.trim() || null, qty: numOrNull(v.qty), unit_price: numOrNull(v.unit_price), billing_method: v.billing_method };
  if (it) {
    await db.update('boq_items', it.id, row);
    for (const k of ['qty', 'unit_price', 'description', 'code']) if (String(it[k] ?? '') !== String(row[k] ?? ''))
      await logChange({ project_id: P.id, entity: 'boq_item', entity_id: it.id, label: `${row.code || ''} ${row.description}`, field: { qty: 'כמות', unit_price: 'מחיר יחידה', description: 'תיאור', code: 'קוד' }[k], old_value: it[k], new_value: row[k], reason: v.reason });
  } else {
    const sort = Math.max(0, ...P.pd.items.map(i => n(i.sort))) + 1;
    const [ni] = await db.insert('boq_items', { tenant_id: S.tenantId, project_id: P.id, variation_id: variationId, progress_pct: 0, sort, ...row });
    await logChange({ project_id: P.id, entity: 'boq_item', entity_id: ni.id, label: `${row.code || ''} ${row.description}`, field: 'סעיף חדש', new_value: n(row.qty) * n(row.unit_price) });
  }
  if (!n(row.qty) || !n(row.unit_price)) toast('נשמר. לסעיף חסר מחיר או כמות, והוא מסומן באדום.', 'bad'); else toast('נשמר');
  render();
}

async function exportBoq(P, items) {
  const XLSX = await loadXLSX();
  const rows = [['פרק', 'קוד', 'תיאור', 'יחידה', 'כמות', 'מחיר יחידה', 'סה"כ', 'שיטת חיוב']].concat(items.map(i => [i.chapter || '', i.code || '', i.description, i.unit || '', n(i.qty), n(i.unit_price), itemSale(i), BILLING[i.billing_method]]));
  const ws = XLSX.utils.aoa_to_sheet(rows); ws['!cols'] = [{ wch: 18 }, { wch: 10 }, { wch: 50 }, { wch: 8 }, { wch: 10 }, { wch: 12 }, { wch: 14 }, { wch: 10 }];
  const wb = XLSX.utils.book_new(); wb.Workbook = { Views: [{ RTL: true }] }; XLSX.utils.book_append_sheet(wb, ws, 'כתב כמויות');
  XLSX.writeFile(wb, `כתב כמויות - ${P.project.name.replace(/[\\/:*?"<>|·]/g, '-')}.xlsx`);
}

// ===== קליטה מאקסל =====
async function importFlow(P, file) {
  let sheets;
  try { sheets = await readWorkbook(file); } catch (e) { return toast('לא הצלחנו לקרוא את הקובץ: ' + e.message, 'bad'); }
  let cur = bestSheet(sheets) || { ...sheets[0], parsed: parseBoq(sheets[0].rows) };
  let map = cur.parsed.ok ? { ...cur.parsed.map, headerRow: cur.parsed.headerRow } : { headerRow: 0 };
  const existing = P.pd.items.filter(i => !i.variation_id);
  const v = await modal({ title: `קליטת כתב כמויות: ${file.name}`, wide: true, ok: 'קליטה', body: '<div id="impbox"></div>', onMount: el => {
    const box = $('#impbox', el);
    const draw = () => {
      const p = parseBoq(cur.rows, map);
      const hdr = cur.rows[map.headerRow] || [];
      const colOpts = sel => `<option value="">—</option>` + Array.from({ length: Math.max(...cur.rows.slice(0, 50).map(r => r.length), 1) }, (_, c) => `<option value="${c}" ${String(sel) === String(c) ? 'selected' : ''}>${esc(String(hdr[c] || '').slice(0, 24) || 'עמודה ' + (c + 1))}</option>`).join('');
      if (!p.ok) { box.innerHTML = `<p class="neg">${esc(p.error)}</p>`; return; }
      const miss = p.items.filter(i => i.missing.length);
      const diff = p.hasFileTotal ? p.calcTotal - p.fileTotal : 0;
      box.innerHTML = `
        ${sheets.length > 1 ? `<label class="fld"><span>גיליון</span><select id="sh">${sheets.map(s => `<option ${s.name === cur.name ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></label>` : ''}
        <div class="grid g4">${Object.entries(COLS).map(([k, l]) => `<label class="fld"><span>${l}</span><select data-col="${k}">${colOpts(map[k])}</select></label>`).join('')}
        <label class="fld"><span>שורת כותרות</span><input type="number" id="hr" min="1" value="${map.headerRow + 1}" dir="ltr"></label></div>
        <div class="kpis" style="grid-template-columns:repeat(4,1fr)">
          <div class="kpi"><div class="l">סעיפים</div><div class="v">${p.items.length}</div><div class="n">דילגנו על ${p.skipped} שורות כותרת, סיכום וחלופות</div></div>
          <div class="kpi"><div class="l">סה"כ מחושב (כמות × מחיר)</div><div class="v">${money(p.calcTotal)}</div></div>
          <div class="kpi"><div class="l">סה"כ לפי הקובץ</div><div class="v">${p.hasFileTotal ? money(p.fileTotal) : '<span class="mut small">אין עמודת סה"כ</span>'}</div><div class="n ${Math.abs(diff) > 1 ? 'neg' : 'pos'}">${p.hasFileTotal ? (Math.abs(diff) > 1 ? 'פער ' + money(diff) : 'תואם') : ''}</div></div>
          <div class="kpi"><div class="l">חסר מחיר או כמות</div><div class="v ${miss.length ? 'neg' : 'pos'}">${miss.length}</div></div></div>
        ${miss.length ? `<div class="note"><b>${miss.length} סעיפים בלי מחיר או כמות:</b> ${miss.slice(0, 8).map(i => esc(`${i.code} ${i.description}`.trim()) + ` (${i.missing.join(', ')}, שורה ${i.row})`).join(' · ')}${miss.length > 8 ? ' …' : ''}
          <label class="chk" style="margin:8px 0 0"><input type="checkbox" name="force"> לקלוט בכל זאת (הסעיפים יסומנו באדום)</label></div>` : ''}
        ${existing.length ? `<label class="fld"><span>כבר יש ${existing.length} סעיפים בפרויקט</span><select name="how"><option value="append">להוסיף לקיימים</option><option value="replace">להחליף את כתב הכמויות הקיים (כולל התמחיר שלו)</option></select></label>` : ''}
        <div class="tw" style="max-height:340px;overflow:auto"><table><thead><tr><th>פרק</th><th>קוד</th><th>תיאור</th><th>יח'</th><th class="n">כמות</th><th class="n">מחיר</th><th class="n">סה"כ</th></tr></thead><tbody>
        ${p.items.slice(0, 400).map(i => `<tr class="${i.missing.length ? 'al-r' : ''}"><td class="small">${esc(i.chapter)}</td><td>${esc(i.code)}</td><td class="wrap">${esc(i.description)}</td><td>${esc(i.unit)}</td><td class="n">${num(i.qty)}</td><td class="n">${money(i.unit_price, { unit: true })}</td><td class="n">${money(n(i.qty) * n(i.unit_price))}</td></tr>`).join('')}
        </tbody></table></div>`;
      box._parsed = p;
      $$('[data-col]', box).forEach(s => s.onchange = () => { map[s.dataset.col] = s.value === '' ? undefined : +s.value; draw(); });
      $('#hr', box).onchange = e => { map.headerRow = Math.max(0, +e.target.value - 1); draw(); };
      $('#sh', box)?.addEventListener('change', e => { cur = sheets.find(s => s.name === e.target.value); const pp = parseBoq(cur.rows); map = pp.ok ? { ...pp.map, headerRow: pp.headerRow } : { headerRow: 0 }; draw(); });
    };
    draw();
  }, validate: (d, form) => {
    const p = $('#impbox', form)._parsed;
    if (!p?.ok || !p.items.length) return 'לא נמצאו סעיפים לקליטה';
    if (p.items.some(i => i.missing.length) && !d.force) return 'יש סעיפים בלי מחיר או כמות. סמן "לקלוט בכל זאת" או תקן את הקובץ.';
    return null;
  } });
  if (!v) return;
  const p = parseBoq(cur.rows, map);
  if (v.how === 'replace') {
    if (!(await confirmBox('החלפת כתב כמויות', `${existing.length} הסעיפים הקיימים והתמחיר שלהם יימחקו.`, 'החלפה', true))) return;
    await db.removeWhere('boq_items', { eq: { project_id: P.id }, isNull: ['variation_id'], in: { id: existing.map(i => i.id) } });
  }
  let sort = v.how === 'replace' ? 0 : Math.max(0, ...P.pd.items.map(i => n(i.sort))) + 1;
  const rows = p.items.map(i => ({ tenant_id: S.tenantId, project_id: P.id, variation_id: null, chapter: i.chapter || null, code: i.code || null, description: i.description, unit: i.unit || null, qty: i.qty, unit_price: i.unit_price, billing_method: 'measure', progress_pct: 0, sort: sort++ }));
  await db.insert('boq_items', rows);
  await logChange({ project_id: P.id, entity: 'boq', label: `קליטת כתב כמויות מ-${file.name}`, field: v.how === 'replace' ? 'החלפה' : 'הוספה', new_value: `${rows.length} סעיפים, ${Math.round(p.calcTotal).toLocaleString('en-US')} ₪` });
  toast(`נקלטו ${rows.length} סעיפים`); render();
}

// ===== תמחיר =====
const TEMPLATES = {
  'גבס - קיר': [['material', 'לוחות, פרופילים וברגים', 1, 5], ['piece', 'התקנה בקבלנות', 1, 0], ['transport', 'הובלה והנפה', 0, 0]],
  'גבס - תקרה': [['material', 'לוחות ותלייה', 1, 5], ['piece', 'התקנה בקבלנות', 1, 0], ['equipment', 'במות / פיגומים', 0, 0]],
  'תקרה מינרלית': [['material', 'אריחים ופרופילים', 1, 5], ['piece', 'התקנה בקבלנות', 1, 0]],
  'טיח': [['material', 'טיח ורשתות', 1, 8], ['piece', 'טיח בקבלנות', 1, 0]],
  'ריצוף': [['material', 'אריחים', 1, 7], ['material', 'דבק ורובה', 1, 5], ['piece', 'ריצוף בקבלנות', 1, 0]],
  'צבע': [['material', 'צבע ושפכטל', 1, 8], ['piece', 'צביעה בקבלנות', 1, 0]],
  'חשמל': [['material', 'כבלים, צנרת ואביזרים', 1, 5], ['labor', 'חשמלאי (ימי עבודה)', 0, 0]],
  'אינסטלציה': [['material', 'צנרת ואביזרים', 1, 5], ['labor', 'שרברב (ימי עבודה)', 0, 0]],
  'מיזוג אוויר': [['material', 'יחידות וצנרת', 1, 3], ['sub', 'קבלן תעלות', 0, 0], ['labor', 'טכנאי (ימי עבודה)', 0, 0]]
};

export function tabCosting(P) {
  const oh = n(P.project.overhead_pct);
  const linesBy = {}; for (const l of P.pd.lines) (linesBy[l.boq_item_id] ||= []).push(l);
  const vos = Object.fromEntries(P.pd.variations.map(v => [v.id, v]));
  const groups = groupBy(P.pd.items, i => i.variation_id ? `הוראת שינוי ${vos[i.variation_id]?.number || ''} · ${vos[i.variation_id]?.title || ''}` : (i.chapter || 'ללא פרק'));
  let T = { sale: 0, plan: 0 };
  const el = h(`<div>
    <div class="actions" style="margin-bottom:12px">${can.edit() ? '<button class="btn ghost" id="copy">העתקת תמחיר מפרויקט אחר</button>' : ''}<span class="mut small">תקורה בפרויקט: ${oh}% מהעלות הישירה (משנים בהגדרות הפרויקט)</span></div>
    <div class="tw"><table><thead><tr><th>קוד</th><th>תיאור</th><th class="n">כמות</th><th class="n">מכירה</th><th class="n">עלות ישירה</th><th class="n">תמחיר כולל</th><th class="n">עלות ליח'</th><th class="n">מחיר ליח'</th><th class="n">רווח מתוכנן</th><th class="n">% רווח</th><th></th></tr></thead><tbody id="tb"></tbody></table></div></div>`);
  const tb = $('#tb', el);
  if (!P.pd.items.length) tb.innerHTML = `<tr><td colspan="11" class="empty">אין סעיפים. <a href="#/project/${P.id}/boq">לכתב הכמויות</a></td></tr>`;
  for (const [g, rs] of groups) {
    tb.insertAdjacentHTML('beforeend', `<tr class="sec"><td colspan="11">${esc(g)}</td></tr>`);
    for (const i of rs) {
      const ls = linesBy[i.id] || [], pl = itemPlanned(ls, oh), sale = itemSale(i), prof = sale - pl.total;
      T.sale += sale; T.plan += pl.total;
      const cls = !ls.length ? '' : prof < 0 ? 'al-dr' : '';
      tb.insertAdjacentHTML('beforeend', `<tr class="click ${cls}" data-cost="${i.id}"><td>${esc(i.code || '')}</td><td class="wrap">${esc(i.description)}${ls.length ? '' : ' <span class="chip amber">לא תומחר</span>'}${prof < 0 && ls.length ? ' <span class="chip red">הפסד מתוכנן</span>' : ''}</td>
        <td class="n">${num(i.qty)} <span class="small mut">${esc(i.unit || '')}</span></td><td class="n">${money(sale)}</td><td class="n">${money(pl.direct)}</td><td class="n">${money(pl.total)}</td>
        <td class="n">${n(i.qty) ? money(pl.total / n(i.qty), { unit: true }) : ''}</td><td class="n">${money(i.unit_price, { unit: true })}</td><td class="n">${ls.length ? money(prof) : ''}</td><td class="n">${ls.length && sale ? pct(prof / sale * 100) : ''}</td>
        <td><button class="btn small ${ls.length ? 'ghost' : ''}">${can.edit() ? (ls.length ? 'עריכה' : 'תמחור') : 'פירוט'}</button></td></tr>`);
    }
  }
  if (P.pd.items.length) tb.insertAdjacentHTML('beforeend', `<tr class="tot"><td></td><td>סה"כ (חוזה וכל הוראות השינוי)</td><td></td><td class="n">${money(T.sale)}</td><td></td><td class="n">${money(T.plan)}</td><td></td><td></td><td class="n">${money(T.sale - T.plan)}</td><td class="n">${pct(T.sale ? (T.sale - T.plan) / T.sale * 100 : 0)}</td><td></td></tr>`);
  $$('[data-cost]', el).forEach(r => r.onclick = () => costingEditor(P, P.pd.items.find(i => i.id === r.dataset.cost)));
  $('#copy', el)?.addEventListener('click', () => copyCosting(P));
  return el;
}

export async function costingEditor(P, item) {
  const oh = n(P.project.overhead_pct);
  const orig = P.pd.lines.filter(l => l.boq_item_id === item.id).sort((a, b) => n(a.sort) - n(b.sort));
  let lines = orig.map(l => ({ id: l.id, kind: l.kind, description: l.description || '', qty: l.qty ?? '', unit: l.unit || '', unit_cost: l.unit_cost ?? '', waste_pct: l.waste_pct ?? 0, labor_type: l.labor_type || '', crew: l.crew ?? '' }));
  const sale = itemSale(item);
  const ro = !can.edit();
  const actual = P.summary.rows.find(r => r.item.id === item.id)?.c.actual || 0;
  const needReason = orig.length && (n(item.progress_pct) > 0 || actual > 0);
  const others = P.pd.items.filter(i => i.id !== item.id && P.pd.lines.some(l => l.boq_item_id === i.id));
  const body = `<p class="small mut">${num(item.qty)} ${esc(item.unit || '')} × ${money(item.unit_price, { unit: true })} = <b>${money(sale)}</b> · תקורה ${oh}% · עבודה עצמית: עלות יום כולל עלות מעביד (מקדם ${settings().employer_factor})</p>
    ${ro ? '' : `<div class="actions" style="margin-bottom:10px"><button type="button" class="btn small" id="addl">+ שורה</button>
      <select id="tpl" style="width:auto;min-height:30px"><option value="">תבנית לפי מקצוע…</option>${Object.keys(TEMPLATES).map(k => `<option>${esc(k)}</option>`).join('')}</select>
      ${others.length ? `<select id="cp" style="width:auto;min-height:30px;max-width:260px"><option value="">העתקה מסעיף אחר…</option>${others.map(i => `<option value="${i.id}">${esc(`${i.code || ''} ${i.description}`.slice(0, 60))}</option>`).join('')}</select>` : ''}</div>`}
    <div class="tw" style="box-shadow:none"><table><thead><tr><th>סוג</th><th>תיאור</th><th class="n">כמות</th><th>יח'</th><th class="n">עלות ליח'</th><th class="n">פחת % / צוות</th><th class="n">סה"כ</th>${ro ? '' : '<th></th>'}</tr></thead><tbody id="lt"></tbody></table></div>
    <p class="small mut">בשורת עבודה עצמית: כמות = ימי עבודה. אפשר לציין סוג עובדים (שכירים / יומיים) ומספר עובדים ביום, ואז יומן העבודה מתריע כשמגיעים יותר עובדים או כשהימים נגמרים.</p>
    <div id="lsum"></div>${needReason && !ro ? field('סיבת תיקון התמחיר (חובה, כי הסעיף כבר בביצוע)', 'reason', '', { hint: 'למשל: תיקון טעות / שינוי מחיר ספק / שינוי שיטת ביצוע' }) : ''}`;
  const v = await modal({ title: `תמחיר: ${item.code || ''} ${item.description}`, body, wide: true, ok: ro ? null : 'שמירת תמחיר', cancel: ro ? 'סגירה' : 'ביטול',
    onMount: el => {
      const lt = $('#lt', el);
      const draw = () => {
        lt.innerHTML = lines.map((l, k) => ro ? `<tr><td>${COST_KINDS[l.kind]}</td><td>${esc(l.description)}</td><td class="n">${num(l.qty)}</td><td>${esc(l.unit)}</td><td class="n">${money(l.unit_cost, { unit: true })}</td><td class="n">${l.kind === 'material' ? num(l.waste_pct) : l.kind === 'labor' ? `${LABOR_TYPES[l.labor_type || '']}${n(l.crew) ? ' · ' + num(l.crew) + ' עובדים' : ''}` : ''}</td><td class="n">${money(lineCost(l))}</td></tr>`
          : `<tr data-k="${k}"><td><select data-f="kind" style="min-width:120px">${Object.entries(COST_KINDS).map(([a, b]) => `<option value="${a}" ${a === l.kind ? 'selected' : ''}>${b}</option>`).join('')}</select></td>
          <td><input data-f="description" value="${esc(l.description)}" style="min-width:160px"></td><td><input data-f="qty" type="number" step="any" dir="ltr" value="${esc(l.qty)}" style="width:90px"></td>
          <td><input data-f="unit" value="${esc(l.unit)}" style="width:70px" list="unl2"></td><td><input data-f="unit_cost" type="number" step="any" dir="ltr" value="${esc(l.unit_cost)}" style="width:100px"></td>
          <td>${l.kind === 'labor' ? `<div class="actions" style="flex-wrap:nowrap;gap:4px"><select data-f="labor_type" style="width:auto;min-height:30px" aria-label="סוג עובדים">${Object.entries(LABOR_TYPES).map(([a, b]) => `<option value="${a}" ${a === (l.labor_type || '') ? 'selected' : ''}>${b}</option>`).join('')}</select><input data-f="crew" type="number" step="any" dir="ltr" value="${esc(l.crew)}" style="width:56px" placeholder="צוות" title="מספר עובדים מתוכנן ביום"></div>`
            : `<input data-f="waste_pct" type="number" step="any" dir="ltr" value="${esc(l.waste_pct)}" style="width:64px" ${l.kind === 'material' ? '' : 'disabled'}>`}</td><td class="n" data-tot>${money(lineCost(l))}</td><td><button type="button" class="btn small ghost" data-rm aria-label="מחיקת שורה">✕</button></td></tr>`).join('')
          || `<tr><td colspan="8" class="empty">אין שורות עלות. הוסף שורה או בחר תבנית.</td></tr>`;
        lt.insertAdjacentHTML('beforeend', `<datalist id="unl2">${UNITS.map(u => `<option value="${esc(u)}">`).join('')}</datalist>`);
        sumUp();
        $$('[data-k]', lt).forEach(tr => {
          const k = +tr.dataset.k;
          $$('[data-f]', tr).forEach(inp => inp.oninput = inp.onchange = () => {
            lines[k][inp.dataset.f] = inp.value;
            if (inp.dataset.f === 'kind') { draw(); return; }
            $('[data-tot]', tr).innerHTML = money(lineCost(lines[k])); sumUp();
          });
          $('[data-rm]', tr).onclick = () => { lines.splice(k, 1); draw(); };
        });
      };
      const sumUp = () => {
        const pl = itemPlanned(lines, oh), prof = sale - pl.total;
        $('#lsum', el).innerHTML = `<div class="kpis" style="grid-template-columns:repeat(4,1fr)"><div class="kpi"><div class="l">עלות ישירה</div><div class="v">${money(pl.direct)}</div></div>
          <div class="kpi"><div class="l">תמחיר כולל תקורה</div><div class="v">${money(pl.total)}</div><div class="n">${n(item.qty) ? money(pl.total / n(item.qty), { unit: true }) + ' ליח\'' : ''}</div></div>
          <div class="kpi"><div class="l">רווח מתוכנן</div><div class="v ${prof < 0 ? 'neg' : 'pos'}">${money(prof)}</div></div><div class="kpi"><div class="l">אחוז רווח</div><div class="v ${prof < 0 ? 'neg' : ''}">${pct(sale ? prof / sale * 100 : 0)}</div></div></div>
          ${prof < 0 && lines.length ? '<div class="note neg">התמחיר גבוה ממחיר המכירה. הסעיף צפוי להפסיד.</div>' : ''}`;
      };
      draw();
      $('#addl', el)?.addEventListener('click', () => { lines.push({ kind: 'material', description: '', qty: item.qty ?? '', unit: item.unit || '', unit_cost: '', waste_pct: 0 }); draw(); });
      $('#tpl', el)?.addEventListener('change', e => {
        const t = TEMPLATES[e.target.value]; e.target.value = ''; if (!t) return;
        for (const [kind, description, perQty, waste] of t) lines.push({ kind, description, qty: perQty ? item.qty ?? '' : (kind === 'labor' ? '' : 1), unit: perQty ? item.unit || '' : (kind === 'labor' ? 'יום' : "קומפ'"), unit_cost: '', waste_pct: waste });
        draw();
      });
      $('#cp', el)?.addEventListener('change', e => {
        const src = P.pd.items.find(i => i.id === e.target.value); e.target.value = ''; if (!src) return;
        const ratio = n(src.qty) ? n(item.qty) / n(src.qty) : 1;
        for (const l of P.pd.lines.filter(l => l.boq_item_id === src.id)) {
          const perUnit = l.unit && src.unit && l.unit === src.unit;
          lines.push({ kind: l.kind, description: l.description || '', qty: perUnit ? Math.round(n(l.qty) * ratio * 100) / 100 : l.qty, unit: l.unit || '', unit_cost: l.unit_cost ?? '', waste_pct: l.waste_pct ?? 0, labor_type: l.labor_type || '', crew: l.crew ?? '' });
        }
        draw();
      });
    },
    validate: d => {
      if (lines.some(l => !String(l.description).trim() && !n(l.unit_cost))) return 'יש שורה ריקה. מלא תיאור ועלות או מחק אותה.';
      if (needReason && !String(d.reason || '').trim()) return 'הסעיף כבר בביצוע. כתוב סיבה לתיקון התמחיר.';
      return null;
    } });
  if (!v || ro) return;
  const before = itemPlanned(orig, oh).total, after = itemPlanned(lines, oh).total;
  // עדכון במקום (שומר קישורים מהזמנות, הוצאות ויומן לשורות התמחיר)
  const rowOf = (l, k) => ({ kind: l.kind, description: l.description, qty: numOrNull(l.qty), unit: l.unit || null, unit_cost: numOrNull(l.unit_cost), waste_pct: l.kind === 'material' ? n(l.waste_pct) : 0,
    labor_type: l.kind === 'labor' ? (l.labor_type || null) : null, crew: l.kind === 'labor' ? numOrNull(l.crew) : null, sort: k });
  const keep = new Set(lines.filter(l => l.id).map(l => l.id));
  for (const o of orig) if (!keep.has(o.id)) await db.remove('cost_lines', o.id);
  for (const [k, l] of lines.entries()) if (l.id) await db.update('cost_lines', l.id, rowOf(l, k));
  const fresh = lines.map((l, k) => [l, k]).filter(([l]) => !l.id);
  if (fresh.length) await db.insert('cost_lines', fresh.map(([l, k]) => ({ tenant_id: S.tenantId, project_id: P.id, boq_item_id: item.id, ...rowOf(l, k) })));
  if (Math.round(before) !== Math.round(after)) await logChange({ project_id: P.id, entity: 'costing', entity_id: item.id, label: `תמחיר ${item.code || ''} ${item.description}`, field: 'תמחיר כולל', old_value: Math.round(before), new_value: Math.round(after), reason: v.reason || (orig.length ? '' : 'תמחיר ראשון') });
  toast('התמחיר נשמר'); render();
}

async function copyCosting(P) {
  const projects = (await db.select('projects', { eq: { tenant_id: S.tenantId } })).filter(p => p.id !== P.id);
  if (!projects.length) return toast('אין פרויקטים אחרים ללקוח הזה', 'bad');
  const v = await modal({ title: 'העתקת תמחיר מפרויקט אחר', body: `<p class="small mut">מעתיק תמחיר לסעיפים שעדיין לא תומחרו, לפי קוד סעיף זהה ואם אין, לפי תיאור זהה. כמויות שנמדדות לפי יחידת הסעיף מותאמות לכמות בפרויקט הזה.</p>
    <label class="fld"><span>פרויקט מקור</span><select name="src">${projects.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select></label>`, ok: 'העתקה' });
  if (!v) return;
  const [sItems, sLines] = await Promise.all([db.select('boq_items', { eq: { project_id: v.src } }), db.select('cost_lines', { eq: { project_id: v.src } })]);
  const norm = s => String(s || '').replace(/\s+/g, ' ').trim();
  const rows = []; let count = 0;
  for (const it of P.pd.items.filter(i => !P.pd.lines.some(l => l.boq_item_id === i.id))) {
    const src = sItems.find(s => it.code && norm(s.code) === norm(it.code) && sLines.some(l => l.boq_item_id === s.id)) || sItems.find(s => norm(s.description) === norm(it.description) && sLines.some(l => l.boq_item_id === s.id));
    if (!src) continue;
    const ratio = n(src.qty) ? n(it.qty) / n(src.qty) : 1;
    sLines.filter(l => l.boq_item_id === src.id).forEach((l, k) => rows.push({ tenant_id: S.tenantId, project_id: P.id, boq_item_id: it.id, kind: l.kind, description: l.description, qty: l.unit && l.unit === src.unit ? Math.round(n(l.qty) * ratio * 100) / 100 : l.qty, unit: l.unit, unit_cost: l.unit_cost, waste_pct: l.waste_pct, labor_type: l.labor_type || null, crew: l.crew ?? null, sort: k }));
    count++;
  }
  if (!rows.length) return toast('לא נמצאו סעיפים תואמים בלי תמחיר', 'bad');
  await db.insert('cost_lines', rows);
  await logChange({ project_id: P.id, entity: 'costing', label: 'העתקת תמחיר מפרויקט אחר', field: 'סעיפים', new_value: count });
  toast(`הועתק תמחיר ל-${count} סעיפים`); render();
}
