// יומן עבודה: מסך יום (מתוכנן לטלפון), רשימת ימים במשרד, ושמירה בלי קליטה (תור שנשלח כשהקליטה חוזרת)
import { h, esc, $, $$, toast, money, num, store, fmtDate, confirmBox } from '../util.js';
import { closedThrough, isClosedDate } from '../monthclose.js';
import { monthLabel } from '../cashflow.js';
import { db } from '../db.js';
import { S, can, render, settings } from '../app.js';
import { n } from '../calc.js';
import { PAY_TYPES } from '../quota.js';
import { uploadFile } from '../files.js';
import { modal, field, select } from '../util.js';

const OUTBOX = 'subcon-outbox';
const today = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
const WEATHER = { '': 'רגיל', rain: 'גשם', heat: 'עומס חום', wind: 'רוח חזקה', other: 'אחר' };
const DAY_OPTS = [[1, 'יום'], [0.75, '¾'], [0.5, '½'], [0.25, '¼']];

// ===== תור שליחה =====
export const outbox = () => store(OUTBOX) || [];
async function sendDay(job) { return db.rpc('save_work_day', { p: job.p, d: job.d, payload: job.payload }); }
export async function flushOutbox() {
  const q = outbox(); if (!q.length) return 0;
  const left = []; let sent = 0;
  for (const job of q) {
    try { await sendDay(job); sent++; } catch (e) { left.push(job); if (!e.offline) toast(`יום ${job.d} לא נשמר: ${e.message}`, 'bad'); }
  }
  store(OUTBOX, left);
  if (sent) toast(`${sent} ימי עבודה שנשמרו בטלפון נשלחו`);
  return sent;
}

// פריטים לבחירה: סעיפי חוזה וסעיפי הוראות שינוי (למנהל עבודה בלי מחירים)
async function itemsFor(P) {
  const items = can.prices() ? P.pd.items : await db.rpc('field_boq', { p: P.id });
  const vos = can.prices() ? P.pd.variations : [];
  return { items, vos };
}
function itemOptions({ items, vos }, sel, { general = true } = {}) {
  const lab = i => esc(`${i.code || ''} ${i.description}`.trim().slice(0, 60));
  const contract = items.filter(i => !i.variation_id);
  const byVo = {};
  for (const i of items.filter(i => i.variation_id)) (byVo[i.variation_id] ||= []).push(i);
  const voName = id => { const v = vos.find(x => x.id === id); return v ? `${v.number} ${v.title}` : 'הוראת שינוי'; };
  return `${general ? `<option value="">כללי לפרויקט</option>` : '<option value="">בחירת סעיף</option>'}
    <optgroup label="סעיפי חוזה">${contract.map(i => `<option value="i:${i.id}" ${sel === 'i:' + i.id ? 'selected' : ''}>${lab(i)}</option>`).join('')}</optgroup>
    ${Object.entries(byVo).map(([vid, is]) => `<optgroup label="${esc(voName(vid))}">${is.map(i => `<option value="i:${i.id}" ${sel === 'i:' + i.id ? 'selected' : ''}>${lab(i)}</option>`).join('')}</optgroup>`).join('')}`;
}

// ===== מסך יום עבודה =====
export async function dayView(P, date) {
  const d = date && date !== 'today' ? date : today();
  const lists = await itemsFor(P);
  const itemById = Object.fromEntries(lists.items.map(i => [i.id, i]));
  const workers = (P.data.workers || []).filter(w => w.active !== false);
  const W = Object.fromEntries((P.data.workers || []).map(w => [w.id, w]));
  const pe = P.data.entries.filter(e => e.project_id === P.id);
  const dayRow = P.data.days.find(x => x.project_id === P.id && x.log_date === d);
  const prevDate = [...new Set(pe.map(e => e.log_date))].filter(x => x < d).sort().pop();
  const pending = outbox().find(j => j.p === P.id && j.d === d);

  // מצב: שורות רישום (עובד יכול להופיע פעמיים אם פוצל בין סעיפים)
  const DH = n(settings().day_hours) || 9;
  const hrsOf = r => r.hours !== '' && r.hours != null ? n(r.hours) : n(r.days) * DH;
  const toRow = e => ({ worker_id: e.worker_id, days: n(e.days) || 1, hours: e.hours ?? '', ot_hours: n(e.ot_hours) || '', piece_qty: e.piece_qty ?? '', note: e.note || '', link: e.boq_item_id ? 'i:' + e.boq_item_id : '' });
  let rows = pending ? pending.payload.entries.map(e => toRow(e)) : pe.filter(e => e.log_date === d).map(toRow);
  let qty = (pending ? pending.payload.qty : P.data.wqty.filter(q => q.project_id === P.id && q.log_date === d)).map(q => ({ link: 'i:' + q.boq_item_id, qty: q.qty ?? '', note: q.note || '' }));
  const toX = x => ({ id: x.id || crypto.randomUUID(), description: x.description || '', unit: x.unit || '', qty: x.qty ?? '', note: x.note || '', is_vo: !!x.is_vo, variation_id: x.variation_id || null });
  let extras = (pending?.payload.extras || (P.data.extras || []).filter(x => x.project_id === P.id && x.log_date === d)).map(toX);
  const meta = pending ? pending.payload : (dayRow || {});
  const isNew = !rows.length && !dayRow && !pending && !extras.length;
  // סדר: מי שעבד ביום הקודם קודם
  const prevSet = new Set(pe.filter(e => e.log_date === prevDate).map(e => e.worker_id));
  const order = [...workers].sort((a, b) => (prevSet.has(b.id) - prevSet.has(a.id)) || a.name.localeCompare(b.name, 'he'));

  const el = h(`<div class="dayv">
    <div class="top"><div><h1>יומן עבודה</h1><div class="sub">${esc(P.project.name)}</div></div>
      <div class="actions"><a class="btn ghost small" href="#/project/${P.id}/${can.prices() ? 'worklog' : 'field'}">חזרה</a></div></div>
    ${pending ? '<div class="note">היום הזה שמור בטלפון וממתין לשליחה. הוא יישלח כשתחזור קליטה.</div>' : ''}
    <div class="card"><div class="grid g2"><label class="fld"><span>תאריך</span><input type="date" id="dt" value="${d}" max="${today()}"></label>
      <div class="fld"><span>&nbsp;</span><div class="actions">${prevDate ? `<button class="btn ghost" id="copy" type="button">כמו ב-${fmtDate(prevDate)}</button>` : ''}</div></div></div>
      ${isNew ? '' : `<p class="small mut">${dayRow || pending ? 'עריכת יום קיים. השמירה מחליפה את הרישומים של היום הזה.' : ''}</p>`}</div>
    <div class="card"><h2>עובדים <span class="chip" id="cnt"></span></h2>
      <div class="actions" style="margin-bottom:8px"><label class="fld" style="flex:1;min-width:200px;margin:0"><span>סעיף לכל המסומנים</span><select id="all">${itemOptions(lists, '')}</select></label></div>
      <div id="wl"></div>${workers.length ? '' : '<div class="empty">אין עובדים פעילים ברשימה.</div>'}
      <button type="button" class="btn ghost small" id="addw">+ עובד שלא ברשימה</button>
      <p class="small mut">עובד חדש נשמר ברשימת העובדים ומסומן "ממתין לתעריף". המשרד משלים את השכר.</p></div>
    <div class="card"><h2>כמויות שבוצעו היום</h2><div id="ql"></div><button type="button" class="btn ghost small" id="addq">+ כמות לסעיף</button>
      <p class="small mut">לא חובה. עוזר למשרד לעדכן אחוז ביצוע ולהשוות למדידה.</p></div>
    <div class="card"><h2>עבודה שלא ברשימה</h2><div id="xlst"></div><button type="button" class="btn ghost small" id="addx">+ עבודה שלא ברשימה</button>
      <p class="small mut">עבודה שאין לה סעיף. אם זו תוספת שצריך לגבות עליה, מסמנים "תוספת / הוראת שינוי", והיא עוברת למשרד לתמחור ולגבייה.</p></div>
    <div class="card"><h2>הערות</h2><div class="grid g2"><label class="fld"><span>מזג אוויר</span><select id="we">${Object.entries(WEATHER).map(([k, v]) => `<option value="${k}" ${meta.weather === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      <label class="fld"><span>עיכובים</span><input id="dl" value="${esc(meta.delays || '')}" placeholder="למשל: חומר לא הגיע, אין גישה לקומה"></label></div>
      <label class="fld"><span>הערות</span><textarea id="nt" rows="2">${esc(meta.notes || '')}</textarea></label></div>
    <div class="savebar"><span id="sum"></span><span class="sp"></span>${!isNew ? '<button type="button" class="btn ghost danger-t" id="delday">מחיקת היום</button>' : ''}<button type="button" class="btn" id="save">שמירה</button></div></div>`);

  const wl = $('#wl', el), ql = $('#ql', el);
  const drawWorkers = () => {
    wl.innerHTML = order.map(w => {
      const rs = rows.map((r, i) => ({ r, i })).filter(x => x.r.worker_id === w.id);
      const on = rs.length > 0;
      return `<div class="wrow ${on ? 'on' : ''}"><label class="whd"><input type="checkbox" data-w="${w.id}" ${on ? 'checked' : ''}><b>${esc(w.name)}</b><span class="chip ${w.pay_type === 'piece' ? 'blue' : w.pay_type === 'salary' ? 'green' : w.pay_type === 'hourly' ? 'violet' : 'amber'}">${PAY_TYPES[w.pay_type]}</span>${w.trade ? `<span class="small mut">${esc(w.trade)}</span>` : ''}${w.pending_rate ? '<span class="chip amber">ממתין לתעריף</span>' : ''}</label>
        ${rs.map(({ r, i }) => `<div class="wdet" data-i="${i}">
          <select data-k="link" aria-label="סעיף">${itemOptions(lists, r.link)}</select>
          ${w.pay_type === 'piece' ? `<label class="mini"><span>כמות${r.link && itemById[r.link.slice(2)]?.unit ? ' (' + esc(itemById[r.link.slice(2)].unit) + ')' : ''}</span><input type="number" inputmode="decimal" dir="ltr" data-k="piece_qty" value="${esc(r.piece_qty)}"></label>`
            : w.pay_type === 'hourly' ? `<label class="mini"><span>שעות</span><input type="number" inputmode="decimal" dir="ltr" data-k="hours" value="${esc(r.hours === '' ? DH : r.hours)}"></label>
               <label class="mini"><span>ש' נוספות</span><input type="number" inputmode="decimal" dir="ltr" data-k="ot_hours" value="${esc(r.ot_hours)}"></label>`
            : `<div class="seg sm" role="group" aria-label="חלק מיום">${DAY_OPTS.map(([v, l]) => `<button type="button" data-days="${v}" class="${n(r.days) === v ? 'on' : ''}">${l}</button>`).join('')}</div>
               <label class="mini"><span>ש' נוספות</span><input type="number" inputmode="decimal" dir="ltr" data-k="ot_hours" value="${esc(r.ot_hours)}"></label>`}
          <input data-k="note" class="wnote" value="${esc(r.note || '')}" placeholder="פירוט העבודה (לא חובה)" aria-label="פירוט העבודה">
          <button type="button" class="btn small ghost" data-split title="פיצול לסעיף נוסף">+ סעיף</button>${rs.length > 1 ? '<button type="button" class="btn small ghost" data-rm aria-label="הסרת השורה">✕</button>' : ''}</div>`).join('')}</div>`;
    }).join('');
    $$('[data-w]', wl).forEach(cb => cb.onchange = () => {
      const w = W[cb.dataset.w];
      if (cb.checked) rows.push({ worker_id: w.id, days: 1, hours: w.pay_type === 'hourly' ? DH : '', ot_hours: '', piece_qty: '', note: '', link: $('#all', el).value || lastLink(w.id) });
      else rows = rows.filter(r => r.worker_id !== w.id);
      drawWorkers(); summary();
    });
    $$('.wdet', wl).forEach(box => {
      const r = rows[+box.dataset.i];
      $$('[data-k]', box).forEach(inp => inp.onchange = () => { r[inp.dataset.k] = inp.value; if (inp.dataset.k === 'link') drawWorkers(); summary(); });
      $$('[data-days]', box).forEach(b => b.onclick = () => { r.days = +b.dataset.days; drawWorkers(); summary(); });
      $('[data-split]', box).onclick = () => { const hourly = W[r.worker_id]?.pay_type === 'hourly';
        if (hourly) { const half = Math.round(hrsOf(r) / 2 * 4) / 4; r.hours = half; rows.splice(+box.dataset.i + 1, 0, { ...r, link: '', hours: half, piece_qty: '', ot_hours: '' }); drawWorkers(); summary(); return; }
        if (W[r.worker_id]?.pay_type !== 'piece' && n(r.days) === 1) r.days = 0.5; rows.splice(+box.dataset.i + 1, 0, { ...r, link: '', days: W[r.worker_id]?.pay_type === 'piece' ? 1 : 0.5, piece_qty: '', ot_hours: '' }); drawWorkers(); summary(); };
      $('[data-rm]', box)?.addEventListener('click', () => { rows.splice(+box.dataset.i, 1); drawWorkers(); summary(); });
    });
  };
  const lastLink = wid => { const e = pe.filter(x => x.worker_id === wid && x.log_date < d).sort((a, b) => a.log_date.localeCompare(b.log_date)).pop(); return e?.boq_item_id ? 'i:' + e.boq_item_id : ''; };
  const drawQty = () => {
    ql.innerHTML = qty.map((q, i) => `<div class="qrow" data-q="${i}"><select data-k="link">${itemOptions(lists, q.link, { general: false })}</select>
      <input type="number" inputmode="decimal" dir="ltr" data-k="qty" value="${esc(q.qty)}" placeholder="כמות" aria-label="כמות"><span class="small mut">${q.link && itemById[q.link.slice(2)] ? esc(itemById[q.link.slice(2)].unit || '') : ''}</span>
      <input data-k="note" class="wnote" value="${esc(q.note || '')}" placeholder="פירוט (לא חובה)" aria-label="פירוט">
      <button type="button" class="btn small ghost" data-rmq aria-label="הסרה">✕</button></div>`).join('') || '<div class="small mut" style="margin-bottom:8px">לא הוזנו כמויות</div>';
    $$('.qrow', ql).forEach(box => {
      const q = qty[+box.dataset.q];
      $$('[data-k]', box).forEach(inp => inp.onchange = () => { q[inp.dataset.k] = inp.value; if (inp.dataset.k === 'link') drawQty(); });
      $('[data-rmq]', box).onclick = () => { qty.splice(+box.dataset.q, 1); drawQty(); };
    });
  };
  const xl = $('#xlst', el);
  const drawExtras = () => {
    xl.innerHTML = extras.map((x, i) => `<div class="xrow" data-x="${i}">
      <input data-k="description" value="${esc(x.description)}" placeholder="תיאור העבודה" aria-label="תיאור העבודה" class="xdesc">
      <div class="qrow"><input type="number" inputmode="decimal" dir="ltr" data-k="qty" value="${esc(x.qty)}" placeholder="כמות" aria-label="כמות"><input data-k="unit" value="${esc(x.unit)}" placeholder="יח' (מ&quot;ר, יח')" aria-label="יחידה" style="width:110px">
        <button type="button" class="btn small ghost" data-rmx aria-label="הסרה" ${x.variation_id ? 'disabled title="כבר נפתחה הוראת שינוי"' : ''}>✕</button></div>
      <input data-k="note" class="wnote" value="${esc(x.note)}" placeholder="פירוט (לא חובה)" aria-label="פירוט">
      <label class="chk"><input type="checkbox" data-k="is_vo" ${x.is_vo || x.variation_id ? 'checked' : ''} ${x.variation_id ? 'disabled' : ''}> תוספת / הוראת שינוי (עוברת למשרד לתמחור ולגבייה)</label>
      ${x.variation_id ? '<span class="chip blue">נפתחה הוראת שינוי</span>' : ''}</div>`).join('') || '<div class="small mut" style="margin-bottom:8px">אין</div>';
    $$('.xrow', xl).forEach(box => {
      const x = extras[+box.dataset.x];
      $$('[data-k]', box).forEach(inp => inp.onchange = () => { x[inp.dataset.k] = inp.type === 'checkbox' ? inp.checked : inp.value; });
      $('[data-rmx]', box).onclick = () => { extras.splice(+box.dataset.x, 1); drawExtras(); };
    });
  };
  const summary = () => {
    const ppl = new Set(rows.map(r => r.worker_id)).size;
    const days = rows.filter(r => W[r.worker_id]?.pay_type !== 'piece').reduce((a, r) => a + (W[r.worker_id]?.pay_type === 'hourly' ? hrsOf(r) / DH : n(r.days)), 0);
    $('#cnt', el).textContent = ppl ? `${ppl} סומנו` : '';
    $('#sum', el).innerHTML = `${ppl} עובדים · ${num(days, 2)} ימי עבודה`;
  };
  drawWorkers(); drawQty(); drawExtras(); summary();

  $('#dt', el).onchange = e => { if (e.target.value) location.hash = `#/project/${P.id}/day/${e.target.value}`; };
  $('#copy', el)?.addEventListener('click', () => {
    rows = pe.filter(e => e.log_date === prevDate && W[e.worker_id]?.active !== false).map(e => ({ ...toRow(e), piece_qty: '', ot_hours: '' }));
    drawWorkers(); summary(); toast('הועתקו העובדים והסעיפים מהיום הקודם');
  });
  $('#all', el).onchange = e => { if (!e.target.value) return; rows.forEach(r => r.link = e.target.value); drawWorkers(); };
  $('#addq', el).onclick = () => { qty.push({ link: '', qty: '', note: '' }); drawQty(); };
  $('#addx', el).onclick = () => { extras.push(toX({})); drawExtras(); $('.xrow:last-child .xdesc', xl)?.focus(); };
  $('#addw', el).onclick = async () => {
    if (!navigator.onLine) return toast('אין קליטה. אפשר להוסיף עובד כשיש אינטרנט', 'bad');
    const v = await modal({ title: 'עובד שלא ברשימה', body: `${field('שם העובד', 'name', '', { req: true })}
      <div class="grid g2">${field('טלפון', 'phone', '', { type: 'tel', attrs: 'dir="ltr"' })}${field('מקצוע', 'trade', '', { attrs: 'placeholder="למשל: טייח, רצף"' })}</div>
      ${select('סוג העסקה', 'pay', { daily: PAY_TYPES.daily, salary: PAY_TYPES.salary, hourly: PAY_TYPES.hourly, piece: PAY_TYPES.piece }, 'daily')}
      <p class="small mut">את השכר משלים המשרד. עד אז העובד מסומן "ממתין לתעריף".</p>`, ok: 'הוספה', validate: x => !x.name.trim() && 'חסר שם' });
    if (!v) return;
    try {
      const id = await db.rpc('field_add_worker', { p: P.id, wname: v.name.trim(), wphone: v.phone, wpay: v.pay, wtrade: v.trade });
      const w = { id, name: v.name.trim(), pay_type: v.pay, trade: v.trade || null, active: true, pending_rate: true };
      (P.data.workers ||= []).push(w); W[id] = w; order.unshift(w);
      rows.push({ worker_id: id, days: 1, hours: v.pay === 'hourly' ? DH : '', ot_hours: '', piece_qty: '', note: '', link: $('#all', el).value || '' });
      drawWorkers(); summary(); toast('העובד נוסף וסומן להיום');
    } catch (e) { toast(e.message, 'bad'); }
  };

  const payloadOf = () => ({
    weather: $('#we', el).value || null, delays: $('#dl', el).value.trim() || null, notes: $('#nt', el).value.trim() || null,
    entries: rows.map(r => { const it = r.link ? itemById[r.link.slice(2)] : null;
      const pt = W[r.worker_id]?.pay_type, hrs = pt === 'hourly' ? hrsOf(r) : null;
      return { worker_id: r.worker_id, boq_item_id: it?.id || null, variation_id: it?.variation_id || null, days: pt === 'piece' ? 1 : pt === 'hourly' ? Math.round(hrs / DH * 1000) / 1000 : n(r.days) || 1, hours: hrs,
        ot_hours: n(r.ot_hours) || 0, piece_qty: r.piece_qty === '' ? null : n(r.piece_qty), note: r.note || null }; }),
    qty: qty.filter(q => q.link && q.qty !== '').map(q => ({ boq_item_id: q.link.slice(2), qty: n(q.qty), note: q.note || null })),
    extras: extras.filter(x => x.description.trim()).map(x => ({ id: x.id, description: x.description.trim(), unit: x.unit || null, qty: x.qty === '' ? null : n(x.qty), note: x.note || null, is_vo: !!x.is_vo || !!x.variation_id }))
  });
  const commit = async payload => {
    const job = { p: P.id, d, payload, at: new Date().toISOString() };
    try {
      await sendDay(job);
      store(OUTBOX, outbox().filter(j => !(j.p === P.id && j.d === d)));
      return true;
    } catch (e) {
      if (!e.offline) { toast(e.message, 'bad'); return false; }
      store(OUTBOX, outbox().filter(j => !(j.p === P.id && j.d === d)).concat(job));
      toast('אין קליטה. היום נשמר בטלפון ויישלח כשהקליטה תחזור.', 'warn');
      return true;
    }
  };
  const locked = isClosedDate(d, closedThrough(P.data.closes));
  if (locked) { $('#save', el).insertAdjacentHTML('beforebegin', `<div class="note">🔒 ${monthLabel(d.slice(0, 7))} סגור. אפשר לצפות ביום, אבל לא לשנות אותו. תיקון לעלות העבודה רושמים כהוצאה בחודש פתוח.</div>`); $('#save', el).disabled = true; $('#delday', el)?.setAttribute('disabled', ''); }
  $('#save', el).onclick = async () => {
    if (locked) return toast('החודש סגור', 'bad');
    const p = payloadOf();
    const badPiece = rows.filter(r => W[r.worker_id]?.pay_type === 'piece' && (r.piece_qty === '' || !r.link));
    if (badPiece.length && !(await confirmBox('חסרים נתוני קבלנות', `ל-${badPiece.length} רישומי קבלנות חסר סעיף או כמות. בלי כמות לא תחושב עלות. לשמור בכל זאת?`, 'שמירה'))) return;
    if (extras.some(x => !x.description.trim() && (x.qty !== '' || x.note))) return toast('בעבודה שלא ברשימה חסר תיאור', 'bad');
    if (!p.entries.length && !p.qty.length && !p.extras.length && !p.notes && !p.delays && !(await confirmBox('יום בלי עובדים', 'לא סומנו עובדים. לשמור את היום בכל זאת?', 'שמירה'))) return;
    if (await commit(p)) { toast('יום העבודה נשמר'); location.hash = `#/project/${P.id}/${can.prices() ? 'worklog' : 'field'}`; render(); }
  };
  $('#delday', el)?.addEventListener('click', async () => {
    if (locked) return toast('החודש סגור', 'bad');
    if (!(await confirmBox('מחיקת יום עבודה', `למחוק את כל הרישומים של ${fmtDate(d)}?`, 'מחיקה', true))) return;
    if (await commit({ delete: true })) { toast('היום נמחק'); location.hash = `#/project/${P.id}/${can.prices() ? 'worklog' : 'field'}`; render(); }
  });
  return el;
}

// ===== רשימת ימים (משרד) =====
export function tabWorkLog(P) {
  const W = Object.fromEntries((P.data.workers || []).map(w => [w.id, w]));
  const costs = P.summary.costs || {};
  const pe = P.pd.entries, pq = P.pd.wqty;
  const months = [...new Set(pe.map(e => e.log_date.slice(0, 7)).concat(P.pd.days.map(x => x.log_date.slice(0, 7))))].sort().reverse();
  let month = months[0] || today().slice(0, 7);
  const items = Object.fromEntries(P.pd.items.map(i => [i.id, i]));
  const pend = outbox().filter(j => j.p === P.id);
  const el = h(`<div>
    <div class="actions" style="margin-bottom:12px">${can.log() ? `<a class="btn" href="#/project/${P.id}/day/today">+ יום עבודה (היום)</a>` : ''}
      <label>חודש <select id="m" style="width:auto">${(months.length ? months : [month]).map(m => `<option ${m === month ? 'selected' : ''}>${m}</option>`).join('')}</select></label></div>
    ${pend.length ? `<div class="note">${pend.length} ימים שמורים בטלפון הזה וממתינים לשליחה.</div>` : ''}
    <div id="xo"></div>
    <div class="kpis" id="k"></div><div class="tw" id="t"></div>
    <p class="small mut">עלות עבודה מהיומן נכנסת אוטומטית ל"בפועל" של הסעיף. עבודה בלי סעיף מתחלקת כמו הוצאה כללית. אל תרשמי במקביל את השכר כהוצאה, כדי שלא ייספר פעמיים.</p></div>`);
  const draw = () => {
    const es = pe.filter(e => e.log_date.startsWith(month));
    const dates = [...new Set(es.map(e => e.log_date).concat(P.pd.days.filter(x => x.log_date.startsWith(month)).map(x => x.log_date)))].sort().reverse();
    const cost = es.reduce((a, e) => a + (costs[e.id]?.cost || 0), 0);
    const days = es.filter(e => W[e.worker_id]?.pay_type !== 'piece').reduce((a, e) => a + n(e.days), 0);
    $('#k', el).innerHTML = `<div class="kpi"><div class="l">ימי רישום</div><div class="v">${dates.length}</div></div>
      <div class="kpi"><div class="l">ימי עבודה (שכירים ויומיים)</div><div class="v">${num(days, 1)}</div></div>
      <div class="kpi"><div class="l">עלות עבודה בחודש</div><div class="v">${money(cost)}</div><div class="n">סה"כ בפרויקט ${money(P.summary.laborCost)}</div></div>`;
    $('#t', el).innerHTML = `<table><thead><tr><th>תאריך</th><th>עובדים</th><th class="n">ימים</th><th class="n hide-m">שעות נוספות</th><th class="hide-m">סעיפים</th><th class="hide-m">כמויות</th><th class="n">עלות</th><th class="hide-m">הערות</th></tr></thead><tbody>
      ${dates.map(dt => { const de = es.filter(e => e.log_date === dt), dq = pq.filter(q => q.log_date === dt), dd = P.pd.days.find(x => x.log_date === dt);
        const its = [...new Set(de.map(e => e.boq_item_id ? (items[e.boq_item_id]?.code || '?') : 'כללי'))];
        return `<tr class="click" data-d="${dt}"><td>${fmtDate(dt)}</td><td class="wrap small">${esc([...new Set(de.map(e => W[e.worker_id]?.name || '?'))].join(', '))}</td>
          <td class="n">${num(de.filter(e => W[e.worker_id]?.pay_type !== 'piece').reduce((a, e) => a + n(e.days), 0), 2)}</td><td class="n hide-m">${num(de.reduce((a, e) => a + n(e.ot_hours), 0), 1)}</td>
          <td class="hide-m small">${esc(its.join(', '))}</td><td class="hide-m small">${dq.map(q => `${esc(items[q.boq_item_id]?.code || '')}: ${num(q.qty)}`).join(' · ')}${(P.pd.extras || []).some(x => x.log_date === dt) ? ` <span class="chip amber">${(P.pd.extras || []).filter(x => x.log_date === dt).length} לא ברשימה</span>` : ''}</td>
          <td class="n">${money(de.reduce((a, e) => a + (costs[e.id]?.cost || 0), 0))}</td><td class="hide-m wrap small">${esc([dd?.weather ? WEATHER[dd.weather] : '', dd?.delays, dd?.notes].filter(Boolean).join(' · '))}</td></tr>`; }).join('')
        || '<tr><td colspan="8" class="empty">אין ימי עבודה בחודש הזה</td></tr>'}</tbody></table>`;
    $$('[data-d]', el).forEach(tr => tr.onclick = () => { if (can.log()) location.hash = `#/project/${P.id}/day/${tr.dataset.d}`; });
  };
  draw();
  $('#m', el).onchange = e => { month = e.target.value; draw(); };
  // עבודות שלא ברשימה שעוד לא טופלו: שיוך לסעיף, פתיחת הוראת שינוי, או סימון כטופל
  const open = (P.pd.extras || []).filter(x => !x.variation_id && !x.boq_item_id && !x.handled).sort((a, b) => b.log_date.localeCompare(a.log_date));
  if (open.length && can.edit()) {
    const box = $('#xo', el);
    box.innerHTML = `<div class="card"><h2>עבודות שלא ברשימה <span class="chip amber">${open.length}</span></h2>
      <p class="small mut">נרשמו ביומן בלי סעיף. משייכים לסעיף קיים, פותחים הוראת שינוי כדי לתמחר ולגבות, או מסמנים כטופל.</p>
      <div class="tw"><table><thead><tr><th>תאריך</th><th>עבודה</th><th class="n">כמות</th><th>פירוט</th><th>שיוך לסעיף</th><th></th></tr></thead><tbody>
      ${open.map(x => `<tr data-xid="${x.id}"><td>${fmtDate(x.log_date)}</td><td class="wrap"><b>${esc(x.description)}</b>${x.created_by ? `<div class="small mut">${esc(x.created_by)}</div>` : ''}</td>
        <td class="n">${x.qty != null ? num(x.qty) + ' ' + esc(x.unit || '') : ''}</td><td class="wrap small">${esc(x.note || '')}</td>
        <td><select data-xlink style="min-width:160px"><option value="">בחירת סעיף…</option>${P.pd.items.map(i => `<option value="${i.id}">${esc(`${i.code || ''} ${i.description}`.trim().slice(0, 50))}</option>`).join('')}</select></td>
        <td class="nw"><button class="btn small" data-xvo>פתיחת הוראת שינוי</button> <button class="btn small ghost" data-xdone>טופל</button></td></tr>`).join('')}</tbody></table></div></div>`;
    $$('[data-xid]', box).forEach(tr => {
      const id = tr.dataset.xid;
      $('[data-xlink]', tr).onchange = async e => { if (!e.target.value) return; await db.update('work_extras', id, { boq_item_id: e.target.value, handled: true }); toast('שויך לסעיף'); render(); };
      $('[data-xvo]', tr).onclick = async () => { await db.update('work_extras', id, { is_vo: true }); await db.rpc('field_extra_vo', { x: id }); toast('נפתחה הוראת שינוי (טיוטה). מתמחרים אותה בלשונית הוראות שינוי'); render(); };
      $('[data-xdone]', tr).onclick = async () => { await db.update('work_extras', id, { handled: true }); render(); };
    });
  }
  return el;
}

// ===== מנהל עבודה: מסך פרויקט =====
export function fieldProject(P, fieldItems) {
  const W = Object.fromEntries((P.data.workers || []).map(w => [w.id, w]));
  const pe = P.data.entries.filter(e => e.project_id === P.id);
  const dates = [...new Set(pe.map(e => e.log_date))].sort().reverse().slice(0, 14);
  const pend = outbox().filter(j => j.p === P.id);
  const el = h(`<div><div class="top"><div><h1>${esc(P.project.name)}</h1><div class="sub">${esc(P.project.address || '')}</div></div></div>
    <a class="btn big" href="#/project/${P.id}/day/today">יומן עבודה להיום</a>
    <button class="btn big ghost" id="dnote" style="margin-top:8px">📷 צילום תעודת משלוח</button><input type="file" id="dnf" accept="image/*,application/pdf" capture="environment" multiple hidden>
    <p class="small mut" style="margin:4px 0 12px">התעודה נשלחת למשרד לבדיקה ולקליטה מול ההזמנה.</p>
    ${pend.length ? `<div class="note">${pend.length} ימים ממתינים לשליחה (אין קליטה).</div>` : ''}
    <div class="card"><h2>ימים אחרונים</h2>${dates.map(d => { const de = pe.filter(e => e.log_date === d); return `<a class="act" href="#/project/${P.id}/day/${d}"><div><b>${fmtDate(d)}</b><small>${esc([...new Set(de.map(e => W[e.worker_id]?.name || '?'))].join(', '))}</small></div><span class="amt">${new Set(de.map(e => e.worker_id)).size} עובדים</span></a>`; }).join('') || '<div class="empty">עדיין אין רישומים</div>'}</div>
    <details class="card"><summary><b>סעיפי העבודה בפרויקט (${fieldItems.length})</b></summary>${fieldItems.map(i => `<div class="act"><div><b>${esc(i.code || '')}</b> ${esc(i.description)}<small>${esc(i.chapter || '')} · ${esc(i.unit || '')}</small></div></div>`).join('')}</details></div>`);
  wireDeliveryPhoto(el, P.id);
  return el;
}

// מנהל עבודה מצלם תעודת משלוח: הקובץ עולה לתיבת המסמכים של המשרד, מסומן כתעודת משלוח של הפרויקט
export function wireDeliveryPhoto(el, projectId) {
  const btn = $('#dnote', el), inp = $('#dnf', el); if (!btn) return;
  btn.onclick = () => inp.click();
  inp.onchange = async () => {
    const list = [...inp.files]; inp.value = ''; if (!list.length) return;
    if (!navigator.onLine) return toast('אין קליטה. צריך לצלם שוב כשיש אינטרנט', 'bad');
    btn.disabled = true; btn.textContent = 'שולח...';
    let k = 0;
    for (const f of list) { try { await uploadFile(f, { projectId, docType: 'delivery', status: 'new' }); k++; } catch (e) { toast(e.message, 'bad'); } }
    btn.disabled = false; btn.textContent = '📷 צילום תעודת משלוח';
    if (k) toast(k === 1 ? 'התעודה נשלחה למשרד' : `${k} תעודות נשלחו למשרד`);
  };
}
