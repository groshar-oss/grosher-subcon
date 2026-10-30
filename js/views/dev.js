// פרויקט יזם: בקרה תקציבית, נעילת בסיס והתקשרויות עם קבלנים, ספקים ויועצים
import { h, esc, $, $$, modal, field, select, area, toast, money, pct, num, fmtDate, confirmBox, numOrNull, nullIfEmpty } from '../util.js';
import { db } from '../db.js';
import { S, can, render, logChange, settings } from '../app.js';
import { n, itemSale } from '../calc.js';
import { devSummary, devAlerts, baselineSnapshot, lineAmount, CONTRACT_KINDS, CONTRACT_STATUS, COMMITTED } from '../dev.js';
import { rowAttr, legend } from './common.js';
import { attachBtn, wireAttach, clip, filesFor } from '../files.js';
import { loadXLSX } from '../import.js';

export const devSum = P => devSummary({ project: P.project, items: P.pd.items, contracts: P.pd.contracts || [], cLines: P.pd.cLines || [], expenses: P.pd.expenses,
  cos: P.pd.cos || [], coLines: P.pd.coLines || [], cbills: P.pd.cbills || [], cbLines: P.pd.cbLines || [], vatPct: settings().vat_pct });
const alertOpts = P => ({ critPct: settings().crit_pct, vendorsWithContracts: vendorNames(P), today: new Date().toISOString().slice(0, 10), filesFor: id => filesFor(P.data.files, id) });
const vendorNames = P => new Set((P.pd.contracts || []).filter(c => c.status !== 'cancelled').map(c => (c.vendor_name || '').trim()).filter(Boolean));
export const devProjectAlerts = P => devAlerts(devSum(P), alertOpts(P));
const label = it => `${it.code || ''} ${it.description}`.trim();
const dt = d => d ? new Date(d).toLocaleDateString('he-IL') : '';

// ===== בקרה תקציבית =====
export function devControl(P) {
  const s = devSum(P), t = s.total;
  const alerts = devAlerts(s, alertOpts(P));
  const el = h(`<div>
    <div class="kpis">
      <div class="kpi"><div class="l">תקציב מאושר</div><div class="v">${money(t.budget)}</div><div class="n">${s.rows.length} סעיפים</div></div>
      <div class="kpi"><div class="l">בסיס נעול</div><div class="v">${t.baseTotal != null ? money(t.baseTotal) : '<span class="mut small">לא ננעל</span>'}</div><div class="n">${s.baselineAt ? 'ננעל ב-' + dt(s.baselineAt) : 'נועלים אחרי אישור התקציב'}</div></div>
      <div class="kpi"><div class="l">התקשרויות</div><div class="v">${money(t.committed + t.outside)}</div><div class="n">${pct(t.budget ? (t.committed + t.outside) / t.budget * 100 : 0, { d: 0 })} מהתקציב · טרם נסגר ${money(t.uncommitted)}${t.coApproved ? ` · כולל שינויים ${money(t.coApproved)}` : ''}${t.coPending ? ` · שינויים בתהליך ${money(t.coPending)}` : ''}</div></div>
      <div class="kpi"><div class="l">צפי עלות לסיום</div><div class="v">${money(t.forecast)}</div><div class="n">${pct(t.dev, { sign: true })} מול התקציב${t.devBase != null ? ` · ${pct(t.devBase, { sign: true })} מול הבסיס` : ''}</div></div>
      <div class="kpi"><div class="l">חויב / שולם</div><div class="v">${money(t.paid)}</div><div class="n">חויב ${money(t.invoiced)}</div></div>
    </div>
    ${can.edit() ? `<div class="actions" style="margin-bottom:12px"><button class="btn ${s.hasBaseline ? 'ghost' : ''}" id="lock">${s.hasBaseline ? 'נעילת בסיס חדש' : 'נעילת בסיס'}</button><button class="btn ghost" id="xl">ייצוא לאקסל</button></div>` : ''}
    ${alerts.length ? `<div class="card"><h2>דורש תשומת לב (${alerts.length})</h2><ul class="small" id="al">${alerts.slice(0, 14).map(a => `<li class="${a.crit ? 'neg' : ''}"><b>${a.co || a.bill ? `<a href="#/project/${P.id}/${a.bill ? 'cbill/' + a.bill.id : 'cos'}">${esc(a.title)}</a>` : esc(a.title)}</b> · ${esc(a.detail)}${a.amount != null ? ` · ${money(a.amount)}` : ''}${a.pct != null ? ` (${pct(a.pct, { sign: true })})` : ''}</li>`).join('')}</ul></div>` : ''}
    <div class="tw" id="ctl"></div>${legend()}
    <div class="card"><h2>איך מחושב</h2><p class="small">צפי לסיום לכל סעיף = התקשרויות חתומות לסעיף. סעיף בלי התקשרות מקבל את סכום התקציב ומסומן "הערכה". צפי ידני אפשר להזין בלחיצה על הסעיף, עם הסבר. הצפי לא יורד מתחת למה שכבר חויב.</p>
    <p class="small mut">הבסיס הוא צילום של התקציב ביום הנעילה. כל שינוי אחריו נמדד מול הבסיס ונרשם ביומן השינויים. התקשרות בטיוטה לא נכנסת לצפי.</p></div></div>`);

  const head = `<thead><tr><th>קוד</th><th>תיאור</th><th class="n">תקציב</th><th class="n hide-m">בסיס</th><th class="n">התקשרויות</th><th class="n">צפי לסיום</th><th class="n hide-m">חויב</th><th class="n hide-m">שולם</th><th class="n">סטייה מהתקציב</th><th class="n hide-m">מול הבסיס</th></tr></thead>`;
  const row = r => {
    const a = r.estimate ? { cls: '', style: '', crit: false } : rowAttr(r.dev);
    const chips = (r.estimate ? ' <span class="chip amber">הערכה</span>' : '') + (r.manual ? ` <span class="chip blue" title="${esc(r.item.forecast_note || '')}">צפי ידני</span>` : '') + (r.newItem ? ' <span class="chip">נוסף אחרי הבסיס</span>' : '') + (r.draft ? ` <span class="chip" title="התקשרות בטיוטה">טיוטה ${money(r.draft)}</span>` : '') + (r.co ? ` <span class="chip blue" title="הוראות שינוי מאושרות, כלולות בהתקשרויות">שינויים ${money(r.co)}</span>` : '') + (r.coPending ? ` <span class="chip amber" title="הוראות שינוי שטרם אושרו, לא בצפי">בתהליך ${money(r.coPending)}</span>` : '');
    return `<tr class="click ${a.cls}"${a.style} data-item="${r.item.id}"><td>${esc(r.item.code || '')}</td><td class="wrap">${esc(r.item.description)}${chips}</td>
      <td class="n">${money(r.budget)}</td><td class="n hide-m">${r.base != null ? money(r.base) : ''}</td><td class="n">${r.committed ? money(r.committed) : ''}</td><td class="n">${money(r.forecast)}</td>
      <td class="n hide-m">${r.invoiced ? money(r.invoiced) : ''}</td><td class="n hide-m">${r.paid ? money(r.paid) : ''}</td><td class="n">${r.estimate ? '' : pct(r.dev, { sign: true })}${a.crit ? '<span class="crit">קריטי</span>' : ''}</td><td class="n hide-m">${r.devBase != null && !r.estimate ? pct(r.devBase, { sign: true }) : ''}</td></tr>`;
  };
  const sub = (lbl, x, cls = 'tot') => `<tr class="${cls}"><td></td><td>${esc(lbl)}</td><td class="n">${money(x.budget)}</td><td class="n hide-m">${x.base ? money(x.base) : ''}</td><td class="n">${money(x.committed)}</td><td class="n">${money(x.forecast)}</td><td class="n hide-m">${money(x.invoiced)}</td><td class="n hide-m">${money(x.paid)}</td><td class="n">${pct(x.dev, { sign: true })}</td><td class="n hide-m">${x.devBase != null ? pct(x.devBase, { sign: true }) : ''}</td></tr>`;
  let html = `<table>${head}<tbody>`;
  if (!s.rows.length) html += `<tr><td colspan="10" class="empty">אין תקציב עדיין. <a href="#/project/${P.id}/boq">לקליטת התקציב</a></td></tr>`;
  for (const ch of s.chapters) html += `<tr class="sec"><td colspan="10">${esc(ch.name)}</td></tr>` + ch.rows.map(row).join('') + (s.chapters.length > 1 ? sub('סה"כ ' + ch.name, ch) : '');
  if (s.outside.length) {
    html += `<tr class="sec"><td colspan="10">התקשרויות בלי סעיף תקציב</td></tr>` + s.outside.map(o => `<tr class="al-r"><td></td><td class="wrap">${esc(o.contract.vendor_name || '')} · ${esc(o.contract.title)} <span class="chip red">מחוץ לתקציב</span></td><td class="n"></td><td class="n hide-m"></td><td class="n">${money(o.amount)}</td><td class="n">${money(o.amount)}</td><td class="n hide-m"></td><td class="n hide-m"></td><td class="n"></td><td class="n hide-m"></td></tr>`).join('');
  }
  if (t.unalloc > 0.5) html += `<tr class="al-y"><td></td><td>הוצאות בלי סעיף תקציב <a href="#/project/${P.id}/expenses">לשיוך ←</a></td><td class="n"></td><td class="n hide-m"></td><td class="n"></td><td class="n">${money(t.unalloc)}</td><td class="n hide-m">${money(t.unalloc)}</td><td class="n hide-m"></td><td class="n"></td><td class="n hide-m"></td></tr>`;
  if (s.rows.length) html += `<tr class="tot"><td></td><td>סה"כ פרויקט</td><td class="n">${money(t.budget)}</td><td class="n hide-m">${t.baseTotal != null ? money(t.baseTotal) : ''}</td><td class="n">${money(t.committed + t.outside)}</td><td class="n">${money(t.forecast)}</td><td class="n hide-m">${money(t.invoiced)}</td><td class="n hide-m">${money(t.paid)}</td><td class="n">${pct(t.dev, { sign: true })}</td><td class="n hide-m">${t.devBase != null ? pct(t.devBase, { sign: true }) : ''}</td></tr>`;
  $('#ctl', el).innerHTML = html + '</tbody></table>';

  $$('[data-item]', el).forEach(tr => tr.onclick = () => devItemDetail(P, s, tr.dataset.item));
  $('#lock', el)?.addEventListener('click', () => lockBaseline(P, s));
  $('#xl', el)?.addEventListener('click', () => exportControl(P, s));
  return el;
}

async function lockBaseline(P, s) {
  const snap = baselineSnapshot(P.pd.items);
  if (!Object.keys(snap.items).length) return toast('אין סעיפי תקציב לנעילה', 'bad');
  const again = s.hasBaseline;
  const v = await modal({ title: again ? 'נעילת בסיס חדש' : 'נעילת בסיס', body: `<p>הבסיס יהיה התקציב הנוכחי: <b>${money(snap.total)}</b> ב-${Object.keys(snap.items).length} סעיפים. מעכשיו כל שינוי נמדד מולו.</p>
    ${again ? `<p class="small mut">הבסיס הקודם (${money(P.project.baseline.total)}, ${dt(P.project.baseline_at)}) יוחלף, והשינוי יירשם ביומן.</p>` : ''}${field(again ? 'סיבה לבסיס חדש' : 'הערה (למשל: תקציב שאושר בישיבה)', 'note', '', { req: again })}`,
    ok: 'נעילה', validate: d => again && !d.note.trim() && 'בבסיס חדש צריך לכתוב סיבה' });
  if (!v) return;
  const at = new Date().toISOString();
  await db.update('projects', P.id, { baseline: snap, baseline_at: at, baseline_note: v.note.trim() || null });
  await logChange({ project_id: P.id, entity: 'project', entity_id: P.id, label: 'בסיס תקציב', field: again ? 'בסיס חדש' : 'נעילת בסיס', old_value: again ? P.project.baseline.total : null, new_value: snap.total, reason: v.note.trim() || null });
  toast('הבסיס ננעל'); render();
}

async function devItemDetail(P, s, itemId) {
  const r = s.rows.find(x => x.item.id === itemId); if (!r) return;
  const it = r.item;
  const cls = (P.pd.cLines || []).filter(l => l.boq_item_id === itemId);
  const cmap = Object.fromEntries((P.pd.contracts || []).map(c => [c.id, c]));
  const exps = P.pd.expenses.filter(e => e.boq_item_id === itemId);
  const body = `<p class="small mut">${esc(it.chapter || '')} · ${num(it.qty)} ${esc(it.unit || '')} × ${money(it.unit_price, { unit: true })} = ${money(r.budget)}${r.base != null ? ` · בסיס ${money(r.base)}` : ''}</p>
    <h3 style="margin:10px 0 6px">התקשרויות לסעיף</h3>
    ${cls.length ? `<div class="tw"><table><thead><tr><th>גורם</th><th>תיאור</th><th class="n">כמות</th><th class="n">מחיר תקציב</th><th class="n">מחיר בחוזה</th><th class="n">סה"כ</th><th>סטטוס</th></tr></thead><tbody>
      ${cls.map(l => { const c = cmap[l.contract_id] || {}; const d = n(it.unit_price) ? (n(l.unit_price) - n(it.unit_price)) / n(it.unit_price) * 100 : 0; return `<tr class="${COMMITTED.includes(c.status) ? '' : 'dim'}"><td>${esc(c.vendor_name || '')}</td><td class="wrap">${esc(l.description)}</td><td class="n">${num(l.qty)}</td><td class="n">${money(it.unit_price, { unit: true })}</td><td class="n">${money(l.unit_price, { unit: true })} ${Math.abs(d) > 0.05 ? `<span class="small ${d > 0 ? 'neg' : 'pos'}">${pct(d, { sign: true })}</span>` : ''}</td><td class="n">${money(lineAmount(l))}</td><td>${CONTRACT_STATUS[c.status] || ''}</td></tr>`; }).join('')}</tbody></table></div>` : '<p class="small mut">אין התקשרות לסעיף. הצפי לפי התקציב.</p>'}
    ${exps.length ? `<h3 style="margin:10px 0 6px">הוצאות על הסעיף</h3><div class="tw"><table><thead><tr><th>תאריך</th><th>ספק</th><th>מסמך</th><th class="n">סכום</th><th>סטטוס</th></tr></thead><tbody>${exps.map(e => `<tr><td>${fmtDate(e.doc_date)}</td><td>${esc(e.supplier_name || '')}</td><td>${esc(e.doc_no || '')}</td><td class="n">${money(e.amount)}</td><td>${e.status === 'paid' ? 'שולם' : e.status === 'expected' ? 'צפוי' : 'חויב'}</td></tr>`).join('')}</tbody></table></div>` : ''}
    <p>צפי לסיום: <b>${money(r.forecast)}</b>${r.estimate ? ' (הערכה לפי התקציב)' : ''} · סטייה מהתקציב ${pct(r.dev, { sign: true })}</p>
    ${can.edit() ? `<h3 style="margin:14px 0 6px">צפי ידני</h3><p class="small mut">ריק = חישוב אוטומטי. צפי ידני דורש הסבר (למשל: הצעת מחיר, מחיר שוק).</p><div class="grid g2">${field('צפי עלות לסיום ₪', 'forecast_manual', it.forecast_manual ?? '', { type: 'number' })}${field('על מה מבוסס', 'forecast_note', it.forecast_note || '')}</div>` : ''}`;
  const v = await modal({ title: label(it), body, wide: true, ok: can.edit() ? 'שמירה' : null, cancel: 'סגירה',
    validate: d => d.forecast_manual !== '' && !String(d.forecast_note || '').trim() && 'צפי ידני דורש הסבר' });
  if (!v || !can.edit()) return;
  const fm = v.forecast_manual === '' ? null : n(v.forecast_manual);
  if (fm !== (it.forecast_manual == null ? null : n(it.forecast_manual)) || (v.forecast_note || '') !== (it.forecast_note || '')) {
    await db.update('boq_items', it.id, { forecast_manual: fm, forecast_note: v.forecast_note || null });
    await logChange({ project_id: P.id, entity: 'boq_item', entity_id: it.id, label: label(it), field: 'צפי ידני', old_value: it.forecast_manual, new_value: fm, reason: v.forecast_note });
    toast('הצפי עודכן'); render();
  }
}

async function exportControl(P, s) {
  const XLSX = await loadXLSX();
  const rows = [['פרק', 'קוד', 'תיאור', 'תקציב', 'בסיס', 'התקשרויות', 'צפי לסיום', 'חויב', 'שולם', 'סטייה מהתקציב %', 'סטייה מהבסיס %', 'הערה']];
  for (const r of s.rows) rows.push([r.item.chapter || '', r.item.code || '', r.item.description, Math.round(r.budget), r.base != null ? Math.round(r.base) : '', Math.round(r.committed), Math.round(r.forecast), Math.round(r.invoiced), Math.round(r.paid),
    r.estimate ? '' : Math.round(r.dev * 10) / 10, r.devBase != null ? Math.round(r.devBase * 10) / 10 : '', r.estimate ? 'הערכה' : r.manual ? 'צפי ידני: ' + (r.item.forecast_note || '') : '']);
  for (const o of s.outside) rows.push(['מחוץ לתקציב', '', `${o.contract.vendor_name || ''} · ${o.contract.title}`, 0, '', Math.round(o.amount), Math.round(o.amount), '', '', '', '', 'התקשרות בלי סעיף']);
  const t = s.total;
  rows.push(['', '', 'סה"כ פרויקט', Math.round(t.budget), t.baseTotal != null ? Math.round(t.baseTotal) : '', Math.round(t.committed + t.outside), Math.round(t.forecast), Math.round(t.invoiced), Math.round(t.paid), Math.round(t.dev * 10) / 10, t.devBase != null ? Math.round(t.devBase * 10) / 10 : '', '']);
  const ws = XLSX.utils.aoa_to_sheet(rows); ws['!cols'] = [{ wch: 18 }, { wch: 9 }, { wch: 46 }, ...Array(8).fill({ wch: 13 }), { wch: 24 }];
  const wb = XLSX.utils.book_new(); wb.Workbook = { Views: [{ RTL: true }] }; XLSX.utils.book_append_sheet(wb, ws, 'בקרה תקציבית');
  XLSX.writeFile(wb, `בקרה תקציבית - ${P.project.name.replace(/[\\/:*?"<>|·]/g, '-')}.xlsx`);
}

// ===== התקשרויות =====
export function devContracts(P) {
  const s = devSum(P);
  const el = h(`<div>
    ${can.edit() ? '<div class="actions" style="margin-bottom:12px"><button class="btn" id="add">+ התקשרות</button></div>' : ''}
    <div class="note small">כל התקשרות חתומה עם קבלן, ספק או יועץ: סכום, תנאי תשלום, עיכבון ומקדמה. שורות ההתקשרות משויכות לסעיפי התקציב, ומחיר היחידה בחוזה מושווה למחיר בתקציב.</div>
    <div class="tw"><table><thead><tr><th>מס'</th><th>גורם</th><th class="hide-m">סוג</th><th>סטטוס</th><th class="n">סכום</th><th class="n hide-m">מול התקציב</th><th class="n">חויב</th><th class="n hide-m">שולם</th><th class="n">יתרה לתשלום</th><th class="hide-m">תנאים</th><th></th></tr></thead><tbody id="tb"></tbody></table></div></div>`);
  const bud = c => c.lines.filter(l => l.boq_item_id).reduce((a, l) => { const it = P.pd.items.find(i => i.id === l.boq_item_id); return a + (it ? n(l.qty) * n(it.unit_price) : 0); }, 0);
  $('#tb', el).innerHTML = s.contracts.map(c => {
    const k = c.contract, b = bud(c), d = b ? (c.base - b) / b * 100 : null, a = d != null && COMMITTED.includes(k.status) ? rowAttr(d) : { cls: '', style: '' };
    return `<tr class="click ${k.status === 'cancelled' ? 'dim' : ''}" data-c="${k.id}"><td>${esc(k.number || '')}</td><td><b>${esc(k.vendor_name || '')}</b><div class="small mut">${esc(k.title)}</div></td><td class="hide-m">${CONTRACT_KINDS[k.kind] || ''}</td>
      <td><span class="chip ${k.status === 'signed' ? 'green' : k.status === 'draft' ? 'amber' : ''}">${CONTRACT_STATUS[k.status]}</span></td><td class="n">${money(c.amount)}${c.coAmt ? `<div class="small mut">כולל שינויים ${money(c.coAmt)}</div>` : ''}</td>
      <td class="n hide-m ${a.cls}"${a.style}>${d != null ? pct(d, { sign: true }) : ''}</td><td class="n ${c.over ? 'neg' : ''}">${money(c.invoiced)}</td><td class="n hide-m">${money(c.paid)}</td><td class="n">${money(c.balance)}</td>
      <td class="hide-m small">${k.pay_terms_days != null ? 'שוטף+' + k.pay_terms_days : ''}${n(k.retention_pct) ? ` · עיכבון ${num(k.retention_pct)}%` : ''}${n(k.advance_amount) ? ` · מקדמה ${money(k.advance_amount)}` : ''}</td>
      <td style="white-space:nowrap">${can.edit() ? attachBtn(P.data.files, 'contracts', k.id, { projectId: P.id, docType: 'contract', label: `${k.vendor_name || ''} ${k.title}`.trim() }) : clip(P.data.files, k.id)}</td></tr>`;
  }).join('') + (s.contracts.length ? `<tr class="tot"><td></td><td>סה"כ (${s.contracts.length})</td><td class="hide-m"></td><td></td><td class="n">${money(s.contracts.filter(c => COMMITTED.includes(c.contract.status)).reduce((a, c) => a + c.amount, 0))}</td><td class="hide-m"></td><td class="n">${money(s.contracts.reduce((a, c) => a + c.invoiced, 0))}</td><td class="n hide-m">${money(s.contracts.reduce((a, c) => a + c.paid, 0))}</td><td class="n">${money(s.contracts.filter(c => COMMITTED.includes(c.contract.status)).reduce((a, c) => a + c.balance, 0))}</td><td class="hide-m"></td><td></td></tr>` : `<tr><td colspan="11" class="empty">אין התקשרויות עדיין</td></tr>`);
  wireAttach(el, P.data.files || [], render);
  $$('[data-c]', el).forEach(tr => tr.onclick = e => { if (e.target.closest('button,a')) return; contractDialog(P, P.pd.contracts.find(c => c.id === tr.dataset.c)); });
  $('#add', el)?.addEventListener('click', () => contractDialog(P));
  return el;
}

export async function contractDialog(P, c = null) {
  const items = P.pd.items.filter(i => !i.variation_id);
  const itemBy = Object.fromEntries(items.map(i => [i.id, i]));
  const vendors = P.data.vendors || [];
  let lines = c ? (P.pd.cLines || []).filter(l => l.contract_id === c.id).map(l => ({ ...l })) : [];
  const chapters = [...new Set(items.map(i => i.chapter || 'ללא פרק'))];
  const ro = !can.edit();
  const body = `<datalist id="vnd">${vendors.map(v => `<option value="${esc(v.name)}">`).join('')}</datalist>
    <div class="grid g2">${field('גורם (קבלן / ספק / יועץ)', 'vendor_name', c?.vendor_name || '', { req: true, attrs: 'list="vnd"' })}${field('נושא ההתקשרות', 'title', c?.title || '', { req: true })}</div>
    <div class="grid g4">${field('מספר חוזה', 'number', c?.number || '')}${select('סוג', 'kind', CONTRACT_KINDS, c?.kind || 'contractor')}${select('סטטוס', 'status', CONTRACT_STATUS, c?.status || 'signed')}${field('תאריך חתימה', 'signed_date', c?.signed_date || '', { type: 'date' })}</div>
    <div class="grid g4">${field('תנאי תשלום (שוטף + ימים)', 'pay_terms_days', c?.pay_terms_days ?? 30, { type: 'number' })}${field('עיכבון %', 'retention_pct', c?.retention_pct ?? 5, { type: 'number' })}${field('מקדמה ₪', 'advance_amount', c?.advance_amount ?? 0, { type: 'number' })}${field('קיזוז מקדמה % מכל חשבון', 'advance_offset_pct', c?.advance_offset_pct ?? 0, { type: 'number' })}</div>
    <label class="chk"><input type="checkbox" name="indexation" ${c?.indexation ? 'checked' : ''}> צמוד למדד תשומות הבנייה</label>${field('מדד בסיס', 'base_index', c?.base_index ?? '', { type: 'number' })}
    <h3 style="margin:12px 0 6px">שורות ההתקשרות</h3>
    <p class="small mut">כל שורה משויכת לסעיף תקציב. מחיר התקציב מוצג להשוואה, ואת מחיר החוזה אפשר לשנות.</p>
    ${ro ? '' : `<div class="actions" style="margin-bottom:8px"><select id="pickch" style="width:auto"><option value="">הוספת פרק שלם מהתקציב…</option>${chapters.map(ch => `<option>${esc(ch)}</option>`).join('')}</select>
      <select id="pickit" style="width:auto;max-width:280px"><option value="">הוספת סעיף מהתקציב…</option>${items.map(i => `<option value="${i.id}">${esc(label(i).slice(0, 70))}</option>`).join('')}</select><button class="btn small ghost" type="button" id="addfree">+ שורה חופשית</button></div>`}
    <div class="tw" style="max-height:340px;overflow:auto"><table><thead><tr><th>סעיף תקציב</th><th>תיאור</th><th>יח'</th><th class="n">כמות</th><th class="n">מחיר תקציב</th><th class="n">מחיר בחוזה</th><th class="n">סה"כ</th><th></th></tr></thead><tbody id="cl"></tbody></table></div>
    <div id="ctot" class="small" style="margin-top:6px"></div>${area('הערות', 'notes', c?.notes || '')}`;
  let host, drawing = false;
  const draw = () => {
    const tb = $('#cl', host);
    drawing = true; // החלפת השורות מורידה פוקוס משדה, וזה מפעיל change נוסף
    tb.innerHTML = lines.map((l, k) => { const it = itemBy[l.boq_item_id]; const d = it && n(it.unit_price) && l.unit_price !== '' && l.unit_price != null ? (n(l.unit_price) - n(it.unit_price)) / n(it.unit_price) * 100 : null;
      return `<tr><td><select data-k="${k}" data-f="boq_item_id" style="max-width:190px" ${ro ? 'disabled' : ''}><option value="">— בלי סעיף —</option>${items.map(i => `<option value="${i.id}" ${i.id === l.boq_item_id ? 'selected' : ''}>${esc(label(i).slice(0, 50))}</option>`).join('')}</select></td>
        <td><input data-k="${k}" data-f="description" value="${esc(l.description || '')}" ${ro ? 'readonly' : ''}></td><td><input data-k="${k}" data-f="unit" value="${esc(l.unit || '')}" style="width:60px" ${ro ? 'readonly' : ''}></td>
        <td><input data-k="${k}" data-f="qty" type="number" step="any" dir="ltr" value="${l.qty ?? ''}" style="width:90px" ${ro ? 'readonly' : ''}></td>
        <td class="n">${it ? money(it.unit_price, { unit: true }) : ''}</td>
        <td><input data-k="${k}" data-f="unit_price" type="number" step="any" dir="ltr" value="${l.unit_price ?? ''}" style="width:100px" ${ro ? 'readonly' : ''}>${d != null && Math.abs(d) > 0.05 ? `<div class="small ${d > 0 ? 'neg' : 'pos'}">${pct(d, { sign: true })}</div>` : ''}</td>
        <td class="n">${money(lineAmount(l))}</td><td>${ro ? '' : `<button type="button" class="btn small ghost" data-rm="${k}" aria-label="הסרה">✕</button>`}</td></tr>`; }).join('') || '<tr><td colspan="8" class="empty">אין שורות. מוסיפים פרק או סעיף מהתקציב, או שורה חופשית.</td></tr>';
    drawing = false;
    const err = host.querySelector('.err'); if (err && lines.length) err.hidden = true;
    const tot = lines.reduce((a, l) => a + lineAmount(l), 0);
    const bud = lines.reduce((a, l) => { const it = itemBy[l.boq_item_id]; return a + (it ? n(l.qty) * n(it.unit_price) : 0); }, 0);
    const free = lines.filter(l => !l.boq_item_id).reduce((a, l) => a + lineAmount(l), 0);
    $('#ctot', host).innerHTML = `סה"כ התקשרות: <b>${money(tot)}</b>${bud ? ` · אותן כמויות לפי מחירי התקציב ${money(bud)} (${pct((tot - free - bud) / bud * 100, { sign: true })})` : ''}${free ? ` · <span class="neg">${money(free)} בשורות בלי סעיף תקציב</span>` : ''}`;
    $$('[data-f]', tb).forEach(inp => inp.onchange = () => { const l = lines[+inp.dataset.k]; const f = inp.dataset.f; l[f] = ['qty', 'unit_price'].includes(f) ? (inp.value === '' ? null : n(inp.value)) : inp.value || null;
      if (f === 'boq_item_id' && l.boq_item_id) { const it = itemBy[l.boq_item_id]; Object.assign(l, { description: l.description || it.description, unit: l.unit || it.unit, code: it.code, qty: l.qty ?? it.qty, unit_price: l.unit_price ?? it.unit_price }); }
      if (!drawing) draw(); });
    $$('[data-rm]', tb).forEach(b => b.onclick = () => { lines.splice(+b.dataset.rm, 1); draw(); });
  };
  const fromItem = it => ({ boq_item_id: it.id, code: it.code, description: it.description, unit: it.unit, qty: it.qty, unit_price: it.unit_price });
  const v = await modal({ title: c ? `התקשרות: ${c.vendor_name || ''} · ${c.title}` : 'התקשרות חדשה', body, wide: true, ok: ro ? null : 'שמירה', cancel: ro ? 'סגירה' : 'ביטול', onMount: el => {
    host = el; draw();
    $('#pickch', el)?.addEventListener('change', e => { const ch = e.target.value; if (!ch) return; items.filter(i => (i.chapter || 'ללא פרק') === ch && !lines.some(l => l.boq_item_id === i.id)).forEach(i => lines.push(fromItem(i))); e.target.value = ''; draw(); });
    $('#pickit', el)?.addEventListener('change', e => { const it = itemBy[e.target.value]; if (it) lines.push(fromItem(it)); e.target.value = ''; draw(); });
    $('#addfree', el)?.addEventListener('click', () => { lines.push({ boq_item_id: null, description: '', unit: '', qty: 1, unit_price: null }); draw(); });
  }, validate: d => {
    if (!d.vendor_name.trim()) return 'חסר שם הגורם';
    if (!d.title.trim()) return 'חסר נושא';
    if (!lines.length) return 'אין שורות בהתקשרות';
    if (lines.some(l => !String(l.description || '').trim())) return 'יש שורה בלי תיאור';
    if (lines.some(l => !n(l.qty) || l.unit_price === '' || l.unit_price == null)) return 'יש שורה בלי כמות או מחיר';
    return null;
  } });
  if (!v || ro) return;
  // ספק: כרטיס קיים לפי שם, או חדש
  const vname = v.vendor_name.trim();
  let vendor = vendors.find(x => x.name.trim() === vname);
  if (!vendor) [vendor] = await db.insert('vendors', { tenant_id: S.tenantId, name: vname, kind: v.kind === 'consultant' ? 'consultant' : v.kind === 'supplier' ? 'supplier' : 'contractor', pay_terms_days: numOrNull(v.pay_terms_days), active: true });
  const row = { vendor_id: vendor.id, vendor_name: vname, title: v.title.trim(), number: v.number.trim() || null, kind: v.kind, status: v.status, signed_date: nullIfEmpty(v.signed_date),
    pay_terms_days: numOrNull(v.pay_terms_days), retention_pct: n(v.retention_pct), advance_amount: n(v.advance_amount), advance_offset_pct: n(v.advance_offset_pct), indexation: !!v.indexation, base_index: numOrNull(v.base_index), notes: v.notes || null };
  const newTotal = lines.reduce((a, l) => a + lineAmount(l), 0);
  let cid = c?.id;
  if (c) {
    const oldTotal = (P.pd.cLines || []).filter(l => l.contract_id === c.id).reduce((a, l) => a + lineAmount(l), 0);
    await db.update('contracts', c.id, row);
    if (Math.abs(oldTotal - newTotal) > 0.5) await logChange({ project_id: P.id, entity: 'contract', entity_id: c.id, label: `${vname} · ${row.title}`, field: 'סכום התקשרות', old_value: Math.round(oldTotal), new_value: Math.round(newTotal) });
    if (c.status !== row.status) await logChange({ project_id: P.id, entity: 'contract', entity_id: c.id, label: `${vname} · ${row.title}`, field: 'סטטוס התקשרות', old_value: CONTRACT_STATUS[c.status], new_value: CONTRACT_STATUS[row.status] });
    const keep = new Set(lines.filter(l => l.id).map(l => l.id));
    for (const old of (P.pd.cLines || []).filter(l => l.contract_id === c.id && !keep.has(l.id))) await db.remove('contract_lines', old.id);
  } else {
    [{ id: cid }] = await db.insert('contracts', { tenant_id: S.tenantId, project_id: P.id, ...row });
    await logChange({ project_id: P.id, entity: 'contract', entity_id: cid, label: `${vname} · ${row.title}`, field: 'התקשרות חדשה', new_value: Math.round(newTotal) });
  }
  let sort = 0;
  for (const l of lines) {
    const lr = { boq_item_id: l.boq_item_id || null, code: l.code || null, description: String(l.description).trim(), unit: l.unit || null, qty: n(l.qty), unit_price: n(l.unit_price), sort: sort++ };
    if (l.id) await db.update('contract_lines', l.id, lr);
    else await db.insert('contract_lines', { tenant_id: S.tenantId, project_id: P.id, contract_id: cid, ...lr });
  }
  toast('ההתקשרות נשמרה'); render();
}
