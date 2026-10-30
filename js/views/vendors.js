// שלב 7: ספקים וקבלנים, מסמכים עם תוקף, מסמכי הלקוח מול הקבלן הראשי, ערבויות וספר טלפונים
import { guarVisible } from '../modules.js';
import { composeMail } from '../mailui.js';
import { h, esc, $, $$, modal, field, select, area, toast, money, fmtDate, nullIfEmpty, confirmBox, WA_ICON } from '../util.js';
import { phoneIntl } from '../alertsui.js';
import { contactPicker, wireContactPickers, loadContacts, cardFields, propagateContact, usageMap, dropContactsCache, ensureLinksLocal } from '../contacts.js';
import { db } from '../db.js';
import { S, can, render, loadTenantData, logChange, reloadTenants } from '../app.js';
import { n } from '../calc.js';
import { VENDOR_KINDS, DOC_TYPES, REQUIRED, OWN_REQUIRED, GUAR_KINDS, expiryState, daysLeft, docStatus, vendorStatus, guaranteeState, parseContacts, isDup } from '../docs.js';
import { readWorkbook, loadXLSX } from '../import.js';
import { attachBtn, wireAttach, openFile } from '../files.js';
let FILES = [];

const todayStr = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
const stChip = (s, d) => s === 'expired' ? `<span class="chip red">פג תוקף${d != null ? ` (${-d} ימים)` : ''}</span>` : s === 'soon' ? `<span class="chip amber">פג בעוד ${d} ימים</span>` : s === 'open' ? '<span class="chip">בלי תפוגה</span>' : s === 'returned' ? '<span class="chip">הוחזרה</span>' : '<span class="chip green">בתוקף</span>';
const statusLine = st => [st.missing.length ? `<span class="chip red">חסר: ${st.missing.map(t => DOC_TYPES[t]).join(', ')}</span>` : '', st.expired.length ? `<span class="chip red">פג: ${st.expired.map(d => DOC_TYPES[d.doc_type]).join(', ')}</span>` : '', st.soon.length ? `<span class="chip amber">פג בקרוב: ${st.soon.map(d => DOC_TYPES[d.doc_type]).join(', ')}</span>` : ''].join(' ') || '<span class="chip green">מסמכים תקינים</span>';

export async function viewVendors(tab = 'list') {
  if (!can.prices()) return h('<div class="card empty">אין הרשאה</div>');
  const data = await loadTenantData();
  FILES = data.files || [];
  const el = h(`<div><div class="top"><div><h1>ספקים, מסמכים וערבויות</h1><div class="sub">מסמכים עם תאריך תוקף · התראה ${30} יום לפני פקיעה · מסמך שפג נחשב חסר</div></div></div>
    <nav class="tabs"><a href="#/vendors" class="${tab === 'list' ? 'on' : ''}">ספקים וקבלנים</a><a href="#/vendors/own" class="${tab === 'own' ? 'on' : ''}">המסמכים שלנו מול הקבלן הראשי</a><a href="#/vendors/guarantees" class="${tab === 'guarantees' ? 'on' : ''}">ערבויות</a></nav><div id="vt"></div></div>`);
  $('#vt', el).appendChild({ list: tabList, own: tabOwn, guarantees: tabGuar }[tab]?.(data) || tabList(data));
  return el;
}

// ===== ספקים וקבלנים =====
function tabList(data) {
  const today = todayStr(), edit = can.expense();
  const F = { q: '', kind: '', bad: false };
  const spent = name => data.expenses.filter(e => (e.supplier_name || '').trim() === name.trim()).reduce((a, e) => a + n(e.amount), 0);
  const el = h(`<div><div class="actions" style="margin-bottom:12px;flex-wrap:wrap;gap:8px">${edit ? '<button class="btn" id="add">+ ספק / קבלן</button><button class="btn ghost" id="fromexp" title="יוצר כרטיס לכל שם ספק שמופיע בהוצאות ואין לו כרטיס">כרטיסים מההוצאות</button>' : ''}
    <input id="q" placeholder="חיפוש" style="max-width:200px"><select id="k" style="width:auto"><option value="">כל הסוגים</option>${Object.entries(VENDOR_KINDS).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select>
    <label class="chk" style="margin:0"><input type="checkbox" id="bad"> רק עם בעיית מסמכים</label></div>
    <div class="tw"><table><thead><tr><th>שם</th><th>סוג</th><th class="hide-m">איש קשר</th><th class="hide-m">טלפון</th><th>מסמכים</th><th class="n hide-m">הוצאות ₪</th><th></th></tr></thead><tbody id="tb"></tbody></table></div>
    <p class="small mut">מסמכי חובה: לקבלן ${REQUIRED.contractor.map(t => DOC_TYPES[t]).join(', ')}; לספק ולנותן שירות ${REQUIRED.supplier.map(t => DOC_TYPES[t]).join(', ')}.</p></div>`);
  const draw = () => {
    const rows = data.vendors.filter(v => (!F.kind || v.kind === F.kind) && (!F.q || `${v.name} ${v.contact_name || ''} ${v.company_no || ''}`.includes(F.q)))
      .map(v => ({ v, st: vendorStatus(v, data.documents, today) })).filter(x => !F.bad || !x.st.ok || x.st.soon.length);
    $('#tb', el).innerHTML = rows.map(({ v, st }) => `<tr class="${v.active === false ? 'dim' : ''}"><td><b>${esc(v.name)}</b>${v.company_no ? `<div class="small mut">ח"פ ${esc(v.company_no)}</div>` : ''}</td><td>${VENDOR_KINDS[v.kind]}</td>
      <td class="hide-m">${esc(v.contact_name || '')}</td><td class="hide-m" dir="ltr" style="text-align:right">${esc(v.phone || '')}</td><td class="wrap">${statusLine(st)}</td><td class="n hide-m">${money(spent(v.name), { sym: false })}</td>
      <td><button class="btn small ghost" data-v="${v.id}">${edit ? 'כרטיס' : 'צפייה'}</button></td></tr>`).join('') || '<tr><td colspan="7" class="empty">אין ספקים. מוסיפים ספק, או יוצרים כרטיסים משמות הספקים שבהוצאות.</td></tr>';
    $$('[data-v]', el).forEach(b => b.onclick = () => vendorDialog(data, data.vendors.find(v => v.id === b.dataset.v)));
  };
  $('#q', el).oninput = e => { F.q = e.target.value.trim(); draw(); };
  $('#k', el).onchange = e => { F.kind = e.target.value; draw(); };
  $('#bad', el).onchange = e => { F.bad = e.target.checked; draw(); };
  $('#add', el)?.addEventListener('click', () => vendorDialog(data, null));
  $('#fromexp', el)?.addEventListener('click', async () => {
    const have = new Set(data.vendors.map(v => v.name.trim()));
    const names = [...new Set(data.expenses.map(e => (e.supplier_name || '').trim()).filter(x => x && !have.has(x)))];
    if (!names.length) return toast('לכל הספקים בהוצאות כבר יש כרטיס');
    if (!(await confirmBox('כרטיסים מההוצאות', `ייווצרו ${names.length} כרטיסי ספק: ${names.slice(0, 6).join(', ')}${names.length > 6 ? '…' : ''}. אחר כך כדאי לעדכן סוג ומסמכים.`, 'יצירה'))) return;
    await db.insert('vendors', names.map(name => ({ tenant_id: S.tenantId, name, kind: data.expenses.some(e => e.supplier_name?.trim() === name && ['sub', 'piece', 'labor'].includes(e.kind)) ? 'contractor' : 'supplier', active: true })));
    toast(`נוצרו ${names.length} כרטיסים`); render();
  });
  draw();
  return el;
}

async function vendorDialog(data, v) {
  const edit = can.expense(), today = todayStr();
  const contacts = await loadContacts();
  const docs = v ? data.documents.filter(d => d.vendor_id === v.id) : [];
  const body = `<div class="grid g2">${field('שם', 'name', v?.name, { req: true })}${select('סוג', 'kind', VENDOR_KINDS, v?.kind || 'supplier')}
    ${field('ח"פ / ע"מ', 'company_no', v?.company_no)}${edit ? contactPicker('איש קשר', 'contact_id', contacts.find(c => c.id === v?.contact_id)) : field('איש קשר', 'contact_name', [v?.contact_name, v?.phone, v?.email].filter(Boolean).join(' · '), { attrs: 'readonly' })}
    ${field('בנק / סניף / חשבון', 'bank', v?.bank)}${field('תנאי תשלום (שוטף + ימים)', 'pay_terms_days', v?.pay_terms_days ?? '', { type: 'number', hint: 'ריק = לפי ההגדרה הכללית' })}</div>
    ${v ? `<label class="chk"><input type="checkbox" name="active" ${v.active !== false ? 'checked' : ''}> פעיל</label>` : ''}${area('הערות', 'notes', v?.notes)}
    ${v ? `<h3 style="margin:12px 0 6px">מסמכים ${edit ? '<button type="button" class="btn small" id="adddoc">+ מסמך</button>' : ''}</h3>${docTable(docs, today, edit)}` : '<p class="small mut">אחרי השמירה אפשר להוסיף מסמכים לכרטיס.</p>'}
    ${v && edit ? '<p><button type="button" class="btn small ghost danger-t" id="delv">מחיקת הכרטיס</button></p>' : ''}`;
  const d = await modal({ title: v ? v.name : 'ספק / קבלן חדש', body, wide: true, ok: edit ? 'שמירה' : null, cancel: edit ? 'ביטול' : 'סגירה', onMount: (el, close) => {
    $('#adddoc', el)?.addEventListener('click', () => { close(null); docDialog(data, { vendor_id: v.id }, fresh => vendorDialog(fresh, fresh.vendors.find(x => x.id === v.id))); });
    wireAttach(el, FILES, null);
    wireContactPickers(el);
    $$('[data-doc]', el).forEach(b => b.onclick = () => { close(null); docDialog(data, data.documents.find(x => x.id === b.dataset.doc), fresh => vendorDialog(fresh, fresh.vendors.find(x => x.id === v.id))); });
    $('#delv', el)?.addEventListener('click', async () => { if (!(await confirmBox('מחיקת כרטיס', `למחוק את ${v.name} ואת המסמכים שלו? ההוצאות נשארות.`, 'מחיקה', true))) return; await db.remove('vendors', v.id); close(null); toast('נמחק'); render(); });
  }, validate: x => (!x.name.trim() ? 'חסר שם' : (!v || x.name.trim() !== v.name) && data.vendors.some(o => o.name.trim() === x.name.trim()) ? 'כבר יש כרטיס בשם הזה' : null) });
  if (!d || !edit) return;
  const row = { name: d.name.trim(), kind: d.kind, company_no: d.company_no || null, contact_id: d.contact_id || null, ...cardFields((await loadContacts()).find(c => c.id === d.contact_id)), bank: d.bank || null,
    pay_terms_days: d.pay_terms_days === '' ? null : Math.round(n(d.pay_terms_days)), notes: d.notes || null, active: v ? !!d.active : true };
  if (v) await db.update('vendors', v.id, row); else await db.insert('vendors', { tenant_id: S.tenantId, ...row });
  toast('נשמר'); render();
}

const docTable = (docs, today, edit, extraCol) => `<div class="tw" style="box-shadow:none;border:1px solid var(--line)"><table><thead><tr><th>סוג</th>${extraCol ? `<th>${extraCol[0]}</th>` : ''}<th>פרטים</th><th>בתוקף עד</th><th>מצב</th><th></th></tr></thead><tbody>
  ${docs.map(d => { const s = expiryState(d.expiry, today); return `<tr class="${s === 'expired' ? 'al-r' : s === 'soon' ? 'al-y' : ''}"><td>${DOC_TYPES[d.doc_type]}</td>${extraCol ? `<td>${esc(extraCol[1](d))}</td>` : ''}<td class="wrap">${esc(d.title || '')}${d.number ? ` · ${esc(d.number)}` : ''}${d.link && !String(d.link).startsWith('file:') ? ` · <a href="${esc(d.link)}" target="_blank" rel="noopener">קישור</a>` : ''}</td>
    <td>${fmtDate(d.expiry)}</td><td>${stChip(s, daysLeft(d.expiry, today))}</td><td style="white-space:nowrap">${edit ? `${attachBtn(docFiles(d), 'documents', d.id, { projectId: d.project_id, docType: 'vendor_doc', label: `${DOC_TYPES[d.doc_type]} ${d.number || ''}`.trim() })} <button type="button" class="btn small ghost" data-doc="${d.id}">עריכה</button>` : ''}</td></tr>`; }).join('') || '<tr><td colspan="6" class="empty">אין מסמכים</td></tr>'}</tbody></table></div>`;

// מסמך שנקלט מתיבת המסמכים מקושר לקובץ (link = file:<id>), גם אם הקובץ עצמו לא סומן
const docFiles = d => { const fid = String(d.link || '').startsWith('file:') ? d.link.slice(5) : null; const f = fid && FILES.find(x => x.id === fid);
  if (f && !(f.links || []).some(l => l.id === d.id)) f.links = [...(f.links || []), { table: 'documents', id: d.id, label: DOC_TYPES[d.doc_type] }]; return FILES; };

async function docDialog(data, d0, after) {
  const isNew = !d0.id;
  const mcs = data.mcs;
  const own = !d0.vendor_id;
  const body = `<div class="grid g2">${select('סוג מסמך', 'doc_type', DOC_TYPES, d0.doc_type || 'insurance')}${field('תיאור', 'title', d0.title, { attrs: 'placeholder="למשל: ביטוח עבודות קבלניות"' })}
    ${own ? select('מול קבלן ראשי', 'main_contractor_id', { '': 'כללי (לכל הקבלנים)', ...Object.fromEntries(mcs.map(m => [m.id, m.name])) }, d0.main_contractor_id || '') : ''}
    ${field('מספר / פוליסה', 'number', d0.number)}${field('תאריך הוצאה', 'issue_date', d0.issue_date, { type: 'date' })}${field('בתוקף עד', 'expiry', d0.expiry, { type: 'date', hint: 'ההתראה מופיעה 30 יום לפני' })}
    ${field('קישור לקובץ (Drive וכו\')', 'link', d0.link, { attrs: 'dir="ltr"' })}</div>${area('הערות', 'notes', d0.notes)}
    ${!isNew ? '<p><button type="button" class="btn small ghost danger-t" id="deld">מחיקת המסמך</button></p>' : ''}`;
  const d = await modal({ title: isNew ? 'מסמך חדש' : 'עריכת מסמך', body, onMount: (el, close) => {
    $('#deld', el)?.addEventListener('click', async () => { if (!(await confirmBox('מחיקה', 'למחוק את המסמך?', 'מחיקה', true))) return; await db.remove('documents', d0.id); close(null); toast('נמחק'); await reloadAfter(after); });
  } });
  if (!d) return after ? reloadAfter(after) : null;
  const row = { doc_type: d.doc_type, title: d.title || null, number: d.number || null, issue_date: nullIfEmpty(d.issue_date), expiry: nullIfEmpty(d.expiry), link: d.link || null, notes: d.notes || null,
    ...(own ? { main_contractor_id: d.main_contractor_id || null } : {}) };
  if (isNew) await db.insert('documents', { tenant_id: S.tenantId, vendor_id: d0.vendor_id || null, project_id: d0.project_id || null, ...row }); else await db.update('documents', d0.id, row);
  toast('המסמך נשמר'); await reloadAfter(after);
}
// אחרי שמירת מסמך מכרטיס ספק: טוענים מחדש ופותחים שוב את הכרטיס
async function reloadAfter(after) { await render(); if (after) after(await loadTenantData()); }

// ===== המסמכים שלנו מול הקבלן הראשי =====
function tabOwn(data) {
  const today = todayStr(), edit = can.expense();
  const own = data.documents.filter(d => !d.vendor_id);
  const mcName = id => data.mcs.find(m => m.id === id)?.name || 'כללי';
  const blocks = [{ id: null, name: 'כללי (לכל הקבלנים הראשיים)' }, ...data.mcs.map(m => ({ id: m.id, name: m.name }))];
  const el = h(`<div><div class="actions" style="margin-bottom:12px">${edit ? '<button class="btn" id="add">+ מסמך</button>' : ''}<span class="small mut">מה הקבלנים הראשיים דורשים מאיתנו: ביטוחים, רישיון קבלן, אישורי ניהול ספרים וניכוי במקור.</span></div>
    ${blocks.map(b => { const ds = own.filter(d => (d.main_contractor_id || null) === b.id); if (b.id && !ds.length) return '';
      const st = docStatus(own.filter(d => !d.main_contractor_id || d.main_contractor_id === b.id), OWN_REQUIRED, today);
      return `<div class="card"><h2>${esc(b.name)} <span style="font-weight:400">${statusLine(st)}</span></h2>${docTable(ds, today, edit)}</div>`; }).join('')}</div>`);
  wireAttach(el, FILES, render);
  $('#add', el)?.addEventListener('click', () => docDialog(data, {}, null));
  $$('[data-doc]', el).forEach(b => b.onclick = () => docDialog(data, data.documents.find(x => x.id === b.dataset.doc), null));
  return el;
}

// ===== ערבויות =====
function tabGuar(data) {
  const today = todayStr(), edit = can.expense();
  const F = { all: false };
  const el = h(`<div><div class="actions" style="margin-bottom:12px">${edit ? '<button class="btn" id="add">+ ערבות</button>' : ''}<label class="chk" style="margin:0"><input type="checkbox" id="all"> להציג גם ערבויות שהוחזרו</label></div>
    <div class="kpis" id="k"></div><div class="tw"><table><thead><tr><th>פרויקט</th><th>סוג</th><th class="hide-m">קבלן ראשי</th><th class="hide-m">בנק / מספר</th><th class="n">סכום</th><th>בתוקף עד</th><th>מצב</th><th></th></tr></thead><tbody id="tb"></tbody></table></div>
    <p class="small mut">ערבות שהלקוח נתן לקבלן הראשי (ביצוע, מקדמה, בדק). התראה 30 יום לפני פקיעה, כדי להאריך או לבקש החזרה.</p></div>`);
  const draw = () => {
    const vis = data.guarantees.filter(guarVisible(data));
    const gs = vis.filter(g => F.all || g.status !== 'returned');
    const act = vis.filter(g => g.status !== 'returned');
    $('#k', el).innerHTML = `<div class="kpi"><div class="l">ערבויות פתוחות</div><div class="v">${money(act.reduce((a, g) => a + n(g.amount), 0))}</div><div class="n">${act.length} ערבויות</div></div>
      <div class="kpi"><div class="l">פג תוקף או יפוג ב-30 יום</div><div class="v ${act.some(g => ['soon', 'expired'].includes(guaranteeState(g, today))) ? 'neg' : ''}">${act.filter(g => ['soon', 'expired'].includes(guaranteeState(g, today))).length}</div></div>`;
    $('#tb', el).innerHTML = gs.map(g => { const s = guaranteeState(g, today); return `<tr class="${s === 'expired' ? 'al-r' : s === 'soon' ? 'al-y' : s === 'returned' ? 'dim' : ''}"><td>${esc(data.projects.find(p => p.id === g.project_id)?.name || '')}</td><td>${GUAR_KINDS[g.kind]}</td>
      <td class="hide-m">${esc(data.mcs.find(m => m.id === g.main_contractor_id)?.name || '')}</td><td class="hide-m">${esc(g.bank || '')}${g.number ? ' · ' + esc(g.number) : ''}</td><td class="n">${money(g.amount)}</td><td>${fmtDate(g.expiry)}</td><td>${stChip(s, daysLeft(g.expiry, today))}</td>
      <td style="white-space:nowrap">${edit ? `${attachBtn(FILES, 'guarantees', g.id, { projectId: g.project_id, docType: 'guarantee', label: `ערבות ${GUAR_KINDS[g.kind]} ${g.number || ''}`.trim() })} <button class="btn small ghost" data-g="${g.id}">עריכה</button>` : ''}</td></tr>`; }).join('') || '<tr><td colspan="8" class="empty">אין ערבויות</td></tr>';
    wireAttach(el, FILES, render);
    $$('[data-g]', el).forEach(b => b.onclick = () => guarDialog(data, data.guarantees.find(g => g.id === b.dataset.g)));
  };
  $('#all', el).onchange = e => { F.all = e.target.checked; draw(); };
  $('#add', el)?.addEventListener('click', () => guarDialog(data, null));
  draw();
  return el;
}

export async function guarDialog(data, g, preset = {}) {
  const v = { status: 'active', kind: 'performance', ...preset, ...(g || {}) };
  const body = `<div class="grid g2">${select('פרויקט', 'project_id', { '': 'ללא פרויקט', ...Object.fromEntries(data.projects.map(p => [p.id, p.name])) }, v.project_id || '')}${select('סוג', 'kind', GUAR_KINDS, v.kind)}
    ${select('קבלן ראשי', 'main_contractor_id', { '': 'לפי הפרויקט', ...Object.fromEntries(data.mcs.map(m => [m.id, m.name])) }, v.main_contractor_id || '')}${field('סכום ₪', 'amount', v.amount, { type: 'number', req: true })}
    ${field('בנק / חברת ביטוח', 'bank', v.bank)}${field('מספר ערבות', 'number', v.number)}${field('תאריך הוצאה', 'issue_date', v.issue_date, { type: 'date' })}${field('בתוקף עד', 'expiry', v.expiry, { type: 'date' })}
    ${select('מצב', 'status', { active: 'פעילה', returned: 'הוחזרה' }, v.status)}${field('תאריך החזרה', 'returned_date', v.returned_date, { type: 'date' })}</div>${area('הערות', 'notes', v.notes)}
    ${g ? '<p><button type="button" class="btn small ghost danger-t" id="delg">מחיקת הערבות</button></p>' : ''}`;
  const d = await modal({ title: g ? 'עריכת ערבות' : 'ערבות חדשה', body, onMount: (el, close) => {
    $('#delg', el)?.addEventListener('click', async () => { if (!(await confirmBox('מחיקה', 'למחוק את הערבות?', 'מחיקה', true))) return; await db.remove('guarantees', g.id); close(null); toast('נמחק'); render(); });
  }, validate: x => (!n(x.amount) ? 'חסר סכום' : null) });
  if (!d) return;
  const pr = data.projects.find(p => p.id === d.project_id);
  const row = { project_id: d.project_id || null, kind: d.kind, main_contractor_id: d.main_contractor_id || pr?.main_contractor_id || null, amount: n(d.amount), bank: d.bank || null, number: d.number || null,
    issue_date: nullIfEmpty(d.issue_date), expiry: nullIfEmpty(d.expiry), status: d.status, returned_date: d.status === 'returned' ? (d.returned_date || todayStr()) : null, notes: d.notes || null };
  if (g) await db.update('guarantees', g.id, row); else await db.insert('guarantees', { tenant_id: S.tenantId, ...row });
  if (g && g.status !== row.status) await logChange({ project_id: row.project_id, entity: 'guarantee', entity_id: g.id, label: `ערבות ${GUAR_KINDS[row.kind]} ${row.number || ''}`, field: 'מצב', old_value: g.status === 'returned' ? 'הוחזרה' : 'פעילה', new_value: row.status === 'returned' ? 'הוחזרה' : 'פעילה' });
  toast('נשמר'); render();
}

// ===== ספר טלפונים (כל משתמשי הלקוח רואים) =====
export async function viewContacts() {
  await ensureLinksLocal();
  const [list, used] = await Promise.all([db.select('contacts', { eq: { tenant_id: S.tenantId }, order: 'name' }), usageMap()]);
  const edit = can.expense();
  const F = { q: '', used: false };
  const el = h(`<div><div class="top"><div><h1>ספר טלפונים</h1><div class="sub">המקום היחיד לטלפונים ומיילים. כרטיס הלקוח, הספקים, הקבלנים הראשיים והפרויקטים בוחרים מכאן · ${list.length} אנשי קשר</div></div></div>
    <div class="actions" style="margin-bottom:12px;flex-wrap:wrap;gap:8px"><input id="q" type="search" placeholder="חיפוש שם, חברה, טלפון" style="flex:1 1 220px;max-width:340px"><label class="chk small" style="margin:0"><input type="checkbox" id="fu"> רק מי שבשימוש</label>
      ${edit ? '<button class="btn" id="add">+ איש קשר</button><label class="btn ghost" style="cursor:pointer">ייבוא מאקסל<input type="file" id="imp" accept=".xlsx,.xls,.csv" hidden></label>' : ''}<button class="btn ghost" id="xl">ייצוא לאקסל</button></div>
    <div id="cl"></div></div>`);
  const draw = () => {
    const q = F.q;
    const rows = list.filter(c => !F.used || used[c.id]).filter(c => !q || [c.name, c.company, c.role, c.phone, c.phone2, c.email].join(' ').toLowerCase().includes(q.toLowerCase()) || (q.replace(/\D/g, '').length >= 3 && [c.phone, c.phone2].join(' ').replace(/\D/g, '').includes(q.replace(/\D/g, ''))));
    $('#cl', el).innerHTML = `<div class="ctl">${rows.slice(0, 300).map(c => `<div class="ccard"><div class="cn"><b>${esc(c.name)}</b>${c.role ? `<span class="small mut"> · ${esc(c.role)}</span>` : ''}<div class="small mut">${esc(c.company || '')}</div>${used[c.id] ? `<div class="small cused">🔗 ${used[c.id].map(esc).join(' · ')}</div>` : ''}</div>
      <div class="cp">${c.phone ? `<span class="nw"><a href="tel:${esc(c.phone)}" dir="ltr">${esc(c.phone)}</a> <a href="https://wa.me/${phoneIntl(c.phone)}" target="_blank" rel="noopener" class="wa-a" title="וואטסאפ" aria-label="וואטסאפ">${WA_ICON}</a></span>` : ''}${c.phone2 ? `<a href="tel:${esc(c.phone2)}" dir="ltr" class="small">${esc(c.phone2)}</a>` : ''}${c.email ? `<a href="#" data-mail="${esc(c.email)}" dir="ltr" class="small" title="שליחת מייל ישירה">${esc(c.email)}</a>` : ''}</div>
      ${edit ? `<button class="btn small ghost" data-c="${c.id}" aria-label="עריכה">✎</button>` : ''}</div>`).join('') || '<div class="card empty">אין אנשי קשר. אפשר לייבא מאקסל עם עמודות: שם, חברה, תפקיד, נייד, אימייל.</div>'}</div>
      ${rows.length > 300 ? `<p class="small mut">מוצגים 300 מתוך ${rows.length}. צמצמי בחיפוש.</p>` : ''}`;
    $$('[data-c]', el).forEach(b => b.onclick = () => contactDialog(list.find(c => c.id === b.dataset.c)));
    $$('[data-mail]', el).forEach(a => a.onclick = e => { e.preventDefault(); e.stopPropagation(); composeMail({ to: [a.dataset.mail] }); });
  };
  $('#q', el).oninput = e => { F.q = e.target.value.trim(); draw(); };
  $('#add', el)?.addEventListener('click', () => contactDialog(null));
  $('#fu', el).onchange = e => { F.used = e.target.checked; draw(); };
  $('#imp', el)?.addEventListener('change', async e => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const sheets = await readWorkbook(f);
      const best = sheets.map(s => parseContacts(s.rows)).filter(p => p.ok).sort((a, b) => b.contacts.length - a.contacts.length)[0];
      if (!best || !best.contacts.length) return toast('לא נמצאו עמודות שם וטלפון/אימייל בקובץ', 'bad');
      const fresh = []; let dups = 0;
      for (const c of best.contacts) { if (isDup(c, list.concat(fresh))) dups++; else fresh.push(c); }
      if (!fresh.length) return toast(`כל ${best.contacts.length} אנשי הקשר כבר קיימים`);
      if (!(await confirmBox('ייבוא אנשי קשר', `נמצאו ${best.contacts.length} אנשי קשר. ${fresh.length} חדשים ייקלטו${dups ? `, ${dups} כפולים (אותו נייד או אותו שם וחברה) ידולגו` : ''}.`, 'ייבוא'))) return;
      for (let i = 0; i < fresh.length; i += 500) await db.insert('contacts', fresh.slice(i, i + 500).map(c => ({ tenant_id: S.tenantId, ...c })));
      toast(`נקלטו ${fresh.length} אנשי קשר`); render();
    } catch (err) { toast(err.message, 'bad'); }
  });
  $('#xl', el).onclick = async () => {
    const XLSX = await loadXLSX();
    const ws = XLSX.utils.aoa_to_sheet([['שם', 'חברה', 'תפקיד', 'נייד', 'טלפון נוסף', 'אימייל', 'הערות'], ...list.map(c => [c.name, c.company || '', c.role || '', c.phone || '', c.phone2 || '', c.email || '', c.notes || ''])]);
    const wb = XLSX.utils.book_new(); wb.Workbook = { Views: [{ RTL: true }] }; XLSX.utils.book_append_sheet(wb, ws, 'אנשי קשר'); XLSX.writeFile(wb, 'ספר טלפונים.xlsx');
  };
  draw();
  return el;
}

export async function contactDialog(c, { name = '', noRender = false } = {}) {
  const used = c ? ((await usageMap())[c.id] || []) : [];
  const body = `<div class="grid g2">${field('שם', 'name', c?.name ?? name, { req: true })}${field('חברה', 'company', c?.company)}${field('תפקיד', 'role', c?.role)}${field('נייד', 'phone', c?.phone, { attrs: 'dir="ltr" inputmode="tel"' })}
    ${field('טלפון נוסף', 'phone2', c?.phone2, { attrs: 'dir="ltr" inputmode="tel"' })}${field('אימייל', 'email', c?.email, { type: 'email', attrs: 'dir="ltr"' })}</div>${area('הערות', 'notes', c?.notes)}
    ${used.length ? `<p class="small"><b>בשימוש ב:</b> ${used.map(esc).join(' · ')}. שינוי כאן מתעדכן שם לבד.</p>` : ''}
    ${c ? '<p><button type="button" class="btn small ghost danger-t" id="delc">מחיקה</button></p>' : ''}`;
  const d = await modal({ title: c ? c.name : 'איש קשר חדש', body, onMount: (el, close) => {
    $('#delc', el)?.addEventListener('click', async () => {
      if (!(await confirmBox('מחיקה', used.length ? `${c.name} בשימוש ב: ${used.join(', ')}. אחרי המחיקה המקומות האלה יישארו בלי איש קשר. למחוק?` : `למחוק את ${c.name}?`, 'מחיקה', true))) return;
      await propagateContact(c.id, { deleted: true }); await db.remove('contacts', c.id); dropContactsCache(); S.projList = null; await reloadTenants(); close(null); toast('נמחק'); render(); });
  }, validate: x => (!x.name.trim() ? 'חסר שם' : null) });
  if (!d) return null;
  const row = { name: d.name.trim(), company: d.company || null, role: d.role || null, phone: d.phone || null, phone2: d.phone2 || null, email: d.email || null, notes: d.notes || null };
  let saved;
  if (c) { await db.update('contacts', c.id, row); saved = { ...c, ...row }; } else [saved] = await db.insert('contacts', { tenant_id: S.tenantId, ...row });
  dropContactsCache();
  if (c) { const k = await propagateContact(c.id); if (k) { S.projList = null; await reloadTenants(); } }
  toast(c && used.length ? `נשמר ועודכן ב-${used.length} מקומות` : 'נשמר');
  if (!noRender) render();
  return saved;
}
