// לשוניות "מכירות" ו"ליווי בנקאי" בפרויקט יזם (מודולים נפרדים שמדליקים בהגדרות הפרויקט)
import { h, esc, $, $$, modal, field, select, area, toast, money, pct, fmtDate, confirmBox, numOrNull } from '../util.js';
import { db } from '../db.js';
import { S, can, render, logChange, settings } from '../app.js';
import { n } from '../calc.js';
import { monthLabel, addMonths, mkey } from '../cashflow.js';
import { UNIT_STATUS, planOf, planPct, planDue, salesConf, salesSummary, unitIncomeRows, forecastMonths, bankConf, bankSim, defaultPlan } from '../sales.js';
import { devCashflow } from '../devcash.js';
import { devSummary } from '../dev.js';
import { has } from '../modules.js';

const todayStr = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
const ST_CHIP = { available: '', reserved: 'amber', sold: 'green' };

// ===== עורך לוח תשלומים (בהגדרות המכירה ובדירה) =====
function planEditor(plan) {
  return `<div class="tw" style="box-shadow:none"><table class="plt"><thead><tr><th>תשלום</th><th class="n">%</th><th class="n">חודשים מהחתימה</th><th>או באבן דרך (חודש)</th><th></th></tr></thead><tbody id="plb">
    ${plan.map((l, i) => planRow(l, i)).join('')}</tbody></table></div>
    <div class="actions" style="margin:6px 0"><button type="button" class="btn small ghost" id="pladd">+ תשלום</button><span class="small mut" id="plsum"></span></div>
    <p class="small mut">תשלום באבן דרך שכבר עברה בזמן המכירה נכנס לחודש החתימה. אבן דרך גוברת על חודשים מהחתימה.</p>`;
}
const planRow = (l, i) => `<tr><td><input name="pl_label_${i}" value="${esc(l.label || '')}" style="min-width:100px"></td>
  <td class="n"><input name="pl_pct_${i}" type="number" step="any" dir="ltr" value="${esc(l.pct ?? '')}" style="width:70px"></td>
  <td class="n"><input name="pl_off_${i}" type="number" min="0" dir="ltr" value="${esc(l.month ? '' : l.offset ?? '')}" style="width:70px"></td>
  <td><input name="pl_month_${i}" type="month" value="${esc(l.month || '')}" style="width:150px"></td>
  <td><button type="button" class="btn small ghost" data-pldel aria-label="מחיקה">✕</button></td></tr>`;
function wirePlan(el) {
  const sum = () => { const t = $$('[name^=pl_pct_]', el).reduce((a, i) => a + n(i.value), 0); const s = $('#plsum', el); if (s) { s.textContent = `סה"כ ${Math.round(t * 10) / 10}%`; s.className = 'small ' + (Math.abs(t - 100) > 0.01 ? 'neg' : 'mut'); } };
  const wire = () => { $$('[data-pldel]', el).forEach(b => b.onclick = () => { b.closest('tr').remove(); sum(); }); $$('[name^=pl_pct_]', el).forEach(i => i.oninput = sum); sum(); };
  $('#pladd', el).onclick = () => { const k = Date.now() % 100000; $('#plb', el).insertAdjacentHTML('beforeend', planRow({ label: 'תשלום', pct: '', offset: '' }, 'x' + k)); wire(); };
  wire();
}
function readPlan(v) {
  const keys = Object.keys(v).filter(k => k.startsWith('pl_label_')).map(k => k.slice(9));
  return keys.map(k => ({ label: String(v['pl_label_' + k] || '').trim() || 'תשלום', pct: n(v['pl_pct_' + k]), offset: v['pl_off_' + k] === '' ? 0 : Math.round(n(v['pl_off_' + k])), month: /^\d{4}-\d{2}$/.test(v['pl_month_' + k] || '') ? v['pl_month_' + k] : '' })).filter(l => l.pct > 0);
}
const planCheck = plan => (!plan.length ? 'חסר לפחות תשלום אחד בלוח' : Math.abs(planPct(plan) - 100) > 0.01 ? `סכום האחוזים בלוח ${Math.round(planPct(plan) * 10) / 10}%, צריך 100%` : null);

// ===== לשונית מכירות =====
export function salesTab(P) {
  const p = P.project, units = P.pd.units || [], income = P.pd.income || [];
  const cur = mkey(todayStr()), c = salesConf(p), s = salesSummary(units, income), fm = forecastMonths(p, units, cur);
  const edit = can.expense();
  const flt = P.__flt || 'all';
  const list = units.filter(u => flt === 'all' || u.status === flt);
  const el = h(`<div>
    <div class="kpis">
      <div class="kpi"><div class="l">דירות</div><div class="v">${s.count}</div><div class="n">נמכרו ${s.sold} · שמורות ${s.reserved} · פנויות ${s.available}</div></div>
      <div class="kpi"><div class="l">שווי חוזי מכר</div><div class="v">${money(s.soldValue)}</div><div class="n">${s.count ? pct(s.soldValue / (s.totalValue || 1) * 100, { d: 0 }) + ' מהשווי הכולל' : ''}${s.perSqm ? ` · ${money(s.perSqm)} למ"ר` : ''}</div></div>
      <div class="kpi"><div class="l">נגבה מרוכשים</div><div class="v">${money(s.collected)}</div><div class="n">יתרה לגבייה ${money(s.open)}</div></div>
      <div class="kpi"><div class="l">מלאי לא מכור (מחירון)</div><div class="v">${money(s.unsoldValue)}</div><div class="n">${n(c.pace) > 0 ? `קצב ${c.pace} דירות לחודש${c.forecast !== false ? ', נכנס לתזרים' : ', לא נכנס לתזרים'}` : 'לא הוגדר קצב מכירות'}</div></div>
      ${s.guarantees ? `<div class="kpi"><div class="l">ערבויות חוק המכר</div><div class="v">${money(s.guarantees)}</div><div class="n">מה שרוכשים שילמו מעל 7% מהמחיר</div></div>` : ''}
    </div>
    <div class="card">
      <div class="actions" style="flex-wrap:wrap;gap:8px;margin-bottom:10px">
        <h2 style="margin:0;flex:1 1 auto">מלאי דירות</h2>
        <div class="seg" id="uflt">${[['all', 'הכל'], ...Object.entries(UNIT_STATUS)].map(([k, l]) => `<button type="button" data-k="${k}" class="${flt === k ? 'on' : ''}">${l}</button>`).join('')}</div>
        ${edit ? '<button class="btn small" id="addu">+ דירה</button><button class="btn small ghost" id="genu">יצירת דירות</button><button class="btn small ghost" id="sconf">קצב ולוח תשלומים</button>' : ''}</div>
      <div class="tw" style="box-shadow:none"><table><thead><tr><th>דירה</th><th>בניין / קומה</th><th class="n">חדרים</th><th class="n">מ"ר</th><th class="n">מחירון</th><th>מצב</th><th>רוכש</th><th class="n">מחיר מכירה</th><th class="n">נגבה</th><th class="n">יתרה</th></tr></thead><tbody>
      ${list.map(u => { const b = s.byUnit[u.id] || { got: 0 }; return `<tr class="${edit ? 'click' : ''}" data-u="${u.id}"><td><b>${esc(u.name)}</b></td><td class="nw">${esc([u.building, u.floor && 'קומה ' + u.floor].filter(Boolean).join(' · '))}</td>
        <td class="n">${u.rooms ?? ''}</td><td class="n">${u.area ?? ''}</td><td class="n">${money(u.list_price)}</td>
        <td class="nw"><span class="chip ${ST_CHIP[u.status]}">${UNIT_STATUS[u.status]}</span>${u.status !== 'sold' && fm[u.id] ? ` <span class="small mut">צפי ${monthLabel(fm[u.id])}</span>` : ''}</td>
        <td class="nw">${esc(u.buyer || '')}${u.sale_date ? ` <span class="small mut">${fmtDate(u.sale_date)}</span>` : ''}</td>
        <td class="n">${u.status === 'sold' ? money(u.sale_price) : ''}</td><td class="n">${u.status === 'sold' ? money(b.got) : ''}</td><td class="n">${u.status === 'sold' ? money(n(u.sale_price) - b.got) : ''}</td></tr>`; }).join('')
        || `<tr><td colspan="10" class="empty">${units.length ? 'אין דירות במצב הזה' : 'אין דירות עדיין. מוסיפים דירה אחת, או "יצירת דירות" לבניין שלם.'}</td></tr>`}
      </tbody>${list.length ? `<tfoot><tr class="tot"><td colspan="4">${list.length} דירות</td><td class="n">${money(list.reduce((a, u) => a + n(u.list_price), 0))}</td><td colspan="2"></td><td class="n">${money(list.filter(u => u.status === 'sold').reduce((a, u) => a + n(u.sale_price), 0))}</td><td class="n">${money(list.reduce((a, u) => a + (s.byUnit[u.id]?.got || 0), 0))}</td><td></td></tr></tfoot>` : ''}</table></div>
      <p class="small mut">דירה שמסמנים "נמכרה" יוצרת לבד את תשלומי הרוכש לפי לוח התשלומים, בלשונית "הכנסות ותזרים". את קבלת הכסף מסמנים שם. דירות פנויות ושמורות נכנסות לתזרים כ"מכירות צפויות" לפי הקצב שהוגדר.</p>
    </div></div>`);
  $$('#uflt button', el).forEach(b => b.onclick = () => { P.__flt = b.dataset.k; el.replaceWith(salesTab(P)); });
  $('#addu', el)?.addEventListener('click', () => unitDialog(P));
  $('#genu', el)?.addEventListener('click', () => genUnits(P));
  $('#sconf', el)?.addEventListener('click', () => salesConfDialog(P));
  if (edit) $$('[data-u]', el).forEach(tr => tr.onclick = () => unitDialog(P, units.find(u => u.id === tr.dataset.u)));
  return el;
}

async function salesConfDialog(P) {
  const p = P.project, c = salesConf(p), plan = planOf(p);
  const v = await modal({ title: 'קצב מכירות ולוח תשלומים', wide: true, body: `
    <div class="grid g3">${field('קצב מכירות צפוי (דירות לחודש)', 'pace', c.pace || '', { type: 'number', hint: 'ריק או 0: בלי תחזית' })}${field('החל מחודש', 'from_month', c.from_month || '', { type: 'month', hint: 'ריק: מהחודש הנוכחי' })}
      <label class="chk" style="align-self:end"><input type="checkbox" name="forecast" ${c.forecast !== false ? 'checked' : ''}> להכניס מכירות צפויות לתזרים</label></div>
    <h3 style="margin:12px 0 4px">לוח תשלומים לרוכשים (ברירת מחדל לכל דירה)</h3>${planEditor(plan)}
    <button type="button" class="btn small ghost" id="pldef">איפוס ללוח ברירת המחדל</button>`,
    onMount: el => { wirePlan(el); $('#pldef', el).onclick = () => { $('#plb', el).innerHTML = defaultPlan(p).map((l, i) => planRow(l, 'd' + i)).join(''); wirePlan(el); }; },
    validate: d => planCheck(readPlan(d)) });
  if (!v) return;
  const sales = { pace: n(v.pace), from_month: v.from_month || '', forecast: !!v.forecast, plan: readPlan(v) };
  await db.update('projects', p.id, { sales });
  await logChange({ project_id: p.id, entity: 'project', entity_id: p.id, label: 'מכירות', field: 'קצב ולוח תשלומים', old_value: `${c.pace || 0} לחודש`, new_value: `${sales.pace} לחודש` });
  toast('נשמר'); render();
}

async function genUnits(P) {
  const v = await modal({ title: 'יצירת דירות', body: `<p class="small mut">יוצר דירות לפי קומות. אחר כך אפשר לערוך כל דירה בנפרד.</p>
    <div class="grid g3">${field('בניין (רשות)', 'building', '')}${field('מקומה', 'f1', '1', { type: 'number', req: true })}${field('עד קומה', 'f2', '', { type: 'number', req: true })}</div>
    <div class="grid g3">${field('דירות בקומה', 'per', '4', { type: 'number', req: true })}${field('חדרים', 'rooms', '', { type: 'number' })}${field('שטח מ"ר', 'area', '', { type: 'number' })}</div>
    <div class="grid g2">${field('מחיר מחירון לדירה ₪ (כולל מע"מ)', 'price', '', { type: 'number', req: true })}${field('תוספת לכל קומה ₪', 'step', '', { type: 'number', hint: 'למשל 20,000: קומות גבוהות יקרות יותר' })}</div>`,
    validate: d => (!(n(d.f2) >= n(d.f1)) ? 'עד קומה צריך להיות גדול או שווה למקומה' : !(n(d.per) > 0) ? 'חסר מספר דירות בקומה' : !(n(d.price) > 0) ? 'חסר מחיר' : (n(d.f2) - n(d.f1) + 1) * n(d.per) > 600 ? 'יותר מדי דירות בבת אחת' : null) });
  if (!v) return;
  const units = P.pd.units || []; let k = units.length, no = units.length;
  const rows = [];
  for (let f = Math.round(n(v.f1)); f <= Math.round(n(v.f2)); f++) for (let j = 0; j < Math.round(n(v.per)); j++) {
    no++; rows.push({ tenant_id: S.tenantId, project_id: P.id, name: `דירה ${no}`, building: v.building.trim() || null, floor: String(f), rooms: numOrNull(v.rooms), area: numOrNull(v.area),
      list_price: Math.round(n(v.price) + n(v.step) * (f - Math.round(n(v.f1)))), status: 'available', sort: ++k });
  }
  await db.insert('dev_units', rows);
  await logChange({ project_id: P.id, entity: 'project', entity_id: P.id, label: 'מכירות', field: 'יצירת דירות', new_value: rows.length });
  toast(`נוצרו ${rows.length} דירות`); render();
}

async function unitDialog(P, u = null) {
  const p = P.project, plan = u?.plan?.length ? u.plan : planOf(p);
  const inc = (P.pd.income || []).filter(i => u && i.unit_id === u.id), got = inc.filter(i => i.status === 'received');
  const v = await modal({ title: u ? u.name : 'דירה חדשה', wide: true, body: `
    <div class="grid g3">${field('שם / מספר דירה', 'name', u?.name || `דירה ${(P.pd.units || []).length + 1}`, { req: true })}${field('בניין', 'building', u?.building || '')}${field('קומה', 'floor', u?.floor || '')}</div>
    <div class="grid g3">${field('חדרים', 'rooms', u?.rooms ?? '', { type: 'number' })}${field('שטח מ"ר', 'area', u?.area ?? '', { type: 'number' })}${field('מחיר מחירון ₪ (כולל מע"מ)', 'list_price', u?.list_price ?? '', { type: 'number', req: true })}</div>
    ${select('מצב', 'status', UNIT_STATUS, u?.status || 'available')}
    <div class="buyer" ${u?.status === 'sold' || u?.status === 'reserved' ? '' : 'hidden'}>
      <div class="grid g3">${field('רוכש', 'buyer', u?.buyer || '')}${field('טלפון', 'buyer_phone', u?.buyer_phone || '', { type: 'tel', attrs: 'dir="ltr"' })}${field('אימייל', 'buyer_email', u?.buyer_email || '', { type: 'email', attrs: 'dir="ltr"' })}</div>
      <div class="soldonly" ${u?.status === 'sold' ? '' : 'hidden'}>
        <div class="grid g2">${field('תאריך חתימה', 'sale_date', u?.sale_date || todayStr(), { type: 'date' })}${field('מחיר מכירה ₪ (כולל מע"מ)', 'sale_price', u?.sale_price ?? u?.list_price ?? '', { type: 'number' })}</div>
        <h3 style="margin:10px 0 4px">לוח תשלומים לרוכש</h3>${planEditor(plan)}<div id="plprev" class="small"></div>
        ${got.length ? `<p class="small mut">כבר התקבלו ${got.length} תשלומים (${money(got.reduce((a, i) => a + n(i.received_amount ?? i.amount), 0))}). הם נשמרים כמו שהם; רק התשלומים הצפויים נבנים מחדש.</p>` : ''}
      </div></div>
    ${area('הערות', 'notes', u?.notes || '')}
    ${u ? '<button type="button" class="btn small ghost danger-t" id="delu">מחיקת הדירה</button>' : ''}`,
    onMount: (el, close) => {
      const st = $('[name=status]', el);
      const prev = () => { const d = Object.fromEntries([...$('form', el).elements].filter(x => x.name).map(x => [x.name, x.value])); const pl = readPlan(d), price = n(d.sale_price), sm = (d.sale_date || todayStr()).slice(0, 7);
        $('#plprev', el).innerHTML = price && pl.length ? planDue(pl, sm).map(l => `${esc(l.label)}: <b>${money(price * l.pct / 100)}</b> ב${monthLabel(l.month)}`).join(' · ') : ''; };
      st.onchange = () => { $('.buyer', el).hidden = st.value === 'available'; $('.soldonly', el).hidden = st.value !== 'sold'; prev(); };
      wirePlan(el); $('form', el).addEventListener('input', prev); prev();
      $('#delu', el)?.addEventListener('click', async () => {
        if (!(await confirmBox('מחיקת דירה', got.length ? 'התשלומים שהתקבלו יישארו בהכנסות. התשלומים הצפויים יימחקו.' : 'הדירה והתשלומים הצפויים שלה יימחקו.', 'מחיקה', true))) return;
        for (const i of inc.filter(i => i.status !== 'received')) await db.remove('dev_income', i.id);
        await db.remove('dev_units', u.id); await logChange({ project_id: P.id, entity: 'unit', entity_id: u.id, label: u.name, field: 'מחיקת דירה' }); close(null); toast('נמחק'); render(); });
    },
    validate: d => (!d.name.trim() ? 'חסר שם' : !(n(d.list_price) > 0) ? 'חסר מחיר מחירון' : d.status === 'sold' && !d.buyer.trim() ? 'חסר שם הרוכש' : d.status === 'sold' && !(n(d.sale_price) > 0) ? 'חסר מחיר מכירה'
      : d.status === 'sold' && !d.sale_date ? 'חסר תאריך חתימה' : d.status === 'sold' ? planCheck(readPlan(d)) : null) });
  if (!v) return;
  const sold = v.status === 'sold';
  const row = { name: v.name.trim(), building: v.building.trim() || null, floor: v.floor.trim() || null, rooms: numOrNull(v.rooms), area: numOrNull(v.area), list_price: n(v.list_price), status: v.status,
    buyer: v.status === 'available' ? null : v.buyer.trim() || null, buyer_phone: v.status === 'available' ? null : v.buyer_phone.trim() || null, buyer_email: v.status === 'available' ? null : v.buyer_email.trim() || null,
    sale_date: sold ? v.sale_date : null, sale_price: sold ? n(v.sale_price) : null, plan: sold ? readPlan(v) : null, notes: v.notes || null };
  if (!sold && u?.status === 'sold' && got.length && !(await confirmBox('ביטול מכירה', `כבר התקבלו ${money(got.reduce((a, i) => a + n(i.received_amount ?? i.amount), 0))} מהרוכש. הם יישארו בהכנסות, ורק התשלומים הצפויים יימחקו.`, 'המשך', true))) return;
  let id = u?.id;
  if (u) await db.update('dev_units', u.id, row);
  else { const [r] = await db.insert('dev_units', { tenant_id: S.tenantId, project_id: P.id, sort: (P.pd.units || []).length + 1, ...row }); id = r.id; }
  // תשלומי הרוכש: נבנים מחדש בכל שמירה (רק הצפויים)
  for (const i of inc.filter(i => i.status !== 'received')) await db.remove('dev_income', i.id);
  if (sold) { const rows = unitIncomeRows({ ...row, id }, row.plan, got); if (rows.length) await db.insert('dev_income', rows.map(r => ({ tenant_id: S.tenantId, project_id: P.id, ...r }))); }
  if (!u || u.status !== row.status || n(u.sale_price) !== n(row.sale_price)) await logChange({ project_id: P.id, entity: 'unit', entity_id: id, label: row.name, field: u ? 'מצב / מחיר' : 'דירה חדשה',
    old_value: u ? `${UNIT_STATUS[u.status]}${u.sale_price ? ' ' + u.sale_price : ''}` : null, new_value: `${UNIT_STATUS[row.status]}${row.sale_price ? ' ' + row.sale_price : ''}` });
  toast(sold && (!u || u.status !== 'sold') ? 'נמכרה! תשלומי הרוכש נוספו להכנסות' : 'נשמר'); render();
}

// ===== לשונית ליווי בנקאי =====
function simFor(P) {
  const pd = P.pd, st = settings();
  const s = devSummary({ project: pd.project, items: pd.items, contracts: pd.contracts, cLines: pd.cLines, expenses: pd.expenses, cos: pd.cos, signoffs: pd.signoffs, fixedCosts: pd.fixedCosts, coLines: pd.coLines, cbills: pd.cbills, cbLines: pd.cbLines, vatPct: st.vat_pct });
  // התזרים בלי משיכות והחזרים לבנק: הסימולציה היא שקובעת אותם
  const pd2 = { ...pd, income: (pd.income || []).filter(i => i.source !== 'bank') };
  const end = pd.project.end_date ? mkey(pd.project.end_date) : '';
  const cur = mkey(todayStr());
  const ahead = Math.min(72, Math.max(12, end ? (+end.slice(0, 4) - +cur.slice(0, 4)) * 12 + (+end.slice(5) - +cur.slice(5)) + 6 : 24));
  const cf = devCashflow([{ project: pd.project, s, pd: pd2 }], { settings: { ...st, cash_opening: 0 }, today: todayStr(), back: 0, ahead, indexSeries: pd.indexSeries || [] });
  return bankSim(pd.project, { months: cf.months, units: pd.units || [], income: pd.income || [], cur, costTotal: cf.costTotal });
}

export function bankTab(P) {
  const p = P.project, b = bankConf(p), r = simFor(P), edit = can.expense();
  const simRows = (P.pd.income || []).filter(i => i.source === 'bank' && i.notes === 'sim');
  const bar = (now, req, unit) => { const k = req ? Math.min(1, now / req) : 1; return `<div class="pbar"><i style="width:${(k * 100).toFixed(0)}%" class="${k >= 1 ? 'ok' : ''}"></i></div><div class="small mut">${unit(now)} מתוך ${unit(req)}</div>`; };
  const cnt = v => `${Math.round(v)} דירות`;
  const el = h(`<div>
    <div class="actions" style="margin-bottom:10px;flex-wrap:wrap;gap:8px"><span class="small mut">מסגרת ${money(b.line)} · הון עצמי ${b.equity_amount ? money(b.equity_amount) : pct(n(b.equity_pct), { d: 0 }) + ' מהעלות'} · מכירות מוקדמות ${pct(n(b.presale_pct), { d: 0 })} ${b.presale_basis === 'units' ? 'מהדירות' : 'מהשווי'} · ריבית ${pct(n(b.rate_pct))} לשנה</span>
      ${edit ? '<button class="btn small ghost" id="bconf">תנאי הליווי</button>' : ''}</div>
    ${!n(b.line) ? '<div class="note">עוד לא הוזנו תנאי הליווי. לוחצים "תנאי הליווי" ומזינים את גובה המסגרת, ההון העצמי הנדרש ותנאי המכירות המוקדמות מהסכם הליווי.</div>' : ''}
    <div class="cols even">
      <div class="card"><h2>תנאים לפתיחת המסגרת ${r.metNow ? '<span class="chip green">מתקיימים</span>' : '<span class="chip amber">עוד לא</span>'}</h2>
        <div style="margin-bottom:10px"><b>הון עצמי</b> ${r.equityOk ? '✓' : ''}${bar(r.equityIn, r.equityReq, money)}</div>
        <div><b>מכירות מוקדמות</b> ${r.presaleOk ? '✓' : ''}${bar(r.presaleNow, r.presaleReq, b.presale_basis === 'units' ? cnt : money)}</div>
        ${!has(p, 'sales') ? '<p class="small mut">כדי לעקוב אחרי מכירות מוקדמות, מדליקים גם את המודול "מכירות דירות" בהגדרות הפרויקט.</p>' : ''}
        ${!r.metNow && r.metM ? `<p class="small">לפי קצב המכירות וההון הצפוי, התנאים יתקיימו ב<b>${monthLabel(r.metM)}</b>.</p>` : ''}
      </div>
      <div class="card"><h2>סימולציה</h2><div class="kpis" style="margin:0">
        <div class="kpi"><div class="l">שיא ניצול המסגרת</div><div class="v ${r.lineUse > 1 ? 'neg' : ''}">${money(r.peak)}</div><div class="n">${r.peakM ? monthLabel(r.peakM) : ''}${n(b.line) ? ' · ' + pct(r.lineUse * 100, { d: 0 }) + ' מהמסגרת' : ''}</div></div>
        <div class="kpi"><div class="l">ריבית צפויה</div><div class="v">${money(r.interest)}</div><div class="n">עמלת מסגרת ${money(r.fee)}</div></div>
        <div class="kpi"><div class="l">משיכה ראשונה</div><div class="v">${r.firstDraw ? monthLabel(r.firstDraw) : '—'}</div><div class="n">סה"כ משיכות ${money(r.drawTotal)}</div></div>
        <div class="kpi"><div class="l">חסר מימון (הון נוסף)</div><div class="v ${r.gapTotal > 1 ? 'neg' : 'pos'}">${money(r.gapTotal)}</div><div class="n">${r.gapTotal > 1 ? 'חודשים שבהם אין מקור לכסות את ההוצאות' : 'כל החודשים מכוסים'}</div></div></div>
        ${edit && r.drawTotal ? `<div class="actions" style="margin-top:10px"><button class="btn small" id="tocf">העברת המשיכות לתזרים</button><span class="small mut">${simRows.length ? `יחליף ${simRows.length} שורות שהועברו קודם` : 'יוצר שורות "בנק מלווה" צפויות בהכנסות'}</span></div>` : ''}
      </div></div>
    <div class="card"><h2>חודש אחר חודש</h2>
      <div class="tw cft"><table><thead><tr><th class="stk">₪ כולל מע"מ</th>${r.rows.map(x => `<th class="n">${monthLabel(x.m)}</th>`).join('')}</tr></thead><tbody>
        ${[['out', 'הוצאות'], ['buyers', 'תקבולי רוכשים ואחרים'], ['equity', 'הון עצמי'], ['interest', 'ריבית'], ['draw', 'משיכה מהבנק'], ['repay', 'החזר לבנק'], ['credit', 'יתרת אשראי'], ['gap', 'חסר מימון']]
          .map(([k, l]) => `<tr class="${k === 'credit' ? 'tot' : ''}"><td class="stk">${l}</td>${r.rows.map(x => `<td class="n ${k === 'gap' && x.gap > 1 ? 'al-r' : ''}">${x[k] ? money(x[k], { sym: false }) : ''}</td>`).join('')}</tr>`).join('')}
        <tr><td class="stk">תנאי המסגרת</td>${r.rows.map(x => `<td class="n">${x.met ? '✓' : ''}</td>`).join('')}</tr>
      </tbody></table></div>
      <p class="small mut">כל חודש: תקבולי הרוכשים וההון העצמי מכסים קודם את ההוצאות, אחר כך עודף שנצבר בחשבון הליווי, ורק אז משיכה מהבנק, ורק אחרי שתנאי ההון העצמי והמכירות המוקדמות מתקיימים, עד גובה המסגרת. עודף בחודש מחזיר קודם את האשראי. מה שנשאר חסר מסומן כ"חסר מימון". ההוצאות לקוחות מתזרים הפרויקט (בלי שורות הבנק), כולל מכירות צפויות אם הוגדרו.</p></div>
  </div>`);
  $('#bconf', el)?.addEventListener('click', () => bankConfDialog(P));
  $('#tocf', el)?.addEventListener('click', async () => {
    if (!(await confirmBox('העברה לתזרים', `ייווצרו שורות "בנק מלווה" צפויות לפי הסימולציה (${money(r.drawTotal)} משיכות${r.rows.some(x => x.repay) ? ' והחזרים' : ''}). שורות שהועברו קודם יוחלפו. שורות בנק שהזנת ידנית לא נוגעות.`, 'העברה'))) return;
    for (const i of simRows.filter(i => i.status !== 'received')) await db.remove('dev_income', i.id);
    const rows = r.rows.flatMap(x => [x.draw && { description: 'משיכה מהליווי (סימולציה)', amount: Math.round(x.draw), m: x.m }, x.repay && { description: 'החזר לבנק (סימולציה)', amount: -Math.round(x.repay), m: x.m }].filter(Boolean))
      .map(x => ({ tenant_id: S.tenantId, project_id: P.id, source: 'bank', payer: 'בנק מלווה', description: x.description, due_date: x.m + '-20', amount: x.amount, status: 'expected', notes: 'sim' }));
    if (rows.length) await db.insert('dev_income', rows);
    await logChange({ project_id: P.id, entity: 'project', entity_id: P.id, label: 'ליווי בנקאי', field: 'העברת משיכות לתזרים', new_value: rows.length });
    toast(`הועברו ${rows.length} שורות לתזרים`); render();
  });
  return el;
}

async function bankConfDialog(P) {
  const p = P.project, b = bankConf(p);
  const v = await modal({ title: 'תנאי הליווי הבנקאי', body: `<p class="small mut">לפי הסכם הליווי. כל הסכומים כולל מע"מ.</p>
    <div class="grid g2">${field('מסגרת אשראי ₪', 'line', b.line || '', { type: 'number', req: true })}${field('ריבית שנתית %', 'rate_pct', b.rate_pct ?? '', { type: 'number' })}</div>
    <div class="grid g2">${field('הון עצמי נדרש % מהעלות', 'equity_pct', b.equity_pct ?? '', { type: 'number' })}${field('או סכום קבוע ₪', 'equity_amount', b.equity_amount ?? '', { type: 'number', hint: 'אם מלא, גובר על האחוז' })}</div>
    <div class="grid g2">${field('מכירות מוקדמות %', 'presale_pct', b.presale_pct ?? '', { type: 'number' })}${select('לפי', 'presale_basis', { value: 'שווי המכירות', units: 'מספר הדירות' }, b.presale_basis)}</div>
    ${field('עמלת מסגרת % (חד פעמי)', 'fee_pct', b.fee_pct ?? '', { type: 'number' })}`,
    validate: d => !(n(d.line) > 0) && 'חסר גובה המסגרת' });
  if (!v) return;
  const bank = { line: n(v.line), rate_pct: n(v.rate_pct), equity_pct: n(v.equity_pct), equity_amount: v.equity_amount === '' ? null : n(v.equity_amount), presale_pct: n(v.presale_pct), presale_basis: v.presale_basis, fee_pct: n(v.fee_pct) };
  await db.update('projects', p.id, { bank });
  await logChange({ project_id: p.id, entity: 'project', entity_id: p.id, label: 'ליווי בנקאי', field: 'תנאי הליווי', old_value: b.line || null, new_value: bank.line });
  toast('נשמר'); render();
}
