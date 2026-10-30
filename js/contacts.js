// ספר הטלפונים הוא המקום היחיד שבו מקלידים טלפון ומייל. בכל מקום אחר (כרטיס לקוח, קבלן ראשי / מזמין, ספק, אנשי קשר בפרויקט)
// שומרים קישור לאיש הקשר, ושדות הטקסט הישנים (contact_name, phone, email, notify_*, approver_*) הם העתק שמתעדכן לבד.
import { esc, $, $$, toast } from './util.js';
import { db, isCloud } from './db.js';
import { S } from './app.js';

export const PC_ROLES = { notify: 'נמען להתרעות (וואטסאפ ומייל)', approver: 'מאשר הוראות שינוי' };
export const digits = v => String(v || '').replace(/\D/g, '').replace(/^972/, '0');
const low = v => String(v || '').trim().toLowerCase();

// ===== טעינה (עם מטמון לכל לקוח) =====
let cache = null;
export async function loadContacts(force = false) {
  if (!force && cache && cache.t === S.tenantId) return cache.list;
  const list = await db.select('contacts', { eq: { tenant_id: S.tenantId }, order: 'name' }).catch(() => []);
  cache = { t: S.tenantId, list };
  return list;
}
export const dropContactsCache = () => { cache = null; };
export const contactLabel = c => [c.name, c.company && c.company !== c.name ? c.company : '', c.phone || c.email].filter(Boolean).join(' · ');

/** העתק השדות מאיש הקשר. prefix: '' לכרטיסים, או notify_/approver_ בפרויקט */
export const cardFields = c => ({ contact_name: c?.name || null, phone: c?.phone || null, email: c?.email || null });
export function projectCache(pcs, contacts) {
  const by = Object.fromEntries(contacts.map(c => [c.id, c]));
  const nt = pcs.filter(r => r.role === 'notify').sort((a, b) => a.sort - b.sort).map(r => by[r.contact_id]).filter(Boolean);
  const ap = pcs.filter(r => r.role === 'approver').map(r => by[r.contact_id]).filter(Boolean)[0];
  const phoneOne = nt.find(c => c.phone);
  return { notify_name: phoneOne?.name || nt[0]?.name || null, notify_phone: phoneOne?.phone || null, notify_emails: [...new Set(nt.map(c => c.email).filter(Boolean))].join(', ') || null,
    approver_name: ap?.name || null, approver_email: ap?.email || null };
}

// ===== בחירת איש קשר =====
/** שדה בחירה: חיפוש בשם / חברה / טלפון, ו"+ חדש". name = שם השדה הנסתר שמחזיק את המזהה */
export function contactPicker(label, name, selected, { hint = '' } = {}) {
  return `<div class="fld cpick" data-cp="${name}"><span>${esc(label)}</span>
    <div class="cprow"><input type="search" class="cpq" placeholder="חיפוש בספר הטלפונים: שם, חברה או טלפון" value="${esc(selected ? contactLabel(selected) : '')}" autocomplete="off">
    <button type="button" class="btn small ghost cpnew" title="איש קשר חדש לספר הטלפונים">+ חדש</button></div>
    <input type="hidden" name="${name}" value="${esc(selected?.id || '')}"><div class="cpres" hidden></div>
    <small class="cpinfo">${selected ? infoLine(selected) : esc(hint || 'הטלפון והמייל נלקחים מספר הטלפונים')}</small></div>`;
}
const infoLine = c => [c.phone && `<span dir="ltr">${esc(c.phone)}</span>`, c.email && `<span dir="ltr">${esc(c.email)}</span>`].filter(Boolean).join(' · ') || 'אין טלפון ומייל בספר. עורכים בספר הטלפונים.';
const match = (c, q) => { const t = low(q); if (!t) return false; const d = digits(q);
  return low(c.name).includes(t) || low(c.company).includes(t) || low(c.email).includes(t) || (d.length >= 3 && (digits(c.phone).includes(d) || digits(c.phone2).includes(d))); };

/** חיבור כל שדות הבחירה בחלון. onPick(name, contact) נקרא אחרי בחירה */
export async function wireContactPickers(el, { onPick } = {}) {
  const boxes = $$('.cpick', el); if (!boxes.length) return;
  let list = await loadContacts();
  for (const box of boxes) wireOne(box);
  function wireOne(box) {
    const q = $('.cpq', box), hid = $('input[type=hidden]', box), res = $('.cpres', box), info = $('.cpinfo', box);
    const set = c => { hid.value = c?.id || ''; q.value = c ? contactLabel(c) : ''; info.innerHTML = c ? infoLine(c) : 'הטלפון והמייל נלקחים מספר הטלפונים'; res.hidden = true; onPick?.(box.dataset.cp, c, box); hid.dispatchEvent(new Event('change', { bubbles: true })); };
    const show = () => {
      const hits = list.filter(c => match(c, q.value)).slice(0, 12);
      res.innerHTML = hits.map(c => `<button type="button" data-id="${c.id}"><b>${esc(c.name)}</b> <span class="mut small">${esc([c.company, c.phone || c.email].filter(Boolean).join(' · '))}</span></button>`).join('')
        || `<div class="small mut" style="padding:6px 8px">לא נמצא בספר. "+ חדש" מוסיף.</div>`;
      res.hidden = !q.value.trim();
      $$('[data-id]', res).forEach(b => b.onmousedown = e => { e.preventDefault(); set(list.find(c => c.id === b.dataset.id)); });
    };
    q.addEventListener('input', () => { if (!q.value.trim()) set(null); else show(); });
    q.addEventListener('focus', () => { if (q.value.trim() && !hid.value) show(); });
    q.addEventListener('blur', () => setTimeout(() => { res.hidden = true; const cur = list.find(c => c.id === hid.value); if (cur && q.value !== contactLabel(cur)) q.value = contactLabel(cur); if (!cur) q.value = ''; }, 150));
    $('.cpnew', box).onclick = async () => {
      const { contactDialog } = await import('./views/vendors.js');
      const c = await contactDialog(null, { name: hid.value ? '' : q.value.trim(), noRender: true });
      if (!c) return;
      list = await loadContacts(true); set(list.find(x => x.id === c.id) || c);
    };
  }
}

// ===== עדכון ההעתקים כשאיש קשר משתנה או נמחק =====
/** מעדכן בכל מקום שמקושר לאיש הקשר. מחזיר כמה מקומות עודכנו */
export async function propagateContact(contactId, { deleted = false } = {}) {
  const list = (await loadContacts(true)).filter(x => !deleted || x.id !== contactId);
  const c = list.find(x => x.id === contactId) || null;
  let k = 0;
  for (const t of ['tenants', 'main_contractors', 'vendors']) {
    const rows = await db.select(t, t === 'tenants' ? {} : { eq: { tenant_id: S.tenantId } }).catch(() => []);
    for (const r of rows.filter(r => r.contact_id === contactId)) { await db.update(t, r.id, c ? cardFields(c) : { contact_id: null, ...cardFields(null) }); k++; }
  }
  const pcs = await db.select('project_contacts', { eq: { tenant_id: S.tenantId } }).catch(() => []);
  const pids = [...new Set(pcs.filter(r => r.contact_id === contactId).map(r => r.project_id))];
  for (const pid of pids) { const mine = pcs.filter(r => r.project_id === pid && (c || r.contact_id !== contactId)); await db.update('projects', pid, projectCache(mine, list)); k++; }
  return k;
}

/** איפה איש הקשר בשימוש (לספר הטלפונים) */
export async function usageMap() {
  const [tenants, mcs, vendors, pcs, projects] = await Promise.all([db.select('tenants', {}).catch(() => []), db.select('main_contractors', { eq: { tenant_id: S.tenantId } }).catch(() => []),
    db.select('vendors', { eq: { tenant_id: S.tenantId } }).catch(() => []), db.select('project_contacts', { eq: { tenant_id: S.tenantId } }).catch(() => []), db.select('projects', { eq: { tenant_id: S.tenantId } }).catch(() => [])]);
  const m = {}, add = (id, s) => { if (id) (m[id] ||= []).push(s); };
  tenants.filter(t => t.id === S.tenantId).forEach(t => add(t.contact_id, 'כרטיס הלקוח'));
  mcs.forEach(r => add(r.contact_id, `קבלן ראשי / מזמין: ${r.name}`));
  vendors.forEach(r => add(r.contact_id, `ספק: ${r.name}`));
  const pn = id => projects.find(p => p.id === id)?.name || '';
  pcs.forEach(r => add(r.contact_id, `${r.role === 'approver' ? 'מאשר הוראות שינוי' : 'התרעות'} · ${pn(r.project_id)}`));
  return m;
}

// ===== אנשי קשר בפרויקט =====
export function projectContactsBlock(pid = '') {
  return `<div class="pcblock" data-pid="${esc(pid || '')}"><h3 style="margin:10px 0 6px">אנשי קשר בפרויקט</h3>
    <p class="small mut" style="margin:0 0 6px">בוחרים מספר הטלפונים. ההתרעות בוואטסאפ ובמייל יוצאות לנמענים, ובקשת אישור הוראת שינוי יוצאת למאשר. בלי נמענים בפרויקט: לאיש הקשר בכרטיס הלקוח.</p>
    <div class="pclist" data-role="notify"></div>
    <div class="actions" style="margin:4px 0 10px"><button type="button" class="btn small ghost" data-pcadd="notify">+ נמען להתרעות</button></div>
    <div class="pclist" data-role="approver"></div>
    <input type="hidden" name="pc_json" value=""></div>`;
}
/** ממלא את הבלוק לפי הפרויקט (ריק בפרויקט חדש). השמירה דרך saveProjectContacts */
export async function wireProjectContacts(el) {
  const box = $('.pcblock', el); if (!box) return;
  const projectId = box.dataset.pid;
  const list = await loadContacts();
  const pcs = projectId ? await db.select('project_contacts', { eq: { project_id: projectId } }).catch(() => []) : [];
  const st = { notify: pcs.filter(r => r.role === 'notify').sort((a, b) => a.sort - b.sort).map(r => r.contact_id), approver: pcs.filter(r => r.role === 'approver').map(r => r.contact_id).slice(0, 1) };
  const hid = $('[name=pc_json]', box);
  const by = id => list.find(c => c.id === id);
  const draw = () => {
    hid.value = JSON.stringify(st);
    const notifyRows = (st.notify.length ? st.notify : ['']).map((id, i) => contactPicker(i ? '' : PC_ROLES.notify, `pcn_${i}`, by(id)) + (st.notify.length > 1 ? `<button type="button" class="btn small ghost pcrm" data-rm="${i}" aria-label="הסרה">✕ הסרה</button>` : '')).join('');
    $('[data-role=notify]', box).innerHTML = notifyRows;
    $('[data-role=approver]', box).innerHTML = contactPicker(PC_ROLES.approver, 'pca_0', by(st.approver[0]), { hint: 'ריק: הבקשה יוצאת לנמען הראשון להתרעות, ואם אין, לאיש הקשר בכרטיס הלקוח' });
    $$('[data-rm]', box).forEach(b => b.onclick = () => { st.notify.splice(+b.dataset.rm, 1); draw(); });
    wireContactPickers(box, { onPick: (name, c) => { const [kind, i] = name.split('_'); const arr = kind === 'pcn' ? st.notify : st.approver; arr[+i] = c?.id || ''; hid.value = JSON.stringify({ notify: st.notify.filter(Boolean), approver: st.approver.filter(Boolean) }); } });
  };
  $('[data-pcadd]', box).onclick = () => { st.notify = st.notify.filter(Boolean); st.notify.push(''); draw(); };
  draw();
}
export async function saveProjectContacts(projectId, json) {
  let st; try { st = JSON.parse(json || 'null'); } catch { st = null; }
  if (!st) return null;
  const want = [...(st.notify || []).filter(Boolean).map((id, i) => ({ contact_id: id, role: 'notify', sort: i })), ...(st.approver || []).filter(Boolean).slice(0, 1).map(id => ({ contact_id: id, role: 'approver', sort: 0 }))];
  const uniq = want.filter((w, i) => want.findIndex(x => x.contact_id === w.contact_id && x.role === w.role) === i);
  const old = await db.select('project_contacts', { eq: { project_id: projectId } }).catch(() => []);
  for (const o of old) if (!uniq.some(w => w.contact_id === o.contact_id && w.role === o.role)) await db.remove('project_contacts', o.id);
  for (const w of uniq) { const o = old.find(x => x.contact_id === w.contact_id && x.role === w.role); if (o) { if (o.sort !== w.sort) await db.update('project_contacts', o.id, { sort: w.sort }); } else await db.insert('project_contacts', { tenant_id: S.tenantId, project_id: projectId, ...w }); }
  const list = await loadContacts();
  const now = await db.select('project_contacts', { eq: { project_id: projectId } }).catch(() => []);
  const cacheRow = projectCache(now, list);
  await db.update('projects', projectId, cacheRow);
  return cacheRow;
}

// ===== מצב הדגמה: אותה העברה כמו ב-SQL, פעם אחת לכל לקוח =====
export async function ensureLinksLocal() {
  if (isCloud() || !S.tenantId) return;
  const key = 'subcon-pb-mig-' + S.tenantId;
  try { if (localStorage.getItem(key)) return; } catch { return; }
  let list = await loadContacts(true);
  const find = async (nm, ph, em, comp) => {
    const d = digits(ph), e = low(em); if (!d && !e) return null;
    let c = list.find(x => (d && digits(x.phone) === d) || (e && low(x.email) === e));
    if (!c) { [c] = await db.insert('contacts', { tenant_id: S.tenantId, name: (nm || '').trim() || comp || e || ph, company: comp || null, phone: ph || null, email: e || null }); list.push(c); }
    else if ((!c.email && e) || (!c.phone && ph)) { const patch = { email: c.email || e || null, phone: c.phone || ph || null }; await db.update('contacts', c.id, patch); Object.assign(c, patch); }
    return c.id;
  };
  const t = (await db.select('tenants', {})).find(x => x.id === S.tenantId);
  if (t && !t.contact_id) { const id = await find(t.contact_name, t.phone, t.email, t.name); if (id) await db.update('tenants', t.id, { contact_id: id }); }
  for (const tb of ['main_contractors', 'vendors']) for (const r of (await db.select(tb, { eq: { tenant_id: S.tenantId } })).filter(r => !r.contact_id)) { const id = await find(r.contact_name, r.phone, r.email, r.name); if (id) await db.update(tb, r.id, { contact_id: id }); }
  const pcs = await db.select('project_contacts', { eq: { tenant_id: S.tenantId } }).catch(() => []);
  for (const p of (await db.select('projects', { eq: { tenant_id: S.tenantId } })).filter(p => !pcs.some(r => r.project_id === p.id))) {
    const ems = String(p.notify_emails || '').split(/[\s,;]+/).filter(Boolean); let k = 0;
    if (p.notify_phone || ems.length) { const id = await find(p.notify_name, p.notify_phone, ems[0], null); if (id) await db.insert('project_contacts', { tenant_id: S.tenantId, project_id: p.id, contact_id: id, role: 'notify', sort: k++ }); }
    for (const em of ems.slice(1)) { const id = await find(null, null, em, null); if (id) await db.insert('project_contacts', { tenant_id: S.tenantId, project_id: p.id, contact_id: id, role: 'notify', sort: k++ }); }
    if (p.approver_email) { const id = await find(p.approver_name, null, p.approver_email, null); if (id) await db.insert('project_contacts', { tenant_id: S.tenantId, project_id: p.id, contact_id: id, role: 'approver', sort: 0 }); }
  }
  try { localStorage.setItem(key, '1'); } catch { /* */ }
  dropContactsCache();
}
