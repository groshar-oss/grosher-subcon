// מסך פרויקט: לשוניות בקרה, כתב כמויות, תמחיר, הוראות שינוי, הוצאות, יומן שינויים והגדרות
import { h, esc, $, $$, modal, field, toast, money, pct, num, area, fmtDate, confirmBox } from '../util.js';
import { db } from '../db.js';
import { S, can, loadTenantData, modeSwitch, render, logChange, settings, projectTabs, TAB_VIS } from '../app.js';
import { n, COST_KINDS, VO_STATUS, PROFIT_MODES, itemPlanned, lineCost, EXPENSE_KINDS } from '../calc.js';
import { STATUS, CONTRACT, projData, summarize, rowAttr, legend, modeLine } from './common.js';
import { projectForm, projectRow, wireModules, wireProjectType } from './projects.js';
import { mods, MODULES } from '../modules.js';
import { tenantOH } from '../tenantoh.js';
import { tradeOf, projectTrades } from '../trades.js';
import { store } from '../util.js';
import { tabBoq, tabCosting } from './boq.js';
import { tabVo, tabExpenses } from './vo_exp.js';
import { dayView, tabWorkLog, fieldProject } from './worklog.js';
import { tabQuota, quotaCounts } from './quotas.js';
import { tabPurchase } from './purchase.js';
import { tabBills, billView } from './bills.js';
import { tabCashflow } from './cashflow.js';
import { viewInbox } from './inbox.js';
import { projectSteps, stepsCard } from '../guide.js';
import { isDev, PROJECT_TYPES, party } from '../dev.js';
import { devControl, devContracts } from './dev.js';
import { devCos, devCbills, cbillView, cbillSheet } from './devflow.js';
import { devCashTab } from './devcash.js';
import { saveProjectContacts } from '../contacts.js';
import { saveTemplateDialog } from './templates.js';
import { salesTab, bankTab } from './sales.js';


// ראש דף הפרויקט: שם, החלפת פרויקט, כל הפרויקטים ופרויקט חדש. הלשוניות מתחת (לא בתפריט הצד)
function projTop(P, sub) {
  const list = P.data.projects.filter(p => p.status !== 'closed' || p.id === P.id);
  return `<div class="top phead"><div><h1>${esc(P.project.name)}</h1><div class="sub">${sub}</div></div>
    <div class="actions"><label class="psw"><span>מעבר לפרויקט</span><select id="psel" aria-label="מעבר לפרויקט אחר">${list.map(p => `<option value="${p.id}" ${p.id === P.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>
      <a class="btn ghost small" href="#/projects">כל הפרויקטים</a>${can.edit() ? '<a class="btn small" href="#/projects/new">+ פרויקט חדש</a>' : ''}</div></div>`;
}
function wirePsel(el, tab) {
  $('#psel', el)?.addEventListener('change', e => { const t = ['day', 'bill', 'cbill', 'cbillpdf'].includes(tab) ? 'control' : tab; location.hash = `#/project/${e.target.value}/${t}`; });
}

export async function viewProject(id, tab, extra) {
  const data = await loadTenantData();
  const project = data.projects.find(p => p.id === id);
  if (!project) return h('<div class="card empty">הפרויקט לא נמצא או שאין לך הרשאה אליו</div>');
  const pd = projData(data, id);
  if (!can.prices()) {
    const P = { data, pd, project, id };
    if (tab === 'day') return dayView(P, extra);
    return fieldProject(P, await db.rpc('field_boq', { p: id }));
  }
  if (isDev(project)) return devProject({ data, pd, project, mcs: data.mcs, id }, tab, extra);
  const P = { data, pd, project, mcs: data.mcs, summary: summarize(pd), id };
  if (tab === 'day') return can.log() ? dayView(P, extra) : h('<div class="card empty">אין הרשאה לרשום ביומן</div>');
  if (tab === 'bill') return billView(P, extra);
  const mc = data.mcs.find(m => m.id === project.main_contractor_id);
  const qc = quotaCounts(P.summary.quotas || []);
  const tabs = projectTabs(project);
  const el = h(`<div>${projTop(P, `${esc(mc?.name || party(project).none)} · ${CONTRACT[project.contract_type]} · שוטף+${project.pay_terms_days} · ${STATUS[project.status]}${project.address ? ' · ' + esc(project.address) : ''}`)}
    <nav class="tabs ptabs">${tabs.map(([k, l]) => `<a href="#/project/${id}/${k}" class="${k === tab ? 'on' : ''}"${TAB_VIS[k] ? ` title="${TAB_VIS[k] === 'pub' ? `גלוי ${party(project).to}` : `פנימי, ${party(project).the} לא רואה`}"` : ''}>${TAB_VIS[k] ? `<i class="vis ${TAB_VIS[k]}" aria-hidden="true"></i>` : ''}${l}${k === 'quota' && qc.over + qc.warn ? ` <span class="badge ${qc.over ? 'red' : 'amber'}">${qc.over + qc.warn}</span>` : ''}</a>`).join('')}</nav>
    <div class="vislegend small mut no-print"><span><i class="vis pub"></i>גלוי ${party(project).to}</span><span><i class="vis int"></i>פנימי, ${party(project).the} לא רואה</span></div><div id="tab"></div></div>`);
  el.dataset.qover = qc.over; el.dataset.qwarn = qc.warn;
  wirePsel(el, tab);
  const body = $('#tab', el);
  const fn = { control: tabControl, boq: tabBoq, costing: tabCosting, quota: tabQuota, vo: tabVo, worklog: tabWorkLog, purchase: tabPurchase, expenses: tabExpenses, bills: tabBills, cashflow: tabCashflow, docs: P => viewInbox(P.id, P), log: tabLog, settings: tabSettings }[tabs.some(t => t[0] === tab) ? tab : 'control'] || tabControl;
  body.appendChild(await fn(P));
  return el;
}

// ===== פרויקט יזם =====
async function devProject(P, tab, extra) {
  if (tab === 'cbillpdf') return cbillSheet(P, extra);
  const tabs = projectTabs(P.project);
  const p = P.project;
  const el = h(`<div>${projTop(P, `${PROJECT_TYPES.dev}${p.owner_name ? ' · ' + esc(p.owner_name) : ''} · ${STATUS[p.status]}${p.address ? ' · ' + esc(p.address) : ''}`)}
    <nav class="tabs ptabs">${tabs.map(([k, l]) => `<a href="#/project/${P.id}/${k}" class="${k === tab || (tab === 'cbill' && k === 'cbills') ? 'on' : ''}">${l}</a>`).join('')}</nav><div id="tab"></div></div>`);
  wirePsel(el, tab);
  if (tab === 'cbill') { $('#tab', el).appendChild(await cbillView(P, extra)); return el; }
  const fn = { control: devControl, boq: P => tabBoq(P, null, { dev: true }), contracts: devContracts, cos: devCos, cbills: devCbills, sales: salesTab, bank: bankTab, cashflow: devCashTab, expenses: tabExpenses, docs: P => viewInbox(P.id, P), log: tabLog, settings: tabSettings }[tabs.some(t => t[0] === tab) ? tab : 'control'] || devControl;
  $('#tab', el).appendChild(await fn(P));
  return el;
}

// ===== בקרה ורווחיות =====
function tabControl(P) {
  const s = P.summary, t = s.total;
  // תקציב מקורי: שיפור (או חריגה) בסגירות מול התמחיר שננעל
  const hasBase = s.hasBase, inView = r => !r.item.variation_id || (r.vo && (S.mode === 'all' ? ['approved', 'partial', 'submitted', 'executed_unapproved'] : S.mode === 'approved' ? ['approved', 'partial'] : []).includes(r.vo.status));
  const closedRows = s.rows.filter(r => r.c.closed && r.c.base != null);
  const closeGain = closedRows.reduce((a, r) => a + r.c.base - r.c.forecast, 0), closedBase = closedRows.reduce((a, r) => a + r.c.base, 0);
  const baseTot = hasBase ? s.contractRows.reduce((a, r) => a + n(r.c.base), 0) : 0;
  // סינון לפי חבילה (ריצוף, גבס...)
  const tkey = 'subcon-trade-' + P.id, trades = projectTrades(P.pd.items);
  let tf = store(tkey) || ''; if (tf && !trades.some(x => x.name === tf)) tf = '';
  const el = h(`<div>${stepsCard(projectSteps(P.pd, { workers: P.data.workers }))}
    <div class="actions" style="margin-bottom:12px" id="mb"><span class="mut small">תצוגת רווחיות:</span></div>
    <div class="kpis">
      <div class="kpi"><div class="l">מכירה</div><div class="v">${money(t.sale)}</div><div class="n">חוזה ${money(s.contract.sale)}${S.mode !== 'contract' ? ` · הוראות שינוי ${money(t.sale - s.contract.sale)}` : ''}</div></div>
      <div class="kpi"><div class="l">תמחיר</div><div class="v">${money(t.planned)}</div><div class="n">רווח מתוכנן ${pct(t.plannedProfitPct)}</div></div>
      <div class="kpi"><div class="l">עלות בפועל</div><div class="v">${money(t.actual)}</div><div class="n">${pct(t.spentPct, { d: 0 })} מהתמחיר · ביצוע ${pct(t.progress, { d: 0 })}</div></div>
      <div class="kpi"><div class="l">צפי עלות לסיום</div><div class="v">${money(t.forecast)}</div><div class="n">${t.overrun < -0.05 ? `<span class="pos">חיסכון ${pct(-t.overrun)} מול התמחיר</span>` : t.overrun > 0.05 ? `<span class="neg">חריגה ${pct(t.overrun)} מעל התמחיר</span>` : 'לפי התמחיר'}</div></div>
      <div class="kpi"><div class="l">רווח צפוי</div><div class="v ${t.profit >= 0 ? 'pos' : 'neg'}">${money(t.profit)}</div><div class="n">${pct(t.profitPct)} מהמכירה</div></div>
      ${hasBase ? `<div class="kpi"><div class="l">שיפור בסגירות מול המקורי</div><div class="v ${closeGain >= 0 ? 'pos' : 'neg'}">${money(closeGain)}</div><div class="n">${closedRows.length ? `${closedRows.length} סעיפים נסגרו בהתקשרות · ${pct(closedBase ? closeGain / closedBase * 100 : 0)} מהמקורי שלהם` : 'עוד לא נסגר סעיף בהתקשרות מלאה'} · תקציב מקורי ${money(baseTot)}${P.project.baseline_at ? ` מ-${fmtDate(P.project.baseline_at)}` : ''}</div></div>` : ''}
      ${(() => { const A = tenantOH(P.data, settings(), new Date().toISOString().slice(0, 7)); const b = A.byProject[P.id]; if (!A.lines.length || !b) return '';
        const after = t.profit - b.total; return `<div class="kpi"><div class="l">רווח אחרי תקורות הקבלן</div><div class="v ${after >= 0 ? 'pos' : 'neg'}">${money(after)}</div><div class="n">חלק הפרויקט בתקורות הקבועות ${money(b.total)} (עד היום ${money(b.toDate)}) · <a href="#/reports/ohprofit">פירוט</a></div></div>`; })()}
    </div>
    ${s.excludedActual ? `<div class="note">עלות שכבר הוצאה על הוראות שינוי שלא נכללות בתצוגה הזו: <b>${money(s.excludedActual)}</b>. כדי לראות אותם, עברי ל"כולל לא מאושרים".</div>` : ''}
    ${(() => { const q = quotaCounts(s.quotas || []); return q.over + q.warn ? `<a class="note" style="display:block" href="#/project/${P.id}/quota"><b>מכסות:</b> ${q.over ? `${q.over} שורות תמחיר חרגו בכמות או בכסף` : ''}${q.over && q.warn ? ' · ' : ''}${q.warn ? `${q.warn} מתקרבות למכסה` : ''}. לפירוט ←</a>` : ''; })()}
    ${s.commitOpen ? `<div class="small mut" style="margin-bottom:8px">התקשרויות רכש פתוחות (הוזמן ועוד לא חויב): <b>${money(s.commitOpen)}</b>. נכללות בצפי לסיום.</div>` : ''}
    ${s.unallocated ? `<div class="note">יש הוצאות בסך ${money(s.unallocated)} שלא שויכו לאף סעיף (אין סעיפים מתאימים בפרויקט).</div>` : ''}
    ${trades.length > 1 ? `<div class="actions" style="margin-bottom:8px;flex-wrap:wrap;gap:6px"><span class="mut small">חבילה:</span><select id="tf" aria-label="סינון לפי חבילה" style="width:auto"><option value="">כל הסעיפים</option>${trades.map(x => `<option value="${esc(x.name)}" ${x.name === tf ? 'selected' : ''}>${esc(x.name)} (${x.count})</option>`).join('')}</select><span class="small mut" id="tfsum"></span></div>` : ''}
    <div class="tw" id="ctl"></div>${legend()}
    <div class="cols even"><div class="card"><h2>רווחיות לפי מקור ${modeLine()}</h2><div class="tw" style="box-shadow:none"><table id="split"></table></div></div>
    <div class="card"><h2>איך מחושב</h2><p class="small">צפי עלות לסיום = עלות בפועל + יתרת התמחיר לפי אחוז הביצוע (אלא אם הוזן צפי ידני). רווח צפוי = מכירה פחות צפי עלות. חריגה = צפי עלות מול התמחיר.</p>
    <p class="small mut">בפועל = הוצאות + עלות עבודה מיומן העבודה. הצפי לא יורד מתחת לבפועל + הזמנות רכש פתוחות. הוצאה כללית לפרויקט מתחלקת בין הסעיפים לפי משקל התמחיר. הוצאה של הוראת שינוי נספרת רק בהוראה.${P.pd.items.some(i => i.is_overhead) ? ' סעיפי "תקורות אתר" הם עלות בלבד, בלי מכירה. אחוז הביצוע שלהם נקבע אוטומטית לפי שאר הפרויקט.' : ''}</p>${can.edit() ? '<p class="small mut">אחוז ביצוע מעדכנים בטבלה. עד שיהיו חשבונות חלקיים (שלב 4), זה הנתון שקובע את הצפי.</p>' : ''}</div></div></div>`);
  $('#mb', el).appendChild(modeSwitch());

  const pick = r => !tf || tradeOf(r.item) === tf;
  const contractByChapter = groupBy(s.contractRows.filter(pick), r => r.item.chapter || 'ללא פרק');
  const voGroups = s.voGroups.filter(g => S.mode === 'all' ? ['approved', 'partial', 'submitted', 'executed_unapproved'].includes(g.vo.status) : S.mode === 'approved' ? ['approved', 'partial'].includes(g.vo.status) : false);
  const NC = hasBase ? 12 : 10;
  const head = `<thead><tr><th>קוד</th><th>תיאור</th><th class="n">מכירה</th>${hasBase ? '<th class="n">תקציב מקורי</th>' : ''}<th class="n">תמחיר</th><th class="n">בפועל</th><th class="n">צפי לסיום</th><th class="n">רווח צפוי</th><th class="n">% ביצוע</th><th class="n">% הוצאה</th><th class="n">חריגה</th>${hasBase ? '<th class="n">צפי מול המקורי</th>' : ''}</tr></thead>`;
  const row = r => {
    const c = r.c, a = rowAttr(c.overrun);
    const prog = c.overhead ? `<span class="small mut" title="סעיף תקורה: אחוז הביצוע לפי שאר הפרויקט">${pct(c.progress, { d: 0 })} אוטו'</span>` : can.edit() ? `<input class="cell-in" type="number" min="0" max="100" step="1" inputmode="numeric" dir="ltr" value="${Math.round(c.progress * 10) / 10}" data-prog="${r.item.id}" aria-label="אחוז ביצוע">` : pct(c.progress, { d: 0 });
    return `<tr class="click ${a.cls}"${a.style} data-item="${r.item.id}"><td>${esc(r.item.code || '')}</td><td class="wrap">${esc(r.item.description)}${c.noCosting ? ' <span class="chip amber">לא תומחר</span>' : ''}${c.reserve ? ` <span class="chip blue" title="רזרבה לבלתי צפוי. מה שלא נוצל בסוף הפרויקט נחשב רווח">רזרבה · נותרו ${money(c.reserveLeft)}</span>` : c.overhead ? ' <span class="chip">תקורה</span>' : ''}${r.item.forecast_manual != null ? ' <span class="chip blue" title="' + esc(r.item.forecast_note || '') + '">צפי ידני</span>' : ''}${c.closed ? ` <span class="chip green" title="נסגר בהתקשרות מלאה: הצפי לפי ההזמנה">נסגר ${money(c.closed)}</span>` : ''}</td>
      <td class="n">${money(c.sale)}</td>${hasBase ? `<td class="n">${c.base == null ? '<span class="mut small">חדש</span>' : money(c.base)}</td>` : ''}<td class="n">${money(c.planned)}</td><td class="n">${money(c.actual)}</td><td class="n">${money(c.forecast)}</td><td class="n">${money(c.profit)}</td>
      <td class="n">${prog}</td><td class="n">${pct(c.spentPct, { d: 0 })}</td><td class="n">${c.noCosting ? '' : pct(c.overrun, { sign: true })}${a.crit ? '<span class="crit">קריטי</span>' : ''}</td>${hasBase ? `<td class="n">${c.base == null ? '' : (() => { const d = c.forecast - c.base; return Math.abs(d) < 1 ? '<span class="mut">0</span>' : `<span class="${d < 0 ? 'pos' : 'neg'}">${money(d)}</span>`; })()}</td>` : ''}</tr>`;
  };
  const subtotal = (label, rs, cls = 'tot') => {
    const a = rs.reduce((x, r) => ({ sale: x.sale + r.c.sale, planned: x.planned + r.c.planned, actual: x.actual + r.c.actual, forecast: x.forecast + r.c.forecast, base: x.base + n(r.c.base), bf: x.bf + (r.c.base == null ? 0 : r.c.forecast) }), { sale: 0, planned: 0, actual: 0, forecast: 0, base: 0, bf: 0 });
    const ov = a.planned ? (a.forecast - a.planned) / a.planned * 100 : 0;
    const bd = a.bf - a.base;
    return `<tr class="${cls}"><td></td><td>${esc(label)}</td><td class="n">${money(a.sale)}</td>${hasBase ? `<td class="n">${money(a.base)}</td>` : ''}<td class="n">${money(a.planned)}</td><td class="n">${money(a.actual)}</td><td class="n">${money(a.forecast)}</td><td class="n">${money(a.sale - a.forecast)}</td><td class="n"></td><td class="n">${pct(a.planned ? a.actual / a.planned * 100 : 0, { d: 0 })}</td><td class="n">${pct(ov, { sign: true })}</td>${hasBase ? `<td class="n"><span class="${bd < -0.5 ? 'pos' : bd > 0.5 ? 'neg' : 'mut'}">${money(bd)}</span></td>` : ''}</tr>`;
  };
  let html = `<table>${head}<tbody>`;
  if (!s.rows.length) html += `<tr><td colspan="${NC}" class="empty">אין סעיפים עדיין. <a href="#/project/${P.id}/boq">לכתב הכמויות</a></td></tr>`;
  for (const [ch, rs] of contractByChapter) { html += `<tr class="sec"><td colspan="${NC}">${esc(ch)}${rs.every(r => r.c.overhead) ? ' <span class="chip">פנימי · עלות בלבד</span>' : ''}</td></tr>` + rs.map(row).join('') + (contractByChapter.length > 1 ? subtotal('סה"כ ' + ch, rs) : ''); }
  if (s.contractRows.length) html += subtotal(tf ? `סה"כ ${tf} בחוזה` : 'סה"כ חוזה', s.contractRows.filter(pick));
  if (voGroups.length && voGroups.some(g => g.rows.some(pick))) {
    html += `<tr class="sec"><td colspan="${NC}">הוראות שינוי (בנפרד מהחוזה)</td></tr>`;
    for (const g of voGroups) {
      if (!g.rows.some(pick)) continue;
      const risk = !['approved', 'partial'].includes(g.vo.status);
      html += `<tr class="${risk ? 'dim' : ''}"><td><b>${esc(g.vo.number)}</b></td><td colspan="${NC - 1}">${esc(g.vo.title)} · <span class="chip ${risk ? 'red' : 'green'}">${VO_STATUS[g.vo.status]}</span>${g.vo.status === 'partial' ? ` אושר ${money(g.approvedSale)} מתוך ${money(g.requested)}` : ''}</td></tr>` + g.rows.filter(pick).map(row).join('');
    }
    html += subtotal('סה"כ הוראות שינוי בתצוגה', voGroups.flatMap(g => g.rows.filter(pick)));
  }
  if (tf) html += subtotal(`סה"כ ${tf} (${PROFIT_MODES[S.mode]})`, s.rows.filter(r => pick(r) && inView(r)));
  else html += `<tr class="tot"><td></td><td>סה"כ פרויקט (${esc(PROFIT_MODES[S.mode])})</td><td class="n">${money(t.sale)}</td>${hasBase ? `<td class="n">${money(baseTot)}</td>` : ''}<td class="n">${money(t.planned)}</td><td class="n">${money(t.actual)}</td><td class="n">${money(t.forecast)}</td><td class="n">${money(t.profit)}</td><td class="n">${pct(t.progress, { d: 0 })}</td><td class="n">${pct(t.spentPct, { d: 0 })}</td><td class="n">${pct(t.overrun, { sign: true })}</td>${hasBase ? (() => { const bd = s.rows.filter(r => r.c.base != null && inView(r)).reduce((a, r) => a + r.c.forecast - r.c.base, 0); return `<td class="n"><span class="${bd < -0.5 ? 'pos' : bd > 0.5 ? 'neg' : 'mut'}">${money(bd)}</span></td>`; })() : ''}</tr>`;
  html += '</tbody></table>';
  if (S.mode !== 'contract' && voGroups.some(g => g.vo.status === 'partial')) html += '<div class="small mut" style="padding:8px">בהוראת שינוי שאושרה חלקית, המכירה בסיכום היא הסכום המאושר.</div>';
  $('#ctl', el).innerHTML = html;

  const split = [['חוזה', s.contract], ['הוראות שינוי מאושרות', s.approved], ['הוראות שינוי שטרם אושרו', s.atRisk]];
  $('#split', el).innerHTML = `<thead><tr><th></th><th class="n">מכירה</th><th class="n">צפי עלות</th><th class="n">רווח</th><th class="n">% רווח</th><th>בתצוגה</th></tr></thead><tbody>
    ${split.map(([l, a], i) => { const inc = i === 0 || (i === 1 && S.mode !== 'contract') || (i === 2 && S.mode === 'all'); return `<tr class="${inc ? '' : 'dim'}"><td>${l}</td><td class="n">${money(a.sale)}</td><td class="n">${money(a.forecast)}</td><td class="n">${money(a.sale - a.forecast)}</td><td class="n">${pct(a.sale ? (a.sale - a.forecast) / a.sale * 100 : 0)}</td><td>${inc ? '✓' : '—'}</td></tr>`; }).join('')}
    <tr class="tot"><td>סה"כ בתצוגה</td><td class="n">${money(t.sale)}</td><td class="n">${money(t.forecast)}</td><td class="n">${money(t.profit)}</td><td class="n">${pct(t.profitPct)}</td><td></td></tr></tbody>`;

  $$('[data-prog]', el).forEach(inp => {
    inp.onclick = e => e.stopPropagation();
    inp.onchange = async () => {
      const it = P.pd.items.find(i => i.id === inp.dataset.prog);
      const v = Math.min(100, Math.max(0, n(inp.value)));
      await db.update('boq_items', it.id, { progress_pct: v });
      await logChange({ project_id: P.id, entity: 'boq_item', entity_id: it.id, label: `${it.code || ''} ${it.description}`, field: 'אחוז ביצוע', old_value: it.progress_pct, new_value: v });
      render();
    };
  });
  $$('[data-item]', el).forEach(tr => tr.onclick = () => itemDetail(P, tr.dataset.item));
  $('#tf', el)?.addEventListener('change', e => { store(tkey, e.target.value || null); render(); });
  return el;
}

async function itemDetail(P, itemId) {
  const r = P.summary.rows.find(x => x.item.id === itemId);
  const it = r.item, c = r.c;
  const lines = P.pd.lines.filter(l => l.boq_item_id === itemId);
  const exps = P.pd.expenses.filter(e => e.boq_item_id === itemId);
  const oh = it.is_overhead ? 0 : n(P.project.overhead_pct);
  const byKind = {};
  for (const l of lines) (byKind[l.kind] ||= { plan: 0, act: 0 }).plan += lineCost(l) * (1 + oh / 100);
  for (const e of exps) { const k = e.kind === 'general' ? 'other' : e.kind; (byKind[k] ||= { plan: 0, act: 0 }).act += n(e.amount); }
  const ents = P.pd.entries.filter(e => e.boq_item_id === itemId);
  const costs = P.summary.costs || {};
  const W = Object.fromEntries((P.data.workers || []).map(w => [w.id, w]));
  for (const e of ents) { const k = W[e.worker_id]?.pay_type === 'piece' ? 'piece' : 'labor'; (byKind[k] ||= { plan: 0, act: 0 }).act += costs[e.id]?.cost || 0; }
  const direct = exps.reduce((a, e) => a + n(e.amount), 0) + ents.reduce((a, e) => a + (costs[e.id]?.cost || 0), 0);
  const body = `<p class="small mut">${esc(it.chapter || '')} · ${num(it.qty)} ${esc(it.unit || '')} × ${money(it.unit_price, { unit: true })}</p>
    <div class="tw"><table><thead><tr><th>רכיב</th><th class="n">תמחיר</th><th class="n">בפועל</th></tr></thead><tbody>
    ${Object.entries(byKind).map(([k, v]) => `<tr><td>${COST_KINDS[k] || EXPENSE_KINDS[k] || k}</td><td class="n">${money(v.plan)}</td><td class="n">${money(v.act)}</td></tr>`).join('')}
    ${c.actual - direct > 0.5 ? `<tr><td>חלק מהוצאות כלליות / הוראת שינוי</td><td class="n"></td><td class="n">${money(c.actual - direct)}</td></tr>` : ''}
    <tr class="tot"><td>סה"כ</td><td class="n">${money(c.planned)}</td><td class="n">${money(c.actual)}</td></tr></tbody></table></div>
    ${ents.length ? `<p class="small">מיומן העבודה: ${ents.filter(e => W[e.worker_id]?.pay_type !== 'piece').reduce((a, e) => a + n(e.days), 0)} ימי עבודה${ents.some(e => W[e.worker_id]?.pay_type === 'piece') ? ` · ${num(ents.reduce((a, e) => a + n(e.piece_qty), 0))} ${esc(it.unit || '')} בקבלנות` : ''}</p>` : ''}
    ${c.commit ? `<p class="small">הזמנות רכש פתוחות לסעיף: <b>${money(c.commit)}</b></p>` : ''}
    <p>צפי לסיום: <b>${money(c.forecast)}</b> · רווח צפוי <b>${money(c.profit)}</b> (${pct(c.profitPct)})</p>
    ${exps.length ? `<h3 style="margin:10px 0 6px">הוצאות על הסעיף</h3><div class="tw"><table><thead><tr><th>תאריך</th><th>ספק</th><th>סוג</th><th class="n">סכום</th></tr></thead><tbody>${exps.map(e => `<tr><td>${fmtDate(e.doc_date)}</td><td>${esc(e.supplier_name || '')}</td><td>${EXPENSE_KINDS[e.kind]}</td><td class="n">${money(e.amount)}</td></tr>`).join('')}</tbody></table></div>` : ''}
    ${can.edit() ? `<h3 style="margin:14px 0 6px">צפי ידני</h3><p class="small mut">ריק = חישוב אוטומטי. צפי ידני דורש בסיס או הערה.</p><div class="grid g2">${field('צפי עלות לסיום ₪', 'forecast_manual', it.forecast_manual ?? '', { type: 'number' })}${field('בסיס / הערה', 'forecast_note', it.forecast_note || '')}</div>` : ''}`;
  const v = await modal({ title: `${it.code || ''} ${it.description}`, body, wide: true, ok: can.edit() ? 'שמירה' : null, cancel: 'סגירה',
    validate: d => d.forecast_manual !== '' && !String(d.forecast_note || '').trim() && 'צפי ידני דורש בסיס או הערה' });
  if (!v || !can.edit()) return;
  const fm = v.forecast_manual === '' ? null : n(v.forecast_manual);
  if (fm !== (it.forecast_manual == null ? null : n(it.forecast_manual)) || (v.forecast_note || '') !== (it.forecast_note || '')) {
    await db.update('boq_items', it.id, { forecast_manual: fm, forecast_note: v.forecast_note || null });
    await logChange({ project_id: P.id, entity: 'boq_item', entity_id: it.id, label: `${it.code || ''} ${it.description}`, field: 'צפי ידני', old_value: it.forecast_manual, new_value: fm, reason: v.forecast_note });
    toast('הצפי עודכן'); render();
  }
}

// ===== יומן שינויים =====
async function tabLog(P) {
  const rows = await db.select('change_log', { eq: { project_id: P.id }, order: 'at desc' });
  return h(`<div class="tw"><table><thead><tr><th>מתי</th><th>מי</th><th>מה</th><th>שדה</th><th>לפני</th><th>אחרי</th><th>סיבה</th></tr></thead><tbody>
    ${rows.map(r => `<tr><td>${new Date(r.at).toLocaleString('he-IL')}</td><td>${esc(r.user_name || '')}</td><td class="wrap">${esc(r.label || r.entity)}</td><td>${esc(r.field || '')}</td><td>${esc(r.old_value ?? '')}</td><td>${esc(r.new_value ?? '')}</td><td class="wrap">${esc(r.reason || '')}</td></tr>`).join('') || '<tr><td colspan="7" class="empty">אין שינויים רשומים</td></tr>'}
    </tbody></table></div>`);
}

// ===== הגדרות פרויקט =====
function tabSettings(P) {
  const el = h(`<div><div class="card"><form id="pf">${projectForm(P.project, P.mcs)}<button class="btn">שמירה</button></form></div>
    ${can.edit() && ['admin', 'owner'].includes(S.role) ? '<div class="card"><h2>תבנית</h2><p class="small mut">שומר את מבנה הפרויקט (סעיפים, תמחיר, מודולים והגדרות) כדי לפתוח ממנו פרויקטים דומים.</p><button class="btn ghost" id="savetpl">שמירה כתבנית</button></div>' : ''}
    <div class="card"><h2>מחיקת פרויקט</h2><p class="small mut">מוחקת את הפרויקט עם כתב הכמויות, התמחיר, הוראות השינוי וההוצאות. אי אפשר לשחזר.</p><button class="btn danger" id="del">מחיקת הפרויקט</button></div></div>`);
  wireProjectType(el);
  $('#pf', el).onsubmit = async e => {
    e.preventDefault();
    const f = e.target; const v = {}; for (const x of f.elements) if (x.name) v[x.name] = x.type === 'checkbox' ? x.checked : x.value;
    if (!v.name.trim()) return toast('חסר שם', 'bad');
    const row = await projectRow(v, P.mcs, P.project.project_type === 'dev' ? 'dev' : 'sub');
    if (row.modules) { const before = mods(P.project); for (const [k, on] of Object.entries(row.modules)) if (!!before[k] !== on) await logChange({ project_id: P.id, entity: 'project', entity_id: P.id, label: 'מודולים בפרויקט', field: MODULES[k].label, old_value: before[k] ? 'דלוק' : 'כבוי', new_value: on ? 'דלוק' : 'כבוי' }); }
    if (row.spread && JSON.stringify(row.spread) !== JSON.stringify(P.project.spread || null)) await logChange({ project_id: P.id, entity: 'project', entity_id: P.id, label: 'פריסה לאורך הפרויקט', field: row.spread.floors.length ? `${row.spread.floors.length} שלבים` : (row.spread.curve === 's' ? 'עקומת S' : 'שווה בכל חודש'), old_value: P.project.spread ? 'הוגדר' : '', new_value: 'עודכן' });
    for (const [k, nv] of Object.entries(row)) { if (k === 'modules' || k === 'spread') continue; const ov = P.project[k]; if (String(ov ?? '') !== String(nv ?? '')) await logChange({ project_id: P.id, entity: 'project', entity_id: P.id, label: 'הגדרות פרויקט', field: k, old_value: ov, new_value: nv }); }
    await db.update('projects', P.id, row);
    const pc = await saveProjectContacts(P.id, v.pc_json);
    if (pc) for (const k of ['notify_phone', 'notify_emails', 'approver_email']) if (String(P.project[k] ?? '') !== String(pc[k] ?? '')) await logChange({ project_id: P.id, entity: 'project', entity_id: P.id, label: 'אנשי קשר בפרויקט', field: k, old_value: P.project[k], new_value: pc[k] });
    toast('נשמר'); render();
  };
  $('#savetpl', el)?.addEventListener('click', () => saveTemplateDialog(P));
  $('#del', el).onclick = async () => {
    const v = await modal({ title: 'מחיקת פרויקט', body: `<p>כדי לאשר, כתוב את שם הפרויקט: <b>${esc(P.project.name)}</b></p>${field('שם הפרויקט', 'c', '')}`, ok: 'מחיקה לצמיתות', danger: true, validate: d => d.c.trim() !== P.project.name.trim() && 'השם לא תואם' });
    if (!v) return;
    await db.remove('projects', P.id); toast('הפרויקט נמחק'); location.hash = '#/projects';
  };
  return el;
}

export function groupBy(arr, fn) {
  const m = new Map();
  for (const x of arr) { const k = fn(x); if (!m.has(k)) m.set(k, []); m.get(k).push(x); }
  return [...m.entries()];
}
