// שכבת נתונים: מצב ענן (Supabase) או מצב הדגמה (נשמר בדפדפן בלבד)
import { CONFIG } from './config.js';
import { store } from './util.js';
import { demoData } from './demo.js';

const LOCAL_KEY = 'grosher-subcon-demo-v5';
export const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
  const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); }));

const TABLES = ['tenants', 'memberships', 'main_contractors', 'projects', 'variations', 'boq_items', 'cost_lines', 'expenses', 'change_log', 'members_demo',
  'workers', 'work_days', 'work_entries', 'work_qty', 'purchase_orders', 'po_lines', 'bills', 'bill_lines', 'bill_fines', 'bill_payments',
  'vendors', 'documents', 'guarantees', 'contacts', 'files', 'alert_log', 'contracts', 'contract_lines', 'change_orders', 'co_lines', 'cbills', 'cbill_lines', 'dev_income', 'alert_state', 'co_signoffs', 'index_series', 'fixed_costs', 'member_invites', 'dev_units', 'project_templates', 'month_closes', 'send_log', 'project_contacts', 'work_extras'];

function match(row, q = {}) {
  for (const [k, v] of Object.entries(q.eq || {})) if (String(row[k] ?? '') !== String(v ?? '')) return false;
  for (const [k, arr] of Object.entries(q.in || {})) if (!arr.map(String).includes(String(row[k]))) return false;
  for (const k of q.isNull || []) if (row[k] !== null && row[k] !== undefined) return false;
  return true;
}
function orderRows(rows, order) {
  if (!order) return rows;
  const keys = Array.isArray(order) ? order : [order];
  return rows.sort((a, b) => {
    for (const k of keys) {
      const [f, dir] = k.split(' ');
      const x = a[f] ?? '', y = b[f] ?? '';
      const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'he', { numeric: true });
      if (c) return dir === 'desc' ? -c : c;
    }
    return 0;
  });
}

// ===== מצב הדגמה =====
class LocalDB {
  constructor() { this.mode = 'demo'; }
  async init() {
    this.data = store(LOCAL_KEY);
    if (!this.data || !this.data.tables) this.reset();
    for (const t of TABLES) this.data.tables[t] ||= [];
    this.data.role ||= 'admin';
    this.user = { id: 'demo-user', email: 'demo@grosher.local', name: 'מצב הדגמה' };
    // לשונית אחרת שינתה את הנתונים (למשל דף החתימה של היזם): טוענים מחדש כדי לא לדרוס
    if (!this._sync) { this._sync = true; addEventListener('storage', e => { if (e.key === LOCAL_KEY && e.newValue) { try { const d = JSON.parse(e.newValue); if (d?.tables) this.data = d; } catch {} } }); }
    return this.user;
  }
  reset() { this.data = { tables: demoData(uuid), role: 'admin' }; this.save(); }
  save() { store(LOCAL_KEY, this.data); }
  get role() { return this.data.role; }
  setRole(r) { this.data.role = r; this.save(); }
  async context() {
    const r = this.data.role;
    const tenants = this.data.tables.tenants;
    if (r === 'admin') return { isAdmin: true, memberships: [] };
    const t = tenants[0];
    const projIds = this.data.tables.projects.filter(p => p.tenant_id === t?.id).slice(0, 1).map(p => p.id);
    return { isAdmin: false, memberships: t ? [{ tenant_id: t.id, role: r, project_ids: r === 'foreman' ? projIds : [] }] : [] };
  }
  async select(table, q = {}) {
    let rows = (this.data.tables[table] || []).filter(r => match(r, q)).map(r => ({ ...r }));
    return orderRows(rows, q.order);
  }
  async insert(table, rows) {
    const arr = (Array.isArray(rows) ? rows : [rows]).map(r => ({ id: uuid(), created_at: new Date().toISOString(), ...r }));
    this.data.tables[table].push(...arr); this.save();
    return arr.map(r => ({ ...r }));
  }
  async update(table, id, patch) {
    const row = this.data.tables[table].find(r => r.id === id);
    if (!row) throw new Error('הרשומה לא נמצאה');
    Object.assign(row, patch); this.save(); return { ...row };
  }
  async remove(table, id) {
    if (table === 'workers' && this.data.tables.work_entries.some(e => e.worker_id === id)) throw new Error('לעובד יש רישומים ביומן העבודה. אפשר לסמן אותו כלא פעיל.');
    this.cascade(table, [id]);
    this.save();
  }
  async removeWhere(table, q) {
    const ids = this.data.tables[table].filter(r => match(r, q)).map(r => r.id);
    this.cascade(table, ids); this.save();
  }
  // עבודה מהיומן שסומנה כתוספת: הוראת שינוי (טיוטה) עם סעיף אחד, כמו field_extra_vo בשרת
  extraVo(xid, noSave) {
    const T = this.data.tables, e = (T.work_extras || []).find(r => r.id === xid); if (!e) throw new Error('לא נמצא');
    if (e.variation_id) return e.variation_id;
    const k = T.variations.filter(v => v.project_id === e.project_id).length + 1;
    const d = e.log_date.split('-').reverse().join('.');
    const v = { id: crypto.randomUUID(), tenant_id: e.tenant_id, project_id: e.project_id, number: 'VO-' + String(k).padStart(2, '0'), title: e.description, source: 'field', has_written_order: false, vo_date: e.log_date,
      status: 'draft', approved_amount: null, from_field: true, notes: ['נפתח מיומן העבודה ' + d, e.qty != null ? `${e.qty} ${e.unit || ''}`.trim() : '', e.note, e.created_by].filter(Boolean).join(' · '), created_at: new Date().toISOString() };
    T.variations.push(v);
    T.boq_items.push({ id: crypto.randomUUID(), tenant_id: e.tenant_id, project_id: e.project_id, variation_id: v.id, chapter: null, code: null, description: e.description, unit: e.unit, qty: e.qty, unit_price: null, billing_method: 'measure', progress_pct: 0, forecast_manual: null, forecast_note: null, sort: 0, created_at: new Date().toISOString() });
    e.variation_id = v.id; if (!noSave) this.save(); return v.id;
  }
  cascade(table, ids) {
    if (!ids.length) return;
    const T = this.data.tables;
    T[table] = T[table].filter(r => !ids.includes(r.id));
    const deps = {
      tenants: [['project_contacts', 'tenant_id'], ['project_templates', 'tenant_id'], ['month_closes', 'tenant_id'], ['send_log', 'tenant_id'], ['member_invites', 'tenant_id'], ['index_series', 'tenant_id'], ['files', 'tenant_id'], ['alert_log', 'tenant_id'], ['alert_state', 'tenant_id'], ['memberships', 'tenant_id'], ['main_contractors', 'tenant_id'], ['projects', 'tenant_id'], ['change_log', 'tenant_id'], ['workers', 'tenant_id'], ['vendors', 'tenant_id'], ['documents', 'tenant_id'], ['guarantees', 'tenant_id'], ['contacts', 'tenant_id']],
      projects: [['fixed_costs', 'project_id'], ['variations', 'project_id'], ['boq_items', 'project_id'], ['cost_lines', 'project_id'], ['expenses', 'project_id'], ['change_log', 'project_id'],
        ['work_days', 'project_id'], ['work_entries', 'project_id'], ['work_qty', 'project_id'], ['work_extras', 'project_id'], ['purchase_orders', 'project_id'], ['bills', 'project_id'], ['documents', 'project_id'], ['guarantees', 'project_id'], ['contracts', 'project_id'], ['change_orders', 'project_id'], ['cbills', 'project_id'], ['dev_income', 'project_id'], ['dev_units', 'project_id'], ['project_contacts', 'project_id'], ['alert_state', 'project_id']],
      contracts: [['contract_lines', 'contract_id'], ['cbills', 'contract_id']],
      change_orders: [['co_lines', 'co_id']],
      co_lines: [['cbill_lines', 'co_line_id']],
      contract_lines: [['cbill_lines', 'contract_line_id']],
      cbills: [['cbill_lines', 'cbill_id']],
      vendors: [['documents', 'vendor_id']],
      bills: [['bill_lines', 'bill_id'], ['bill_fines', 'bill_id'], ['bill_payments', 'bill_id']],
      variations: [['boq_items', 'variation_id']],
      boq_items: [['cost_lines', 'boq_item_id'], ['work_qty', 'boq_item_id'], ['bill_lines', 'boq_item_id']],
      purchase_orders: [['po_lines', 'po_id']],
      contacts: [['project_contacts', 'contact_id']]
    }[table] || [];
    const nullify = (t, k) => T[t].forEach(r => { if (ids.includes(r[k])) r[k] = null; });
    for (const [t, k] of deps) this.cascade(t, T[t].filter(r => ids.includes(r[k])).map(r => r.id));
    if (table === 'variations') nullify('work_extras', 'variation_id');
    if (table === 'boq_items') nullify('work_extras', 'boq_item_id');
    if (table === 'main_contractors') { T.projects.forEach(p => { if (ids.includes(p.main_contractor_id)) p.main_contractor_id = null; }); this.cascade('documents', T.documents.filter(d => ids.includes(d.main_contractor_id)).map(d => d.id)); nullify('guarantees', 'main_contractor_id'); nullify('contacts', 'main_contractor_id'); }
    if (table === 'vendors') { nullify('contacts', 'vendor_id'); nullify('contracts', 'vendor_id'); nullify('guarantees', 'vendor_id'); }
    if (table === 'contracts') { nullify('expenses', 'contract_id'); nullify('guarantees', 'contract_id'); nullify('change_orders', 'contract_id'); }
    if (table === 'contract_lines') nullify('co_lines', 'contract_line_id');
    if (table === 'cbills') nullify('expenses', 'cbill_id');
    if (table === 'boq_items') ['expenses', 'work_entries', 'po_lines', 'contract_lines', 'change_orders', 'fixed_costs'].forEach(t => nullify(t, 'boq_item_id'));
    if (table === 'variations') ['expenses', 'work_entries', 'po_lines'].forEach(t => nullify(t, 'variation_id'));
    if (table === 'cost_lines') ['expenses', 'work_entries', 'po_lines'].forEach(t => nullify(t, 'cost_line_id'));
    if (table === 'purchase_orders') nullify('expenses', 'po_id');
    if (table === 'dev_units') nullify('dev_income', 'unit_id');
    if (table === 'projects') nullify('send_log', 'project_id');
    if (table === 'contacts') ['tenants', 'main_contractors', 'vendors'].forEach(t => nullify(t, 'contact_id'));
  }
  async rpc(name, args) {
    const T = this.data.tables;
    if (name === 'tenant_members') return T.members_demo.filter(m => m.tenant_id === args.t);
    if (name === 'add_member') {
      const ex = T.members_demo.find(m => m.tenant_id === args.t && m.email === args.member_email);
      // בדמו: מי שלא ברשימת המשתמשים "עוד לא נרשם", ולכן נשמרת הזמנה (כמו במערכת האמיתית)
      const known = new Set([...T.members_demo.map(m => m.email), 'demo@grosher.local']);
      if (!ex && !known.has(args.member_email)) {
        T.member_invites ||= [];
        const iv = T.member_invites.find(i => i.tenant_id === args.t && i.email === args.member_email);
        const row = { role: args.member_role, project_ids: args.member_projects || [] };
        if (iv) Object.assign(iv, row); else T.member_invites.push({ id: uuid(), tenant_id: args.t, email: args.member_email, ...row, created_at: new Date().toISOString(), accepted_at: null });
        this.save(); return 'invited';
      }
      if (ex) Object.assign(ex, { role: args.member_role, project_ids: args.member_projects || [] });
      else T.members_demo.push({ id: uuid(), tenant_id: args.t, email: args.member_email, role: args.member_role, project_ids: args.member_projects || [] });
      this.save(); return 'ok';
    }
    if (name === 'remove_member') { T.members_demo = T.members_demo.filter(m => m.id !== args.id); this.save(); return 'ok'; }
    if (name === 'save_work_day') {
      const pr = T.projects.find(x => x.id === args.p); if (!pr) throw new Error('הפרויקט לא נמצא');
      const same = r => r.project_id === args.p && r.log_date === args.d;
      T.work_entries = T.work_entries.filter(r => !same(r)); T.work_qty = T.work_qty.filter(r => !same(r));
      const P = args.payload || {};
      if (P.delete) { T.work_days = T.work_days.filter(r => !same(r)); T.work_extras = (T.work_extras || []).filter(r => !(same(r) && !r.variation_id)); this.save(); return 'deleted'; }
      const day = T.work_days.find(same);
      if (day) Object.assign(day, { weather: P.weather || null, delays: P.delays || null, notes: P.notes || null });
      else T.work_days.push({ id: uuid(), tenant_id: pr.tenant_id, project_id: args.p, log_date: args.d, weather: P.weather || null, delays: P.delays || null, notes: P.notes || null, created_at: new Date().toISOString() });
      const num = v => v === '' || v == null ? null : +v;
      for (const e of P.entries || []) T.work_entries.push({ id: uuid(), tenant_id: pr.tenant_id, project_id: args.p, log_date: args.d, worker_id: e.worker_id, boq_item_id: e.boq_item_id || null, variation_id: e.variation_id || null,
        cost_line_id: null, days: num(e.days) ?? 1, hours: num(e.hours), ot_hours: num(e.ot_hours) ?? 0, piece_qty: num(e.piece_qty), piece_rate: null, note: e.note || null, created_at: new Date().toISOString() });
      for (const q of P.qty || []) T.work_qty.push({ id: uuid(), tenant_id: pr.tenant_id, project_id: args.p, log_date: args.d, boq_item_id: q.boq_item_id, qty: num(q.qty) ?? 0, note: q.note || null });
      if (P.extras) {
        T.work_extras ||= [];
        const keep = new Set(P.extras.map(x => x.id).filter(Boolean));
        T.work_extras = T.work_extras.filter(r => !(same(r) && !r.variation_id && !keep.has(r.id)));
        for (const x of P.extras) {
          if (!String(x.description || '').trim()) continue;
          const row = { description: x.description.trim(), unit: x.unit || null, qty: num(x.qty), note: x.note || null, is_vo: !!x.is_vo };
          let r = T.work_extras.find(y => y.id === x.id);
          if (r) Object.assign(r, row); else { r = { id: x.id || uuid(), tenant_id: pr.tenant_id, project_id: args.p, log_date: args.d, variation_id: null, boq_item_id: null, handled: false, created_by: 'demo', created_at: new Date().toISOString(), ...row }; T.work_extras.push(r); }
          if (r.is_vo) this.extraVo(r.id, true);
        }
      }
      this.save(); return 'ok';
    }
    if (name === 'field_workers') return orderRows(T.workers.filter(w => w.tenant_id === args.t).map(({ id, name, pay_type, trade, active, pending_rate }) => ({ id, name, pay_type, trade, active, pending_rate: !!pending_rate })), ['name']);
    if (name === 'field_add_worker') {
      const pr = T.projects.find(x => x.id === args.p); if (!pr) throw new Error('הפרויקט לא נמצא');
      if (!String(args.wname || '').trim()) throw new Error('חסר שם עובד');
      const w = { id: uuid(), tenant_id: pr.tenant_id, name: args.wname.trim(), phone: (args.wphone || '').trim() || null, pay_type: ['salary', 'daily', 'hourly', 'piece'].includes(args.wpay) ? args.wpay : 'daily',
        trade: (args.wtrade || '').trim() || null, active: true, pending_rate: true, added_by: 'demo', is_foreign: false, created_at: new Date().toISOString() };
      T.workers.push(w); this.save(); return w.id;
    }
    if (name === 'field_extra_vo') return this.extraVo(args.x);
    if (name === 'field_boq') return orderRows(T.boq_items.filter(b => b.project_id === args.p).map(({ id, chapter, code, description, unit, variation_id }) => ({ id, chapter, code, description, unit, variation_id })), ['sort', 'code']);
    // דף החתימה של היזם (במצב הדגמה: אותו דפדפן)
    if (name === 'co_signoff_get') {
      const x = T.co_signoffs.find(r => r.token === args.t); if (!x) return null;
      return { status: x.status === 'pending' && new Date(x.expires_at) < new Date() ? 'expired' : x.status, expires_at: x.expires_at, sent_at: x.sent_at, sent_name: x.sent_name, snapshot: x.snapshot, signer_name: x.signer_name, signed_at: x.signed_at, signer_note: x.signer_note };
    }
    if (name === 'co_signoff_submit') {
      const x = T.co_signoffs.find(r => r.token === args.t);
      if (!x) throw new Error('הקישור לא נמצא');
      if (x.status !== 'pending') throw new Error('הבקשה כבר טופלה');
      if (new Date(x.expires_at) < new Date()) throw new Error('תוקף הקישור פג. צריך לבקש קישור חדש');
      if (!['approved', 'rejected'].includes(args.decision)) throw new Error('החלטה לא תקינה');
      if (!String(args.signer || '').trim()) throw new Error('חסר שם החותם');
      if (args.decision === 'approved' && !String(args.sig || '').startsWith('data:image/png;base64,')) throw new Error('חסרה חתימה');
      const now = new Date(), nm = String(args.signer).trim(), note = String(args.note || '').trim() || null;
      Object.assign(x, { status: args.decision, signer_name: nm, signature: args.sig || null, signed_at: now.toISOString(), signer_note: note, signer_agent: String(args.agent || '').slice(0, 300) });
      const co = T.change_orders.find(c => c.id === x.co_id);
      if (co && args.decision === 'approved' && co.stage !== 'rejected') Object.assign(co, { stage: ['request', 'pricing', 'dev_approval'].includes(co.stage) ? 'approved' : co.stage, approved_date: now.toISOString().slice(0, 10), approved_by: nm, approval_ref: 'חתימה אלקטרונית ' + now.toLocaleString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) });
      if (co && ['request', 'pricing', 'dev_approval'].includes(co.stage)) {
        if (args.decision === 'approved') Object.assign(co, { stage: 'approved', approved_date: now.toISOString().slice(0, 10), approved_by: nm, approval_ref: 'חתימה אלקטרונית ' + now.toLocaleString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) });
        else Object.assign(co, { stage: 'rejected', decision_note: note || co.decision_note });
      }
      T.change_log.push({ id: uuid(), tenant_id: x.tenant_id, project_id: x.project_id, entity: 'change_order', entity_id: x.co_id, label: `${x.snapshot?.co?.number || ''} ${x.snapshot?.co?.title || ''}`.trim(), field: 'אישור יזם', old_value: 'ממתין לאישור יזם', new_value: args.decision === 'approved' ? 'אושר בחתימה' : 'נדחה', reason: note, user_name: nm + ' (דף חתימה)', at: now.toISOString() });
      this.save(); return { status: args.decision, signed_at: now.toISOString() };
    }
    throw new Error('פעולה לא מוכרת: ' + name);
  }
  async signOut() {}
}

// קבצים במצב הדגמה: IndexedDB בדפדפן
function idb() {
  return new Promise((res, rej) => { const r = indexedDB.open('grosher-subcon-files', 1); r.onupgradeneeded = () => r.result.createObjectStore('f'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
}
async function idbDo(mode, fn) { const d = await idb(); return new Promise((res, rej) => { const tx = d.transaction('f', mode); const r = fn(tx.objectStore('f')); tx.oncomplete = () => res(r?.result); tx.onerror = () => rej(tx.error); }); }
LocalDB.prototype.putFile = async function (path, blob) { await idbDo('readwrite', s => s.put(blob, path)); };
LocalDB.prototype.getFile = async function (path) { const b = await idbDo('readonly', s => s.get(path)); if (!b) throw new Error('הקובץ לא נמצא בדפדפן הזה'); return b; };
LocalDB.prototype.removeFile = async function (path) { await idbDo('readwrite', s => s.delete(path)); };
// קריאת מסמך: במצב הדגמה אין שרת. בדיקות יכולות להזריק תשובה מדומה
LocalDB.prototype.intake = async function (body) {
  if (window.__INTAKE_MOCK__) return window.__INTAKE_MOCK__(body);
  throw Object.assign(new Error('במצב הדגמה אין קריאה אוטומטית של מסמכים. אפשר לבחור סוג ולמלא ידנית.'), { demo: true });
};

// ===== מצב ענן =====
class CloudDB {
  constructor() { this.mode = 'cloud'; }
  async init() {
    const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm');
    this.recovery = /type=recovery/.test(location.hash); // הגיעה מקישור איפוס סיסמה
    this.sb = createClient(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey, { auth: { persistSession: true } });
    this.sb.auth.onAuthStateChange(ev => { if (ev === 'PASSWORD_RECOVERY') this.recovery = true; });
    const { data } = await this.sb.auth.getSession();
    if (/access_token|type=/.test(location.hash)) history.replaceState(null, '', location.pathname + location.search + '#/');
    this.user = data.session?.user ? { id: data.session.user.id, email: data.session.user.email } : null;
    return this.user;
  }
  async signIn(email, password) {
    const { data, error } = await this.sb.auth.signInWithPassword({ email, password });
    if (error) throw new Error(heAuthError(error.message));
    this.user = { id: data.user.id, email: data.user.email }; return this.user;
  }
  async signUp(email, password) {
    const { data, error } = await this.sb.auth.signUp({ email, password, options: { emailRedirectTo: location.href.split('#')[0] } });
    if (error) throw new Error(heAuthError(error.message));
    return data.session ? 'signed_in' : 'confirm_email';
  }
  async resetPassword(email) {
    const { error } = await this.sb.auth.resetPasswordForEmail(email, { redirectTo: location.href.split('#')[0] });
    if (error) throw new Error(heAuthError(error.message));
  }
  async setPassword(password) {
    const { error } = await this.sb.auth.updateUser({ password });
    if (error) throw new Error(heAuthError(error.message));
    this.recovery = false;
  }
  async signOut() { await this.sb.auth.signOut(); this.user = null; }
  async context() {
    // הזמנות שמחכות לאימייל הזה: מצטרפים אוטומטית ללקוח עם התפקיד שנבחר
    try { await this.sb.rpc('accept_invites'); } catch { /* לפני הרצת schema.sql של חבילה 20 */ }
    const isAdmin = !!(await this.rpc('claim_service_admin', {}));
    const memberships = await this.select('memberships', { eq: { user_id: this.user.id } });
    return { isAdmin, memberships };
  }
  q(table, q = {}) {
    let s = this.sb.from(table).select('*');
    for (const [k, v] of Object.entries(q.eq || {})) s = v === null ? s.is(k, null) : s.eq(k, v);
    for (const [k, arr] of Object.entries(q.in || {})) s = s.in(k, arr);
    for (const k of q.isNull || []) s = s.is(k, null);
    for (const o of [].concat(q.order || [])) { const [f, dir] = o.split(' '); s = s.order(f, { ascending: dir !== 'desc' }); }
    return s;
  }
  async select(table, q = {}) {
    const all = []; let from = 0;
    for (;;) { // עד 1000 שורות בכל בקשה
      const { data, error } = await this.q(table, q).range(from, from + 999);
      if (error) throw dbErr(error);
      all.push(...data); if (data.length < 1000) break; from += 1000;
    }
    return all;
  }
  async insert(table, rows) {
    const arr = Array.isArray(rows) ? rows : [rows];
    const out = [];
    for (let i = 0; i < arr.length; i += 500) {
      const { data, error } = await this.sb.from(table).insert(arr.slice(i, i + 500), { defaultToNull: false }).select();
      if (error) throw dbErr(error);
      out.push(...data);
    }
    return out;
  }
  async update(table, id, patch) {
    const { data, error } = await this.sb.from(table).update(patch).eq('id', id).select().single();
    if (error) throw dbErr(error); return data;
  }
  async remove(table, id) { const { error } = await this.sb.from(table).delete().eq('id', id); if (error) throw dbErr(error); }
  async removeWhere(table, q) {
    let s = this.sb.from(table).delete();
    for (const [k, v] of Object.entries(q.eq || {})) s = s.eq(k, v);
    for (const [k, arr] of Object.entries(q.in || {})) s = s.in(k, arr);
    for (const k of q.isNull || []) s = s.is(k, null);
    const { error } = await s; if (error) throw dbErr(error);
  }
  async putFile(path, blob) {
    const { error } = await this.sb.storage.from('files').upload(path, blob, { contentType: blob.type || 'application/octet-stream', upsert: false });
    if (error) throw dbErr(error);
  }
  async getFile(path) {
    const { data, error } = await this.sb.storage.from('files').download(path);
    if (error) throw dbErr(error); return data;
  }
  async removeFile(path) { const { error } = await this.sb.storage.from('files').remove([path]); if (error) throw dbErr(error); }
  // קריאת מסמך ב-Claude דרך פונקציית השרת intake (המפתח שמור בשרת בלבד)
  async intake(body) {
    const { data, error } = await this.sb.functions.invoke('intake', { body });
    if (error) {
      let m = error.message || '';
      try { const j = await error.context?.json?.(); if (j?.error) m = j.error; } catch { /* */ }
      if (/Failed to send|not found|404/i.test(m)) m = 'פונקציית הקריאה (intake) עוד לא הותקנה ב-Supabase. ראו בחוברת ההתקנה של חבילה 5, שלב 3.';
      throw new Error(m);
    }
    if (data?.error) throw new Error(data.error);
    return data;
  }
  async rpc(name, args) {
    if (name === 'remove_member') return this.remove('memberships', args.id);
    const { data, error } = await this.sb.rpc(name, args);
    if (error) throw dbErr(error); return data;
  }
}

// הודעות שגיאה מובנות בעברית. err.offline מסמן תקלת רשת (לשמירה לתור ושליחה כשהקליטה חוזרת)
export function dbErr(error) {
  const m = error?.message || String(error);
  let he = m;
  if (error?.code === '23503') he = 'אי אפשר למחוק: יש רשומות אחרות שקשורות לזה.';
  else if (error?.code === '42501' || /row-level security/i.test(m)) he = 'אין לך הרשאה לפעולה הזו.';
  else if (error?.code === '23505') he = 'הרשומה כבר קיימת.';
  const e = new Error(he);
  if (/Failed to fetch|NetworkError|network|Load failed/i.test(m)) { e.offline = true; e.message = 'אין חיבור לאינטרנט.'; }
  return e;
}

function heAuthError(m) {
  if (/Invalid login/i.test(m)) return 'אימייל או סיסמה שגויים';
  if (/Email not confirmed/i.test(m)) return 'צריך לאשר את האימייל (קישור נשלח לתיבת הדואר)';
  if (/already registered/i.test(m)) return 'האימייל כבר רשום. אפשר להתחבר.';
  if (/Password should be/i.test(m)) return 'הסיסמה קצרה מדי (לפחות 6 תווים)';
  return m;
}

export const isCloud = () => !!(CONFIG.supabaseUrl && CONFIG.supabaseAnonKey);
export const db = isCloud() ? new CloudDB() : new LocalDB();
