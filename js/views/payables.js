// מסך תשלומים לספקים: מה פתוח לתשלום ומתי, אישור ותשלום של כמה חשבוניות יחד, יתרות לפי ספק וייצוא לאקסל
import { h, esc, $, $$, money, fmtDate, toast, modal, field, select, confirmBox, store } from '../util.js';
import { db } from '../db.js';
import { S, can, loadTenantData, render, settings, logChange, tenant } from '../app.js';
import { n, EXPENSE_STATUS } from '../calc.js';
import { payableRows, payTotals, vendorBalances, PAY_METHODS, withVat } from '../payables.js';
import { attachBtn, wireAttach } from '../files.js';
import { loadXLSX } from '../import.js';

const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);

export async function viewPayables(tab = 'open') {
  if (!can.expense()) return h('<div class="card empty">אין הרשאה</div>');
  const data = await loadTenantData();
  const st = settings(), t = today();
  const rows = payableRows(data, { terms: st.supplier_terms_days, vat: st.vat_pct, today: t });
  const T = payTotals(rows);
  const F = { p: store('subcon-pay-p') || '', q: '', when: store('subcon-pay-when') || 'all' };
  const sel = new Set();
  const el = h(`<div><div class="top"><div><h1>תשלומים לספקים</h1><div class="sub">חשבוניות של ספקים וקבלני ביצוע שעוד לא שולמו, לפי מועד התשלום · סכומים כולל מע"מ</div></div></div>
    <nav class="tabs"><a href="#/payables" class="${tab === 'open' ? 'on' : ''}">לתשלום <span class="badge ${T.nOverdue ? 'red' : ''}">${rows.length}</span></a><a href="#/payables/vendors" class="${tab === 'vendors' ? 'on' : ''}">יתרות לפי ספק</a><a href="#/payables/paid" class="${tab === 'paid' ? 'on' : ''}">שולמו לאחרונה</a></nav>
    <div id="pt"></div></div>`);
  const body = $('#pt', el);
  if (tab === 'vendors') { body.appendChild(vendorsTab(data, st)); return el; }
  if (tab === 'paid') { body.appendChild(paidTab(data, st)); return el; }

  body.appendChild(h(`<div><div class="kpis">
      <div class="kpi"><div class="l">פתוח לתשלום</div><div class="v">${money(T.all)}</div><div class="n">${rows.length} חשבוניות</div></div>
      <div class="kpi"><div class="l">באיחור</div><div class="v ${T.nOverdue ? 'neg' : 'pos'}">${money(T.overdue)}</div><div class="n">${T.nOverdue} חשבוניות</div></div>
      <div class="kpi"><div class="l">לתשלום ב-7 הימים הקרובים</div><div class="v">${money(T.week)}</div><div class="n">${T.nWeek} חשבוניות</div></div>
      <div class="kpi"><div class="l">אושר לתשלום</div><div class="v">${money(T.approved)}</div><div class="n">${T.nWarn ? `<span class="neg">${T.nWarn} עם אזהרה</span>` : 'אין אזהרות'}</div></div></div>
    <div class="actions" style="margin-bottom:10px">
      <select id="fp" style="width:auto"><option value="">כל הפרויקטים</option>${data.projects.map(p => `<option value="${p.id}" ${F.p === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>
      <div class="seg" id="fw">${[['all', 'הכול'], ['overdue', 'באיחור'], ['week', 'עד שבוע'], ['approved', 'אושר לתשלום'], ['warn', 'עם אזהרה']].map(([k, l]) => `<button type="button" data-w="${k}" class="${F.when === k ? 'on' : ''}">${l}</button>`).join('')}</div>
      <input id="fq" placeholder="חיפוש ספק או חשבונית" style="width:200px"><span class="sp"></span><button class="btn ghost small" id="xl">ייצוא לאקסל</button></div>
    <div class="paybar" id="bar" hidden><b id="bn"></b><span id="bs"></span><span class="sp"></span><button class="btn small ghost" id="ap">אישור לתשלום</button><button class="btn small" id="pd">סימון כשולם</button><button class="btn small ghost" id="clr">ניקוי בחירה</button></div>
    <div class="tw"><table><thead><tr><th><input type="checkbox" id="all" aria-label="בחירת הכול"></th><th>מועד תשלום</th><th>ספק</th><th class="hide-m">פרויקט</th><th class="hide-m">חשבונית</th><th class="n hide-m">לפני מע"מ</th><th class="n">כולל מע"מ</th><th>סטטוס</th><th></th></tr></thead><tbody id="tb"></tbody></table></div>
    <p class="small mut">מועד התשלום: תאריך שנקבע בהוצאה, אחרת שוטף + ימים לפי כרטיס הספק (או ${st.supplier_terms_days} יום לפי הגדרות הלקוח). עלות עובדים לא מופיעה כאן, היא בדוח הנוכחות.</p></div>`));

  const vis = () => rows.filter(r => (!F.p || r.e.project_id === F.p) && (F.when === 'all' || (F.when === 'overdue' && r.overdue) || (F.when === 'week' && r.thisWeek) || (F.when === 'approved' && r.e.status === 'approved') || (F.when === 'warn' && r.warn.length))
    && (!F.q || `${r.e.supplier_name} ${r.e.doc_no || ''} ${r.e.description || ''}`.includes(F.q)));
  const bar = () => { const rs = rows.filter(r => sel.has(r.e.id)); $('#bar', el).hidden = !rs.length;
    $('#bn', el).textContent = `נבחרו ${rs.length} חשבוניות`; $('#bs', el).textContent = ` · ${money(rs.reduce((a, r) => a + r.total, 0)).replace(/<[^>]+>/g, '')}`; };
  const draw = () => {
    const rs = vis();
    $('#tb', el).innerHTML = rs.map(r => { const e = r.e;
      return `<tr class="${r.overdue ? 'al-r' : r.thisWeek ? 'al-y' : ''}"><td><input type="checkbox" data-s="${e.id}" ${sel.has(e.id) ? 'checked' : ''} aria-label="בחירה"></td>
        <td>${r.due ? fmtDate(r.due) : '<span class="mut">אין תאריך</span>'}${r.overdue ? '<div class="small neg">באיחור</div>' : r.thisWeek ? '<div class="small">השבוע</div>' : ''}</td>
        <td><b>${esc(e.supplier_name || '')}</b>${r.warn.length ? `<div class="small neg">⚠ ${r.warn.map(esc).join(' · ')}</div>` : ''}<div class="small mut">${esc(e.description || '')}</div></td>
        <td class="hide-m small">${esc(r.project)}</td><td class="hide-m">${esc(e.doc_no || '')}<div class="small mut">${fmtDate(e.doc_date)}</div></td>
        <td class="n hide-m">${money(e.amount)}</td><td class="n"><b>${money(r.total)}</b></td><td><span class="chip ${e.status === 'approved' ? 'blue' : 'amber'}">${EXPENSE_STATUS[e.status]}</span></td>
        <td style="white-space:nowrap">${attachBtn(data.files, 'expenses', e.id, { projectId: e.project_id, docType: 'invoice', label: `${e.supplier_name || ''} ${e.doc_no || ''}`.trim() })} <button class="btn small ghost" data-due="${e.id}" title="שינוי מועד התשלום">מועד</button></td></tr>`; }).join('')
      || `<tr><td colspan="9" class="empty">${rows.length ? 'אין חשבוניות שמתאימות לסינון' : 'אין חשבוניות פתוחות לתשלום'}</td></tr>`;
    $$('[data-s]', el).forEach(c => c.onchange = () => { c.checked ? sel.add(c.dataset.s) : sel.delete(c.dataset.s); bar(); });
    $('#all', el).checked = rs.length > 0 && rs.every(r => sel.has(r.e.id));
    $$('[data-due]', el).forEach(b => b.onclick = () => dueDialog(rows.find(r => r.e.id === b.dataset.due)));
    wireAttach(el, data.files || [], render);
    bar();
  };
  $('#all', el).onchange = e => { vis().forEach(r => e.target.checked ? sel.add(r.e.id) : sel.delete(r.e.id)); draw(); };
  $('#fp', el).onchange = e => { F.p = e.target.value; store('subcon-pay-p', F.p); draw(); };
  $('#fq', el).oninput = e => { F.q = e.target.value.trim(); draw(); };
  $$('[data-w]', el).forEach(b => b.onclick = () => { F.when = b.dataset.w; store('subcon-pay-when', F.when); $$('[data-w]', el).forEach(x => x.classList.toggle('on', x === b)); draw(); });
  $('#clr', el).onclick = () => { sel.clear(); draw(); };
  $('#xl', el).onclick = () => exportRows(vis(), `תשלומים לספקים ${t}`);

  $('#ap', el).onclick = async () => {
    const rs = rows.filter(r => sel.has(r.e.id) && r.e.status !== 'approved');
    if (!rs.length) return toast('כל החשבוניות שנבחרו כבר מאושרות');
    if (!(await warnOk(rs, 'אישור לתשלום'))) return;
    for (const r of rs) { await db.update('expenses', r.e.id, { status: 'approved' });
      await logChange({ project_id: r.e.project_id, entity: 'expense', entity_id: r.e.id, label: `${r.e.supplier_name} ${r.e.doc_no || ''}`, field: 'סטטוס', old_value: EXPENSE_STATUS[r.e.status], new_value: EXPENSE_STATUS.approved }); }
    toast(`${rs.length} חשבוניות אושרו לתשלום`); render();
  };
  $('#pd', el).onclick = async () => {
    const rs = rows.filter(r => sel.has(r.e.id));
    if (!(await warnOk(rs, 'תשלום'))) return;
    const tot = rs.reduce((a, r) => a + r.total, 0);
    const v = await modal({ title: `סימון כשולם: ${rs.length} חשבוניות`, ok: 'סימון כשולם', body: `<p>סה"כ <b>${money(tot)}</b> כולל מע"מ${new Set(rs.map(r => r.e.supplier_name)).size === 1 ? ` ל${esc(rs[0].e.supplier_name)}` : ''}.</p>
      <div class="grid g2">${field('תאריך התשלום', 'pay_date', t, { type: 'date', req: true })}${select('אמצעי תשלום', 'pay_method', PAY_METHODS, 'transfer')}
      ${field('אסמכתא (מספר העברה / שיק)', 'pay_ref', '')}</div>`, validate: d => !d.pay_date && 'חסר תאריך' });
    if (!v) return;
    for (const r of rs) { await db.update('expenses', r.e.id, { status: 'paid', pay_date: v.pay_date, pay_method: v.pay_method, pay_ref: v.pay_ref || null });
      await logChange({ project_id: r.e.project_id, entity: 'expense', entity_id: r.e.id, label: `${r.e.supplier_name} ${r.e.doc_no || ''}`, field: 'תשלום', old_value: EXPENSE_STATUS[r.e.status], new_value: `שולם ${v.pay_date} ${PAY_METHODS[v.pay_method]} ${v.pay_ref || ''}`.trim() }); }
    toast(`${rs.length} חשבוניות סומנו כשולמו`); render();
  };
  draw();
  return el;
}

// אזהרות לפני אישור או תשלום
async function warnOk(rs, what) {
  const w = rs.filter(r => r.warn.length);
  if (!w.length) return true;
  const v = await modal({ title: `לבדוק לפני ${what}`, ok: 'להמשיך בכל זאת', danger: true,
    body: `<p>ב-${w.length} מהחשבוניות שנבחרו יש דברים לבדוק:</p><ul class="small">${w.map(r => `<li><b>${esc(r.e.supplier_name || '')} ${esc(r.e.doc_no || '')}</b>: ${r.warn.map(esc).join(' · ')}</li>`).join('')}</ul>
      <p class="small mut">ספק בלי אישור ניכוי מס בתוקף: לפי החוק צריך לנכות מס במקור מהתשלום.</p>` });
  return v !== null;
}

async function dueDialog(r) {
  const v = await modal({ title: `מועד תשלום: ${r.e.supplier_name} ${r.e.doc_no || ''}`, body: `${field('לשלם בתאריך', 'pay_date', r.due || '', { type: 'date' })}<p class="small mut">ריק = לפי תנאי התשלום של הספק.</p>` });
  if (!v) return;
  await db.update('expenses', r.e.id, { pay_date: v.pay_date || null });
  toast('המועד עודכן'); render();
}

function vendorsTab(data, st) {
  const bs = vendorBalances(data, { vat: st.vat_pct });
  const el = h(`<div><div class="actions" style="margin-bottom:10px"><input id="vq" placeholder="חיפוש ספק" style="width:200px"><span class="sp"></span><button class="btn ghost small" id="xl">ייצוא לאקסל</button></div>
    <div class="tw"><table id="vt"><thead><tr><th>ספק</th><th class="n">הוזמן</th><th class="n">חויב</th><th class="n">שולם</th><th class="n">פתוח לתשלום</th><th class="n">פתוח כולל מע"מ</th><th class="n hide-m">הוזמן ועוד לא חויב</th><th class="hide-m">תנאי תשלום</th></tr></thead><tbody id="tb"></tbody></table></div>
    <p class="small mut">סכומים לפני מע"מ, חוץ מהעמודה "פתוח כולל מע"מ". "הוזמן ועוד לא חויב" הוא התחייבות שעוד תגיע כחשבונית.</p></div>`);
  const draw = q => { $('#tb', el).innerHTML = bs.filter(b => !q || b.name.includes(q)).map(b => `<tr><td><b>${esc(b.name)}</b>${b.vendor ? '' : ' <span class="chip">אין כרטיס</span>'}<div class="small mut">${b.n} חשבוניות</div></td>
    <td class="n">${money(b.ordered)}</td><td class="n">${money(b.invoiced)}</td><td class="n">${money(b.paid)}</td><td class="n"><b>${money(b.open)}</b></td><td class="n">${money(b.openVat)}</td><td class="n hide-m">${money(b.commit)}</td>
    <td class="hide-m">שוטף+${b.vendor?.pay_terms_days ?? st.supplier_terms_days}</td></tr>`).join('') || '<tr><td colspan="8" class="empty">אין ספקים</td></tr>'; };
  $('#vq', el).oninput = e => draw(e.target.value.trim()); draw('');
  $('#xl', el).onclick = async () => { const XLSX = await loadXLSX(); const wb = XLSX.utils.book_new(); wb.Workbook = { Views: [{ RTL: true }] };
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(bs.map(b => ({ ספק: b.name, הוזמן: b.ordered, חויב: b.invoiced, שולם: b.paid, 'פתוח לתשלום': b.open, 'פתוח כולל מע"מ': b.openVat, 'הוזמן ועוד לא חויב': b.commit }))), 'יתרות ספקים');
    XLSX.writeFile(wb, `יתרות ספקים ${today()}.xlsx`); };
  return el;
}

function paidTab(data, st) {
  const since = new Date(Date.now() - 90 * 864e5).toISOString().slice(0, 10);
  const pname = id => data.projects.find(p => p.id === id)?.name || '';
  const ps = data.expenses.filter(e => e.status === 'paid' && e.kind !== 'labor' && (e.pay_date || e.doc_date || '') >= since).sort((a, b) => String(b.pay_date || b.doc_date).localeCompare(String(a.pay_date || a.doc_date)));
  const el = h(`<div><p class="small mut">תשלומים מ-90 הימים האחרונים. סימון בטעות? "ביטול" מחזיר את החשבונית ל"אושר".</p>
    <div class="tw"><table><thead><tr><th>שולם</th><th>ספק</th><th class="hide-m">פרויקט</th><th class="hide-m">חשבונית</th><th class="n">כולל מע"מ</th><th>אמצעי / אסמכתא</th><th></th></tr></thead><tbody>
    ${ps.map(e => `<tr><td>${fmtDate(e.pay_date || e.doc_date)}</td><td><b>${esc(e.supplier_name || '')}</b></td><td class="hide-m small">${esc(pname(e.project_id))}</td><td class="hide-m">${esc(e.doc_no || '')}</td>
      <td class="n">${money(withVat(e, st.vat_pct))}</td><td class="small">${esc(PAY_METHODS[e.pay_method] || '')} ${esc(e.pay_ref || '')}</td><td><button class="btn small ghost" data-un="${e.id}">ביטול</button></td></tr>`).join('') || '<tr><td colspan="7" class="empty">אין תשלומים ב-90 הימים האחרונים</td></tr>'}
    </tbody></table></div></div>`);
  $$('[data-un]', el).forEach(b => b.onclick = async () => { const e = data.expenses.find(x => x.id === b.dataset.un);
    if (!(await confirmBox('ביטול סימון תשלום', `להחזיר את ${e.supplier_name} ${e.doc_no || ''} ל"אושר לתשלום"?`, 'ביטול התשלום'))) return;
    await db.update('expenses', e.id, { status: 'approved', pay_date: null, pay_method: null, pay_ref: null });
    await logChange({ project_id: e.project_id, entity: 'expense', entity_id: e.id, label: `${e.supplier_name} ${e.doc_no || ''}`, field: 'תשלום', old_value: 'שולם', new_value: 'בוטל, חזר לאושר' });
    toast('הסימון בוטל'); render(); });
  return el;
}

async function exportRows(rs, name) {
  const XLSX = await loadXLSX(); const wb = XLSX.utils.book_new(); wb.Workbook = { Views: [{ RTL: true }] };
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rs.map(r => ({ 'מועד תשלום': r.due || '', ספק: r.e.supplier_name || '', פרויקט: r.project, חשבונית: r.e.doc_no || '', 'תאריך חשבונית': r.e.doc_date || '',
    'לפני מע"מ': n(r.e.amount), 'כולל מע"מ': r.total, סטטוס: EXPENSE_STATUS[r.e.status], 'בנק הספק': r.vendor?.bank || '', אזהרות: r.warn.join('; ') }))), 'לתשלום');
  XLSX.writeFile(wb, `${name}.xlsx`);
}
