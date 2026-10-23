// עובדים ונוכחות: כרטיסי עובדים (שכיר / יומי / שעתי / קבלנות) ודוח נוכחות חודשי לשכר
import { h, esc, $, $$, modal, field, select, area, toast, money, num, numOrNull, confirmBox } from '../util.js';
import { db } from '../db.js';
import { S, can, loadTenantData, render, settings, logChange } from '../app.js';
import { n } from '../calc.js';
import { PAY_TYPES, entryCosts, attendance } from '../quota.js';
import { loadXLSX } from '../import.js';

const monthNow = () => new Date().toISOString().slice(0, 7);
const rateText = w => w.pay_type === 'salary' ? `${money(w.monthly_salary)} לחודש` : w.pay_type === 'daily' ? `${money(w.daily_rate)} ליום` : w.pay_type === 'hourly' ? `${money(w.hourly_rate)} לשעה` : (n(w.piece_rate) ? `${money(w.piece_rate, { unit: true })} ליח'` : 'לפי תמחיר הסעיף');

export async function viewWorkers(tab = 'list') {
  if (!can.workers() && S.role !== 'viewer') return h('<div class="card empty">אין הרשאה</div>');
  const data = await loadTenantData();
  const el = h(`<div><div class="top"><div><h1>עובדים ונוכחות</h1><div class="sub">שכר ותעריפים גלויים רק למנהלת, לבעלים ולהנהלת חשבונות. מנהל עבודה רואה שמות בלבד.</div></div></div>
    <nav class="tabs"><a href="#/workers" class="${tab === 'list' ? 'on' : ''}">עובדים</a><a href="#/workers/attendance" class="${tab === 'attendance' ? 'on' : ''}">נוכחות חודשית</a></nav><div id="wt"></div></div>`);
  $('#wt', el).appendChild(tab === 'attendance' ? attendanceView(data) : listView(data));
  return el;
}

function listView(data) {
  const st = settings();
  const month = monthNow();
  const daysThisMonth = {};
  for (const e of data.entries) if (String(e.log_date).startsWith(month)) daysThisMonth[e.worker_id] = (daysThisMonth[e.worker_id] || 0) + n(e.days);
  const F = { q: '', type: '', inactive: false };
  const el = h(`<div>
    <div class="actions" style="margin-bottom:12px">${can.workers() ? '<button class="btn" id="add">+ עובד</button>' : ''}
      <input id="q" placeholder="חיפוש שם או מקצוע" style="width:200px">
      <select id="ft" style="width:auto"><option value="">כל סוגי ההעסקה</option>${Object.entries(PAY_TYPES).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
      <label class="chk"><input type="checkbox" id="fi"> להציג גם לא פעילים</label></div>
    <div class="tw"><table><thead><tr><th>שם</th><th>סוג העסקה</th><th class="hide-m">מקצוע</th><th class="n">שכר / תעריף</th><th class="n hide-m">מקדם</th><th class="n">ימים החודש</th><th></th></tr></thead><tbody id="tb"></tbody></table></div>
    <p class="small mut">עלות שכיר בפרויקט = ברוטו × מקדם עלות מעביד (ברירת מחדל ${st.employer_factor}) × ימי העבודה בפרויקט ÷ ימי העבודה שלו בחודש (לפחות ${st.work_days_month}).
      עובד יומי: תעריף × ימים. קבלנות: כמות שבוצעה × מחיר קבלנות, לא לפי שעות.</p></div>`);
  const draw = () => {
    const q = F.q.trim();
    const rows = data.workers.filter(w => (F.inactive || w.active !== false) && (!F.type || w.pay_type === F.type) && (!q || `${w.name} ${w.trade || ''}`.includes(q)));
    $('#tb', el).innerHTML = rows.map(w => `<tr class="${w.active === false ? 'dim' : ''}"><td><b>${esc(w.name)}</b>${w.is_foreign ? ' <span class="chip blue">עובד זר</span>' : ''}${w.agency ? `<div class="small mut">${esc(w.agency)}</div>` : ''}</td>
      <td>${PAY_TYPES[w.pay_type]}</td><td class="hide-m">${esc(w.trade || '')}</td><td class="n">${rateText(w)}</td>
      <td class="n hide-m">${w.pay_type === 'piece' ? '' : num(w.cost_factor ?? (w.pay_type === 'salary' ? st.employer_factor : 1))}</td><td class="n">${num(daysThisMonth[w.id] || 0, 1)}</td>
      <td>${can.workers() ? `<button class="btn small ghost" data-ed="${w.id}">עריכה</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="7" class="empty">אין עובדים. מוסיפים עובד ואז רושמים אותו ביומן העבודה של הפרויקט.</td></tr>';
    $$('[data-ed]', el).forEach(b => b.onclick = () => workerDialog(data, data.workers.find(w => w.id === b.dataset.ed)));
  };
  draw();
  $('#q', el).oninput = e => { F.q = e.target.value; draw(); };
  $('#ft', el).onchange = e => { F.type = e.target.value; draw(); };
  $('#fi', el).onchange = e => { F.inactive = e.target.checked; draw(); };
  $('#add', el)?.addEventListener('click', () => workerDialog(data));
  return el;
}

async function workerDialog(data, w) {
  const st = settings();
  const used = w ? data.entries.some(e => e.worker_id === w.id) : false;
  const body = `<div class="grid g2">${field('שם', 'name', w?.name, { req: true })}${select('סוג העסקה', 'pay_type', PAY_TYPES, w?.pay_type || 'daily', { attrs: 'id="pt"' })}
    ${field('ת"ז / דרכון', 'id_no', w?.id_no)}${field('טלפון', 'phone', w?.phone, { attrs: 'dir="ltr" inputmode="tel"' })}${field('מקצוע', 'trade', w?.trade, { attrs: 'placeholder="גבסן, עוזר, צבעי..."' })}${field('קבלן כוח אדם (אם יש)', 'agency', w?.agency)}</div>
    <div class="grid g2">
      <div data-for="salary">${field('שכר ברוטו חודשי ₪', 'monthly_salary', w?.monthly_salary, { type: 'number' })}</div>
      <div data-for="daily">${field('תעריף יומי ₪', 'daily_rate', w?.daily_rate, { type: 'number' })}</div>
      <div data-for="hourly">${field('תעריף לשעה ₪', 'hourly_rate', w?.hourly_rate, { type: 'number', hint: `יום עבודה = ${st.day_hours} שעות (בהגדרות הלקוח)` })}</div>
      <div data-for="piece">${field('מחיר קבלנות קבוע ₪ ליחידה (רשות)', 'piece_rate', w?.piece_rate, { type: 'number', hint: 'ריק = לפי מחיר הקבלנות בתמחיר הסעיף' })}</div>
      <div data-for="salary daily hourly">${field('מקדם עלות מעביד', 'cost_factor', w?.cost_factor ?? '', { type: 'number', hint: `ריק = ${st.employer_factor} לשכיר, 1 ליומי ולשעתי` })}</div>
      <div data-for="salary daily hourly">${field('תעריף שעה נוספת ₪ (עלות)', 'ot_rate', w?.ot_rate, { type: 'number', hint: 'ריק = 125% משעה רגילה' })}</div></div>
    <label class="chk"><input type="checkbox" name="is_foreign" ${w?.is_foreign ? 'checked' : ''}> עובד זר (היטל, מגורים וביטוח רפואי נכללים במקדם)</label>
    ${w ? `<label class="chk"><input type="checkbox" name="active" ${w.active !== false ? 'checked' : ''}> פעיל (לא פעיל לא מופיע ביומן)</label>` : ''}
    ${area('הערות', 'notes', w?.notes)}
    ${w ? `<p><button type="button" class="btn small ${used ? 'ghost' : 'danger'}" id="delw">${used ? 'לעובד יש רישומים ביומן: אפשר רק לסמן לא פעיל' : 'מחיקת העובד'}</button></p>` : ''}`;
  const d = await modal({ title: w ? `עריכת ${w.name}` : 'עובד חדש', body, onMount: (el, close) => {
    const sync = () => { const t = $('#pt', el).value; $$('[data-for]', el).forEach(x => x.hidden = !x.dataset.for.split(' ').includes(t)); };
    $('#pt', el).onchange = sync; sync();
    $('#delw', el)?.addEventListener('click', async () => {
      if (used) return;
      if (!(await confirmBox('מחיקת עובד', `למחוק את ${w.name}?`, 'מחיקה', true))) return;
      try { await db.remove('workers', w.id); close(null); toast('העובד נמחק'); render(); } catch (e) { toast(e.message, 'bad'); }
    });
  }, validate: x => {
    if (!x.name.trim()) return 'חסר שם';
    if (x.pay_type === 'salary' && !n(x.monthly_salary)) return 'לשכיר צריך שכר חודשי';
    if (x.pay_type === 'daily' && !n(x.daily_rate)) return 'לעובד יומי צריך תעריף יומי';
    if (x.pay_type === 'hourly' && !n(x.hourly_rate)) return 'לעובד שעתי צריך תעריף לשעה';
    return null;
  } });
  if (!d) return;
  const row = { name: d.name.trim(), pay_type: d.pay_type, id_no: d.id_no || null, phone: d.phone || null, trade: d.trade || null, agency: d.agency || null,
    monthly_salary: d.pay_type === 'salary' ? numOrNull(d.monthly_salary) : null, daily_rate: d.pay_type === 'daily' ? numOrNull(d.daily_rate) : null, hourly_rate: d.pay_type === 'hourly' ? numOrNull(d.hourly_rate) : null,
    piece_rate: d.pay_type === 'piece' ? numOrNull(d.piece_rate) : null, cost_factor: d.pay_type === 'piece' ? null : numOrNull(d.cost_factor),
    ot_rate: d.pay_type === 'piece' ? null : numOrNull(d.ot_rate), is_foreign: !!d.is_foreign, notes: d.notes || null };
  if (w) {
    row.active = !!d.active;
    await db.update('workers', w.id, row);
    for (const k of ['monthly_salary', 'daily_rate', 'hourly_rate', 'piece_rate', 'cost_factor', 'pay_type']) if (String(w[k] ?? '') !== String(row[k] ?? ''))
      await logChange({ entity: 'worker', entity_id: w.id, label: `עובד: ${row.name}`, field: k, old_value: w[k], new_value: row[k] });
  } else await db.insert('workers', { tenant_id: S.tenantId, active: true, ...row });
  toast('נשמר'); render();
}

function attendanceView(data) {
  let month = monthNow();
  const months = [...new Set(data.entries.map(e => String(e.log_date).slice(0, 7)))].sort().reverse();
  if (!months.includes(month)) months.unshift(month);
  const showCost = can.workers();
  const el = h(`<div><div class="actions" style="margin-bottom:12px"><label>חודש <select id="m" style="width:auto">${months.map(m => `<option ${m === month ? 'selected' : ''}>${m}</option>`).join('')}</select></label>
    <button class="btn ghost" id="x">ייצוא לאקסל (לשכר)</button></div><div id="out"></div>
    <p class="small mut">ימים ושעות נוספות מיומן העבודה של כל הפרויקטים. ${showCost ? 'העלות היא עלות מעביד, אחרי חלוקה בין הפרויקטים.' : ''}</p></div>`);
  const pname = id => data.projects.find(p => p.id === id)?.name || '';
  const W = Object.fromEntries(data.workers.map(w => [w.id, w]));
  let rows = [];
  const draw = () => {
    const costs = entryCosts({ entries: data.entries, workers: data.workers, lines: data.lines, settings: settings() });
    rows = attendance({ entries: data.entries, costs, month, piece: e => W[e.worker_id]?.pay_type === 'piece' }).sort((a, b) => (W[a.worker_id]?.name || '').localeCompare(W[b.worker_id]?.name || '', 'he') || pname(a.project_id).localeCompare(pname(b.project_id), 'he'));
    const byW = {};
    for (const r of rows) (byW[r.worker_id] ||= []).push(r);
    let html = `<div class="tw"><table><thead><tr><th>עובד</th><th>פרויקט</th><th class="n">ימים</th><th class="n">ש' נוספות</th><th class="n">כמות קבלנות</th>${showCost ? '<th class="n">עלות</th>' : ''}</tr></thead><tbody>`;
    for (const [wid, rs] of Object.entries(byW)) {
      const w = W[wid];
      html += rs.map((r, i) => `<tr><td>${i ? '' : `<b>${esc(w?.name || '?')}</b> <span class="small mut">${PAY_TYPES[w?.pay_type] || ''}</span>`}</td><td>${esc(pname(r.project_id))}</td><td class="n">${w?.pay_type === 'piece' ? `<span class="small mut">${r.dates.size} ימי נוכחות</span>` : num(r.days, 2)}</td><td class="n">${num(r.ot, 1)}</td><td class="n">${r.piece ? num(r.piece) : ''}</td>${showCost ? `<td class="n">${money(r.cost)}</td>` : ''}</tr>`).join('');
      if (rs.length > 1) { const t = rs.reduce((a, r) => ({ days: a.days + r.days, ot: a.ot + r.ot, piece: a.piece + r.piece, cost: a.cost + r.cost }), { days: 0, ot: 0, piece: 0, cost: 0 });
        html += `<tr class="tot"><td></td><td>סה"כ ${esc(w?.name || '')}</td><td class="n">${num(t.days, 2)}</td><td class="n">${num(t.ot, 1)}</td><td class="n">${t.piece ? num(t.piece) : ''}</td>${showCost ? `<td class="n">${money(t.cost)}</td>` : ''}</tr>`; }
    }
    if (!rows.length) html += `<tr><td colspan="6" class="empty">אין רישומים ביומן בחודש הזה</td></tr>`;
    else html += `<tr class="tot"><td></td><td>סה"כ החודש</td><td class="n">${num(rows.reduce((a, r) => a + r.days, 0), 2)}</td><td class="n">${num(rows.reduce((a, r) => a + r.ot, 0), 1)}</td><td></td>${showCost ? `<td class="n">${money(rows.reduce((a, r) => a + r.cost, 0))}</td>` : ''}</tr>`;
    $('#out', el).innerHTML = html + '</tbody></table></div>';
  };
  draw();
  $('#m', el).onchange = e => { month = e.target.value; draw(); };
  $('#x', el).onclick = async () => {
    const XLSX = await loadXLSX();
    const aoa = [['עובד', 'ת"ז', 'סוג העסקה', 'פרויקט', 'ימים', 'שעות נוספות', 'כמות קבלנות', 'תאריכים', ...(showCost ? ['עלות מעביד'] : [])]];
    for (const r of rows) { const w = W[r.worker_id] || {};
      aoa.push([w.name, w.id_no || '', PAY_TYPES[w.pay_type] || '', pname(r.project_id), +r.days.toFixed(2), r.ot, r.piece || '', [...r.dates].sort().map(d => d.slice(8, 10)).join(' '), ...(showCost ? [Math.round(r.cost)] : [])]); }
    const ws = XLSX.utils.aoa_to_sheet(aoa); ws['!cols'] = [{ wch: 22 }, { wch: 12 }, { wch: 12 }, { wch: 28 }, { wch: 8 }, { wch: 10 }, { wch: 12 }, { wch: 40 }, { wch: 12 }];
    const wb = XLSX.utils.book_new(); wb.Workbook = { Views: [{ RTL: true }] }; XLSX.utils.book_append_sheet(wb, ws, 'נוכחות ' + month);
    XLSX.writeFile(wb, `נוכחות ${month}.xlsx`);
  };
  return el;
}
