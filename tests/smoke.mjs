// בדיקת עשן: טוען כל מסך במצב הדגמה, אוסף שגיאות ומצלם
import { chromium } from 'playwright';
const BASE = process.env.BASE || 'http://localhost:8123/';
const out = process.env.OUT || 'tests/shots';
const b = await chromium.launch();
const errors = [];
async function page(w, h) {
  const p = await b.newPage({ viewport: { width: w, height: h } });
  p.on('pageerror', e => errors.push('pageerror ' + e.message));
  p.on('console', m => { if (m.type() === 'error') errors.push('console ' + m.text()); });
  return p;
}
const p = await page(1440, 900);
await p.goto(BASE); await p.waitForSelector('.kpis', { timeout: 15000 });
await p.screenshot({ path: out + '/home.png', fullPage: true });
const pid = await p.evaluate(() => document.querySelector('a.proj').getAttribute('href').split('/')[2]);
for (const tab of ['control', 'boq', 'costing', 'quota', 'vo', 'worklog', 'purchase', 'expenses', 'bills', 'cashflow', 'log', 'settings']) {
  await p.goto(BASE + `#/project/${pid}/${tab}`); await p.waitForTimeout(500);
  await p.screenshot({ path: `${out}/p-${tab}.png`, fullPage: true });
}
for (const r of ['projects', 'clients', 'settings', 'workers', 'workers/attendance', 'collection', 'cashflow', 'reports/profit', 'reports/labor', 'reports/expenses', 'reports/vo', 'reports/retention', 'reports/client', 'vendors', 'vendors/own', 'vendors/guarantees', 'contacts']) { await p.goto(BASE + '#/' + r); await p.waitForTimeout(400); await p.screenshot({ path: `${out}/${r.replace('/', '-')}.png`, fullPage: true }); }
const bid = await p.evaluate(k => JSON.parse(localStorage.getItem(k)).tables.bills.find(b => b.number === 2).id, 'grosher-subcon-demo-v5');
await p.goto(BASE + `#/project/${pid}/bill/${bid}`); await p.waitForTimeout(600); await p.addStyleTag({ content: '.savebar{position:static!important}' }); await p.screenshot({ path: out + '/bill-2.png', fullPage: true });
await p.goto(BASE + `#/project/${pid}/day/2026-10-13`); await p.waitForTimeout(500); await p.screenshot({ path: out + '/day-desktop.png', fullPage: true });
const m = await page(390, 844);
await m.goto(BASE); await m.waitForSelector('.kpis');
await m.screenshot({ path: out + '/m-home.png', fullPage: true });
const of = [];
for (const tab of ['control', 'boq', 'costing', 'quota', 'vo', 'worklog', 'purchase', 'expenses', 'bills', 'cashflow', 'day/today']) {
  await m.goto(BASE + `#/project/${pid}/${tab}`); await m.waitForTimeout(400);
  if (await m.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)) of.push(tab);
}
await m.goto(BASE + `#/project/${pid}/quota`); await m.waitForTimeout(400); await m.screenshot({ path: out + '/m-quota.png', fullPage: true });
for (const r of ['reports/client', 'reports/labor', 'vendors', 'vendors/guarantees', 'contacts']) { await m.goto(BASE + '#/' + r); await m.waitForTimeout(400); if (await m.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)) of.push(r); }
await m.goto(BASE + '#/cashflow'); await m.waitForTimeout(500); await m.screenshot({ path: out + '/m-cashflow.png', fullPage: true }); if (await m.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)) of.push('cashflow');
// מנהל עבודה בטלפון: בית, פרויקט, יומן היום, סימון עובד ושמירה
await m.goto(BASE); await m.waitForSelector('#demoRole'); await m.selectOption('#demoRole', 'foreman'); await m.waitForSelector('text=הפרויקטים שלי', { timeout: 15000 }); await m.waitForTimeout(300);
await m.screenshot({ path: out + '/f-home.png', fullPage: true });
if (await m.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)) of.push('f-home');
await m.click('text=יומן עבודה להיום'); await m.waitForSelector('.dayv'); await m.waitForTimeout(300);
const before = await m.evaluate(() => JSON.parse(localStorage.getItem('grosher-subcon-demo-v5')).tables.work_entries.length);
await m.click('.wrow input[type=checkbox] >> nth=0'); await m.click('.wrow input[type=checkbox] >> nth=1');
await m.screenshot({ path: out + '/f-day.png', fullPage: true });
if (await m.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)) of.push('f-day');
await m.click('#save'); await m.waitForTimeout(800);
const after = await m.evaluate(() => JSON.parse(localStorage.getItem('grosher-subcon-demo-v5')).tables.work_entries.length);
console.log('foreman saved entries:', after - before, '· back at', await m.evaluate(() => location.hash.split('/').pop()));
const leak = await m.evaluate(() => /₪/.test(document.body.innerText));
console.log('foreman sees ₪:', leak);
await m.selectOption('#demoRole', 'admin'); await m.waitForTimeout(500);
await m.screenshot({ path: out + '/m-expenses.png', fullPage: true });
console.log('overflow:', of.join(',') || 'none');
console.log(errors.length ? errors.join('\n') : 'no errors');
await b.close();
