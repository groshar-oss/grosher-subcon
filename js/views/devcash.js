// פרויקט יזם: הכנסות (רוכשים, בנק מלווה, הון עצמי) ותזרים מול ההוצאות והתקציב, עם תרחישי איחור בתקבולים ועיכוב בלו"ז
import { h, esc, $, $$, modal, field, select, area, toast, money, fmtDate, confirmBox, numOrNull, nullIfEmpty, store } from '../util.js';
import { closedThrough, isClosedDate, corrLabel, correctionDate } from '../monthclose.js';
import { db } from '../db.js';
import { S, can, render, logChange, settings } from '../app.js';
import { n } from '../calc.js';
import { monthLabel, usedRows, groupPeriods, PERIODS } from '../cashflow.js';
import { devCashflow, devCashAlerts, INCOME_SOURCES, DCF_ROWS, DCF_IN, DCF_OUT } from '../devcash.js';
import { devSummary } from '../dev.js';
import { projData } from './common.js';
import { chart, perSeg } from './cashflow.js';
import { loadXLSX } from '../import.js';

const todayStr = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
const opt = () => ({ ahead: 12, incomeDelay: 0, schedDelay: 0, delayCost: 0, per: 'month', ...(store('subcon-dcf') || {}) });
const m0 = v => money(v, { sym: false });

export function devCfFor(data, ids, o = opt()) {
  const list = ids.map(id => { const pd = projData(data, id); const s = devSummary({ project: pd.project, items: pd.items, contracts: pd.contracts, cLines: pd.cLines, expenses: pd.expenses, cos: pd.cos, signoffs: pd.signoffs, fixedCosts: pd.fixedCosts, coLines: pd.coLines, cbills: pd.cbills, cbLines: pd.cbLines, vatPct: settings().vat_pct }); return { project: pd.project, s, pd }; });
  return devCashflow(list, { settings: settings(), today: todayStr(), back: 3, ahead: o.ahead, incomeDelay: o.incomeDelay, schedDelay: o.schedDelay, delayCost: o.delayCost, indexSeries: data.indexSeries || [] });
}

// לשונית "הכנסות ותזרים" בפרויקט יזם
export function devCashTab(P) {
  const el = h('<div></div>');
  el.appendChild(incomeCard(P));
  el.appendChild(devCashBlock(P.data, [P.id], P.project.name));
  return el;
}

function incomeCard(P) {
  const list = [...(P.pd.income || [])].sort((a, b) => String(a.due_date || '').localeCompare(String(b.due_date || '')));
  const today = todayStr();
  const sum = f => list.filter(f).reduce((a, i) => a + n(i.status === 'received' ? i.received_amount ?? i.amount : i.amount), 0);
  const edit = can.expense();
  const late = list.filter(i => i.status !== 'received' && i.due_date && i.due_date < today);
  const bySrc = Object.keys(INCOME_SOURCES).map(k => [k, sum(i => i.source === k)]).filter(x => x[1]);
  const el = h(`<details class="card" ${list.length ? '' : 'open'}><summary><b>הכנסות היזם</b> <span class="small mut">· התקבל ${money(sum(i => i.status === 'received'))} · צפוי ${money(sum(i => i.status !== 'received'))}${late.length ? ` · <span class="neg">${late.length} באיחור</span>` : ''} · ${bySrc.map(([k, v]) => `${INCOME_SOURCES[k]} ${money(v)}`).join(' · ')}</span></summary>
    ${edit ? '<div class="actions" style="margin:10px 0"><button class="btn small" id="addinc" type="button">+ הכנסה</button><span class="small mut">רוכשים, משיכות מהבנק המלווה, הון עצמי. כולל מע"מ.</span></div>' : ''}
    <div class="tw" style="max-height:360px;overflow:auto"><table><thead><tr><th>מועד</th><th>מקור</th><th>משלם / פירוט</th><th class="n">סכום</th><th>מצב</th></tr></thead><tbody>
    ${list.map(i => `<tr class="click ${i.status !== 'received' && i.due_date < today ? 'al-r' : ''}" data-inc="${i.id}"><td>${fmtDate(i.status === 'received' ? i.received_date || i.due_date : i.due_date)}</td><td>${INCOME_SOURCES[i.source]}</td><td class="wrap">${esc(i.payer || '')}${i.corr_month ? ` <span class="chip amber">${corrLabel(i.corr_month)}</span>` : ''}<div class="small mut">${esc(i.description || '')}</div></td>
      <td class="n">${money(i.status === 'received' ? i.received_amount ?? i.amount : i.amount)}</td><td>${i.status === 'received' ? '<span class="chip green">התקבל</span>' : i.due_date < today ? '<span class="chip red">באיחור</span>' : '<span class="chip">צפוי</span>'}</td></tr>`).join('') || '<tr><td colspan="5" class="empty">אין הכנסות. מוסיפים תשלומי רוכשים ומשיכות מהבנק כדי לראות תזרים.</td></tr>'}
    </tbody></table></div></details>`);
  $('#addinc', el)?.addEventListener('click', () => incomeDialog(P));
  if (edit) $$('[data-inc]', el).forEach(tr => tr.onclick = () => incomeDialog(P, list.find(i => i.id === tr.dataset.inc)));
  return el;
}

async function incomeDialog(P, i = null, preset = null) {
  const thr = closedThrough(P.data.closes);
  if (i && i.status === 'received' && isClosedDate(i.received_date, thr)) {
    const m = String(i.received_date).slice(0, 7);
    if (!(await confirmBox(`${monthLabel(m)} סגור`, `התקבול הזה התקבל בחודש סגור ולכן לא משנים אותו. אפשר לרשום שורת תיקון בחודש הנוכחי (בסכום ההפרש, גם שלילי), שתסומן "${corrLabel(m)}".`, 'שורת תיקון'))) return;
    return incomeDialog(P, null, { source: i.source, payer: i.payer, description: `תיקון: ${i.description || ''}`.trim(), status: 'received', received_date: correctionDate(), due_date: correctionDate(), amount: '', unit_id: i.unit_id || null, corr_month: m, correction_of: i.id });
  }
  const i0 = i; i = i || preset;
  const v = await modal({ title: i0 ? 'הכנסה' : preset?.corr_month ? corrLabel(preset.corr_month) : 'הכנסה חדשה', body: `<div class="grid g2">${select('מקור', 'source', INCOME_SOURCES, i?.source || 'buyer')}${field('משלם', 'payer', i?.payer || '')}</div>
    ${field('פירוט (למשל: דירה 14, תשלום שני)', 'description', i?.description || '')}
    <div class="grid g3">${field('מועד צפוי', 'due_date', i?.due_date || todayStr(), { type: 'date', req: true })}${field('סכום ₪ (כולל מע"מ)', 'amount', i?.amount ?? '', { type: 'number', req: true })}${select('מצב', 'status', { expected: 'צפוי', received: 'התקבל' }, i?.status || 'expected')}</div>
    <div class="grid g2">${field('תאריך קבלה בפועל', 'received_date', i?.received_date || '', { type: 'date' })}${field('סכום שהתקבל ₪ (ריק = הסכום הצפוי)', 'received_amount', i?.received_amount ?? '', { type: 'number' })}</div>${area('הערות', 'notes', i?.notes || '')}
    ${i0 ? '<button type="button" class="btn small ghost danger-t" id="delinc">מחיקה</button>' : ''}`,
    onMount: (el, close) => { $('[name=status]', el).onchange = e => { if (e.target.value === 'received' && !$('[name=received_date]', el).value) $('[name=received_date]', el).value = todayStr(); };
      $('#delinc', el)?.addEventListener('click', async () => { if (!(await confirmBox('מחיקת הכנסה', 'למחוק את ההכנסה?', 'מחיקה', true))) return; await db.remove('dev_income', i.id); close(null); toast('נמחק'); render(); }); },
    validate: d => (!n(d.amount) ? 'חסר סכום' : !d.due_date ? 'חסר מועד' : i0 && d.status === 'received' && isClosedDate(d.received_date, thr) ? 'תאריך הקבלה בחודש סגור. רושמים תאריך בחודש פתוח' : null) });
  if (!v) return;
  const row = { source: v.source, payer: v.payer.trim() || null, description: v.description.trim() || null, due_date: v.due_date, amount: n(v.amount), status: v.status,
    received_date: v.status === 'received' ? nullIfEmpty(v.received_date) || todayStr() : null, received_amount: v.status === 'received' ? numOrNull(v.received_amount) : null, notes: v.notes || null };
  const lbl = `${INCOME_SOURCES[row.source]}${row.payer ? ' · ' + row.payer : ''}`;
  if (preset?.corr_month) Object.assign(row, { corr_month: preset.corr_month, correction_of: preset.correction_of, unit_id: preset.unit_id || null });
  else if (!i0 && row.status === 'received' && isClosedDate(row.received_date, thr)) { row.corr_month = row.received_date.slice(0, 7); row.notes = `התקבל ב-${fmtDate(row.received_date)}${row.notes ? '. ' + row.notes : ''}`; row.received_date = correctionDate(); }
  i = i0;
  if (i) { await db.update('dev_income', i.id, row); if (i.status !== row.status || n(i.amount) !== row.amount) await logChange({ project_id: P.id, entity: 'income', entity_id: i.id, label: lbl, field: i.status !== row.status ? 'מצב הכנסה' : 'סכום הכנסה', old_value: i.status !== row.status ? (i.status === 'received' ? 'התקבל' : 'צפוי') : i.amount, new_value: i.status !== row.status ? (row.status === 'received' ? 'התקבל' : 'צפוי') : row.amount }); }
  else { const [r] = await db.insert('dev_income', { tenant_id: S.tenantId, project_id: P.id, ...row }); await logChange({ project_id: P.id, entity: 'income', entity_id: r.id, label: lbl, field: 'הכנסה חדשה', new_value: row.amount }); }
  toast('נשמר'); render();
}

// תזרים יזם: לפרויקט אחד או לכמה פרויקטים
export function devCashBlock(data, ids, title) {
  const wrap = h('<div></div>');
  const draw = () => {
    const o = opt(), st = settings();
    const r = devCfFor(data, ids, o);
    const view = groupPeriods(r.months, o.per, r.cur), fut = r.months.filter(m => !m.past);
    const alerts = devCashAlerts(r);
    const next3 = fut.slice(0, 3).reduce((a, m) => a + m.net, 0);
    const low = r.lowest;
    wrap.innerHTML = '';
    const el = h(`<div>
      <div class="actions" style="margin:12px 0;flex-wrap:wrap;gap:8px">
        <span class="mut small">טווח:</span><div class="seg" id="ah">${[6, 12, 24].map(k => `<button type="button" data-k="${k}" class="${o.ahead === k ? 'on' : ''}">${k} חודשים</button>`).join('')}</div>
        <span class="mut small">איחור בתקבולים:</span><div class="seg" id="idl">${[0, 30, 60].map(k => `<button type="button" data-k="${k}" class="${o.incomeDelay === k ? 'on' : ''}">${k ? `+${k} יום` : 'בזמן'}</button>`).join('')}</div>
        <span class="mut small">עיכוב בלו"ז:</span><div class="seg" id="sdl">${[0, 1, 3, 6].map(k => `<button type="button" data-k="${k}" class="${o.schedDelay === k ? 'on' : ''}">${k ? `+${k} ח'` : 'בזמן'}</button>`).join('')}</div>
        ${o.schedDelay ? `<label class="small" style="display:flex;align-items:center;gap:6px">עלות לחודש עיכוב ₪ <input id="dcost" type="number" dir="ltr" step="any" value="${o.delayCost || ''}" placeholder="פיקוח, שמירה, מימון" style="width:120px"></label>` : ''}
        ${perSeg(o.per)}
        <button class="btn ghost small" id="xl">ייצוא לאקסל</button></div>
      <div class="kpis">
        <div class="kpi"><div class="l">יתרה בתחילת ${monthLabel(r.cur)}</div><div class="v ${r.opening < 0 ? 'neg' : ''}">${money(r.opening)}</div><div class="n">יתרה בבנק ${money(st.cash_opening || 0)} נכון ל-${monthLabel(r.asof)}${can.edit() ? ` · <a href="#/client/${S.tenantId}">עדכון</a>` : ''}</div></div>
        <div class="kpi"><div class="l">נטו ב-3 החודשים הקרובים</div><div class="v ${next3 < 0 ? 'neg' : 'pos'}">${money(next3)}</div><div class="n">הכנסות פחות הוצאות</div></div>
        <div class="kpi"><div class="l">היתרה הנמוכה בטווח</div><div class="v ${low && low.cum < n(st.cash_min) ? 'neg' : ''}">${money(low?.cum || 0)}</div><div class="n">${low ? monthLabel(low.m) : ''} · מינימום ${money(st.cash_min || 0)}</div></div>
        <div class="kpi"><div class="l">הכנסות מול עלות</div><div class="v">${money(r.incomeTotal)}</div><div class="n">צפי עלות ${money(r.costTotal)} · תקציב ${money(r.budgetTotal)}</div></div>
      </div>
      ${alerts.length ? `<div class="note neg" id="cfal">${alerts.map(a => `<div><b>${esc(a.title)}</b> · ${esc(a.detail)}</div>`).join('')}${o.incomeDelay || o.schedDelay ? `<div class="small">בתרחיש: ${[o.incomeDelay ? `איחור ${o.incomeDelay} יום בתקבולים` : '', o.schedDelay ? `עיכוב ${o.schedDelay} חודשים בלו"ז` : ''].filter(Boolean).join(', ')}</div>` : ''}</div>` : '<div class="note small pos">אין חודש שבו ההוצאות עולות על ההכנסות, והיתרה לא יורדת מתחת למינימום.</div>'}
      <div class="card" style="padding:10px 6px">${chart(view, n(st.cash_min))}</div>
      <div class="tw cft"><table><thead><tr><th class="stk">₪ כולל מע"מ</th>${view.map(m => `<th class="n ${m.cur ? 'curm' : ''}">${m.label}${m.past ? '<div class="small mut">בפועל</div>' : m.cur ? `<div class="small">${o.per === 'month' ? 'החודש' : 'כולל החודש'}</div>` : ''}</th>`).join('')}</tr></thead><tbody>
        <tr class="sec"><td class="stk"><b>הכנסות</b></td>${view.map(() => '<td></td>').join('')}</tr>
        ${usedRows(DCF_IN, view).map(k => row(k, view)).join('')}
        <tr class="tot"><td class="stk">סה"כ הכנסות</td>${view.map(m => `<td class="n">${money(m.inTotal)}</td>`).join('')}</tr>
        <tr class="sec"><td class="stk"><b>הוצאות</b></td>${view.map(() => '<td></td>').join('')}</tr>
        ${usedRows(DCF_OUT, view).map(k => row(k, view)).join('')}
        <tr class="tot"><td class="stk">סה"כ הוצאות</td>${view.map(m => `<td class="n ${m.outOverIn ? 'neg' : ''}">${money(m.outTotal)}</td>`).join('')}</tr>
        <tr class="tot"><td class="stk">נטו ב${PERIODS[o.per] || 'חודש'}</td>${view.map(m => `<td class="n ${m.net < 0 ? 'neg' : 'pos'}">${money(m.net)}</td>`).join('')}</tr>
        <tr class="tot"><td class="stk"><b>יתרה מצטברת</b></td>${view.map(m => `<td class="n ${m.below && !m.past ? 'al-r' : ''}"><b>${money(m.cum)}</b></td>`).join('')}</tr>
      </tbody></table></div>
      <p class="small mut">חודשים שעברו: תקבולים שהתקבלו ותשלומים ששולמו. מהחודש הנוכחי: הכנסות צפויות (באיחור נכנסות לחודש הנוכחי), חשבונות שאושרו לפי תנאי התשלום של כל התקשרות, יתרת ההתקשרויות החתומות ויתרת הצפי שטרם נסגרה, מתחלקות עד סיום הפרויקט. בעיכוב בלו"ז: ההוצאות מתפרסות על תקופה ארוכה יותר, תקבולי הרוכשים והמשיכות מהבנק זזים באותו מספר חודשים, ועלות החודש הנוסף נכנסת בסוף. לחיצה על סכום מציגה פירוט.</p>
    </div>`);
    $$('#ah button', el).forEach(b => b.onclick = () => { store('subcon-dcf', { ...opt(), ahead: +b.dataset.k }); draw(); });
    $$('#idl button', el).forEach(b => b.onclick = () => { store('subcon-dcf', { ...opt(), incomeDelay: +b.dataset.k }); draw(); });
    $$('#sdl button', el).forEach(b => b.onclick = () => { store('subcon-dcf', { ...opt(), schedDelay: +b.dataset.k }); draw(); });
    $$('#per button', el).forEach(b => b.onclick = () => { store('subcon-dcf', { ...opt(), per: b.dataset.k }); draw(); });
    $('#dcost', el)?.addEventListener('change', e => { store('subcon-dcf', { ...opt(), delayCost: n(e.target.value) }); draw(); });
    $$('[data-cell]', el).forEach(td => td.onclick = () => {
      const [mk, key] = td.dataset.cell.split('|'); const M = view.find(x => x.m === mk);
      const pn = id => data.projects.find(p => p.id === id)?.name || '';
      modal({ title: `${DCF_ROWS[key]} · ${M.label}`, ok: 'סגירה', cancel: null, body: `<div class="tw" style="box-shadow:none"><table><thead><tr>${ids.length > 1 ? '<th>פרויקט</th>' : ''}<th>פירוט</th><th class="n">₪</th></tr></thead><tbody>
        ${M.items.filter(i => i.key === key).map(i => `<tr class="${i.late ? 'al-r' : ''}">${ids.length > 1 ? `<td>${esc(pn(i.projectId))}</td>` : ''}<td>${esc(i.label)}</td><td class="n">${m0(i.amt)}</td></tr>`).join('')}</tbody></table></div>` });
    });
    $('#xl', el).onclick = () => exportDcf(view, title, o);
    wrap.appendChild(el);
  };
  draw();
  return wrap;
}
const row = (k, view) => `<tr><td class="stk">${DCF_ROWS[k]}</td>${view.map(m => m.rows[k] ? `<td class="n click" data-cell="${m.m}|${k}">${m0(m.rows[k])}</td>` : '<td></td>').join('')}</tr>`;

async function exportDcf(view, title, o) {
  const XLSX = await loadXLSX();
  const r = v => Math.round(n(v));
  const aoa = [[`תזרים יזם - ${title}`], [`הופק ${todayStr()} · איחור בתקבולים ${o.incomeDelay} יום · עיכוב בלו"ז ${o.schedDelay} חודשים · כולל מע"מ`], [],
    ['', ...view.map(m => (m.label || monthLabel(m.m)) + (m.past ? ' (בפועל)' : ''))],
    ['הכנסות'], ...usedRows(DCF_IN, view).map(k => [DCF_ROWS[k], ...view.map(m => r(m.rows[k]))]), ['סה"כ הכנסות', ...view.map(m => r(m.inTotal))],
    ['הוצאות'], ...usedRows(DCF_OUT, view).map(k => [DCF_ROWS[k], ...view.map(m => r(m.rows[k]))]), ['סה"כ הוצאות', ...view.map(m => r(m.outTotal))],
    ['נטו לתקופה', ...view.map(m => r(m.net))], ['יתרה מצטברת', ...view.map(m => r(m.cum))]];
  const ws = XLSX.utils.aoa_to_sheet(aoa); ws['!cols'] = [{ wch: 32 }, ...view.map(() => ({ wch: 12 }))];
  const wb = XLSX.utils.book_new(); wb.Workbook = { Views: [{ RTL: true }] }; XLSX.utils.book_append_sheet(wb, ws, 'תזרים יזם');
  XLSX.writeFile(wb, `תזרים יזם - ${String(title).replace(/[\\/:*?"<>|·]/g, '-')}.xlsx`);
}
