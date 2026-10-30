// מעטפת המערכת: התחברות, בחירת לקוח, ניווט, הרשאות וטעינת נתונים
import { mods } from './modules.js';
import { db, isCloud } from './db.js';
import { CONFIG } from './config.js';
import { esc, h, $, $$, toast, store, modal, field } from './util.js';
import { PROFIT_MODES } from './calc.js';
import { viewHome } from './views/home.js';
import { viewSentLog } from './views/sentlog.js';
import { viewClients, viewClient } from './views/clients.js';
import { viewProjects } from './views/projects.js';
import { viewProject } from './views/project.js';
import { viewSettings } from './views/settings.js';
import { viewWorkers } from './views/workers.js';
import { viewCollection } from './views/bills.js';
import { viewCashflow } from './views/cashflow.js';
import { viewReports } from './views/reports.js';
import { viewVendors, viewContacts } from './views/vendors.js';
import { flushOutbox } from './views/worklog.js';
import { viewInbox } from './views/inbox.js';
import { viewPayables } from './views/payables.js';
import { helpBtn, guidePage, HELP } from './guide.js';
import { pillHtml, wirePill, pillState, maybeAutoSync } from './drivesync.js';
const HELP_KEYS = Object.keys(HELP);

export const S = { user: null, ctx: null, tenants: [], tenantId: null, role: null, mode: 'approved' };

const ROLE_NAMES = { admin: 'מנהל שירות', owner: 'בעלים', foreman: 'מנהל עבודה', accountant: 'הנהלת חשבונות', viewer: 'צפייה בלבד' };
export const roleName = r => ROLE_NAMES[r] || r;

export const can = {
  edit: () => ['admin', 'owner'].includes(S.role),
  expense: () => ['admin', 'owner', 'accountant'].includes(S.role),
  costing: () => ['admin', 'owner', 'viewer'].includes(S.role),
  prices: () => S.role !== 'foreman',
  log: () => ['admin', 'owner', 'foreman'].includes(S.role),
  workers: () => ['admin', 'owner', 'accountant'].includes(S.role),
  admin: () => S.role === 'admin'
};

export const tenant = () => S.tenants.find(t => t.id === S.tenantId);
export const settings = () => ({ employer_factor: 1.3, crit_pct: 15, vat_pct: 18, overhead_pct: 0, work_days_month: 22, day_hours: 9, quota_warn_pct: 80, quota_gap_pct: 10, cash_opening: 0, cash_min: 0, supplier_terms_days: 60, ...(tenant()?.settings || {}) });

export function setMode(m) { S.mode = m; store('subcon-mode-' + (S.user?.id || ''), m); }
export function modeSwitch(onChange) {
  const el = h(`<div class="seg" role="group" aria-label="תצוגת רווחיות">${Object.entries({ contract: 'בלי הוראות שינוי', approved: 'עם הוראות שינוי מאושרות', all: 'כולל לא מאושרים' })
    .map(([k, v]) => `<button type="button" data-m="${k}" class="${S.mode === k ? 'on' : ''}" title="${esc(PROFIT_MODES[k])}">${v}</button>`).join('')}</div>`);
  $$('button', el).forEach(b => b.onclick = () => { setMode(b.dataset.m); onChange ? onChange() : render(); });
  return el;
}

// טעינת כל נתוני הלקוח הנבחר
export async function loadTenantData(tenantId = S.tenantId) {
  if (tenantId === S.tenantId) { try { const { ensureLinksLocal } = await import('./contacts.js'); await ensureLinksLocal(); } catch (e) { console.warn('contacts', e); } }
  const q = { eq: { tenant_id: tenantId } };
  const [projects, mcs] = await Promise.all([db.select('projects', { ...q, order: 'created_at' }), can.prices() ? db.select('main_contractors', { ...q, order: 'name' }) : []]);
  if (tenantId === S.tenantId) S.projList = { t: tenantId, list: projects };
  // יומן עבודה: כל מי שרואה פרויקט (ההרשאות בשרת מגבילות מנהל עבודה לפרויקטים שלו)
  const [entries, days, wqty, extras] = await Promise.all([
    db.select('work_entries', { ...q, order: ['log_date', 'created_at'] }), db.select('work_days', { ...q, order: 'log_date' }), db.select('work_qty', { ...q, order: 'log_date' }),
    db.select('work_extras', { ...q, order: ['log_date', 'created_at'] }).catch(() => [])]);
  if (!can.prices()) {
    const m = S.ctx.memberships.find(x => x.tenant_id === tenantId);
    const vis = S.role === 'foreman' ? projects.filter(p => (m?.project_ids || []).includes(p.id)) : projects;
    const workers = await db.rpc('field_workers', { t: tenantId });
    return { projects: vis, mcs: [], items: [], lines: [], vos: [], expenses: [], workers, entries, days, wqty, extras, pos: [], poLines: [], bills: [], billLines: [], fines: [], payments: [], vendors: [], documents: [], guarantees: [], files: [], contracts: [], cLines: [], cos: [], coLines: [], cbills: [], cbLines: [], income: [], alertStates: [], closes: await db.select('month_closes', q).catch(() => []) };
  }
  const [items, lines, vos, expenses, workers, pos, poLines, bills, billLines, fines, payments] = await Promise.all([
    db.select('boq_items', { ...q, order: ['sort', 'code'] }),
    can.costing() ? db.select('cost_lines', { ...q, order: 'sort' }) : [],
    db.select('variations', { ...q, order: 'number' }),
    db.select('expenses', { ...q, order: 'doc_date desc' }),
    S.role === 'viewer' || can.workers() ? db.select('workers', { ...q, order: 'name' }) : db.rpc('field_workers', { t: tenantId }),
    db.select('purchase_orders', { ...q, order: 'order_date desc' }),
    db.select('po_lines', { ...q, order: 'sort' }),
    db.select('bills', { ...q, order: 'number' }), db.select('bill_lines', q), db.select('bill_fines', q), db.select('bill_payments', { ...q, order: 'pay_date' })
  ]);
  const [vendors, documents, guarantees, files, contracts, cLines, cos, coLines, cbills, cbLines] = await Promise.all([db.select('vendors', { ...q, order: 'name' }), db.select('documents', { ...q, order: 'expiry' }), db.select('guarantees', { ...q, order: 'expiry' }),
    can.expense() ? db.select('files', { ...q, order: 'created_at desc' }) : [],
    db.select('contracts', { ...q, order: 'created_at' }), db.select('contract_lines', { ...q, order: 'sort' }),
    db.select('change_orders', { ...q, order: 'created_at' }), db.select('co_lines', { ...q, order: 'sort' }), db.select('cbills', { ...q, order: 'number' }), db.select('cbill_lines', q)]);
  const [income, alertStates, signoffs] = await Promise.all([db.select('dev_income', { ...q, order: 'due_date' }), db.select('alert_state', q), db.select('co_signoffs', { ...q, order: 'sent_at' }).catch(() => [])]);
  const [indexSeries, fixedCosts, units, closes] = await Promise.all([db.select('index_series', { ...q, order: 'month' }).catch(() => []), db.select('fixed_costs', { ...q, order: 'from_month' }).catch(() => []), db.select('dev_units', { ...q, order: ['sort', 'name'] }).catch(() => []), db.select('month_closes', { eq: { tenant_id: tenantId }, order: 'month' }).catch(() => [])]);
  return { projects, mcs, items, lines, vos, expenses, workers, entries, days, wqty, extras, pos, poLines, bills, billLines, fines, payments, vendors, documents, guarantees, files, contracts, cLines, cos, coLines, cbills, cbLines, income, alertStates, signoffs, indexSeries, fixedCosts, units, closes };
}

export async function logChange(e) {
  try {
    await db.insert('change_log', { tenant_id: S.tenantId, user_name: S.user?.email || '', at: new Date().toISOString(), ...e,
      old_value: e.old_value == null ? null : String(e.old_value), new_value: e.new_value == null ? null : String(e.new_value) });
  } catch (err) { console.warn('change log', err); }
}

// ===== ניווט =====
// כללי (לכל הפרויקטים) למעלה, הפרויקט הפתוח מתחת, וניהול מקופל בתחתית
const NAV = () => [
  ['#/', '◧', 'מה דורש טיפול', true],
  ['#/projects', '▤', 'פרויקטים', true],
  ['#/inbox', '⇪', 'תיבת מסמכים', can.expense()],
  ['#/workers', '☺', 'עובדים ונוכחות', can.workers()],
  ['#/collection', '₪', 'חשבונות וגבייה', can.prices()],
  ['#/payables', '⇄', 'תשלומים לספקים', can.expense()],
  ['#/cashflow', '≋', 'תזרים מזומנים', can.prices()],
  ['#/reports', '▦', 'דוחות', can.prices()],
  ['#/vendors', '▣', 'ספקים, מסמכים וערבויות', can.prices()],
  ['#/contacts', '☏', 'ספר טלפונים', !!S.tenantId && S.role !== 'foreman'],
  ['#/sent', '✉', 'ארכיון שליחות', can.expense()]
].filter(x => x[3]);
const NAV_ADMIN = () => [
  ['#/clients', '◎', 'לקוחות', can.admin()],
  ['#/client/' + S.tenantId, '⚙', 'הגדרות לקוח ומשתמשים', S.tenantId && can.edit()],
  ['#/guide', '?', 'איך עובדים', can.prices()],
  ['#/settings', '☼', 'תצוגה ומצב', true]
].filter(x => x[3]);

// לשוניות הפרויקט: שורת לשוניות בראש דף הפרויקט (במחשב ובטלפון)
// פרויקט יזם: תקציב, התקשרויות, הוצאות ותשלומים
const PROJECT_TABS_DEV = [['control', 'בקרה תקציבית', '◔'], ['boq', 'תקציב', '☰'], ['contracts', 'התקשרויות', '✍'], ['cos', 'הוראות שינוי', '±'], ['cbills', 'חשבונות קבלנים', '₪'], ['sales', 'מכירות', '⌂'], ['bank', 'ליווי בנקאי', '⛁'], ['cashflow', 'הכנסות ותזרים', '≋'], ['expenses', 'הוצאות ותשלומים', '−'], ['docs', 'מסמכים', '⇪'], ['log', 'יומן שינויים', '↺'], ['settings', 'הגדרות פרויקט', '⚙']];
const PROJECT_TABS = [['control', 'בקרה ורווחיות', '◔'], ['boq', 'כתב כמויות', '☰'], ['costing', 'תמחיר', '∑'], ['quota', 'מכסות', '◫'], ['vo', 'הוראות שינוי', '±'], ['worklog', 'יומן עבודה', '✎'], ['purchase', 'רכש', '⛟'], ['expenses', 'הוצאות', '−'], ['bills', 'חשבונות', '₪'], ['cashflow', 'תזרים', '≋'], ['docs', 'מסמכים', '⇪'], ['log', 'יומן שינויים', '↺'], ['settings', 'הגדרות פרויקט', '⚙']];
// לשונית של מודול כבוי לא מוצגת (worklog = עובדים ויומן, purchase = רכש)
const TAB_MODULE = { worklog: 'workers', purchase: 'purchase', sales: 'sales', bank: 'bank' };
export const projectTabs = (pr = null) => !can.prices() ? [['control', 'יומן עבודה', '✎']] : (pr?.project_type === 'dev' ? PROJECT_TABS_DEV : PROJECT_TABS).filter(([k]) => (!TAB_MODULE[k] || !pr || mods(pr)[TAB_MODULE[k]]) && (!['costing', 'quota'].includes(k) || can.costing()) && (k !== 'log' || can.edit()) && (k !== 'docs' || can.expense()) && (k !== 'settings' || can.edit()));
// הפרויקט הפתוח נשמר לכל לקוח, גם אחרי רענון
const PKEY = () => 'subcon-proj-' + (S.tenantId || '');
export const openProjectId = () => store(PKEY());
export function setOpenProject(id) { store(PKEY(), id || null); }
async function projList() {
  if (!S.projList || S.projList.t !== S.tenantId) S.projList = { t: S.tenantId, list: S.tenantId ? await db.select('projects', { eq: { tenant_id: S.tenantId }, order: 'created_at' }) : [] };
  return S.projList.list;
}

const isOn = (href, hash) => hash === href || (href !== '#/' && hash.startsWith(href + '/')) || (href !== '#/' && hash === href) || (href === '#/projects' && hash.startsWith('#/project/'));
const navLinks = (items, hash) => items.map(([href, ico, label]) => `<a href="${href}" class="${isOn(href, hash) ? 'on' : ''}"><span class="ico">${ico}</span>${label}</a>`).join('');
function shell(content, title) {
  const t = tenant();
  const tenantBox = S.tenants.length > 1 || can.admin()
    ? `<div class="tsel"><span>לקוח <i class="rolebadge" title="סוג המשתמש שלך">${esc(roleName(S.role))}</i></span><select id="tsel" aria-label="בחירת לקוח">${S.tenants.map(x => `<option value="${x.id}" ${x.id === S.tenantId ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}${S.tenants.length ? '' : '<option>אין לקוחות עדיין</option>'}</select></div>`
    : `<div class="tsel"><span>לקוח <i class="rolebadge" title="סוג המשתמש שלך">${esc(roleName(S.role))}</i></span><b>${esc(t?.name || '')}</b></div>`;
  const hash = location.hash || '#/';
  const root = h(`<div class="app">
    <div class="mobile-top"><button id="mnav" aria-label="תפריט">☰</button><b>${esc(title || CONFIG.appName)}</b><a href="#" id="gdotb" aria-label="${esc(pillState().t)}" title="${esc(pillState().t)}"><i id="gdot" class="gdot ${pillState().st}"></i></a></div>
    <aside class="side" id="side">
      <div class="brand"><img src="icons/logo-neg.png" alt=""><div><b>גרושר פרויקטים</b><span>בקרת עלויות ותזרים</span></div></div>
      ${pillHtml()}
      ${tenantBox}
      <nav class="nav">${navLinks(NAV(), hash)}</nav>
      <details class="nadm" ${NAV_ADMIN().some(([href]) => isOn(href, hash)) ? 'open' : ''}><summary>ניהול</summary><nav class="nav">${navLinks(NAV_ADMIN(), hash)}</nav></details>
      <div class="side-foot">${esc(S.user?.email || '')}<br>${esc(roleName(S.role))}${isCloud() ? ' · <button id="logout">יציאה</button>' : ''}</div>
    </aside>
    <main class="main" id="main"></main></div>`);
  if (!isCloud()) {
    const bar = h(`<div class="demo-bar"><b>מצב הדגמה.</b> הנתונים נשמרים רק בדפדפן הזה. כדי לעבוד עם כמה משתמשים צריך לחבר את Supabase.
      <label>צפייה בתור: <select id="demoRole">${Object.entries(ROLE_NAMES).map(([k, v]) => `<option value="${k}" ${db.role === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      <button class="btn small ghost" id="demoReset">איפוס נתוני הדמו</button></div>`);
    $('#main', root).appendChild(bar);
  }
  $('#main', root).appendChild(content);
  return root;
}

function wireShell() {
  $('#mnav')?.addEventListener('click', () => $('#side').classList.toggle('open'));
  $$('#side a').forEach(a => a.addEventListener('click', () => $('#side').classList.remove('open')));
  $('#tsel')?.addEventListener('change', e => { S.tenantId = e.target.value; store('subcon-tenant', S.tenantId); refreshRole(); location.hash = '#/'; render(); });
  wirePill();
  $('#gdotb')?.addEventListener('click', e => { e.preventDefault(); $('#side').classList.add('open'); });
  $('#logout')?.addEventListener('click', async () => { await db.signOut(); location.reload(); });
  $('#demoRole')?.addEventListener('change', async e => { db.setRole(e.target.value); await boot(); });
  $('#demoReset')?.addEventListener('click', async () => {
    if (!(await modal({ title: 'איפוס נתוני הדמו', body: '<p>כל השינויים שעשית במצב הדגמה יימחקו ונתוני הדמו יחזרו למצב ההתחלתי.</p>', ok: 'איפוס', danger: true }))) return;
    db.reset(); await boot(); toast('נתוני הדמו אופסו');
  });
}

function refreshRole() {
  if (S.ctx.isAdmin) { S.role = 'admin'; return; }
  S.role = S.ctx.memberships.find(m => m.tenant_id === S.tenantId)?.role || null;
}

let renderSeq = 0;
export async function render() {
  const seq = ++renderSeq;
  const root = $('#root');
  if (!S.user) return renderLogin();
  if (!S.tenants.length && !can.admin()) {
    root.replaceChildren(h(`<div class="login"><div class="box"><h2>עדיין אין לך גישה ללקוח</h2><p class="mut">המשתמש ${esc(S.user.email)} רשום, אבל עוד לא שויך לאף לקוח. מנהל השירות צריכה להוסיף אותו בהגדרות הלקוח.</p>${isCloud() ? '<button class="btn" id="lo">יציאה</button>' : ''}</div></div>`));
    $('#lo')?.addEventListener('click', async () => { await db.signOut(); location.reload(); });
    return;
  }
  const [, route, a, b, c] = (location.hash || '#/').split('/');
  if (route === 'project' && a) setOpenProject(a);
  let view, title;
  try {
    if (!route) { view = await viewHome(); title = 'מה דורש טיפול'; }
    else if (route === 'projects') { view = await viewProjects(a); title = 'פרויקטים'; }
    else if (route === 'project') { view = await viewProject(a, b || 'control', c); title = b === 'day' ? 'יומן עבודה' : b === 'bill' ? 'חשבון חלקי' : b === 'cbill' ? 'חשבון קבלן' : b === 'cbillpdf' ? 'בדיקת חשבון והמלצה לתשלום' : 'פרויקט'; }
    else if (route === 'inbox') { view = await viewInbox(); title = 'תיבת מסמכים'; }
    else if (route === 'payables') { view = await viewPayables(a || 'open'); title = 'תשלומים לספקים'; }
    else if (route === 'guide') { view = h(guidePage()); title = 'איך עובדים'; }
    else if (route === 'collection') { view = await viewCollection(); title = 'חשבונות וגבייה'; }
    else if (route === 'vendors') { view = await viewVendors(a || 'list'); title = 'ספקים ומסמכים'; }
    else if (route === 'contacts') { view = S.role === 'foreman' ? h('<div class="card empty">אין הרשאה</div>') : await viewContacts(); title = 'ספר טלפונים'; }
    else if (route === 'sent') { view = can.expense() ? await viewSentLog() : h('<div class="card empty">אין הרשאה</div>'); title = 'ארכיון שליחות'; }
    else if (route === 'reports') { view = await viewReports(a); title = 'דוחות'; }
    else if (route === 'cashflow') { view = can.prices() ? await viewCashflow() : h('<div class="card empty">אין הרשאה</div>'); title = 'תזרים מזומנים'; }
    else if (route === 'workers') { view = await viewWorkers(a || 'list'); title = 'עובדים ונוכחות'; }
    else if (route === 'clients') { view = await viewClients(); title = 'לקוחות'; }
    else if (route === 'client') { view = await viewClient(a); title = 'הגדרות לקוח'; }
    else if (route === 'settings') { view = await viewSettings(); title = 'תצוגה ומצב'; }
    else { view = h('<div class="empty">הדף לא נמצא</div>'); }
  } catch (e) {
    console.error(e);
    view = h(`<div class="card"><h2>משהו השתבש</h2><p class="neg">${esc(e.message)}</p></div>`);
  }
  try { if (openProjectId()) { const l = await projList(); if (!l.some(p => p.id === openProjectId())) setOpenProject(null); } } catch { /* */ }
  if (seq !== renderSeq) return;
  // כפתור "?" ליד כותרת המסך
  let hk = !route ? 'home' : route === 'project' ? (b && !['day', 'bill', 'field', 'cbillpdf'].includes(b) ? 'p-' + (b === 'cbill' ? 'cbills' : b) : !b ? 'p-control' : '') : route;
  if (route === 'project' && S.projList?.list?.find(x => x.id === a)?.project_type === 'dev' && hk && HELP_KEYS.includes('d-' + hk.slice(2))) hk = 'd-' + hk.slice(2);
  const h1 = view.querySelector?.('.top h1');
  if (h1 && hk && !h1.querySelector('.helpb') && can.prices()) h1.insertAdjacentHTML('beforeend', ' ' + helpBtn(hk));
  root.replaceChildren(shell(view, title));
  wireShell();
  view.dispatchEvent(new Event('mounted'));
  document.querySelector('.ptabs a.on')?.scrollIntoView({ block: 'nearest', inline: 'center' });
  maybeAutoSync();
}

function renderLogin() {
  const root = $('#root');
  // קישור הזמנה: ...?invite=email ממלא את האימייל ומסביר מה לעשות
  const invited = (new URLSearchParams(location.search).get('invite') || '').trim();
  const el = h(`<div class="login"><div class="box">
    <div class="logo"><img src="icons/logo-neg.png" alt=""><div><b>גרושר פרויקטים</b><div class="mut small">בקרת עלויות ותזרים</div></div></div>
    ${invited ? `<div class="note small" style="margin-bottom:10px"><b>הוזמנת למערכת.</b> בפעם הראשונה: לבחור סיסמה וללחוץ "הרשמה", ואז לאשר את המייל שיגיע. אחרי הכניסה תראה את הלקוח שהזמין אותך.</div>` : ''}
    <form id="lf">${field('אימייל', 'email', invited, { type: 'email', req: true, attrs: 'autocomplete="username" dir="ltr"' })}
    ${field('סיסמה', 'password', '', { type: 'password', req: true, attrs: 'autocomplete="current-password" dir="ltr"' })}
    <div class="err" id="lerr" hidden></div>
    <div class="actions"><button class="btn" type="submit">כניסה</button><button class="btn ghost" type="button" id="signup">הרשמה</button><button class="btn link" type="button" id="forgot">שכחתי סיסמה</button></div></form></div></div>`);
  root.replaceChildren(el);
  const err = m => { const e = $('#lerr'); e.textContent = m; e.hidden = !m; };
  const vals = () => ({ email: $('[name=email]').value.trim(), password: $('[name=password]').value });
  $('#lf').onsubmit = async e => {
    e.preventDefault(); err('');
    try { await db.signIn(vals().email, vals().password); await boot(); } catch (x) { err(x.message); }
  };
  $('#signup').onclick = async () => {
    err(''); const v = vals();
    if (!v.email || v.password.length < 6) return err('אימייל וסיסמה של 6 תווים לפחות');
    try { const r = await db.signUp(v.email, v.password); if (r === 'signed_in') await boot(); else err('נשלח אימייל לאישור. אחרי האישור אפשר להיכנס.'); } catch (x) { err(x.message); }
  };
  $('#forgot').onclick = async () => {
    err(''); const v = vals(); if (!v.email) return err('כתוב את האימייל ולחץ שוב');
    try { await db.resetPassword(v.email); err('נשלח קישור לאיפוס סיסמה'); } catch (x) { err(x.message); }
  };
}

export async function reloadTenants() {
  S.tenants = await db.select('tenants', { order: 'name' });
  if (!S.tenants.find(t => t.id === S.tenantId)) S.tenantId = S.tenants[0]?.id || null;
  refreshRole();
}

// אחרי קישור איפוס סיסמה: בחירת סיסמה חדשה
async function newPassword() {
  await modal({ title: 'בחירת סיסמה חדשה', ok: 'שמירה', cancel: null,
    body: field('סיסמה חדשה (8 תווים לפחות)', 'pw', '', { type: 'password', req: true, attrs: 'autocomplete="new-password" dir="ltr"' }),
    validate: async d => { if ((d.pw || '').length < 8) return 'הסיסמה קצרה מדי'; try { await db.setPassword(d.pw); } catch (e) { return e.message; } return null; } });
  toast('הסיסמה עודכנה');
}

async function boot() {
  try {
    S.user = await db.init();
    if (!S.user) return render();
    if (db.recovery) await newPassword();
    flushOutbox().catch(() => {});
    S.ctx = await db.context();
    S.mode = store('subcon-mode-' + S.user.id) || 'approved';
    S.tenantId = store('subcon-tenant');
    await reloadTenants();
  } catch (e) {
    console.error(e);
    $('#root').replaceChildren(h(`<div class="login"><div class="box"><h2>לא הצלחנו להתחבר</h2><p class="neg">${esc(e.message)}</p><p class="mut small">בדוק את הכתובת והמפתח ב-config.js ואת החיבור לאינטרנט.</p></div></div>`));
    return;
  }
  render();
}

const theme = store('subcon-theme'); if (theme) document.documentElement.dataset.theme = theme;
window.addEventListener('hashchange', render);
window.addEventListener('online', () => { if (S.user) flushOutbox().then(k => k && render()); });
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
boot();

// כפתור "הדפסה / PDF" בכל מסך: חלון ההדפסה של הדפדפן, שבו בוחרים "שמירה כ-PDF".
// במסך בלי כותרת דוח מוסיפים לזמן ההדפסה שורת כותרת עם הלוגו, הלקוח והתאריך.
document.addEventListener('click', e => { if (e.target.closest('[data-print]')) window.print(); });
window.addEventListener('beforeprint', () => {
  const main = document.getElementById('main'); if (!main || main.querySelector('.rephead') || document.getElementById('printhead')) return;
  const d = document.createElement('div'); d.id = 'printhead'; d.className = 'rephead print-only';
  d.innerHTML = `<img src="icons/icon-192.png" alt=""><div><b>${esc(tenant()?.name || '')}</b><span>הופק ${new Date().toLocaleDateString('he-IL')}</span></div>`;
  main.prepend(d);
});
window.addEventListener('afterprint', () => document.getElementById('printhead')?.remove());
