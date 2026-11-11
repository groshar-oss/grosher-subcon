// בדיקת חבילה 20: מכירות דירות וליווי בנקאי ליזם
import { chromium } from 'playwright';
const BASE = 'http://localhost:8123/'; const KEY = 'grosher-subcon-demo-v5'; const OUT = 'tests/shots/';
const b = await chromium.launch();
const ok = (name, cond) => { console.log((cond ? 'ok   ' : 'FAIL ') + name); if (!cond) process.exitCode = 1; };
const ctx = await b.newContext({ viewport: { width: 1440, height: 950 } }); const p = await ctx.newPage();
const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
const T = () => p.evaluate(k => JSON.parse(localStorage.getItem(k)).tables, KEY);
const go = async h => { await p.goto(BASE + '#/'); await p.waitForTimeout(250); await p.goto(BASE + h); await p.waitForTimeout(800); };
const cur = new Date().toISOString().slice(0, 7);
const addM = (m, k) => { const [y, mo] = m.split('-').map(Number); return new Date(Date.UTC(y, mo - 1 + k, 1)).toISOString().slice(0, 7); };
await p.goto(BASE); await p.waitForSelector('.kpis'); await p.evaluate(() => localStorage.clear()); await p.reload(); await p.waitForSelector('.kpis');
let t = await T();
const dp = t.projects.find(x => x.project_type === 'dev');
const tid = dp.tenant_id; await p.evaluate(id => { localStorage.setItem('subcon-tenant', JSON.stringify(id)); }, tid); await p.reload(); await p.waitForTimeout(600);

// 1. בפרויקט חדש: המודולים מופיעים
await go('#/projects'); await p.click('#add'); await p.waitForSelector('.dlg [name=project_type]');
await p.check('.dlg [name=project_type][value=dev]'); await p.waitForTimeout(150);
ok('new dev project: sales + bank modules offered', await p.$eval('.dlg [name=mod_sales]', i => !i.closest('.modrow').hidden) && await p.$eval('.dlg [name=mod_bank]', i => !i.closest('.modrow').hidden));
await p.check('.dlg [name=project_type][value=sub]'); await p.waitForTimeout(150);
ok('sub project: sales hidden', await p.$eval('.dlg [name=mod_sales]', i => i.closest('.modrow').hidden));
await p.click('.dlg [data-x]');

// 2. הדלקה בהגדרות פרויקט קיים
await go(`#/project/${dp.id}/control`);
ok('tabs hidden while off', !(await p.$(`a[href="#/project/${dp.id}/sales"]`)));
await go(`#/project/${dp.id}/settings`); await p.check('[name=mod_sales]'); await p.check('[name=mod_bank]');
await p.click('form button.btn:has-text("שמירה")'); await p.waitForTimeout(900);
t = await T(); ok('modules saved', t.projects.find(x => x.id === dp.id).modules?.sales && t.projects.find(x => x.id === dp.id).modules?.bank);
await go(`#/project/${dp.id}/sales`);
ok('sales tab shown', !!(await p.$(`a[href="#/project/${dp.id}/sales"].on`)) && !!(await p.$(`a[href="#/project/${dp.id}/bank"]`)));

// 3. יצירת דירות
await p.click('#genu'); await p.waitForSelector('.dlg [name=f2]');
await p.fill('.dlg [name=f1]', '1'); await p.fill('.dlg [name=f2]', '10'); await p.fill('.dlg [name=per]', '4'); await p.fill('.dlg [name=rooms]', '4'); await p.fill('.dlg [name=area]', '100');
await p.fill('.dlg [name=price]', '2500000'); await p.fill('.dlg [name=step]', '20000');
await p.click('.dlg [data-ok]'); await p.waitForTimeout(1200); if (await p.$('.dlg')) console.log('DLG:', await p.textContent('.dlg')); await p.waitForSelector('[data-u]');
t = await T(); let units = t.dev_units.filter(u => u.project_id === dp.id);
ok('40 units created, price steps per floor', units.length === 40 && units.find(u => u.floor === '10').list_price === 2680000);

// 4. מכירת דירה
await p.click(`[data-u="${units[0].id}"]`); await p.waitForSelector('.dlg [name=status]');
await p.selectOption('.dlg [name=status]', 'sold'); await p.fill('.dlg [name=buyer]', 'משפחת כהן'); await p.fill('.dlg [name=sale_price]', '2400000');
await p.fill('.dlg [name=sale_date]', cur + '-05'); await p.waitForTimeout(200);
ok('payment preview shown', (await p.textContent('#plprev')).includes('480,000'));
await (await p.$('.dlg')).screenshot({ path: OUT + 'p20-unit-sale.png' });
await p.click('.dlg [data-ok]'); await p.waitForTimeout(900);
t = await T(); let inc = t.dev_income.filter(i => i.unit_id === units[0].id);
ok('sale creates 4 buyer payments = price', inc.length === 4 && inc.reduce((a, i) => a + i.amount, 0) === 2400000 && inc[0].payer === 'משפחת כהן');
// תשלום ראשון התקבל, שינוי מחיר: רק הצפויים נבנים מחדש
const first = inc.find(i => i.description.includes('בחתימה'));
await p.evaluate(([k, id]) => { const d = JSON.parse(localStorage.getItem(k)); const i = d.tables.dev_income.find(x => x.id === id); i.status = 'received'; i.received_date = i.due_date; localStorage.setItem(k, JSON.stringify(d)); }, [KEY, first.id]);
await p.reload(); await p.waitForTimeout(900);
await p.click(`[data-u="${units[0].id}"]`); await p.waitForSelector('.dlg [name=sale_price]');
ok('received payment note', (await p.textContent('.dlg')).includes('כבר התקבלו 1'));
await p.fill('.dlg [name=sale_price]', '2500000'); await p.click('.dlg [data-ok]'); await p.waitForTimeout(900);
t = await T(); inc = t.dev_income.filter(i => i.unit_id === units[0].id);
ok('resave keeps received, rebuilds expected', inc.length === 4 && inc.filter(i => i.status === 'received').length === 1 && inc.filter(i => i.status !== 'received').reduce((a, i) => a + i.amount, 0) === 2000000);
const main = await p.textContent('main');
ok('sales KPIs', main.includes('נמכרו 1') && main.includes('480,000'));

// 5. קצב מכירות → תזרים
await p.click('#sconf'); await p.waitForSelector('.dlg [name=pace]');
await p.fill('.dlg [name=pace]', '3'); await p.fill('.dlg [name=from_month]', addM(cur, 1));
await p.fill('.dlg [name=pl_pct_0]', '10'); await p.waitForTimeout(100);
await p.click('.dlg [data-ok]'); await p.waitForTimeout(200);
ok('plan must sum to 100', (await p.textContent('.dlg .err')).includes('100%'));
await p.fill('.dlg [name=pl_pct_0]', '20'); await p.click('.dlg [data-ok]'); await p.waitForTimeout(900);
t = await T(); ok('sales conf saved', t.projects.find(x => x.id === dp.id).sales?.pace === 3);
ok('unsold units show forecast month', (await p.textContent('main')).includes('צפי'));
await p.screenshot({ path: OUT + 'p20-sales.png', fullPage: true });
await go(`#/project/${dp.id}/cashflow`);
ok('cashflow has forecast sales row', (await p.textContent('main')).includes('מכירות צפויות'));

// 6. ליווי בנקאי
await go(`#/project/${dp.id}/bank`); if (process.env.DBG) { p.on('console', m => m.text().startsWith('SIM') && console.log(m.text())); await p.evaluate(() => { globalThis.__DBGS = 1; }); }
ok('bank: prompt to enter terms', (await p.textContent('main')).includes('עוד לא הוזנו'));
await p.click('#bconf'); await p.waitForSelector('.dlg [name=line]');
await p.fill('.dlg [name=line]', '60000000'); await p.fill('.dlg [name=equity_pct]', '10'); await p.fill('.dlg [name=presale_pct]', '20'); await p.fill('.dlg [name=rate_pct]', '6.5');
await p.click('.dlg [data-ok]'); await p.waitForTimeout(1000);
t = await T(); ok('bank conf saved', t.projects.find(x => x.id === dp.id).bank?.line === 60000000);
const bt = await p.textContent('main');
ok('bank: conditions + sim shown', bt.includes('תנאים לפתיחת המסגרת') && bt.includes('שיא ניצול') && bt.includes('יתרת אשראי'));
await p.screenshot({ path: OUT + 'p20-bank.png', fullPage: true });
if (await p.$('#tocf')) {
  await p.click('#tocf'); await p.waitForSelector('.dlg [data-ok]'); await p.click('.dlg [data-ok]'); await p.waitForTimeout(1000);
  t = await T(); const sim = t.dev_income.filter(i => i.project_id === dp.id && i.notes === 'sim');
  ok('sim draws moved to cashflow', sim.length > 0 && sim.every(i => i.source === 'bank'));
  await p.click('#tocf'); await p.waitForSelector('.dlg [data-ok]'); await p.click('.dlg [data-ok]'); await p.waitForTimeout(1000);
  const t2 = await T(); ok('second transfer replaces, not duplicates', t2.dev_income.filter(i => i.project_id === dp.id && i.notes === 'sim').length === sim.length);
} else ok('transfer button (draws exist)', false);

// 7. טלפון
const ph = await (await b.newContext({ viewport: { width: 390, height: 844 } })).newPage();
ph.on('pageerror', e => errs.push(e.message));
await ph.goto(BASE); await ph.waitForTimeout(500);
await ph.evaluate(([k, d]) => localStorage.setItem(k, d), [KEY, await p.evaluate(k => localStorage.getItem(k), KEY)]);
await ph.evaluate(id => localStorage.setItem('subcon-tenant', JSON.stringify(id)), tid);
if (process.env.DBG) ph.on('console', m => m.text().startsWith('SIM') && console.log('PH', m.text()));
for (const tab of ['sales', 'bank']) {
  await ph.goto(BASE + `#/project/${dp.id}/${tab}`); if (process.env.DBG) await ph.addInitScript(() => { globalThis.__DBGS = 1; }); await ph.reload(); await ph.waitForTimeout(1200);
  const w = await ph.evaluate(() => document.documentElement.scrollWidth);
  ok(`phone ${tab}: no page overflow`, w <= 392);
  await ph.screenshot({ path: OUT + `p20-${tab}-phone.png`, fullPage: true });
}
if (process.env.DBG) console.log(await p.evaluate(async ([k, id]) => { const S = await import('./js/sales.js'); const T = JSON.parse(localStorage.getItem(k)).tables; const P = T.projects.find(x => x.id === id); const u = T.dev_units.filter(x => x.project_id === id);
  return [P.sales, [...new Set(S.forecastSales(P, u, '2026-10').map(x => x.saleMonth))].slice(0, 5)]; }, [KEY, dp.id]));
ok('no errors', !errs.length); if (errs.length) console.log(errs);
await b.close();
