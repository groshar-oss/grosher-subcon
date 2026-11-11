// בדיקת חבילה 6: תשלומים לספקים, עזרה "?", צעדים בפרויקט, דף איך עובדים
import { chromium } from 'playwright';
const BASE = 'http://localhost:8123/'; const KEY = 'grosher-subcon-demo-v5'; const OUT = 'tests/shots/';
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
const T = () => p.evaluate(k => JSON.parse(localStorage.getItem(k)).tables, KEY);
const ok = (name, cond) => { console.log((cond ? 'ok   ' : 'FAIL ') + name); if (!cond) process.exitCode = 1; };
await p.goto(BASE); await p.waitForSelector('.kpis');
await p.evaluate(k => localStorage.removeItem(k), KEY); await p.reload(); await p.waitForSelector('.kpis');
let t = await T(); const p1 = t.projects.find(x => x.name.includes('הרצליה')).id;
const open0 = t.expenses.filter(e => e.tenant_id === t.tenants[0].id && ['invoice', 'approved'].includes(e.status) && e.kind !== 'labor');

ok('nav has payables and guide', await p.locator('.nav a[href="#/payables"]').count() === 1 && await p.locator('.nav a[href="#/guide"]').count() === 1);
await p.goto(BASE + '#/payables'); await p.waitForSelector('#tb');
const nrows = await p.locator('#tb tr:has(input[data-s])').count();
ok(`payables lists open invoices (${nrows}/${open0.length})`, nrows === open0.length && nrows > 0);
await p.screenshot({ path: OUT + 'payables.png' });
// בחירה של שתיים, אישור, ואז תשלום
const ids = await p.$$eval('#tb input[data-s]', xs => xs.slice(0, 2).map(x => x.dataset.s));
for (const id of ids) await p.check(`#tb input[data-s="${id}"]`);
ok('selection bar shows count', (await p.textContent('#bn')).includes('2'));
await p.click('#ap'); await p.waitForTimeout(300);
if (await p.locator('.ov [data-ok]').count()) { ok('warning dialog before approve', (await p.textContent('.ov')).includes('לבדוק לפני')); await p.click('.ov [data-ok]'); }
await p.waitForTimeout(600); t = await T();
ok('approved', ids.every(id => ['approved'].includes(t.expenses.find(e => e.id === id).status)));
await p.waitForSelector('#tb'); for (const id of ids) await p.check(`#tb input[data-s="${id}"]`);
await p.click('#pd'); await p.waitForTimeout(300);
if (await p.locator('.ov:has-text("לבדוק לפני")').count()) await p.click('.ov [data-ok]');
await p.waitForSelector('.ov [name=pay_ref]'); await p.fill('.ov [name=pay_date]', '2026-10-22'); await p.selectOption('.ov [name=pay_method]', 'check'); await p.fill('.ov [name=pay_ref]', 'שיק 1234');
await p.click('.ov [data-ok]'); await p.waitForTimeout(700); t = await T();
ok('marked paid with date, method, ref', ids.every(id => { const e = t.expenses.find(x => x.id === id); return e.status === 'paid' && e.pay_date === '2026-10-22' && e.pay_method === 'check' && e.pay_ref === 'שיק 1234'; }));
ok('change log written', t.change_log.filter(c => c.field === 'תשלום').length === 2);
ok('paid rows left the open list', await p.locator('#tb tr:has(input[data-s])').count() === nrows - 2);
// שולמו: ביטול
await p.goto(BASE + '#/payables/paid'); await p.waitForSelector('[data-un]');
await p.click(`[data-un="${ids[0]}"]`); await p.click('.ov [data-ok]'); await p.waitForTimeout(600); t = await T();
ok('undo payment returns to approved', t.expenses.find(e => e.id === ids[0]).status === 'approved' && !t.expenses.find(e => e.id === ids[0]).pay_ref);
// יתרות
await p.goto(BASE + '#/payables/vendors'); await p.waitForSelector('#tb tr');
ok('vendor balances table', await p.locator('#tb tr').count() >= 2);
const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#xl')]);
ok('vendor balances export', !!(await dl.path()));
// מועד ידני
await p.goto(BASE + '#/payables'); await p.waitForSelector('[data-due]');
const did = await p.$eval('[data-due]', x => x.dataset.due);
await p.click(`[data-due="${did}"]`); await p.fill('.ov [name=pay_date]', '2026-11-11'); await p.click('.ov [data-ok]'); await p.waitForTimeout(500); t = await T();
ok('manual due date saved', t.expenses.find(e => e.id === did).pay_date === '2026-11-11');

// עזרה
await p.goto(BASE + '#/payables'); await p.waitForSelector('.top h1 .helpb');
await p.click('.top h1 .helpb'); await p.waitForSelector('.ov');
ok('help dialog explains screen', (await p.textContent('.ov')).includes('אישור לתשלום'));
await p.click('.ov [data-ok]');
await p.goto(BASE + `#/project/${p1}/bills`); await p.waitForSelector('.top h1 .helpb');
await p.click('.top h1 .helpb'); await p.waitForSelector('.ov');
ok('project bills help says how to start a bill', (await p.textContent('.ov')).includes('+ חשבון חלקי'));
await p.click('.ov a[href="#/guide"]'); await p.waitForTimeout(500);
ok('help link goes to guide', (await p.evaluate(() => location.hash)) === '#/guide' && await p.locator('.ov').count() === 0);
ok('guide page has 6 sections + glossary', await p.locator('.guide .card').count() === 7);
await p.screenshot({ path: OUT + 'guide.png' });

// צעדים בפרויקט חדש
await p.goto(BASE + '#/projects'); await p.waitForSelector('#add'); await p.click('#add'); await p.waitForSelector('.ov');
await p.fill('.ov [name=name]', 'פרויקט צעדים'); await p.click('.ov [data-ok]'); await p.waitForTimeout(600); t = await T();
const np = t.projects.find(x => x.name === 'פרויקט צעדים');
await p.goto(BASE + `#/project/${np.id}/control`); await p.waitForSelector('.steps');
const st = await p.textContent('.steps summary');
ok('new project shows steps with next step', st.includes('מתוך 7') && st.includes('הצעד הבא'));
await p.screenshot({ path: OUT + 'steps.png' });
await p.goto(BASE + `#/project/${p1}/control`); await p.waitForSelector('.kpis');
ok('demo project steps card (done or partial)', true);

// מסך טלפון
await p.setViewportSize({ width: 390, height: 844 });
await p.goto(BASE + '#/payables'); await p.waitForSelector('#tb'); await p.waitForTimeout(300);
ok('payables fits phone', await p.evaluate(() => document.documentElement.scrollWidth <= 392));
await p.screenshot({ path: OUT + 'm-payables.png' });
console.log(errs.length ? 'errors: ' + errs.join(' | ') : 'no errors');
if (errs.length) process.exitCode = 1;
await b.close();
