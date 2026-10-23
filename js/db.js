// שכבת נתונים: מצב ענן (Supabase) או מצב הדגמה (נשמר בדפדפן בלבד)
import { CONFIG } from './config.js';
import { store } from './util.js';
import { demoData } from './demo.js';

const LOCAL_KEY = 'grosher-subcon-demo-v4';
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
  const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); }));

const TABLES = ['tenants', 'memberships', 'main_contractors', 'projects', 'variations', 'boq_items', 'cost_lines', 'expenses', 'change_log', 'members_demo',
  'workers', 'work_days', 'work_entries', 'work_qty', 'purchase_orders', 'po_lines', 'bills', 'bill_lines', 'bill_fines', 'bill_payments',
  'vendors', 'documents', 'guarantees', 'contacts'];

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
  cascade(table, ids) {
    if (!ids.length) return;
    const T = this.data.tables;
    T[table] = T[table].filter(r => !ids.includes(r.id));
    const deps = {
      tenants: [['memberships', 'tenant_id'], ['main_contractors', 'tenant_id'], ['projects', 'tenant_id'], ['change_log', 'tenant_id'], ['workers', 'tenant_id'], ['vendors', 'tenant_id'], ['documents', 'tenant_id'], ['guarantees', 'tenant_id'], ['contacts', 'tenant_id']],
      projects: [['variations', 'project_id'], ['boq_items', 'project_id'], ['cost_lines', 'project_id'], ['expenses', 'project_id'], ['change_log', 'project_id'],
        ['work_days', 'project_id'], ['work_entries', 'project_id'], ['work_qty', 'project_id'], ['purchase_orders', 'project_id'], ['bills', 'project_id'], ['documents', 'project_id'], ['guarantees', 'project_id']],
      vendors: [['documents', 'vendor_id']],
      bills: [['bill_lines', 'bill_id'], ['bill_fines', 'bill_id'], ['bill_payments', 'bill_id']],
      variations: [['boq_items', 'variation_id']],
      boq_items: [['cost_lines', 'boq_item_id'], ['work_qty', 'boq_item_id'], ['bill_lines', 'boq_item_id']],
      purchase_orders: [['po_lines', 'po_id']]
    }[table] || [];
    const nullify = (t, k) => T[t].forEach(r => { if (ids.includes(r[k])) r[k] = null; });
    for (const [t, k] of deps) this.cascade(t, T[t].filter(r => ids.includes(r[k])).map(r => r.id));
    if (table === 'main_contractors') { T.projects.forEach(p => { if (ids.includes(p.main_contractor_id)) p.main_contractor_id = null; }); this.cascade('documents', T.documents.filter(d => ids.includes(d.main_contractor_id)).map(d => d.id)); nullify('guarantees', 'main_contractor_id'); nullify('contacts', 'main_contractor_id'); }
    if (table === 'vendors') nullify('contacts', 'vendor_id');
    if (table === 'boq_items') ['expenses', 'work_entries', 'po_lines'].forEach(t => nullify(t, 'boq_item_id'));
    if (table === 'variations') ['expenses', 'work_entries', 'po_lines'].forEach(t => nullify(t, 'variation_id'));
    if (table === 'cost_lines') ['expenses', 'work_entries', 'po_lines'].forEach(t => nullify(t, 'cost_line_id'));
    if (table === 'purchase_orders') nullify('expenses', 'po_id');
  }
  async rpc(name, args) {
    const T = this.data.tables;
    if (name === 'tenant_members') return T.members_demo.filter(m => m.tenant_id === args.t);
    if (name === 'add_member') {
      const ex = T.members_demo.find(m => m.tenant_id === args.t && m.email === args.member_email);
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
      if (P.delete) { T.work_days = T.work_days.filter(r => !same(r)); this.save(); return 'deleted'; }
      const day = T.work_days.find(same);
      if (day) Object.assign(day, { weather: P.weather || null, delays: P.delays || null, notes: P.notes || null });
      else T.work_days.push({ id: uuid(), tenant_id: pr.tenant_id, project_id: args.p, log_date: args.d, weather: P.weather || null, delays: P.delays || null, notes: P.notes || null, created_at: new Date().toISOString() });
      const num = v => v === '' || v == null ? null : +v;
      for (const e of P.entries || []) T.work_entries.push({ id: uuid(), tenant_id: pr.tenant_id, project_id: args.p, log_date: args.d, worker_id: e.worker_id, boq_item_id: e.boq_item_id || null, variation_id: e.variation_id || null,
        cost_line_id: null, days: num(e.days) ?? 1, ot_hours: num(e.ot_hours) ?? 0, piece_qty: num(e.piece_qty), piece_rate: null, note: e.note || null, created_at: new Date().toISOString() });
      for (const q of P.qty || []) T.work_qty.push({ id: uuid(), tenant_id: pr.tenant_id, project_id: args.p, log_date: args.d, boq_item_id: q.boq_item_id, qty: num(q.qty) ?? 0, note: q.note || null });
      this.save(); return 'ok';
    }
    if (name === 'field_workers') return orderRows(T.workers.filter(w => w.tenant_id === args.t).map(({ id, name, pay_type, trade, active }) => ({ id, name, pay_type, trade, active })), ['name']);
    if (name === 'field_boq') return orderRows(T.boq_items.filter(b => b.project_id === args.p).map(({ id, chapter, code, description, unit, variation_id }) => ({ id, chapter, code, description, unit, variation_id })), ['sort', 'code']);
    throw new Error('פעולה לא מוכרת: ' + name);
  }
  async signOut() {}
}

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
      const { data, error } = await this.sb.from(table).insert(arr.slice(i, i + 500)).select();
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
