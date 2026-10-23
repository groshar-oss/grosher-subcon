// שלב 6: דוחות. כל דוח לפרויקט אחד או לכולם, עם הדפסה ו-Excel.
import { h, esc, $, $$, money, pct, num, fmtDate, store } from '../util.js';
import { S, can, settings, loadTenantData, modeSwitch, tenant } from '../app.js';
import { n, PROFIT_MODES, VO_STATUS, VO_APPROVED, VO_AT_RISK, EXPENSE_KINDS, EXPENSE_STATUS, overrunPct } from '../calc.js';
import { PAY_TYPES } from '../quota.js';
import { collection, dueDate } from '../bills.js';
import { GUAR_KINDS, guaranteeState } from '../docs.js';
import { cashflow, monthLabel, mkey, addMonths } from '../cashflow.js';
import { projData, summarize, STATUS } from './common.js';
import { loadXLSX } from '../import.js';

const todayStr = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
const m0 = v => money(v, { sym: false });
const opt = () => ({ pid: '', from: todayStr().slice(0, 4) + '-01', to: todayStr().slice(0, 7), by: 'worker', month: addMonths(todayStr().slice(0, 7), -1), ...(store('subcon-rep') || {}) });
const setOpt = o => store('subcon-rep', { ...opt(), ...o });

export const REPORTS = [
  ['profit', 'רווחיות: חוזה, תוספות, סה"כ', () => can.costing()],
  ['labor', 'עלות עבודה', () => can.prices()],
  ['expenses', 'הוצאות לפי ספק ולפי סוג', () => can.prices()],
  ['vo', 'הוראות שינוי', () => can.costing()],
  ['retention', 'עיכבונות וערבויות', () => can.prices()],
  ['client', 'דוח חודשי ללקוח', () => can.costing()]
];

// טבלה גנרית. cols: [[כותרת, מספרי?]], rows: מערכי תאים (מחרוזות HTML). foot: שורת סיכום.
const T = (cols, rows, foot, empty = 'אין נתונים') => `<div class="tw"><table><thead><tr>${cols.map(([c, isN]) => `<th class="${isN ? 'n' : ''}">${c}</th>`).join('')}</tr></thead><tbody>
  ${rows.map(r => `<tr${r.cls ? ` class="${r.cls}"` : ''}>${(r.cells || r).map((c, i) => `<td class="${cols[i]?.[1] ? 'n' : ''}">${c ?? ''}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${cols.length}" class="empty">${empty}</td></tr>`}
  ${foot ? `<tr class="tot">${foot.map((c, i) => `<td class="${cols[i]?.[1] ? 'n' : ''}">${c ?? ''}</td>`).join('')}</tr>` : ''}</tbody></table></div>`;
const sum = (xs, f) => xs.reduce((a, x) => a + n(f(x)), 0);
const inPeriod = (d, o) => d && d.slice(0, 7) >= o.from && d.slice(0, 7) <= o.to;
const periodText = o => `${monthLabel(o.from)} עד ${monthLabel(o.to)}`;

export async function viewReports(kind = 'profit') {
  const list = REPORTS.filter(r => r[2]());
  if (!list.length) return h('<div class="card empty">אין הרשאה</div>');
  if (!list.some(r => r[0] === kind)) kind = list[0][0];
  const data = await loadTenantData();
  const o = opt();
  if (o.pid && !data.projects.some(p => p.id === o.pid)) o.pid = '';
  const projects = o.pid ? data.projects.filter(p => p.id === o.pid) : data.projects.filter(p => p.status !== 'closed');
  const sums = projects.map(p => { const pd = projData(data, p.id); return { p, pd, s: summarize(pd) }; });
  const usesPeriod = ['labor', 'expenses'].includes(kind);
  const el = h(`<div><div class="top no-print"><div><h1>דוחות</h1><div class="sub">כל דוח לפרויקט אחד או לכל הפרויקטים הפעילים · הדפסה ו-Excel</div></div></div>
    <nav class="tabs">${list.map(([k, l]) => `<a href="#/reports/${k}" class="${k === kind ? 'on' : ''}">${l}</a>`).join('')}</nav>
    <div class="actions" style="margin-bottom:12px;flex-wrap:wrap;gap:8px">
      <select id="pid" aria-label="פרויקט"><option value="">כל הפרויקטים הפעילים</option>${data.projects.map(p => `<option value="${p.id}" ${p.id === o.pid ? 'selected' : ''}>${esc(p.name)}${p.status === 'closed' ? ' (סגור)' : ''}</option>`).join('')}</select>
      ${usesPeriod ? `<label class="small mut">מחודש <input type="month" id="from" value="${o.from}"></label><label class="small mut">עד <input type="month" id="to" value="${o.to}"></label>` : ''}
      ${kind === 'client' ? `<label class="small mut">חודש הדוח <input type="month" id="month" value="${o.month}"></label>` : ''}
      <span id="mode"></span>
      <button class="btn ghost small" id="print">הדפסה / PDF</button><button class="btn ghost small" id="xl">ייצוא לאקסל</button></div>
    <div id="rep"></div></div>`);
  const rerender = () => viewReports(kind).then(v => el.replaceWith(v));
  $('#pid', el).onchange = e => { setOpt({ pid: e.target.value }); rerender(); };
  for (const k of ['from', 'to', 'month']) $('#' + k, el)?.addEventListener('change', e => { if (e.target.value) { setOpt({ [k]: e.target.value }); rerender(); } });
  if (['profit', 'client'].includes(kind)) $('#mode', el).appendChild(modeSwitch(rerender));
  const fn = { profit: repProfit, labor: repLabor, expenses: repExpenses, vo: repVo, retention: repRetention, client: repClient }[kind];
  const title = list.find(r => r[0] === kind)[1];
  const scope = o.pid ? projects[0]?.name : 'כל הפרויקטים הפעילים';
  const body = fn({ data, sums, o, rerender });
  $('#rep', el).append(h(`<div class="rephead"><img src="icons/icon-192.png" alt=""><div><b>${esc(title)}</b><span>${esc(tenant()?.name || '')} · ${esc(scope || '')}${usesPeriod ? ' · ' + periodText(o) : ''}${['profit', 'client'].includes(kind) ? ' · ' + esc(PROFIT_MODES[S.mode]) : ''} · הופק ${fmtDate(todayStr())}</span></div></div>`), body);
  $('#print', el).onclick = () => window.print();
  $('#xl', el).onclick = () => exportTables($('#rep', el), `${title} - ${scope}`);
  return el;
}

async function exportTables(root, name) {
  const XLSX = await loadXLSX();
  const wb = XLSX.utils.book_new(); wb.Workbook = { Views: [{ RTL: true }] };
  $$('table', root).forEach((t, i) => {
    const sec = t.closest('[data-sheet]')?.dataset.sheet || `גיליון ${i + 1}`;
    let nm = sec.replace(/[\\/?*[\]:]/g, ' ').slice(0, 28); while (wb.SheetNames.includes(nm)) nm = nm.slice(0, 25) + ' ' + (i + 1);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.table_to_sheet(t), nm);
  });
  XLSX.writeFile(wb, `${name.replace(/[\\/?*:"<>|]/g, ' ')}.xlsx`);
}

// ===== 1. רווחיות: חוזה, תוספות, סה"כ =====
function repProfit({ sums }) {
  const rows = sums.map(({ p, s }) => {
    const c = s.contract, a = s.approved, r = s.atRisk;
    const prof = x => x.sale - x.forecast;
    const tot = s.total;
    return { p, c, a, r, tot, cells: [`<b>${esc(p.name)}</b><div class="small mut">${STATUS[p.status]}</div>`,
      m0(c.sale), m0(c.forecast), cls(prof(c)), pct(c.sale ? prof(c) / c.sale * 100 : 0),
      m0(a.sale), m0(a.forecast), cls(prof(a)),
      m0(r.sale), cls(prof(r)),
      m0(tot.sale), cls(tot.profit), pct(tot.profitPct), pct(overrunPct(tot.forecast, tot.planned), { sign: true })] };
  });
  const S2 = k => sum(rows, k);
  const tc = { sale: S2(r => r.c.sale), forecast: S2(r => r.c.forecast) }, ta = { sale: S2(r => r.a.sale), forecast: S2(r => r.a.forecast) }, tr = { sale: S2(r => r.r.sale), forecast: S2(r => r.r.forecast) };
  const tt = { sale: S2(r => r.tot.sale), forecast: S2(r => r.tot.forecast), planned: S2(r => r.tot.planned) };
  return h(`<div data-sheet="רווחיות">${T([['פרויקט'], ['חוזה: מכירה', 1], ['חוזה: צפי עלות', 1], ['חוזה: רווח', 1], ['%', 1], ['תוספות מאושרות: מכירה', 1], ['צפי עלות', 1], ['רווח', 1], ['לא מאושרות: מבוקש', 1], ['רווח בסיכון', 1], ['סה"כ בתצוגה: מכירה', 1], ['רווח', 1], ['%', 1], ['חריגת עלות', 1]], rows,
    ['סה"כ', m0(tc.sale), m0(tc.forecast), cls(tc.sale - tc.forecast), pct(tc.sale ? (tc.sale - tc.forecast) / tc.sale * 100 : 0), m0(ta.sale), m0(ta.forecast), cls(ta.sale - ta.forecast), m0(tr.sale), cls(tr.sale - tr.forecast), m0(tt.sale), cls(tt.sale - tt.forecast), pct(tt.sale ? (tt.sale - tt.forecast) / tt.sale * 100 : 0), pct(overrunPct(tt.forecast, tt.planned), { sign: true })])}
    <p class="small mut">רווח = מכירה פחות צפי עלות לסיום. "סה"כ בתצוגה" לפי המתג למעלה: ${esc(PROFIT_MODES[S.mode])}. תוספות לא מאושרות הן הוראות שינוי שהוגשו או בוצעו ועדיין לא אושרו.</p></div>`);
}
const cls = v => `<span class="${v < 0 ? 'neg' : ''}">${m0(v)}</span>`;

// ===== 6. עלות עבודה: לפי עובד / פרויקט / סעיף =====
function repLabor({ data, sums, o, rerender }) {
  const W = Object.fromEntries((data.workers || []).map(w => [w.id, w]));
  const all = sums.flatMap(({ p, pd, s }) => pd.entries.filter(e => inPeriod(e.log_date, o)).map(e => ({ e, p, pd, cost: s.costs[e.id]?.cost || 0, w: W[e.worker_id] })));
  const by = o.by || 'worker';
  const groups = {};
  const keyOf = x => by === 'worker' ? x.e.worker_id : by === 'project' ? x.p.id : `${x.p.id}|${x.e.boq_item_id || ''}`;
  for (const x of all) { const g = groups[keyOf(x)] ||= { xs: [], first: x }; g.xs.push(x); }
  const days = xs => sum(xs.filter(x => x.w?.pay_type !== 'piece'), x => x.e.days);
  const ot = xs => sum(xs, x => x.e.ot_hours), cost = xs => sum(xs, x => x.cost);
  let cols, rows;
  if (by === 'worker') {
    cols = [['עובד'], ['סוג העסקה'], ['פרויקטים'], ['ימים', 1], ['שעות נוספות', 1], ['כמות בקבלנות', 1], ['עלות ₪', 1], ['עלות ליום ₪', 1]];
    rows = Object.values(groups).sort((a, b) => cost(b.xs) - cost(a.xs)).map(({ xs, first }) => [`<b>${esc(first.w?.name || '?')}</b>`, PAY_TYPES[first.w?.pay_type] || '', esc([...new Set(xs.map(x => x.p.name))].join(', ')), first.w?.pay_type === 'piece' ? '' : num(days(xs), 1), num(ot(xs), 1), first.w?.pay_type === 'piece' ? num(sum(xs, x => x.e.piece_qty), 1) : '', m0(cost(xs)), days(xs) ? m0(cost(xs) / days(xs)) : '']);
  } else if (by === 'project') {
    cols = [['פרויקט'], ['עובדים', 1], ['ימים', 1], ['שכירים ₪', 1], ['יומיים ₪', 1], ['קבלנות ₪', 1], ['סה"כ עלות ₪', 1]];
    const t = (xs, pt) => sum(xs.filter(x => x.w?.pay_type === pt), x => x.cost);
    rows = Object.values(groups).map(({ xs, first }) => [`<b>${esc(first.p.name)}</b>`, new Set(xs.map(x => x.e.worker_id)).size, num(days(xs), 1), m0(t(xs, 'salary')), m0(t(xs, 'daily')), m0(t(xs, 'piece')), m0(cost(xs))]);
  } else {
    cols = [['פרויקט'], ['סעיף'], ['ימים', 1], ['כמות בקבלנות', 1], ['עלות עבודה בפועל ₪', 1], ['עבודה בתמחיר ₪', 1], ['ביצוע', 1]];
    rows = Object.values(groups).map(({ xs, first }) => {
      const it = first.pd.items.find(i => i.id === first.e.boq_item_id);
      const planned = it ? sum(first.pd.lines.filter(l => l.boq_item_id === it.id && ['labor', 'piece'].includes(l.kind)), l => n(l.qty) * n(l.unit_cost)) : 0;
      return [esc(first.p.name), it ? `<b>${esc(it.code || '')}</b> ${esc(it.description || '')}` : '<span class="mut">בלי סעיף</span>', num(days(xs), 1), num(sum(xs, x => x.e.piece_qty), 1) || '', m0(cost(xs)), planned ? m0(planned) : '', it ? pct(it.progress_pct, { d: 0 }) : ''];
    });
  }
  const foot = by === 'worker' ? ['סה"כ', '', '', num(days(all), 1), num(ot(all), 1), '', m0(cost(all)), ''] : by === 'project' ? ['סה"כ', new Set(all.map(x => x.e.worker_id)).size, num(days(all), 1), '', '', '', m0(cost(all))] : ['סה"כ', '', num(days(all), 1), '', m0(cost(all)), '', ''];
  const el = h(`<div data-sheet="עלות עבודה"><div class="seg no-print" style="margin-bottom:10px">${[['worker', 'לפי עובד'], ['project', 'לפי פרויקט'], ['item', 'לפי סעיף']].map(([k, l]) => `<button type="button" data-by="${k}" class="${by === k ? 'on' : ''}">${l}</button>`).join('')}</div>
    ${T(cols, rows, foot, 'אין רישומים ביומן העבודה בתקופה')}
    <p class="small mut">עלות מיומן העבודה: שכיר לפי חלקו בחודש (ימים ביומן מתוך ${settings().work_days_month} או יותר) כולל מקדם מעביד, יומי לפי תעריף, קבלנות לפי כמות × מחיר. שעות נוספות כלולות בעלות.</p></div>`);
  $$('[data-by]', el).forEach(b => b.onclick = () => { setOpt({ by: b.dataset.by }); rerender(); });
  return el;
}

// ===== 7. הוצאות לפי ספק ולפי סוג =====
function repExpenses({ sums, o }) {
  const vat = n(settings().vat_pct);
  const xs = sums.flatMap(({ p, pd }) => pd.expenses.filter(e => inPeriod(e.doc_date, o)).map(e => ({ e, p })));
  const bySup = {}, byKind = {};
  for (const x of xs) { (bySup[(x.e.supplier_name || 'ללא ספק').trim()] ||= []).push(x); (byKind[x.e.kind || 'other'] ||= []).push(x); }
  const amt = a => sum(a, x => x.e.amount), paid = a => sum(a.filter(x => x.e.status === 'paid'), x => x.e.amount);
  const withVat = a => sum(a, x => n(x.e.amount) * (1 + n(x.e.vat_pct ?? vat) / 100));
  const tot = amt(xs);
  const sup = Object.entries(bySup).sort((a, b) => amt(b[1]) - amt(a[1]));
  const kinds = Object.entries(byKind).sort((a, b) => amt(b[1]) - amt(a[1]));
  return h(`<div><div class="cols even">
    <div data-sheet="לפי ספק"><h2>לפי ספק</h2>${T([['ספק'], ['מסמכים', 1], ['לפני מע"מ ₪', 1], ['כולל מע"מ ₪', 1], ['שולם ₪', 1], ['פתוח ₪', 1], ['פרויקטים']],
      sup.map(([s, a]) => [`<b>${esc(s)}</b>`, a.length, m0(amt(a)), m0(withVat(a)), m0(paid(a)), m0(amt(a) - paid(a)), esc([...new Set(a.map(x => x.p.name))].join(', '))]),
      ['סה"כ', xs.length, m0(tot), m0(withVat(xs)), m0(paid(xs)), m0(tot - paid(xs)), ''], 'אין הוצאות בתקופה')}</div>
    <div data-sheet="לפי סוג"><h2>לפי סוג</h2>${T([['סוג'], ['מסמכים', 1], ['לפני מע"מ ₪', 1], ['חלק', 1]],
      kinds.map(([k, a]) => [EXPENSE_KINDS[k] || k, a.length, m0(amt(a)), pct(tot ? amt(a) / tot * 100 : 0)]), ['סה"כ', xs.length, m0(tot), '100%'], 'אין הוצאות בתקופה')}</div></div>
    <p class="small mut">לפי תאריך המסמך. עלות עובדים מיומן העבודה מופיעה בדוח עלות עבודה ולא כאן. סטטוסים: ${Object.values(EXPENSE_STATUS).join(', ')}; "פתוח" = כל מה שלא סומן שולם.</p></div>`);
}

// ===== 8. תוספות: סטטוס, סכום בסיכון, רווחיות =====
function repVo({ sums }) {
  const today = todayStr();
  const all = sums.flatMap(({ p, s }) => s.voGroups.map(g => ({ p, g })));
  const rows = all.sort((a, b) => (VO_AT_RISK.includes(b.g.vo.status) - VO_AT_RISK.includes(a.g.vo.status)) || b.g.requested - a.g.requested).map(({ p, g }) => {
    const v = g.vo, sale = VO_APPROVED.includes(v.status) ? g.approvedSale : g.requested;
    const age = v.vo_date ? Math.round((new Date(today) - new Date(v.vo_date)) / 864e5) : null;
    return { cls: v.status === 'executed_unapproved' ? 'al-r' : '', cells: [esc(p.name), `<b>${esc(v.number)}</b> ${esc(v.title)}`, VO_STATUS[v.status], v.has_written_order ? 'יש' : '<span class="neg">אין</span>', VO_AT_RISK.includes(v.status) && age != null ? `${age} ימים` : '', m0(g.requested), VO_APPROVED.includes(v.status) ? m0(g.approvedSale) : '', m0(g.actual), m0(g.forecast), cls(sale - g.forecast), VO_AT_RISK.includes(v.status) ? m0(g.requested) : ''] };
  });
  const st = Object.keys(VO_STATUS).map(k => { const a = all.filter(x => x.g.vo.status === k); return a.length ? [VO_STATUS[k], a.length, m0(sum(a, x => x.g.requested)), m0(sum(a, x => x.g.actual))] : null; }).filter(Boolean);
  const risk = all.filter(x => VO_AT_RISK.includes(x.g.vo.status));
  return h(`<div>
    <div class="kpis"><div class="kpi"><div class="l">סכום בסיכון</div><div class="v neg">${money(sum(risk, x => x.g.requested))}</div><div class="n">${risk.length} תוספות שהוגשו או בוצעו בלי אישור</div></div>
      <div class="kpi"><div class="l">עלות שכבר הוצאה על תוספות בסיכון</div><div class="v">${money(sum(risk, x => x.g.actual))}</div></div>
      <div class="kpi"><div class="l">תוספות מאושרות</div><div class="v">${money(sum(all.filter(x => VO_APPROVED.includes(x.g.vo.status)), x => x.g.approvedSale))}</div></div></div>
    <div data-sheet="תוספות">${T([['פרויקט'], ['תוספת'], ['סטטוס'], ['הוראה בכתב'], ['ממתין'], ['מבוקש ₪', 1], ['מאושר ₪', 1], ['עלות בפועל ₪', 1], ['צפי עלות ₪', 1], ['רווח צפוי ₪', 1], ['בסיכון ₪', 1]], rows,
      ['סה"כ', '', '', '', '', m0(sum(all, x => x.g.requested)), m0(sum(all, x => x.g.approvedSale)), m0(sum(all, x => x.g.actual)), m0(sum(all, x => x.g.forecast)), '', m0(sum(risk, x => x.g.requested))], 'אין תוספות')}</div>
    <div data-sheet="לפי סטטוס"><h2>לפי סטטוס</h2>${T([['סטטוס'], ['מספר', 1], ['מבוקש ₪', 1], ['עלות בפועל ₪', 1]], st)}</div></div>`);
}

// ===== 9. עיכבונות וערבויות =====
function repRetention({ data, sums }) {
  const today = todayStr();
  const rows = sums.map(({ p, s }) => {
    const B = s.billing;
    const rel = p.end_date ? dueDate(p.end_date, p.pay_terms_days) : null;
    const cum = B.order.map(id => B.byBill[id]).filter(r => r.bill.status !== 'draft').pop()?.cumEffTotal || 0;
    return { p, ret: B.retentionTotal, ins: sum(Object.values(B.byBill), r => r.insurance), shared: sum(Object.values(B.byBill), r => r.shared), cum, rel,
      cells: [`<b>${esc(p.name)}</b>`, m0(cum), `${p.retention_pct}%${n(p.retention_cap) ? ` · תקרה ${m0(p.retention_cap)}` : ''}`, m0(B.retentionTotal), m0(n(p.retention_released)), m0(Math.max(0, B.retentionTotal - n(p.retention_released))), m0(sum(Object.values(B.byBill), r => r.insurance)), m0(sum(Object.values(B.byBill), r => r.shared)), fmtDate(p.end_date), rel ? `${fmtDate(rel)}${rel < today ? ' <span class="chip red">עבר</span>' : ''}` : ''] };
  });
  const g = (data.guarantees || []).filter(x => sums.some(s => s.p.id === x.project_id) && x.status !== 'returned');
  return h(`<div><div data-sheet="עיכבונות">${T([['פרויקט'], ['מצטבר בחשבונות ₪', 1], ['שיעור'], ['עיכבון שנצבר ₪', 1], ['שוחרר ₪', 1], ['פתוח ₪', 1], ['ביטוח שנוכה ₪', 1], ['הוצאות משותפות ₪', 1], ['סיום פרויקט'], ['שחרור צפוי']], rows,
    ['סה"כ', m0(sum(rows, r => r.cum)), '', m0(sum(rows, r => r.ret)), m0(sum(rows, r => n(r.p.retention_released))), m0(sum(rows, r => Math.max(0, r.ret - n(r.p.retention_released)))), m0(sum(rows, r => r.ins)), m0(sum(rows, r => r.shared)), '', ''])}</div>
    <p class="small mut">עיכבון מחושב מהחשבונות החלקיים (כולל תקרה אם הוגדרה). שחרור צפוי: סוף חודש הסיום + תנאי התשלום, בכפוף לחשבון סופי ולתעודת השלמה.</p>
    <div data-sheet="ערבויות"><h2>ערבויות פתוחות</h2>${T([['פרויקט'], ['סוג'], ['בנק'], ['מספר'], ['סכום ₪', 1], ['בתוקף עד']],
      g.map(x => ({ cls: ['expired', 'soon'].includes(guaranteeState(x, today)) ? 'al-r' : '', cells: [esc(data.projects.find(p => p.id === x.project_id)?.name || ''), GUAR_KINDS[x.kind] || '', esc(x.bank || ''), esc(x.number || ''), m0(x.amount), fmtDate(x.expiry)] })),
      g.length ? ['סה"כ', '', '', '', m0(sum(g, x => x.amount)), ''] : null, 'אין ערבויות פתוחות')}</div></div>`);
}

// ===== 10. דוח חודשי ללקוח: עמוד סיכום ועמוד לכל פרויקט =====
function repClient({ data, sums, o }) {
  const st = settings();
  const month = o.month;
  const endOfMonth = new Date(Date.UTC(+month.slice(0, 4), +month.slice(5, 7), 0)).toISOString().slice(0, 10);
  const el = h('<div class="crep"></div>');
  // סיכום כללי
  const t = { sale: sum(sums, x => x.s.total.sale), forecast: sum(sums, x => x.s.total.forecast), actual: sum(sums, x => x.s.total.actual) };
  const col = sums.map(x => collection(x.s.billing.byBill));
  const cf = cashflow(sums.map(({ p, s, pd }) => ({ project: p, summary: s, pd })), { settings: st, back: 0, ahead: 3 });
  el.append(h(`<section class="rpage" data-sheet="סיכום">
    <h2>סיכום ${monthLabel(month)} · ${sums.length} פרויקטים</h2>
    <div class="kpis"><div class="kpi"><div class="l">היקף מכירה</div><div class="v">${money(t.sale)}</div></div>
      <div class="kpi"><div class="l">רווח צפוי</div><div class="v ${t.sale - t.forecast < 0 ? 'neg' : 'pos'}">${money(t.sale - t.forecast)}</div><div class="n">${pct(t.sale ? (t.sale - t.forecast) / t.sale * 100 : 0)} מהמכירה</div></div>
      <div class="kpi"><div class="l">לגבייה מהקבלנים הראשיים</div><div class="v">${money(sum(col, c => c.outstanding))}</div><div class="n ${sum(col, c => c.overdue.length) ? 'neg' : ''}">${sum(col, c => c.overdue.length)} חשבונות באיחור</div></div>
      <div class="kpi"><div class="l">יתרת מזומנים צפויה בעוד 3 חודשים</div><div class="v ${cf.months.at(-1).cum < n(st.cash_min) ? 'neg' : ''}">${money(cf.months.at(-1).cum)}</div><div class="n">${cf.belowMonths.length ? `<span class="neg">מתחת למינימום ב${cf.belowMonths.map(m => monthLabel(m.m)).join(', ')}</span>` : 'מעל המינימום'}</div></div></div>
    ${T([['פרויקט'], ['מכירה ₪', 1], ['צפי עלות ₪', 1], ['רווח צפוי ₪', 1], ['%', 1], ['ביצוע', 1], ['חריגת עלות', 1], ['תוספות בסיכון ₪', 1], ['לגבייה ₪', 1]],
      sums.map(({ p, s }, i) => [`<b>${esc(p.name)}</b>`, m0(s.total.sale), m0(s.total.forecast), cls(s.total.profit), pct(s.total.profitPct), pct(s.total.progress, { d: 0 }), pct(s.total.overrun, { sign: true }), s.riskAmount ? m0(s.riskAmount) : '', m0(col[i].outstanding)]))}
  </section>`));
  for (const { p, s, pd } of sums) {
    const tot = s.total;
    const prof = x => x.sale - x.forecast;
    const top = s.rows.filter(r => r.c.overrun > 0 && !r.c.noCosting).sort((a, b) => (b.c.forecast - b.c.planned) - (a.c.forecast - a.c.planned)).slice(0, 5);
    const q = (s.quotas || []).filter(x => x.status === 'over');
    const risk = s.voGroups.filter(g => VO_AT_RISK.includes(g.vo.status));
    const c = collection(s.billing.byBill);
    const billsMonth = Object.values(s.billing.byBill).filter(r => (r.bill.submitted_date || '').slice(0, 7) === month);
    const paidMonth = sum(Object.values(s.billing.byBill).flatMap(r => r.payments), x => (x.pay_date || '').slice(0, 7) === month ? x.amount : 0);
    const labMonth = sum(pd.entries.filter(e => mkey(e.log_date) === month), e => s.costs[e.id]?.cost || 0);
    const expMonth = sum(pd.expenses.filter(e => mkey(e.doc_date || '') === month), e => e.amount);
    const pcf = cashflow([{ project: p, summary: s, pd }], { settings: { ...st, cash_opening: 0, cash_asof: '' }, back: 0, ahead: 2 });
    const mc = data.mcs.find(m => m.id === p.main_contractor_id)?.name || '';
    el.append(h(`<section class="rpage" data-sheet="${esc(p.name.slice(0, 25))}">
      <h2>${esc(p.name)}</h2><div class="small mut" style="margin:-6px 0 10px">${esc(mc)} · ${STATUS[p.status]} · עד ${fmtDate(endOfMonth)}</div>
      <div class="kpis"><div class="kpi"><div class="l">מכירה</div><div class="v">${money(tot.sale)}</div><div class="n">חוזה ${money(s.contract.sale)}</div></div>
        <div class="kpi"><div class="l">ביצוע / הוצאה</div><div class="v">${pct(tot.progress, { d: 0 })} / ${pct(tot.spentPct, { d: 0 })}</div><div class="n">מהתמחיר</div></div>
        <div class="kpi"><div class="l">רווח צפוי</div><div class="v ${tot.profit < 0 ? 'neg' : 'pos'}">${money(tot.profit)}</div><div class="n">${pct(tot.profitPct)} · תוכנן ${pct(tot.plannedProfitPct)}</div></div>
        <div class="kpi"><div class="l">חריגת עלות צפויה</div><div class="v ${tot.overrun > 0 ? 'neg' : ''}">${pct(tot.overrun, { sign: true })}</div><div class="n">${money(tot.forecast - tot.planned, { sign: true })}</div></div></div>
      <div class="cols even">
        <div><h3>רווחיות בשלוש התצוגות</h3>${T([['תצוגה'], ['מכירה ₪', 1], ['רווח ₪', 1], ['%', 1]], [
          ['חוזה בלבד', m0(s.contract.sale), cls(prof(s.contract)), pct(s.contract.sale ? prof(s.contract) / s.contract.sale * 100 : 0)],
          ['+ תוספות מאושרות', m0(s.contract.sale + s.approved.sale), cls(prof(s.contract) + prof(s.approved)), pct((s.contract.sale + s.approved.sale) ? (prof(s.contract) + prof(s.approved)) / (s.contract.sale + s.approved.sale) * 100 : 0)],
          ['+ לא מאושרות (בסיכון)', m0(s.contract.sale + s.approved.sale + s.atRisk.sale), cls(prof(s.contract) + prof(s.approved) + prof(s.atRisk)), (() => { const sl = s.contract.sale + s.approved.sale + s.atRisk.sale; return pct(sl ? (prof(s.contract) + prof(s.approved) + prof(s.atRisk)) / sl * 100 : 0); })()]])}</div>
        <div><h3>החודש</h3>${T([['נושא'], ['₪', 1]], [
          [`חשבונות שהוגשו (${billsMonth.map(r => r.bill.number).join(', ') || 'אין'})`, m0(sum(billsMonth, r => r.curSub))],
          ['תקבולים מהקבלן הראשי (כולל מע"מ)', m0(paidMonth)], ['עלות עבודה מהיומן', m0(labMonth)], ['הוצאות (לפי תאריך מסמך)', m0(expMonth)],
          [`לגבייה כעת${c.overdue.length ? ` · <span class="neg">${c.overdue.length} באיחור</span>` : ''}`, m0(c.outstanding)],
          ['תזרים נטו צפוי ב-3 החודשים הקרובים', cls(sum(pcf.months, m => m.net))]])}</div></div>
      <h3>סעיפים בחריגה (5 הגדולים)</h3>${T([['סעיף'], ['תמחיר ₪', 1], ['צפי ₪', 1], ['חריגה', 1], ['ביצוע / הוצאה', 1]],
        top.map(r => [`<b>${esc(r.item.code || '')}</b> ${esc(r.item.description || '')}`, m0(r.c.planned), m0(r.c.forecast), pct(r.c.overrun, { sign: true }), `${pct(r.c.progress, { d: 0 })} / ${pct(r.c.spentPct, { d: 0 })}`]), null, 'אין סעיפים בחריגה')}
      ${q.length || risk.length ? `<h3>לטיפול</h3><ul class="small">${q.slice(0, 4).map(x => `<li>מכסה: ${esc(x.item.code || '')} ${esc(x.line?.description || x.item.description || '')}: ${esc(x.msgs[0] || '')}</li>`).join('')}${risk.map(g => `<li>תוספת ${esc(g.vo.number)} ${esc(g.vo.title)}: ${VO_STATUS[g.vo.status]}, ${money(g.requested)} בסיכון${g.vo.has_written_order ? '' : ', אין הוראה בכתב'}</li>`).join('')}</ul>` : ''}
    </section>`));
  }
  return el;
}
