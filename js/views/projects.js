// רשימת פרויקטים והקמת פרויקט
import { h, esc, $, $$, modal, field, select, toast, money, pct, numOrNull, nullIfEmpty, fmtDate } from '../util.js';
import { db } from '../db.js';
import { S, can, loadTenantData, modeSwitch, settings, render } from '../app.js';
import { n } from '../calc.js';
import { STATUS, CONTRACT, projData, summarize, rowAttr, modeLine } from './common.js';
import { mcForm } from './clients.js';
import { isDev, PROJECT_TYPES, devSummary } from '../dev.js';
import { modulesFieldset, readModules, syncModulesType, mods, moduleTags } from '../modules.js';

export function projectForm(p = {}, mcs = [], { isNew = false } = {}) {
  const ov = p.overhead_pct ?? settings().overhead_pct;
  const dev = isDev(p);
  return `${isNew ? `<fieldset class="ptype" style="border:0;padding:0;margin:0 0 6px;display:flex;gap:22px;flex-wrap:wrap"><legend class="small mut" style="padding:0;margin-bottom:6px">סוג פרויקט</legend>${Object.entries(PROJECT_TYPES).map(([k, l]) => `<label style="display:flex;align-items:center;gap:6px;font-weight:600;cursor:pointer"><input type="radio" name="project_type" value="${k}" style="width:18px;height:18px;margin:0" ${(p.project_type || 'sub') === k ? 'checked' : ''}>${l}</label>`).join('')}</fieldset>
  <p class="small mut" id="ptyhint"></p>` : ''}<div class="grid g2">
  ${field('שם הפרויקט', 'name', p.name, { req: true })}
  <label class="fld subonly" ${dev ? 'hidden' : ''}><span>קבלן ראשי</span><select name="main_contractor_id"><option value="">ללא</option>${mcs.map(m => `<option value="${m.id}" ${m.id === p.main_contractor_id ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}<option value="__new">+ קבלן ראשי חדש…</option></select></label>
  ${field('כתובת', 'address', p.address)}${field('מזמין / יזם', 'owner_name', p.owner_name)}
  ${field('תאריך התחלה', 'start_date', p.start_date, { type: 'date' })}${field('תאריך סיום', 'end_date', p.end_date, { type: 'date' })}
  <div class="subonly" ${dev ? 'hidden' : ''}>${select('סוג חוזה', 'contract_type', CONTRACT, p.contract_type || 'measure')}</div>${select('סטטוס', 'status', STATUS, p.status || 'active')}
  <div class="subonly" ${dev ? 'hidden' : ''}>${field('תנאי תשלום (שוטף + ימים)', 'pay_terms_days', p.pay_terms_days ?? 60, { type: 'number' })}</div><div class="subonly" ${dev ? 'hidden' : ''}>${field('תקורה (% מהעלות הישירה)', 'overhead_pct', ov, { type: 'number' })}</div>
  </div><div class="subonly" ${dev ? 'hidden' : ''}><h3 style="margin:6px 0 10px">ניכויים מהחשבונות</h3><div class="grid g4">
  ${field('עיכבון %', 'retention_pct', p.retention_pct ?? 5, { type: 'number' })}${field('תקרת עיכבון ₪', 'retention_cap', p.retention_cap, { type: 'number' })}
  ${field('ביטוח %', 'insurance_pct', p.insurance_pct ?? 0, { type: 'number' })}${field('הוצאות משותפות %', 'shared_pct', p.shared_pct ?? 0, { type: 'number' })}
  ${field('ניכוי מס במקור %', 'tax_pct', p.tax_pct ?? 0, { type: 'number' })}</div></div>
  ${modulesFieldset(p, { isNew })}
  <div class="idxonly" ${(isNew ? false : mods(p).index) ? '' : 'hidden'}><div class="grid g2">${field('מדד בסיס של הפרויקט (מדד תשומות הבנייה)', 'base_index', p.base_index, { type: 'number', attrs: 'step="any" dir="ltr"' })}<p class="small mut" style="align-self:end">החוזה צמוד למדד. המדד של כל חודש מוזן פעם אחת לכל הפרויקטים, ב"הגדרות לקוח ומשתמשים".</p></div></div>
  <div class="devonly" ${dev ? '' : 'hidden'}><h3 style="margin:10px 0 6px">אישור הוראות שינוי</h3><p class="small mut" style="margin:0 0 6px">היזם שמאשר בחתימה. הבקשה לאישור נשלחת למייל הזה, עם קישור לחתימה.</p>
  <div class="grid g2">${field('שם המאשר מטעם היזם', 'approver_name', p.approver_name || '')}${field('מייל לאישורים', 'approver_email', p.approver_email || '', { attrs: 'dir="ltr" inputmode="email"' })}</div></div>
  <h3 style="margin:10px 0 6px">נמענים להתרעות בפרויקט</h3><p class="small mut" style="margin:0 0 6px">לכפתורי הוואטסאפ והמייל ליד כל התרעה. ריק = הנמענים בהגדרות הלקוח.</p>
  <div class="grid g3">${field('איש קשר אצל הלקוח', 'notify_name', p.notify_name || '')}${field('נייד לוואטסאפ', 'notify_phone', p.notify_phone || '', { attrs: 'dir="ltr" inputmode="tel"' })}${field('מיילים (מופרדים בפסיק)', 'notify_emails', p.notify_emails || '', { attrs: 'dir="ltr"' })}</div>`;
}

export async function projectRow(v, mcs, type = null) {
  let mcId = v.main_contractor_id;
  if (mcId === '__new') {
    const m = await modal({ title: 'קבלן ראשי חדש', body: mcForm(), validate: d => !d.name.trim() && 'חסר שם' });
    if (m) { const [r] = await db.insert('main_contractors', { tenant_id: S.tenantId, ...m, pay_terms_days: Math.round(n(m.pay_terms_days)) }); mcId = r.id; mcs.push(r); }
    else mcId = null;
  }
  const row = {
    name: v.name.trim(), main_contractor_id: nullIfEmpty(mcId), address: v.address, owner_name: v.owner_name,
    start_date: nullIfEmpty(v.start_date), end_date: nullIfEmpty(v.end_date), contract_type: v.contract_type, status: v.status,
    pay_terms_days: Math.round(n(v.pay_terms_days)), overhead_pct: n(v.overhead_pct), retention_pct: n(v.retention_pct), retention_cap: numOrNull(v.retention_cap),
    insurance_pct: n(v.insurance_pct), shared_pct: n(v.shared_pct), tax_pct: n(v.tax_pct), base_index: numOrNull(v.base_index),
    notify_name: v.notify_name?.trim() || null, notify_phone: v.notify_phone?.trim() || null, notify_emails: v.notify_emails?.trim() || null
  };
  if ('approver_email' in v) { row.approver_name = v.approver_name?.trim() || null; row.approver_email = v.approver_email?.trim() || null; }
  if (v.project_type) row.project_type = v.project_type;
  const t = v.project_type || type || 'sub';
  if (Object.keys(v).some(k => k.startsWith('mod_'))) { row.modules = readModules(v, t); row.indexation = !!row.modules.index; }
  return row;
}

// בחירת סוג פרויקט: שדות של קבלן משנה מוסתרים בפרויקט יזם
export function wireProjectType(el) {
  const sync = () => { const t = $('[name=project_type]:checked', el)?.value; if (!t) return; const dev = t === 'dev';
    $$('.subonly', el).forEach(x => x.hidden = dev); $$('.devonly', el).forEach(x => x.hidden = !dev);
    const hint = $('#ptyhint', el); if (hint) hint.textContent = dev ? 'פרויקט יזם: תקציב לפי פרקים וסעיפים, התקשרויות עם קבלנים, ספקים ויועצים, חשבונות שלהם ותקבולים.' : 'פרויקט קבלן משנה: כתב כמויות מול הקבלן הראשי, תמחיר, עובדים, רכש וחשבונות.';
    const own = $('[name=owner_name]', el)?.closest('.fld')?.querySelector('span'); if (own) own.textContent = dev ? 'יזם / בעלים' : 'מזמין / יזם'; };
  $$('[name=project_type]', el).forEach(r => r.onchange = () => { sync(); syncModulesType(el, $('[name=project_type]:checked', el).value); }); sync();
  wireModules(el);
}
// מודול הצמדה: שדה מדד הבסיס מופיע רק כשהמודול דלוק
export function wireModules(el) {
  const idx = $('[name=mod_index]', el), box = $('.idxonly', el);
  const upd = () => { if (box) box.hidden = !idx?.checked; };
  if (idx) idx.addEventListener('change', upd); upd();
  $$('.modrow input', el).forEach(i => i.addEventListener('change', () => { i.closest('.modrow').dataset.touched = '1'; }));
}

export async function newProject(mcs) {
  const v = await modal({ title: 'פרויקט חדש', body: projectForm({}, mcs, { isNew: true }), wide: true, onMount: wireProjectType, validate: d => !d.name.trim() && 'חסר שם פרויקט' });
  if (!v) return;
  const row = await projectRow(v, mcs);
  if (row.project_type === 'dev') Object.assign(row, { main_contractor_id: null, retention_pct: 0, insurance_pct: 0, shared_pct: 0, tax_pct: 0, overhead_pct: 0 });
  const [p] = await db.insert('projects', { tenant_id: S.tenantId, ...row });
  toast(row.project_type === 'dev' ? 'הפרויקט נוסף. השלב הבא: קליטת התקציב' : 'הפרויקט נוסף. השלב הבא: כתב כמויות');
  location.hash = `#/project/${p.id}/boq`;
}

export async function viewProjects(arg) {
  if (!S.tenantId) return h('<div class="empty">בחר לקוח</div>');
  const data = await loadTenantData();
  const mcName = id => data.mcs.find(m => m.id === id)?.name || '';
  const el = h(`<div><div class="top"><div><h1>פרויקטים</h1><div class="sub">${data.projects.length} פרויקטים${data.projects.some(p => !isDev(p)) ? ' · ' + modeLine() : ''}</div></div>
    <div class="actions" id="ab">${can.edit() ? '<button class="btn" id="add">+ פרויקט חדש</button>' : ''}</div></div><div id="body"></div></div>`);
  if (can.prices() && data.projects.some(p => !isDev(p))) $('#ab', el).prepend(modeSwitch());
  $('#add', el)?.addEventListener('click', () => newProject(data.mcs));
  // #/projects/new (מהכפתור "+ פרויקט חדש" בדף הבית ובראש הפרויקט): פותח את החלון מיד
  if (arg === 'new' && can.edit()) el.addEventListener('mounted', () => { history.replaceState(null, '', '#/projects'); newProject(data.mcs); });
  const body = $('#body', el);
  if (!data.projects.length) { body.innerHTML = '<div class="card empty">אין פרויקטים עדיין</div>'; return el; }
  if (!can.prices()) {
    body.innerHTML = `<div class="card">${data.projects.map(p => `<a class="proj" href="#/project/${p.id}/field"><div class="hd">${esc(p.name)}</div><div class="meta">${esc(p.address || '')}</div></a>`).join('')}</div>`;
    return el;
  }
  const subs = data.projects.filter(p => !isDev(p)), devs = data.projects.filter(isDev);
  const rows = subs.map(p => ({ p, s: summarize(projData(data, p.id)) }));
  body.innerHTML = (subs.length ? `${devs.length ? '<h2>פרויקטים של קבלן משנה</h2>' : ''}<div class="tw"><table><thead><tr><th>פרויקט</th><th class="hide-m">קבלן ראשי</th><th class="hide-m">סטטוס</th><th class="n">מכירה</th><th class="n">צפי עלות</th><th class="n">רווח צפוי</th><th class="n">% רווח</th><th class="n hide-m">ביצוע</th><th class="n">חריגה</th></tr></thead><tbody>
  ${rows.map(({ p, s }) => { const t = s.total, a = rowAttr(t.overrun); return `<tr class="click ${a.cls}"${a.style} data-p="${p.id}"><td><b>${esc(p.name)}</b> ${moduleTags(p)}<div class="small mut">${CONTRACT[p.contract_type]} · ${fmtDate(p.start_date)}</div></td><td class="hide-m">${esc(mcName(p.main_contractor_id))}</td><td class="hide-m">${STATUS[p.status]}</td>
    <td class="n">${money(t.sale)}</td><td class="n">${money(t.forecast)}</td><td class="n">${money(t.profit)}</td><td class="n">${pct(t.profitPct)}</td><td class="n hide-m">${pct(t.progress, { d: 0 })}</td><td class="n">${pct(t.overrun, { sign: true })}${a.crit ? '<span class="crit">קריטי</span>' : ''}</td></tr>`; }).join('')}
  </tbody></table></div>` : '') + (devs.length ? devTable(data, devs, !!subs.length) : '');
  $$('[data-p]', body).forEach(r => r.onclick = () => location.hash = `#/project/${r.dataset.p}/control`);
  return el;
}

function devTable(data, devs, titled) {
  const rows = devs.map(p => { const pd = projData(data, p.id); return { p, s: devSummary({ project: p, items: pd.items, contracts: pd.contracts, cLines: pd.cLines, expenses: pd.expenses, fixedCosts: pd.fixedCosts }) }; });
  return `${titled ? '<h2 style="margin-top:18px">פרויקטי יזם</h2>' : ''}<div class="tw"><table><thead><tr><th>פרויקט</th><th class="hide-m">יזם / בעלים</th><th class="hide-m">סטטוס</th><th class="n">תקציב</th><th class="n hide-m">התקשרויות</th><th class="n">צפי לסיום</th><th class="n hide-m">שולם</th><th class="n">סטייה מהתקציב</th></tr></thead><tbody>
  ${rows.map(({ p, s }) => { const t = s.total, a = rowAttr(t.dev); return `<tr class="click ${a.cls}"${a.style} data-p="${p.id}"><td><b>${esc(p.name)}</b> ${moduleTags(p)}<div class="small mut">${PROJECT_TYPES.dev}${s.baselineAt ? ' · בסיס נעול' : ''}</div></td><td class="hide-m">${esc(p.owner_name || '')}</td><td class="hide-m">${STATUS[p.status]}</td>
    <td class="n">${money(t.budget)}</td><td class="n hide-m">${money(t.committed + t.outside)}</td><td class="n">${money(t.forecast)}</td><td class="n hide-m">${money(t.paid)}</td><td class="n">${pct(t.dev, { sign: true })}${a.crit ? '<span class="crit">קריטי</span>' : ''}</td></tr>`; }).join('')}
  </tbody></table></div>`;
}
