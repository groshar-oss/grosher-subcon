// תבניות פרויקט: שומרים פרויקט קיים כתבנית (מבנה, סעיפים, תמחיר, מודולים, עלויות קבועות) ופותחים ממנה פרויקט חדש
import { esc, $, $$, modal, field, toast, confirmBox } from '../util.js';
import { db } from '../db.js';
import { S, logChange } from '../app.js';
import { n } from '../calc.js';
import { addMonths } from '../cashflow.js';

const SKIP = ['id', 'tenant_id', 'project_id', 'boq_item_id', 'created_at', 'variation_id'];
const pick = (o, extra = []) => Object.fromEntries(Object.entries(o).filter(([k]) => !SKIP.includes(k) && !extra.includes(k)));
const monthsLen = fc => { const [a, b] = [fc.from_month, fc.to_month].map(m => m.split('-').map(Number)); return Math.max(1, (b[0] - a[0]) * 12 + b[1] - a[1] + 1); };

export async function loadTemplates() { return db.select('project_templates', { eq: { tenant_id: S.tenantId }, order: 'name' }).catch(() => []); }

/** שמירת פרויקט כתבנית */
export async function saveTemplateDialog(P) {
  const p = P.project, dev = p.project_type === 'dev';
  const items = (P.pd.items || []).filter(i => !i.variation_id), lines = P.pd.lines || [], fixed = P.pd.fixedCosts || [];
  const v = await modal({ title: 'שמירה כתבנית', body: `<p class="small mut">פרויקט חדש שייפתח מהתבנית יקבל את מה שמסומן כאן. הוצאות, חשבונות, יומן ורוכשים לא עוברים.</p>
    ${field('שם התבנית', 'name', `${p.name} (תבנית)`, { req: true })}
    <label class="chk"><input type="checkbox" name="i_items" ${items.length ? 'checked' : 'disabled'}> ${dev ? 'סעיפי התקציב' : 'סעיפי כתב הכמויות'} (${items.length})</label>
    <label class="chk" style="margin-inline-start:22px"><input type="checkbox" name="i_prices" checked> עם מחירים</label>
    <label class="chk" style="margin-inline-start:22px"><input type="checkbox" name="i_qty"> עם כמויות</label>
    ${dev ? '' : `<label class="chk"><input type="checkbox" name="i_lines" ${lines.length ? 'checked' : 'disabled'}> תמחיר הסעיפים (${lines.length} שורות)</label>`}
    <label class="chk"><input type="checkbox" name="i_fixed" ${fixed.length ? 'checked' : 'disabled'}> עלויות חודשיות קבועות (${fixed.length})</label>
    <label class="chk"><input type="checkbox" name="i_settings" checked> מודולים והגדרות (תקורה, ריטנשן, פריסה${dev ? ', לוח תשלומים ותנאי ליווי' : ''})</label>`,
    validate: d => !d.name.trim() && 'חסר שם' });
  if (!v) return;
  const keyOf = new Map(items.map((it, k) => [it.id, k]));
  const data = { items: [], lines: [], fixed: [], settings: null };
  if (v.i_items) data.items = items.map((it, k) => ({ key: k, ...pick(it, ['progress_pct', 'forecast_manual', 'forecast_note']), qty: v.i_qty ? it.qty : null, unit_price: v.i_prices ? it.unit_price : null }));
  if (v.i_items && v.i_lines) data.lines = lines.filter(l => keyOf.has(l.boq_item_id)).map(l => ({ item_key: keyOf.get(l.boq_item_id), ...pick(l), qty: v.i_qty ? l.qty : null }));
  if (v.i_fixed) data.fixed = fixed.map(fc => ({ ...pick(fc, ['from_month', 'to_month', 'notes']), months: monthsLen(fc), item_key: keyOf.get(fc.boq_item_id) ?? null }));
  if (v.i_settings) data.settings = { modules: p.modules || null, overhead_pct: p.overhead_pct, retention_pct: p.retention_pct, insurance_pct: p.insurance_pct, shared_pct: p.shared_pct, tax_pct: p.tax_pct, contract_type: p.contract_type,
    spread: p.spread ? { curve: p.spread.curve, floors: [] } : null, sales: p.sales ? { ...p.sales, from_month: '', plan: (p.sales.plan || []).map(l => ({ ...l, month: '' , offset: l.month ? null : l.offset })) } : null, bank: p.bank || null };
  await db.insert('project_templates', { tenant_id: S.tenantId, name: v.name.trim(), project_type: p.project_type || 'sub', data, created_by: S.user?.email || '' });
  await logChange({ project_id: p.id, entity: 'project', entity_id: p.id, label: 'תבניות', field: 'נשמר כתבנית', new_value: v.name.trim() });
  toast('התבנית נשמרה. בפרויקט חדש בוחרים אותה בראש החלון');
}

/** שדה בחירת תבנית בחלון פרויקט חדש */
export const templatePicker = tpls => tpls.length ? `<label class="fld"><span>פתיחה מתבנית (רשות)</span><select name="tpl"><option value="">בלי תבנית</option>${tpls.map(t => `<option value="${t.id}">${esc(t.name)}</option>`).join('')}</select>
  <small>הסוג, המודולים וההגדרות מתמלאים מהתבנית. הסעיפים והתמחיר נוצרים אחרי השמירה.</small></label>` : '';

export function wireTemplatePicker(el, tpls) {
  const s = $('[name=tpl]', el); if (!s) return;
  s.onchange = () => {
    const t = tpls.find(x => x.id === s.value); if (!t) return;
    const r = $(`[name=project_type][value=${t.project_type}]`, el); if (r) { r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); }
    const st = t.data?.settings;
    if (st?.modules) for (const [k, on] of Object.entries(st.modules)) { const c = $(`[name=mod_${k}]`, el); if (c && c.checked !== !!on) { c.checked = !!on; c.dispatchEvent(new Event('change', { bubbles: true })); } }
    if (st) for (const k of ['overhead_pct', 'retention_pct', 'insurance_pct', 'shared_pct', 'tax_pct']) { const i = $(`[name=${k}]`, el); if (i && st[k] != null) i.value = st[k]; }
    if (st?.contract_type) { const c = $('[name=contract_type]', el); if (c) c.value = st.contract_type; }
  };
}

/** אחרי יצירת הפרויקט: סעיפים, תמחיר, עלויות קבועות והגדרות שאין להן שדה בחלון */
export async function applyTemplate(t, p) {
  const D = t.data || {}, st = D.settings || {};
  const patch = {};
  if (st.spread) patch.spread = st.spread;
  if (st.sales) patch.sales = st.sales;
  if (st.bank) patch.bank = st.bank;
  if (Object.keys(patch).length) await db.update('projects', p.id, patch);
  const ids = {};
  if (D.items?.length) {
    const rows = await db.insert('boq_items', D.items.map(({ key, ...it }) => ({ ...it, tenant_id: S.tenantId, project_id: p.id })));
    D.items.forEach((it, k) => { ids[it.key] = rows[k]?.id; });
  }
  const lines = (D.lines || []).filter(l => ids[l.item_key]);
  if (lines.length) await db.insert('cost_lines', lines.map(({ item_key, ...l }) => ({ ...l, tenant_id: S.tenantId, project_id: p.id, boq_item_id: ids[item_key] })));
  const m0 = (p.start_date || new Date().toISOString()).slice(0, 7);
  if (D.fixed?.length) await db.insert('fixed_costs', D.fixed.map(({ months, item_key, ...fc }) => ({ ...fc, tenant_id: S.tenantId, project_id: p.id, from_month: m0, to_month: addMonths(m0, Math.max(1, n(months)) - 1), boq_item_id: ids[item_key] || null })));
  await logChange({ project_id: p.id, entity: 'project', entity_id: p.id, label: 'תבניות', field: 'נפתח מתבנית', new_value: t.name });
}

/** כרטיס ניהול תבניות בהגדרות הלקוח */
export function templatesCard(tpls) {
  return `<div class="card"><h2>תבניות פרויקט</h2>
    <p class="small mut">שומרים פרויקט כתבנית בהגדרות הפרויקט ← "שמירה כתבנית". בפרויקט חדש בוחרים אותה בראש החלון.</p>
    ${tpls.length ? `<div class="tw" style="box-shadow:none"><table><thead><tr><th>תבנית</th><th>סוג</th><th class="n">סעיפים</th><th></th></tr></thead><tbody>
      ${tpls.map(t => `<tr><td><b>${esc(t.name)}</b><div class="small mut">${esc(t.created_by || '')}</div></td><td>${t.project_type === 'dev' ? 'יזם' : t.project_type === 'exec' ? 'ביצוע' : 'קבלן משנה'}</td><td class="n">${(t.data?.items || []).length}</td>
        <td class="nw"><button class="btn small ghost" data-tren="${t.id}">שינוי שם</button> <button class="btn small ghost" data-tdel="${t.id}" aria-label="מחיקה">✕</button></td></tr>`).join('')}</tbody></table></div>` : '<p class="empty small">אין תבניות עדיין</p>'}</div>`;
}
export function wireTemplatesCard(el, tpls, after) {
  $$('[data-tdel]', el).forEach(b => b.onclick = async () => { const t = tpls.find(x => x.id === b.dataset.tdel);
    if (!(await confirmBox('מחיקת תבנית', `למחוק את התבנית "${t.name}"? פרויקטים שכבר נפתחו ממנה לא משתנים.`, 'מחיקה', true))) return;
    await db.remove('project_templates', t.id); toast('נמחק'); after(); });
  $$('[data-tren]', el).forEach(b => b.onclick = async () => { const t = tpls.find(x => x.id === b.dataset.tren);
    const v = await modal({ title: 'שינוי שם תבנית', body: field('שם', 'name', t.name, { req: true }), validate: d => !d.name.trim() && 'חסר שם' });
    if (!v) return; await db.update('project_templates', t.id, { name: v.name.trim() }); toast('נשמר'); after(); });
}
