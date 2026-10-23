// רשימת פרויקטים והקמת פרויקט
import { h, esc, $, $$, modal, field, select, toast, money, pct, numOrNull, nullIfEmpty, fmtDate } from '../util.js';
import { db } from '../db.js';
import { S, can, loadTenantData, modeSwitch, settings, render } from '../app.js';
import { n } from '../calc.js';
import { STATUS, CONTRACT, projData, summarize, rowAttr, modeLine } from './common.js';
import { mcForm } from './clients.js';

export function projectForm(p = {}, mcs = []) {
  const ov = p.overhead_pct ?? settings().overhead_pct;
  return `<div class="grid g2">
  ${field('שם הפרויקט', 'name', p.name, { req: true })}
  <label class="fld"><span>קבלן ראשי</span><select name="main_contractor_id"><option value="">ללא</option>${mcs.map(m => `<option value="${m.id}" ${m.id === p.main_contractor_id ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}<option value="__new">+ קבלן ראשי חדש…</option></select></label>
  ${field('כתובת', 'address', p.address)}${field('מזמין / יזם', 'owner_name', p.owner_name)}
  ${field('תאריך התחלה', 'start_date', p.start_date, { type: 'date' })}${field('תאריך סיום', 'end_date', p.end_date, { type: 'date' })}
  ${select('סוג חוזה', 'contract_type', CONTRACT, p.contract_type || 'measure')}${select('סטטוס', 'status', STATUS, p.status || 'active')}
  ${field('תנאי תשלום (שוטף + ימים)', 'pay_terms_days', p.pay_terms_days ?? 60, { type: 'number' })}${field('תקורה (% מהעלות הישירה)', 'overhead_pct', ov, { type: 'number' })}
  </div><h3 style="margin:6px 0 10px">ניכויים מהחשבונות</h3><div class="grid g4">
  ${field('עיכבון %', 'retention_pct', p.retention_pct ?? 5, { type: 'number' })}${field('תקרת עיכבון ₪', 'retention_cap', p.retention_cap, { type: 'number' })}
  ${field('ביטוח %', 'insurance_pct', p.insurance_pct ?? 0, { type: 'number' })}${field('הוצאות משותפות %', 'shared_pct', p.shared_pct ?? 0, { type: 'number' })}
  ${field('ניכוי מס במקור %', 'tax_pct', p.tax_pct ?? 0, { type: 'number' })}</div>
  <label class="chk"><input type="checkbox" name="indexation" ${p.indexation ? 'checked' : ''}> חוזה צמוד למדד תשומות הבנייה</label>
  ${field('מדד בסיס', 'base_index', p.base_index, { type: 'number' })}`;
}

export async function projectRow(v, mcs) {
  let mcId = v.main_contractor_id;
  if (mcId === '__new') {
    const m = await modal({ title: 'קבלן ראשי חדש', body: mcForm(), validate: d => !d.name.trim() && 'חסר שם' });
    if (m) { const [r] = await db.insert('main_contractors', { tenant_id: S.tenantId, ...m, pay_terms_days: Math.round(n(m.pay_terms_days)) }); mcId = r.id; mcs.push(r); }
    else mcId = null;
  }
  return {
    name: v.name.trim(), main_contractor_id: nullIfEmpty(mcId), address: v.address, owner_name: v.owner_name,
    start_date: nullIfEmpty(v.start_date), end_date: nullIfEmpty(v.end_date), contract_type: v.contract_type, status: v.status,
    pay_terms_days: Math.round(n(v.pay_terms_days)), overhead_pct: n(v.overhead_pct), retention_pct: n(v.retention_pct), retention_cap: numOrNull(v.retention_cap),
    insurance_pct: n(v.insurance_pct), shared_pct: n(v.shared_pct), tax_pct: n(v.tax_pct), indexation: !!v.indexation, base_index: numOrNull(v.base_index)
  };
}

export async function newProject(mcs) {
  const v = await modal({ title: 'פרויקט חדש', body: projectForm({}, mcs), wide: true, validate: d => !d.name.trim() && 'חסר שם פרויקט' });
  if (!v) return;
  const row = await projectRow(v, mcs);
  const [p] = await db.insert('projects', { tenant_id: S.tenantId, ...row });
  toast('הפרויקט נוסף. השלב הבא: כתב כמויות');
  location.hash = `#/project/${p.id}/boq`;
}

export async function viewProjects() {
  if (!S.tenantId) return h('<div class="empty">בחרי לקוח</div>');
  const data = await loadTenantData();
  const mcName = id => data.mcs.find(m => m.id === id)?.name || '';
  const el = h(`<div><div class="top"><div><h1>פרויקטים</h1><div class="sub">${data.projects.length} פרויקטים · ${modeLine()}</div></div>
    <div class="actions" id="ab">${can.edit() ? '<button class="btn" id="add">+ פרויקט חדש</button>' : ''}</div></div><div id="body"></div></div>`);
  if (can.prices()) $('#ab', el).prepend(modeSwitch());
  $('#add', el)?.addEventListener('click', () => newProject(data.mcs));
  const body = $('#body', el);
  if (!data.projects.length) { body.innerHTML = '<div class="card empty">אין פרויקטים עדיין</div>'; return el; }
  if (!can.prices()) {
    body.innerHTML = `<div class="card">${data.projects.map(p => `<a class="proj" href="#/project/${p.id}/field"><div class="hd">${esc(p.name)}</div><div class="meta">${esc(p.address || '')}</div></a>`).join('')}</div>`;
    return el;
  }
  const rows = data.projects.map(p => ({ p, s: summarize(projData(data, p.id)) }));
  body.innerHTML = `<div class="tw"><table><thead><tr><th>פרויקט</th><th class="hide-m">קבלן ראשי</th><th class="hide-m">סטטוס</th><th class="n">מכירה</th><th class="n">צפי עלות</th><th class="n">רווח צפוי</th><th class="n">%</th><th class="n hide-m">ביצוע</th><th class="n">חריגה</th></tr></thead><tbody>
  ${rows.map(({ p, s }) => { const t = s.total, a = rowAttr(t.overrun); return `<tr class="click ${a.cls}"${a.style} data-p="${p.id}"><td><b>${esc(p.name)}</b><div class="small mut">${CONTRACT[p.contract_type]} · ${fmtDate(p.start_date)}</div></td><td class="hide-m">${esc(mcName(p.main_contractor_id))}</td><td class="hide-m">${STATUS[p.status]}</td>
    <td class="n">${money(t.sale)}</td><td class="n">${money(t.forecast)}</td><td class="n">${money(t.profit)}</td><td class="n">${pct(t.profitPct)}</td><td class="n hide-m">${pct(t.progress, { d: 0 })}</td><td class="n">${pct(t.overrun, { sign: true })}${a.crit ? '<span class="crit">קריטי</span>' : ''}</td></tr>`; }).join('')}
  </tbody></table></div>`;
  $$('[data-p]', body).forEach(r => r.onclick = () => location.hash = `#/project/${r.dataset.p}/control`);
  return el;
}
