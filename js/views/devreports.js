// פרויקט יזם: שמונת הדוחות שבהצעה. כל דוח לפרויקט אחד או לכל פרויקטי היזם, עם הדפסה / PDF ו-Excel.
import { guarVisible } from '../modules.js';
import { h, esc, $, money, pct, num, fmtDate, store } from '../util.js';
import { can, settings, loadTenantData, tenant } from '../app.js';
import { n } from '../calc.js';
import { monthLabel, addMonths, usedRows, groupPeriods, PERIODS } from '../cashflow.js';
import { isDev, devSummary, CONTRACT_KINDS, CONTRACT_STATUS, COMMITTED } from '../dev.js';
import { CO_STAGES, CO_INITIATORS, CBILL_STATUS, CBILL_APPROVED, FLAG_TEXT, dupInvoice, docGate } from '../devflow.js';
import { DCF_ROWS, DCF_IN, DCF_OUT, devCashflow } from '../devcash.js';
import { VENDOR_KINDS, DOC_TYPES, REQUIRED, vendorStatus, findVendor, guaranteeState, expiryState, GUAR_KINDS } from '../docs.js';
import { ALERT_STATUS, defaultDecision, stateMap } from '../alertsui.js';
import { projData } from './common.js';
import { buildActions } from './home.js';
import { T, exportTables, REPORTS, pdfToDrive } from './reports.js';

const todayStr = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
const m0 = v => money(v, { sym: false });
const neg = v => `<span class="${v < -0.5 ? 'neg' : ''}">${m0(v)}</span>`;
const over = v => `<span class="${v > 0.05 ? 'neg' : ''}">${pct(v, { sign: true })}</span>`;
const opt = () => ({ pid: '', h: 6, items: false, handled: false, ...(store('subcon-drep') || {}) });
const setOpt = o => store('subcon-drep', { ...opt(), ...o });
const sum = (xs, f) => xs.reduce((a, x) => a + n(f(x)), 0);
const label = it => `${it.code || ''} ${it.description || ''}`.trim();

export const DEV_REPORTS = [
  ['d-budget', 'בקרה תקציבית'],
  ['d-cash', 'הכנסות מול הוצאות'],
  ['d-cos', 'יומן הוראות שינוי'],
  ['d-cbills', 'בדיקת חשבונות קבלנים'],
  ['d-vendors', 'מצב קבלנים וספקים'],
  ['d-docs', 'מסמכי קבלנים'],
  ['d-group', 'ריכוז פרויקטי הקבוצה'],
  ['d-alerts', 'התרעות חריגה']
];
const NOTE = {
  'd-budget': 'תקציב מול בסיס נעול, התקשרויות, הוראות שינוי, חשבונות ותשלומים וצפי סופי, לפי פרק או סעיף. סכומים לפני מע"מ.',
  'd-cash': 'הכנסות מול הוצאות ל-3, 6 ו-12 החודשים הקרובים, וטבלה חודשית. כולל מע"מ.',
  'd-cos': 'כל הוראות השינוי: יוזם, סיבה, סכום, השפעה על הלו"ז, אישור בכתב, באיזה חשבון נכללה וכמה שולם. סכומים לפני מע"מ.',
  'd-cbills': 'כל חשבונות הקבלנים: מוגש מול מאושר, קיצוצים, עיכבון, קיזוז מקדמה, ממצאי הבדיקה וסטטוס. סכומים לפני מע"מ, חוץ מעמודת "לתשלום".',
  'd-vendors': 'לכל התקשרות: סכום כולל שינויים, חויב, שולם, יתרה, עיכבון שנצבר, מקדמה וערבויות. סכומים לפני מע"מ.',
  'd-docs': 'מסמכי חובה לכל קבלן, ספק ויועץ שיש לו התקשרות: ביטוח, רישיון, ניהול ספרים, ניכוי מס, וחשבוניות כחוק שחסרות.',
  'd-group': 'כל פרויקטי היזם של הקבוצה בשורה אחת לכל פרויקט: עלויות, הכנסות, תזרים והתרעות פתוחות.',
  'd-alerts': 'כל ההתרעות עם ההחלטה הנדרשת והמצב (פתוח, בטיפול, טופל).'
};

/** דוחות לפי סוג הפרויקטים אצל הלקוח: קבלן משנה, יזם, או שניהם */
export function reportNav(data, kind) {
  const hasSub = data.projects.some(p => !isDev(p)), hasDev = data.projects.some(isDev);
  const sub = hasSub ? REPORTS.filter(r => r[2]()) : [], dev = hasDev && can.prices() ? DEV_REPORTS : [];
  const a = ([k, l]) => `<a href="#/reports/${k}" class="${k === kind ? 'on' : ''}">${l}</a>`;
  return `<nav class="tabs">${sub.map(a).join('')}${sub.length && dev.length ? '<span class="tsep" aria-hidden="true">·</span>' : ''}${dev.map(a).join('')}</nav>`;
}

export async function viewDevReports(kind) {
  if (!can.prices()) return h('<div class="card empty">אין הרשאה</div>');
  if (!DEV_REPORTS.some(r => r[0] === kind)) kind = DEV_REPORTS[0][0];
  const data = await loadTenantData();
  const devs = data.projects.filter(isDev);
  const o = opt();
  if (o.pid && !devs.some(p => p.id === o.pid)) o.pid = '';
  const projects = o.pid ? devs.filter(p => p.id === o.pid) : devs.filter(p => p.status !== 'closed');
  const vat = settings().vat_pct;
  const sums = projects.map(p => { const pd = projData(data, p.id); return { p, pd, s: devSummary({ project: p, items: pd.items, contracts: pd.contracts, cLines: pd.cLines, expenses: pd.expenses, cos: pd.cos, signoffs: pd.signoffs, fixedCosts: pd.fixedCosts, coLines: pd.coLines, cbills: pd.cbills, cbLines: pd.cbLines, vatPct: vat }) }; });
  const title = DEV_REPORTS.find(r => r[0] === kind)[1];
  const scope = o.pid ? projects[0]?.name : 'כל פרויקטי היזם הפעילים';
  const el = h(`<div><div class="top no-print"><div><h1>דוחות</h1><div class="sub">פרויקטי יזם · כל דוח לפרויקט אחד או לכולם · הדפסה / PDF ו-Excel</div></div></div>
    ${reportNav(data, kind)}
    <div class="actions no-print" style="margin-bottom:12px;flex-wrap:wrap;gap:8px">
      <select id="pid" aria-label="פרויקט"><option value="">כל פרויקטי היזם הפעילים</option>${devs.map(p => `<option value="${p.id}" ${p.id === o.pid ? 'selected' : ''}>${esc(p.name)}${p.status === 'closed' ? ' (סגור)' : ''}</option>`).join('')}</select>
      ${kind === 'd-budget' ? `<label class="chk small"><input type="checkbox" id="items" ${o.items ? 'checked' : ''}> פירוט לפי סעיף</label>` : ''}
      ${kind === 'd-cash' ? `<label class="small mut">טבלה חודשית ל-<select id="hz">${[3, 6, 12, 24].map(k => `<option value="${k}" ${+o.h === k ? 'selected' : ''}>${k} חודשים</option>`).join('')}</select></label>
        <label class="small mut">תצוגה לפי <select id="per">${Object.entries(PERIODS).map(([k, l]) => `<option value="${k}" ${(o.per || 'month') === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>` : ''}
      ${kind === 'd-alerts' ? `<label class="chk small"><input type="checkbox" id="handled" ${o.handled ? 'checked' : ''}> כולל מה שטופל</label>` : ''}
      <button class="btn ghost small" id="print">הדפסה / PDF</button><button class="btn ghost small" id="xl">ייצוא לאקסל</button><button class="btn ghost small" id="gdrive" title="שומר את הדוח כ-PDF בתיקיית הדוחות של הפרויקט בדרייב">שמירה לדרייב</button></div>
    <div id="rep"></div></div>`);
  const rerender = () => viewDevReports(kind).then(v => el.replaceWith(v));
  $('#pid', el).onchange = e => { setOpt({ pid: e.target.value }); rerender(); };
  $('#items', el)?.addEventListener('change', e => { setOpt({ items: e.target.checked }); rerender(); });
  $('#handled', el)?.addEventListener('change', e => { setOpt({ handled: e.target.checked }); rerender(); });
  $('#hz', el)?.addEventListener('change', e => { setOpt({ h: +e.target.value }); rerender(); });
  $('#per', el)?.addEventListener('change', e => { setOpt({ per: e.target.value }); rerender(); });
  const fn = { 'd-budget': repBudget, 'd-cash': repCash, 'd-cos': repCos, 'd-cbills': repCbills, 'd-vendors': repVendors, 'd-docs': repDocs, 'd-group': repGroup, 'd-alerts': repAlerts }[kind];
  const body = projects.length ? fn({ data, sums, o, multi: projects.length > 1 }) : h('<div class="card empty">אין פרויקטי יזם פעילים</div>');
  $('#rep', el).append(h(`<div class="rephead"><img src="icons/icon-192.png" alt=""><div><b>${esc(title)}</b><span>${esc(tenant()?.name || '')} · ${esc(scope || '')} · הופק ${fmtDate(todayStr())}</span></div></div>`), h(`<p class="small mut repnote">${NOTE[kind]}</p>`), body);
  $('#print', el).onclick = () => window.print();
  $('#xl', el).onclick = () => exportTables($('#rep', el), `${title} - ${scope}`);
  $('#gdrive', el).onclick = () => pdfToDrive($('#rep', el), title, o.pid ? devs.find(p => p.id === o.pid) : null);
  return el;
}

// ===== 1. בקרה תקציבית: לפי פרויקט ופרק (או סעיף) =====
function repBudget({ sums, o }) {
  const wrap = h('<div></div>');
  const cols = [[o.items ? 'פרק / סעיף' : 'פרק'], ['תקציב', 1], ['בסיס נעול', 1], ['התקשרויות', 1], ['מתוכן שינויים מאושרים', 1], ['שינויים בתהליך', 1], ['חויב', 1], ['שולם', 1], ['צפי לסיום', 1], ['סטייה מהתקציב', 1], ['סטייה מהבסיס', 1]];
  for (const { p, s } of sums) {
    const rows = [];
    for (const c of s.chapters) {
      const co = sum(c.rows, r => r.co), coP = sum(c.rows, r => r.coPending);
      rows.push({ cls: o.items ? 'grp' : '', cells: [`<b>${esc(c.name)}</b>`, m0(c.budget), c.base ? m0(c.base) : '', m0(c.committed), co ? m0(co) : '', coP ? m0(coP) : '', m0(c.invoiced), m0(c.paid), `<b>${m0(c.forecast)}</b>`, over(c.dev), c.devBase != null ? over(c.devBase) : ''] });
      if (o.items) for (const r of c.rows) rows.push([`<span style="padding-inline-start:14px;display:inline-block">${esc(label(r.item))}${r.estimate ? ' <span class="small mut">(הערכה)</span>' : ''}${r.newItem ? ' <span class="chip">חדש</span>' : ''}</span>`,
        m0(r.budget), r.base != null ? m0(r.base) : '', m0(r.committed), r.co ? m0(r.co) : '', r.coPending ? m0(r.coPending) : '', m0(r.invoiced), m0(r.paid), m0(r.forecast), over(r.dev), r.devBase != null ? over(r.devBase) : '']);
    }
    if (s.total.outside) rows.push([`התקשרויות ושינויים בלי סעיף תקציב (${s.outside.length})`, '', '', m0(s.total.outside), '', '', '', '', m0(s.total.outside), '', '']);
    if (s.total.unalloc) rows.push(['הוצאות בלי סעיף', '', '', '', '', '', m0(s.total.unalloc), '', '', '', '']);
    const t = s.total;
    wrap.appendChild(h(`<div class="card" data-sheet="${esc(p.name)}"><h2>${esc(p.name)}</h2>
      <div class="small mut" style="margin:-6px 0 8px">${s.hasBaseline ? `בסיס ננעל ${fmtDate(s.baselineAt)}` : 'התקציב עוד לא ננעל כבסיס'} · התקשרויות ${pct(t.budget ? (t.committed + t.outside) / t.budget * 100 : 0)} מהתקציב · שולם ${m0(t.paid)}</div>
      ${T(cols, rows, ['סה"כ', m0(t.budget), t.baseTotal ? m0(t.baseTotal) : '', m0(t.committed + t.outside), m0(t.coApproved), m0(t.coPending), m0(t.invoiced), m0(t.paid), `<b>${m0(t.forecast)}</b>`, over(t.dev), t.devBase != null ? over(t.devBase) : ''])}</div>`));
  }
  return wrap;
}

// ===== 2. הכנסות מול הוצאות: 3/6/12 חודשים =====
function repCash({ data, sums, o }) {
  const cf = devCashflow(sums.map(({ p, s, pd }) => ({ project: p, s, pd })), { settings: settings(), today: todayStr(), back: 3, ahead: Math.max(12, +o.h || 0) });
  const fut = cf.months.filter(m => !m.past);
  const win = k => { const ms = fut.slice(0, k); const inT = sum(ms, m => m.inTotal), outT = sum(ms, m => m.outTotal); const low = ms.reduce((a, m) => (m.cum < a.cum ? m : a), ms[0]);
    return [`${k} חודשים (עד ${monthLabel(ms[ms.length - 1].m)})`, m0(inT), m0(outT), neg(inT - outT), neg(ms[ms.length - 1].cum), `${neg(low.cum)} <span class="small mut">${monthLabel(low.m)}</span>`, ms.filter(m => m.below).length || '', ms.filter(m => m.outOverIn).length || '']; };
  const head = T([['תקופה'], ['הכנסות', 1], ['הוצאות', 1], ['נטו', 1], ['יתרה בסוף', 1], ['יתרה נמוכה', 1], ['חודשים מתחת למינימום', 1], ['חודשים שבהם הוצאות > הכנסות', 1]], [3, 6, 12].map(win));
  const per = PERIODS[o.per] ? o.per : 'month';
  const view = groupPeriods(cf.months.filter(m => m.past || m.m <= addMonths(cf.cur, +o.h - 1)), per, cf.cur);
  const row = (k) => [DCF_ROWS[k], ...view.map(m => m.rows[k] ? m0(m.rows[k]) : '')];
  const monthly = T([['₪ כולל מע"מ'], ...view.map(m => [m.label + (m.past ? ' (בפועל)' : ''), 1])], [
    { cls: 'grp', cells: ['<b>הכנסות</b>', ...view.map(() => '')] }, ...usedRows(DCF_IN, view).map(row), { cls: 'tot', cells: ['סה"כ הכנסות', ...view.map(m => m0(m.inTotal))] },
    { cls: 'grp', cells: ['<b>הוצאות</b>', ...view.map(() => '')] }, ...usedRows(DCF_OUT, view).filter(k => k !== 'out_delay').map(row), { cls: 'tot', cells: ['סה"כ הוצאות', ...view.map(m => m0(m.outTotal))] },
    { cls: 'tot', cells: [`נטו ב${PERIODS[per]}`, ...view.map(m => neg(m.net))] }, { cls: 'tot', cells: ['יתרה מצטברת', ...view.map(m => `<span class="${m.below ? 'neg' : ''}">${m0(m.cum)}</span>`)] }]);
  const st = cf.settings;
  return h(`<div><div class="card" data-sheet="סיכום 3-6-12"><h2>סיכום</h2>
    <div class="small mut" style="margin:-6px 0 8px">יתרת פתיחה ${m0(cf.opening)} ₪ · מינימום ${m0(st.cash_min)} ₪ · התקבל עד היום ${m0(cf.incomeReceived)} ₪ מתוך ${m0(cf.incomeTotal)} ₪ · צפי עלות כולל מע"מ ${m0(cf.costTotal)} ₪${cf.overdueIncome.length ? ` · <span class="neg">${cf.overdueIncome.length} תקבולים באיחור</span>` : ''}</div>${head}</div>
    <div class="card" data-sheet="${{ week: 'שבועי', month: 'חודשי', quarter: 'רבעוני', year: 'שנתי' }[per]}"><h2>לפי ${PERIODS[per]}</h2>${per === 'week' ? '<p class="small mut">הצפי נבנה לפי חודשים. בתצוגה שבועית הסכום החודשי מתחלק לפי ימים.</p>' : ''}${monthly}</div></div>`);
}

// ===== 3. יומן הוראות שינוי =====
function repCos({ sums, multi }) {
  const rows = [];
  let tReq = 0, tApp = 0, tBilled = 0, tPaid = 0;
  for (const { p, s, pd } of sums) {
    const cById = Object.fromEntries((pd.contracts || []).map(c => [c.id, c])), iById = Object.fromEntries(pd.items.map(i => [i.id, i]));
    for (const x of [...s.flow.cos].sort((a, b) => String(a.co.number || '').localeCompare(String(b.co.number || ''), 'he', { numeric: true }))) {
      const co = x.co, c = cById[co.contract_id], it = iById[co.boq_item_id];
      const rej = x.stage === 'rejected';
      if (!rej) { tReq += x.requested; if (x.isApproved) tApp += x.approved; tBilled += x.billing.billedAmt; tPaid += x.billing.paidAmt; }
      rows.push({ cls: rej ? 'dim' : (x.stage === 'executed' && !x.isApproved ? 'al-r' : ''), cells: [...(multi ? [esc(p.name)] : []),
        `<b>${esc(co.number || '')}</b>`, `${esc(co.title)}${co.reason ? `<div class="small mut">${esc(co.reason)}</div>` : ''}`, esc(c?.vendor_name || co.vendor_name || ''),
        `${CO_INITIATORS[co.initiator] || ''}${co.initiator_name ? `<div class="small mut">${esc(co.initiator_name)}</div>` : ''}`, it ? esc(label(it)) : '<span class="mut">בלי סעיף</span>',
        co.schedule_days ? num(co.schedule_days) : '', m0(x.requested), x.isApproved ? m0(x.approved) : '', x.gapSale != null ? neg(x.gapSale) : '',
        `${CO_STAGES[x.stage]}${x.analysis ? '<div class="small neg">נדרש ניתוח מחיר</div>' : ''}`,
        co.approved_date ? `${fmtDate(co.approved_date)}${co.approved_by ? `<div class="small mut">${esc(co.approved_by)}${co.approval_ref ? ' · ' + esc(co.approval_ref) : ''}</div>` : ''}` : (x.stage === 'executed' ? '<span class="neg">בוצע בלי אישור</span>' : ''),
        x.billing.firstBill ? `חשבון ${x.billing.firstBill.number}` : '', x.billing.billedAmt ? m0(x.billing.billedAmt) : '', x.billing.paidAmt ? m0(x.billing.paidAmt) : ''] });
    }
  }
  const cols = [...(multi ? [['פרויקט']] : []), ['מס\''], ['נושא וסיבה'], ['קבלן'], ['יוזם'], ['סעיף'], ['ימי לו"ז', 1], ['מבוקש', 1], ['מאושר', 1], ['פער ממחיר המכירה', 1], ['שלב'], ['אישור בכתב'], ['נכלל בחשבון'], ['חויב', 1], ['שולם', 1]];
  const pad = multi ? [''] : [];
  return h(`<div class="card" data-sheet="יומן הוראות שינוי">${T(cols, rows, ['סה"כ (בלי נדחו)', ...pad, '', '', '', '', '', m0(tReq), m0(tApp), '', '', '', '', m0(tBilled), m0(tPaid)].slice(0, cols.length), 'אין הוראות שינוי')}
    <p class="small mut">"פער ממחיר המכירה": מה שמכרת פחות מה שאושר לקבלן, רק בשורות שיש להן מחיר בכתב הכמויות. שורה אדומה: בוצע בלי אישור בכתב.</p></div>`);
}

// ===== 4. בדיקת חשבונות קבלנים =====
function vendorOf(data, c) { return (data.vendors || []).find(v => v.id === c.vendor_id) || findVendor(data.vendors || [], c.vendor_name); }
function repCbills({ data, sums, multi }) {
  const rows = [], today = todayStr();
  const tot = { claimed: 0, gross: 0, cut: 0, ret: 0, adv: 0, net: 0, total: 0 };
  for (const { p, s, pd } of sums) {
    for (const R of [...s.flow.results].sort((a, b) => String(b.bill.received_date || '').localeCompare(String(a.bill.received_date || '')))) {
      const b = R.bill, c = R.contract;
      const flags = R.flags.map(f => FLAG_TEXT[f.type]);
      const dup = dupInvoice(b, c, pd.cbills || [], pd.contracts || [], pd.expenses || []); if (dup) flags.push(FLAG_TEXT.dup_invoice);
      const v = vendorOf(data, c), gate = docGate(b, v ? vendorStatus(v, data.documents || [], today) : null);
      const gateTxt = gate.map(g => g.type === 'legal_invoice' ? 'חשבונית כחוק' : (g.expired ? 'פג: ' : 'חסר: ') + (DOC_TYPES[g.doc] || g.doc));
      for (const k of Object.keys(tot)) tot[k] += n({ claimed: R.claimed, gross: R.gross, cut: R.cut, ret: R.retention, adv: R.advance, net: R.net, total: R.total }[k]);
      rows.push({ cls: flags.length ? 'al-y' : '', cells: [...(multi ? [esc(p.name)] : []),
        `<a href="#/project/${p.id}/cbill/${b.id}">${esc(c.vendor_name || '')}</a><div class="small mut">${esc(c.title)}</div>`, `<b>${b.number}</b>`, fmtDate(b.received_date),
        m0(R.claimed), m0(R.gross), R.cut > 0.5 ? `<span class="neg">${m0(R.cut)}</span>` : '', R.retention ? m0(R.retention) : '', R.advance ? m0(R.advance) : '', m0(R.net), `<b>${m0(R.total)}</b>`,
        flags.length ? `<span class="neg">${flags.map(x => `<span class="nw">${esc(x)}</span>`).join('<br>')}</span>` : '<span class="pos">תקין</span>',
        gateTxt.length ? (b.doc_override ? `<span class="mut">${gateTxt.map(x => `<span class="nw">${esc(x)}</span>`).join(', ')}<br>אושר חריג: ${esc(b.doc_override)}</span>` : `<span class="neg">${gateTxt.map(x => `<span class="nw">${esc(x)}</span>`).join('<br>')}</span>`) : '✓',
        `<span class="nw">${CBILL_STATUS[b.status]}</span>${b.paid_date ? `<div class="small mut">${fmtDate(b.paid_date)}</div>` : b.approved_date ? `<div class="small mut">${fmtDate(b.approved_date)}</div>` : ''}`] });
    }
  }
  const cols = [...(multi ? [['פרויקט']] : []), ['קבלן / התקשרות'], ['חשבון'], ['התקבל'], ['הוגש', 1], ['מאושר ברוטו', 1], ['קוצץ', 1], ['עיכבון', 1], ['קיזוז מקדמה', 1], ['נטו', 1], ['לתשלום כולל מע"מ', 1], ['ממצאי בדיקה'], ['מסמכים'], ['סטטוס']];
  return h(`<div class="card" data-sheet="בדיקת חשבונות">${T(cols, rows, ['סה"כ', ...(multi ? [''] : []), '', '', m0(tot.claimed), m0(tot.gross), m0(tot.cut), m0(tot.ret), m0(tot.adv), m0(tot.net), m0(tot.total), '', '', ''], 'אין חשבונות קבלנים')}
    <p class="small mut">לכל חשבון יש דף "בדיקה והמלצה לתשלום" להדפסה: לוחצים על שם הקבלן ואז על הכפתור בראש החשבון. "הוגש" הוא מה שהקבלן ביקש בחשבון הזה; "מאושר ברוטו" לפי מחירי החוזה והכמות שנבדקה.</p></div>`);
}

// ===== 5. מצב קבלנים וספקים =====
function repVendors({ data, sums, multi }) {
  const today = todayStr(), rows = [];
  const T0 = { amount: 0, inv: 0, paid: 0, bal: 0, ret: 0, gu: 0 };
  for (const { p, s } of sums) {
    for (const c of s.contracts.filter(c => c.contract.status !== 'cancelled').sort((a, b) => b.amount - a.amount)) {
      const C = c.contract, R = s.flow.byContract[C.id]?.bills || [];
      const lastApp = [...R].reverse().find(x => CBILL_APPROVED.includes(x.bill.status));
      const ret = lastApp?.retentionCum || 0, adv = lastApp?.advanceCum || 0;
      const gs = (data.guarantees || []).filter(guarVisible(data)).filter(g => g.status !== 'returned' && (g.contract_id === C.id || (!g.contract_id && g.vendor_id && g.vendor_id === C.vendor_id && g.project_id === p.id)));
      const gsum = sum(gs, g => g.amount), bad = gs.filter(g => ['expired', 'soon'].includes(guaranteeState(g, today)));
      const bal = c.amount - c.paid;
      if (COMMITTED.includes(C.status)) { T0.amount += c.amount; T0.inv += c.invoiced; T0.paid += c.paid; T0.bal += bal; T0.ret += ret; T0.gu += gsum; }
      rows.push({ cls: c.over ? 'al-r' : C.status === 'draft' ? 'dim' : '', cells: [...(multi ? [esc(p.name)] : []),
        `<b>${esc(C.vendor_name || '')}</b><div class="small mut">${esc(C.title)}${C.number ? ' · ' + esc(C.number) : ''}</div>`, `${CONTRACT_KINDS[C.kind] || ''}<div class="small mut">${CONTRACT_STATUS[C.status]}</div>`,
        m0(c.base), c.coAmt ? m0(c.coAmt) : '', `<b>${m0(c.amount)}</b>`, m0(c.invoiced), m0(c.paid), neg(bal), pct(c.amount ? c.paid / c.amount * 100 : 0),
        ret ? m0(ret) : '', n(C.advance_amount) ? `${m0(adv)} <span class="small mut">מתוך ${m0(C.advance_amount)}</span>` : '',
        gs.length ? `${gs.map(g => `${GUAR_KINDS[g.kind]} ${m0(g.amount)} <span class="small ${bad.includes(g) ? 'neg' : 'mut'}">עד ${fmtDate(g.expiry)}</span>`).join('<br>')}` : '<span class="mut">אין</span>'] });
    }
  }
  const cols = [...(multi ? [['פרויקט']] : []), ['קבלן / ספק'], ['סוג'], ['חוזה', 1], ['שינויים מאושרים', 1], ['סה"כ התקשרות', 1], ['חויב', 1], ['שולם', 1], ['יתרה לתשלום', 1], ['% שולם', 1], ['עיכבון שנצבר', 1], ['מקדמה: קוזז / ניתן', 1], ['ערבויות בתוקף']];
  return h(`<div class="card" data-sheet="מצב קבלנים וספקים">${T(cols, rows, ['סה"כ (חתומות)', ...(multi ? [''] : []), '', '', '', m0(T0.amount), m0(T0.inv), m0(T0.paid), m0(T0.bal), pct(T0.amount ? T0.paid / T0.amount * 100 : 0), m0(T0.ret), '', m0(T0.gu)], 'אין התקשרויות')}
    <p class="small mut">שורה אדומה: חויב יותר מסכום ההתקשרות. "עיכבון שנצבר" לפי החשבון האחרון שאושר. ערבות שפג תוקפה או יפוג ב-30 יום מסומנת באדום.</p></div>`);
}

// ===== 6. מסמכי קבלנים =====
function repDocs({ data, sums }) {
  const today = todayStr(), ids = new Set(sums.map(x => x.p.id));
  const contracts = (data.contracts || []).filter(c => ids.has(c.project_id) && c.status !== 'cancelled');
  const byVendor = new Map();
  for (const c of contracts) { const v = vendorOf(data, c); const k = v?.id || 'n:' + (c.vendor_name || '').trim(); if (!byVendor.has(k)) byVendor.set(k, { v, name: v?.name || c.vendor_name || '', cs: [] }); byVendor.get(k).cs.push(c); }
  const types = Object.keys(DOC_TYPES).filter(t => t !== 'other' && t !== 'safety');
  const cell = (st, t, req) => {
    const d = st?.byType[t];
    if (!d) return req ? '<span class="neg">חסר</span>' : '<span class="mut">לא נדרש</span>';
    const e = expiryState(d.expiry, today);
    return e === 'expired' ? `<span class="neg">פג ${fmtDate(d.expiry)}</span>` : e === 'soon' ? `<span class="warn">עד ${fmtDate(d.expiry)}</span>` : `✓ ${d.expiry ? fmtDate(d.expiry) : ''}`;
  };
  let bad = 0;
  const rows = [...byVendor.values()].sort((a, b) => a.name.localeCompare(b.name, 'he')).map(({ v, name, cs }) => {
    const st = v ? vendorStatus(v, data.documents || [], today) : null, req = v ? REQUIRED[v.kind] || [] : types;
    const bills = (data.cbills || []).filter(b => cs.some(c => c.id === b.contract_id));
    const noLegal = bills.filter(b => !b.invoice_legal && ['recommended', 'approved', 'paid'].includes(b.status));
    const ok = st ? st.ok : false; if (!ok || noLegal.length) bad++;
    return { cls: !ok ? 'al-r' : st.soon.length ? 'al-y' : '', cells: [`<b>${esc(name)}</b>${v ? '' : '<div class="small neg">לא רשום בספקים</div>'}`, v ? VENDOR_KINDS[v.kind] || '' : '',
      [...new Set(cs.map(c => sums.find(x => x.p.id === c.project_id)?.p.name))].map(esc).join('<br>'),
      ...types.map(t => cell(st, t, req.includes(t))), noLegal.length ? `<span class="neg">${noLegal.map(b => 'חשבון ' + b.number).join(', ')}</span>` : '✓',
      ok ? (st.soon.length ? '<span class="warn">מסמך יפוג בקרוב</span>' : '<span class="pos">מלא</span>') : `<span class="neg">חסר ${st ? st.missing.length + st.expired.length : ''}</span>`] };
  });
  return h(`<div class="card" data-sheet="מסמכי קבלנים"><div class="small mut" style="margin:-4px 0 8px">${rows.length} גורמים עם התקשרות · ${bad} עם מסמך חסר, שפג או חשבונית כחוק חסרה</div>
    ${T([['קבלן / ספק'], ['סוג'], ['פרויקטים'], ...types.map(t => [DOC_TYPES[t]]), ['חשבונית כחוק חסרה'], ['מצב']], rows, null, 'אין התקשרויות')}
    <p class="small mut">מסמכי החובה לפי סוג הגורם (קבלן: ביטוח, רישיון, ניהול ספרים, ניכוי מס). את המסמכים מעלים במסך "ספקים, מסמכים וערבויות". אישור חשבון כשחסר מסמך מחייב סיבה, והיא מופיעה בדוח בדיקת החשבונות.</p></div>`);
}

// ===== 7. ריכוז פרויקטי הקבוצה =====
function repGroup({ data, sums }) {
  const actions = buildActions(data, [], sums.map(({ p, s }) => ({ p, s })));
  const stm = stateMap(data.alertStates);
  const rows = sums.map(({ p, s, pd }) => {
    const cf = devCashflow([{ project: p, s, pd }], { settings: { ...settings(), cash_opening: 0 }, today: todayStr(), back: 0, ahead: 12 });
    const inc = pd.income || [], rec = sum(inc.filter(i => i.status === 'received'), i => i.received_amount ?? i.amount), exp = sum(inc.filter(i => i.status !== 'received'), i => i.amount);
    const open = actions.filter(a => a.pid === p.id && stm.get(a.key)?.status !== 'handled');
    const t = s.total;
    return { p, t, rec, exp, net12: sum(cf.months, m => m.net), open: open.length, crit: open.filter(a => a.sev === 'red').length,
      cells: [`<b>${esc(p.name)}</b>`, m0(t.budget), t.baseTotal ? m0(t.baseTotal) : '', m0(t.committed + t.outside), m0(t.coApproved), m0(t.forecast), over(t.dev), m0(t.paid), m0(rec), m0(exp), neg(sum(cf.months, m => m.net)), `${open.length}${open.filter(a => a.sev === 'red').length ? ` <span class="neg">(${open.filter(a => a.sev === 'red').length} אדומות)</span>` : ''}`] };
  });
  const S2 = f => sum(rows, f);
  const tb = S2(r => r.t.budget), tf = S2(r => r.t.forecast);
  const cfAll = devCashflow(sums.map(({ p, s, pd }) => ({ project: p, s, pd })), { settings: settings(), today: todayStr(), back: 0, ahead: 12 });
  return h(`<div><div class="kpis">
      <div class="kpi"><div class="l">תקציב</div><div class="v">${money(tb)}</div><div class="n">${sums.length} פרויקטים</div></div>
      <div class="kpi"><div class="l">צפי עלות לסיום</div><div class="v">${money(tf)}</div><div class="n">${pct(tb ? (tf - tb) / tb * 100 : 0, { sign: true })} מהתקציב</div></div>
      <div class="kpi"><div class="l">הכנסות שהתקבלו</div><div class="v">${money(S2(r => r.rec))}</div><div class="n">צפויות עוד ${money(S2(r => r.exp))}</div></div>
      <div class="kpi"><div class="l">יתרה נמוכה ב-12 חודשים</div><div class="v ${cfAll.lowest?.below ? 'neg' : ''}">${money(cfAll.lowest?.cum || 0)}</div><div class="n">${cfAll.lowest ? monthLabel(cfAll.lowest.m) : ''} · כולל מע"מ</div></div></div>
    <div class="card" data-sheet="ריכוז פרויקטים">${T([['פרויקט'], ['תקציב', 1], ['בסיס נעול', 1], ['התקשרויות', 1], ['שינויים מאושרים', 1], ['צפי לסיום', 1], ['סטייה מהתקציב', 1], ['שולם', 1], ['הכנסות שהתקבלו', 1], ['הכנסות צפויות', 1], ['נטו 12 חודשים (כולל מע"מ)', 1], ['התרעות פתוחות', 1]], rows,
      ['סה"כ', m0(tb), '', m0(S2(r => r.t.committed + r.t.outside)), m0(S2(r => r.t.coApproved)), m0(tf), over(tb ? (tf - tb) / tb * 100 : 0), m0(S2(r => r.t.paid)), m0(S2(r => r.rec)), m0(S2(r => r.exp)), neg(S2(r => r.net12)), S2(r => r.open)])}
    <p class="small mut">עלויות לפני מע"מ. הכנסות ותזרים כולל מע"מ. "נטו 12 חודשים" הוא הכנסות פחות הוצאות בפרויקט ב-12 החודשים הקרובים, בלי יתרת הפתיחה.</p></div></div>`);
}

// ===== 8. התרעות חריגה, עם החלטה נדרשת ומצב =====
function repAlerts({ data, sums, o, multi }) {
  const stm = stateMap(data.alertStates);
  const list = buildActions(data, [], sums.map(({ p, s }) => ({ p, s }))).map(a => ({ a, st: stm.get(a.key) })).filter(x => o.handled || x.st?.status !== 'handled')
    .sort((x, y) => (y.a.sev === 'red') - (x.a.sev === 'red') || y.a.w - x.a.w);
  const rows = list.map(({ a, st }) => ({ cls: st?.status === 'handled' ? 'dim' : a.sev === 'red' ? 'al-r' : '', cells: [
    a.sev === 'red' ? '<span class="neg">גבוהה</span>' : 'בינונית', `<b>${esc(a.title)}</b><div class="small mut">${esc(a.sub || '')}</div>`, a.amt || '',
    esc(defaultDecision({ ...a, decision: st?.decision })), `${ALERT_STATUS[st?.status || 'open']}${st?.note ? `<div class="small mut">${esc(st.note)}</div>` : ''}`, st?.updated_at ? fmtDate(st.updated_at) : ''] }));
  const red = list.filter(x => x.a.sev === 'red').length;
  return h(`<div class="card" data-sheet="התרעות חריגה"><div class="small mut" style="margin:-4px 0 8px">${list.length} התרעות${o.handled ? '' : ' פתוחות ובטיפול'} · ${red} בחומרה גבוהה</div>
    ${T([['חומרה'], ['נושא'], ['סכום', 1], ['החלטה נדרשת'], ['מצב'], ['עודכן']], rows, null, 'אין התרעות פתוחות')}
    <p class="small mut">ההחלטה הנדרשת והמצב נקבעים בדף "מה דורש טיפול" (כפתור ✎). משם גם שולחים כל התרעה בוואטסאפ או במייל.</p></div>`);
}

/** הדוחות של פרויקט יזם אחד, לשמירה בדרייב */
export function devReportNodes(data, pid) {
  if (!can.prices()) return [];
  const p = data.projects.find(x => x.id === pid); if (!p) return [];
  const pd = projData(data, pid), vat = settings().vat_pct;
  const sums = [{ p, pd, s: devSummary({ project: p, items: pd.items, contracts: pd.contracts, cLines: pd.cLines, expenses: pd.expenses, cos: pd.cos, signoffs: pd.signoffs, fixedCosts: pd.fixedCosts, coLines: pd.coLines, cbills: pd.cbills, cbLines: pd.cbLines, vatPct: vat }) }];
  const o = { pid, h: 12, items: true, handled: false };
  const fns = { 'd-budget': repBudget, 'd-cash': repCash, 'd-cos': repCos, 'd-cbills': repCbills, 'd-vendors': repVendors, 'd-docs': repDocs, 'd-group': repGroup, 'd-alerts': repAlerts };
  return DEV_REPORTS.filter(([k]) => k !== 'd-group').map(([kind, title]) => { try { return { kind, title, node: fns[kind]({ data, sums, o, multi: false }) }; } catch (e) { console.warn('report', kind, e); return null; } }).filter(Boolean);
}
