// בדיקת חבילה 21: תבניות, סגירת חודש, ארכיון שליחות
import { chromium } from 'playwright';
const BASE = 'http://localhost:8123/'; const KEY = 'grosher-subcon-demo-v5'; const OUT = 'tests/shots/';
const b = await chromium.launch();
const ok = (name, cond) => { console.log((cond ? 'ok   ' : 'FAIL ') + name); if (!cond) process.exitCode = 1; };
const ctx = await b.newContext({ viewport: { width: 1440, height: 950 } }); const p = await ctx.newPage();
const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
const T = () => p.evaluate(k => JSON.parse(localStorage.getItem(k)).tables, KEY);
const go = async h => { await p.goto(BASE + '#/'); await p.waitForTimeout(250); await p.goto(BASE + h); await p.waitForTimeout(900); };
const okDlg = async () => { await p.click('.dlg [data-ok]'); await p.waitForSelector('.dlg', { state: 'detached' }); await p.waitForTimeout(900); };
const cur = new Date().toISOString().slice(0, 7);
const addM = (m, k) => { const [y, mo] = m.split('-').map(Number); return new Date(Date.UTC(y, mo - 1 + k, 1)).toISOString().slice(0, 7); };
await p.goto(BASE); await p.waitForSelector('.kpis'); await p.evaluate(() => localStorage.clear()); await p.reload(); await p.waitForSelector('.kpis');
let t = await T();
const tid = await p.$eval('#tsel', s => s.value);
const sp = t.projects.find(x => x.tenant_id === tid && x.project_type !== 'dev' && t.boq_items.some(i => i.project_id === x.id) && t.cost_lines.some(l => l.project_id === x.id));

// ===== 1. תבנית =====
await go(`#/project/${sp.id}/settings`);
await p.click('#savetpl'); await p.waitForSelector('.dlg [name=name]');
await p.fill('.dlg [name=name]', 'תבנית בדיקה'); await okDlg();
t = await T(); const tpl = t.project_templates.find(x => x.name === 'תבנית בדיקה');
const nItems = t.boq_items.filter(i => i.project_id === sp.id && !i.variation_id).length;
ok('template saved with items + lines', tpl && tpl.data.items.length === nItems && tpl.data.lines.length > 0 && tpl.data.items.every(i => i.qty == null));
await go('#/projects'); await p.click('#add'); await p.waitForSelector('.dlg [name=tpl]');
await p.selectOption('.dlg [name=tpl]', tpl.id); await p.waitForTimeout(200);
await p.fill('.dlg [name=name]', 'פרויקט מתבנית'); await p.fill('.dlg [name=start_date]', cur + '-01');
await okDlg();
t = await T(); const np = t.projects.find(x => x.name === 'פרויקט מתבנית');
ok('project from template gets items + cost lines', t.boq_items.filter(i => i.project_id === np.id).length === nItems && t.cost_lines.filter(l => l.project_id === np.id).length === tpl.data.lines.length);
ok('template keeps prices, not quantities', t.boq_items.filter(i => i.project_id === np.id).every(i => i.qty == null) && t.boq_items.filter(i => i.project_id === np.id).some(i => i.unit_price > 0));
await go(`#/client/${tid}`);
ok('templates card lists template', (await p.textContent('main')).includes('תבנית בדיקה'));

// ===== 2. סגירת חודש =====
const prev = addM(cur, -1);
// הוצאה בחודש הקודם בפרויקט
await p.evaluate(([k, pid, tid, m]) => { const d = JSON.parse(localStorage.getItem(k)); d.tables.expenses.push({ id: 'exp-close-1', tenant_id: tid, project_id: pid, doc_date: m + '-15', supplier_name: 'ספק נעילה', doc_no: 'L-1', kind: 'material', amount: 1000, vat_pct: 18, status: 'approved', notes: null, boq_item_id: null, variation_id: null }); localStorage.setItem(k, JSON.stringify(d)); }, [KEY, sp.id, tid, prev]);
await p.reload(); await go(`#/client/${tid}`);
ok('close button for previous month', !!(await p.$('#closem')));
// סוגרים עד החודש הקודם (ייתכן שצריך כמה סגירות אם לא נסגר כלום: הראשון הוא החודש הקודם)
await p.click('#closem'); await p.waitForSelector('.dlg [data-ok]'); await okDlg();
t = await T(); ok('month closed with snapshot', t.month_closes.some(c => c.month === prev && c.snapshot && c.snapshot[sp.id]));
ok('cannot close current month', !(await p.$('#closem')));
await p.screenshot({ path: OUT + 'p21-close.png', fullPage: false });
await (await p.$('#mccard')).screenshot({ path: OUT + 'p21-close-card.png' });
// עריכה של הוצאה בחודש סגור
await go(`#/project/${sp.id}/expenses`);
ok('lock icon on closed expense', (await p.textContent('main')).includes('🔒'));
await p.click('[data-ed="exp-close-1"]'); await p.waitForSelector('.dlg [data-k=fix]');
await (await p.$('.dlg')).screenshot({ path: OUT + 'p21-locked.png' });
await p.click('.dlg [data-k=fix]'); await p.waitForSelector('.dlg [name=amount]');
await p.fill('.dlg [name=amount]', '150'); await okDlg();
t = await T(); let corr = t.expenses.find(e => e.correction_of === 'exp-close-1');
ok('correction line in open month', corr && corr.corr_month === prev && corr.amount === 150 && corr.doc_date.slice(0, 7) === cur && t.expenses.find(e => e.id === 'exp-close-1').amount === 1000);
ok('correction chip shown', (await p.textContent('main')).includes('תיקון ל'));
// מחיקה → שורת ביטול
await p.click('[data-del="exp-close-1"]'); await p.waitForSelector('.dlg [data-k=rev]'); await p.click('.dlg [data-k=rev]'); await p.waitForTimeout(900);
t = await T(); ok('delete creates reversal line, original kept', t.expenses.some(e => e.correction_of === 'exp-close-1' && e.amount === -1000) && t.expenses.some(e => e.id === 'exp-close-1'));
// הוצאה חדשה בתאריך של חודש סגור
await p.click('#add'); await p.waitForSelector('.dlg [name=amount]');
await p.fill('.dlg [name=doc_date]', prev + '-20'); await p.fill('.dlg [name=supplier_name]', 'חשבונית מאוחרת'); await p.fill('.dlg [name=amount]', '500'); await okDlg();
t = await T(); const late = t.expenses.find(e => e.supplier_name === 'חשבונית מאוחרת');
ok('late invoice booked as correction in open month', late && late.corr_month === prev && late.doc_date.slice(0, 7) === cur && late.notes.includes('מסמך מתאריך'));
await p.screenshot({ path: OUT + 'p21-expenses.png', fullPage: true });
// דוח הוצאות מציג שורות תיקון
await go('#/reports/expenses'); await p.waitForTimeout(500);
ok('expenses report has correction section', (await p.textContent('main')).includes('שורות תיקון'));
// יומן עבודה בחודש סגור
await go(`#/project/${sp.id}/day/${prev}-10`);
ok('closed work day is read-only', (await p.textContent('main')).includes('סגור') && await p.$eval('#save', b => b.disabled));
// פתיחה מחדש
await go(`#/client/${tid}`); await p.click('#reopen'); await p.waitForSelector('.dlg [data-ok]'); await okDlg();
t = await T(); ok('reopen removes close', !t.month_closes.some(c => c.month === prev));

// ===== 3. ארכיון שליחות =====
await go('#/'); await p.evaluate(() => { window.open = () => null; });
await p.click('[data-wa]'); await p.waitForTimeout(700);
t = await T(); ok('whatsapp alert logged', t.send_log?.some(r => r.channel === 'whatsapp' && r.kind === 'alert' && r.body));
await go('#/sent');
const sl = await p.textContent('main');
ok('archive screen lists send', sl.includes('וואטסאפ') && sl.includes('התרעה'));
await p.click('[data-r]'); await p.waitForSelector('.dlg'); ok('archive shows full text', (await p.textContent('.dlg')).includes('פרויקט:'));
await p.click('.dlg [data-x]');
await p.screenshot({ path: OUT + 'p21-sent.png' });
// הזמנה נרשמת
await go(`#/client/${tid}`); await p.click('#addm'); await p.waitForSelector('.dlg [name=email]'); await p.fill('.dlg [name=email]', 'log.me@example.com'); await p.click('.dlg [data-ok]'); await p.waitForSelector('#invwa');
await p.evaluate(() => { document.querySelector('#invwa').removeAttribute('href'); }); await p.click('#invwa'); await p.waitForTimeout(400);
t = await T(); ok('invite logged', t.send_log.some(r => r.kind === 'invite' && r.recipients === 'log.me@example.com'));
await p.click('.dlg [data-x]');

// ===== טלפון =====
const ph = await (await b.newContext({ viewport: { width: 390, height: 844 } })).newPage(); ph.on('pageerror', e => errs.push(e.message));
await ph.goto(BASE); await ph.waitForTimeout(400);
await ph.evaluate(([k, d]) => localStorage.setItem(k, d), [KEY, await p.evaluate(k => localStorage.getItem(k), KEY)]);
for (const [hsh, nm] of [['#/sent', 'sent'], [`#/client/${tid}`, 'client'], [`#/project/${sp.id}/expenses`, 'exp']]) {
  await ph.goto(BASE + hsh); await ph.reload(); await ph.waitForTimeout(1200);
  ok(`phone ${nm}: no overflow`, (await ph.evaluate(() => document.documentElement.scrollWidth)) <= 392);
  await ph.screenshot({ path: OUT + `p21-${nm}-phone.png`, fullPage: true });
}
ok('no errors', !errs.length); if (errs.length) console.log(errs);
await b.close();
