// עלויות חודשיות קבועות בפרויקט (מודול "קבועות"): מנהל עבודה, שמירה, מכולות, ביטוח וכו'.
// כל שורה = סכום קבוע לחודש, מחודש עד חודש. נכנסת לתזרים מהחודש הנוכחי, ולבקרה כהתקשרות על הסעיף שלה.
import { h, esc, $, $$, modal, field, area, toast, money, confirmBox } from '../util.js';
import { db } from '../db.js';
import { S, can, render, logChange } from '../app.js';
import { n } from '../calc.js';
import { fixedMonths, fixedTotal, fixedLeft } from '../modules.js';
import { expenseDialog } from './vo_exp.js';

const curMonth = () => new Date().toISOString().slice(0, 7);
const mFmt = m => (m ? m.split('-').reverse().join('/') : '');

export function fixedCostsCard(P) {
  const list = [...(P.pd.fixedCosts || [])].sort((a, b) => a.from_month.localeCompare(b.from_month) || a.name.localeCompare(b.name));
  const items = Object.fromEntries(P.pd.items.map(i => [i.id, i]));
  const cur = curMonth(), edit = can.expense();
  const active = list.filter(f => f.from_month <= cur && f.to_month >= cur);
  const monthly = active.reduce((a, f) => a + n(f.amount), 0);
  const left = list.reduce((a, f) => a + fixedLeft(f, cur), 0);
  const el = h(`<details class="card" ${list.length ? '' : 'open'} id="fixedcard"><summary><b>עלויות חודשיות קבועות</b> <span class="small mut">· ${list.length} שורות · החודש ${money(monthly)} · נשאר עד הסוף ${money(left)}</span></summary>
    ${edit ? '<div class="actions" style="margin:10px 0"><button class="btn small" type="button" id="addfc">+ עלות קבועה</button><span class="small mut">סכום קבוע לחודש, לפני מע"מ. נכנס לתזרים מהחודש הנוכחי ולבקרה כהתקשרות של הסעיף.</span></div>' : ''}
    <div class="tw"><table><thead><tr><th>עלות</th><th class="hide-m">סעיף</th><th class="n">לחודש</th><th>תקופה</th><th class="n hide-m">חודשים</th><th class="n">סה"כ</th><th class="n">נשאר</th>${edit ? '<th></th>' : ''}</tr></thead><tbody>
    ${list.map(f => { const on = f.from_month <= cur && f.to_month >= cur, it = items[f.boq_item_id];
      return `<tr class="${f.to_month < cur ? 'mut' : ''}"><td><b>${esc(f.name)}</b>${on ? ' <span class="chip green">פעיל</span>' : ''}<div class="small mut">${esc(f.supplier_name || '')}${f.vat === false ? ' · בלי מע"מ' : ''}</div></td>
        <td class="hide-m wrap small">${it ? esc(`${it.code || ''} ${it.description}`.slice(0, 60)) : '<span class="mut">כללי</span>'}</td>
        <td class="n">${money(f.amount)}</td><td class="nw">${mFmt(f.from_month)} – ${mFmt(f.to_month)}</td><td class="n hide-m">${fixedMonths(f).length}</td>
        <td class="n">${money(fixedTotal(f))}</td><td class="n">${money(fixedLeft(f, cur))}</td>
        ${edit ? `<td class="nw">${on ? `<button class="btn small ghost" data-fexp="${f.id}" title="פותח הוצאה חדשה עם הספק, הסכום והסעיף">רישום חשבונית</button> ` : ''}<button class="btn small ghost" data-fed="${f.id}">עריכה</button></td>` : ''}</tr>`; }).join('')
      || `<tr><td colspan="${edit ? 8 : 7}" class="empty">אין עלויות קבועות. למשל: מנהל עבודה, שמירה, מכולות, ביטוח.</td></tr>`}
    ${list.length ? `<tr class="tot"><td>סה"כ</td><td class="hide-m"></td><td class="n">${money(monthly)}</td><td></td><td class="hide-m"></td><td class="n">${money(list.reduce((a, f) => a + fixedTotal(f), 0))}</td><td class="n">${money(left)}</td>${edit ? '<td></td>' : ''}</tr>` : ''}
    </tbody></table></div>
    <p class="small mut">החשבוניות עצמן נרשמות כהוצאה רגילה (הכפתור "רישום חשבונית" ממלא אותה). התזרים מציג את העלות הקבועה רק מהחודש הנוכחי והלאה, כדי שלא תיספר פעמיים עם הוצאות שכבר נרשמו.</p></details>`);
  $('#addfc', el)?.addEventListener('click', () => fixedDialog(P));
  $$('[data-fed]', el).forEach(b => b.onclick = () => fixedDialog(P, list.find(f => f.id === b.dataset.fed)));
  $$('[data-fexp]', el).forEach(b => b.onclick = () => { const f = list.find(x => x.id === b.dataset.fexp);
    expenseDialog(P, null, { supplier_name: f.supplier_name || f.name, amount: n(f.amount), boq_item_id: f.boq_item_id || null, kind: 'general', status: 'invoice', description: `${f.name} · ${mFmt(cur)}`, vat_pct: f.vat === false ? 0 : undefined }); });
  return el;
}

async function fixedDialog(P, f = null) {
  const items = P.pd.items.filter(i => !i.variation_id);
  const dev = P.project.project_type === 'dev';
  const cur = curMonth();
  const endM = P.project.end_date ? String(P.project.end_date).slice(0, 7) : '';
  const body = `<div class="grid g2">${field('שם העלות', 'name', f?.name || '', { req: true, hint: 'למשל: מנהל עבודה, שמירה, מכולה' })}${field('ספק / נותן שירות', 'supplier_name', f?.supplier_name || '')}</div>
    <div class="grid g3">${field('סכום לחודש ₪ (לפני מע"מ)', 'amount', f?.amount ?? '', { type: 'number', req: true })}${field('מחודש', 'from_month', f?.from_month || cur, { type: 'month', req: true })}${field('עד חודש', 'to_month', f?.to_month || endM || cur, { type: 'month', req: true, hint: endM ? 'ברירת מחדל: סיום הפרויקט' : '' })}</div>
    <label class="fld"><span>${dev ? 'סעיף תקציב' : 'סעיף בכתב הכמויות'}</span><select name="boq_item_id"><option value="">${dev ? 'בלי סעיף (רק בתזרים)' : 'כללי לפרויקט (רק בתזרים)'}</option>${items.map(i => `<option value="${i.id}" ${f?.boq_item_id === i.id ? 'selected' : ''}>${esc(`${i.code || ''} ${i.description}`.slice(0, 70))}</option>`).join('')}</select>
      <small>עם סעיף: נספר בבקרה כהתקשרות של הסעיף. בלי סעיף: מופיע רק בתזרים.</small></label>
    <label class="chk"><input type="checkbox" name="vat" ${f?.vat === false ? '' : 'checked'}> חייב במע"מ</label>
    ${area('הערות', 'notes', f?.notes || '')}
    <div class="small mut" id="fcsum"></div>
    ${f ? '<label class="chk"><input type="checkbox" name="del"> מחיקת העלות הזאת</label>' : ''}`;
  const v = await modal({ title: f ? 'עריכת עלות קבועה' : 'עלות חודשית קבועה', body,
    onMount: d => { const upd = () => { const x = { amount: $('[name=amount]', d).value, from_month: $('[name=from_month]', d).value, to_month: $('[name=to_month]', d).value };
      const ok = /^\d{4}-\d{2}$/.test(x.from_month) && /^\d{4}-\d{2}$/.test(x.to_month) && x.to_month >= x.from_month;
      $('#fcsum', d).innerHTML = ok ? `${fixedMonths(x).length} חודשים · סה"כ ${money(fixedTotal(x))} · מהחודש הנוכחי ${money(fixedLeft(x, cur))}` : ''; };
      $$('input', d).forEach(i => i.addEventListener('input', upd)); upd(); },
    validate: d => d.del ? null : (!d.name.trim() && 'חסר שם') || (!(n(d.amount) > 0) && 'חסר סכום לחודש') || (!/^\d{4}-\d{2}$/.test(d.from_month || '') && 'חסר חודש התחלה') || (!/^\d{4}-\d{2}$/.test(d.to_month || '') && 'חסר חודש סיום') || (d.to_month < d.from_month && 'חודש הסיום לפני חודש ההתחלה') });
  if (!v) return;
  if (v.del) {
    if (!(await confirmBox('מחיקת עלות קבועה', `למחוק את "${f.name}"? ההוצאות שכבר נרשמו נשארות.`, 'מחיקה', true))) return;
    await db.remove('fixed_costs', f.id);
    await logChange({ project_id: P.id, entity: 'fixed_cost', entity_id: f.id, label: f.name, field: 'מחיקת עלות קבועה', old_value: f.amount });
    toast('נמחק'); return render();
  }
  const row = { name: v.name.trim(), supplier_name: v.supplier_name.trim() || null, amount: n(v.amount), from_month: v.from_month, to_month: v.to_month, boq_item_id: v.boq_item_id || null, vat: !!v.vat, notes: v.notes || null };
  if (f) {
    await db.update('fixed_costs', f.id, row);
    for (const k of ['amount', 'from_month', 'to_month']) if (String(f[k]) !== String(row[k])) await logChange({ project_id: P.id, entity: 'fixed_cost', entity_id: f.id, label: row.name, field: { amount: 'סכום לחודש', from_month: 'מחודש', to_month: 'עד חודש' }[k], old_value: f[k], new_value: row[k] });
  } else await db.insert('fixed_costs', { tenant_id: S.tenantId, project_id: P.id, ...row });
  toast('נשמר'); render();
}
