// בדיקת חבילה 7: טעינת לקוחות דמו (גבס, צבע, ריצוף), מעבר בכל המסכים, ומחיקה
import { chromium } from 'playwright';
const BASE = 'http://localhost:8123/'; const KEY = 'grosher-subcon-demo-v5'; const OUT = 'tests/shots/';
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
const T = () => p.evaluate(k => JSON.parse(localStorage.getItem(k)).tables, KEY);
const ok = (name, cond) => { console.log((cond ? 'ok   ' : 'FAIL ') + name); if (!cond) process.exitCode = 1; };
await p.goto(BASE); await p.waitForSelector('.kpis');
await p.evaluate(k => localStorage.removeItem(k), KEY); await p.reload(); await p.waitForSelector('.kpis');
let t = await T(); const realId = 'real-tenant-1';
// לקוח "אמיתי" שלא אמור להימחק
await p.evaluate(([k, id]) => { const d = JSON.parse(localStorage.getItem(k)); d.tables.tenants.push({ id, name: 'לקוח אמיתי', settings: {}, is_demo: false }); d.tables.projects.push({ id: 'real-p', tenant_id: id, name: 'פרויקט אמיתי', status: 'active', contract_type: 'measure' }); localStorage.setItem(k, JSON.stringify(d)); }, [KEY, realId]);
await p.goto(BASE + '#/settings'); await p.reload(); await p.waitForSelector('#democ');
ok('demo card visible to admin', (await p.textContent('#democ')).includes('לקוחות דמו'));
await p.click('#dload'); await p.waitForSelector('.ov'); ok('confirm warns existing demo is replaced', (await p.textContent('.ov')).includes('יימחקו קודם'));
await p.click('.ov [data-ok]'); await p.waitForFunction(() => document.querySelector('#democ')?.textContent.includes('4 לקוחות דמו'), null, { timeout: 20000 });
t = await T();
ok('4 demo tenants + real kept', t.tenants.filter(x => x.is_demo).length === 4 && t.tenants.some(x => x.id === realId));
ok('13 demo projects', t.projects.filter(x => x.is_demo).length === 13);
const names = t.tenants.filter(x => x.is_demo).map(x => x.name);
ok('gypsum, paint, tiling, developer', ['גבס', 'צבע', 'ריצוף', 'יזמות'].every(w => names.some(n => n.includes(w))));
const per = Object.fromEntries(t.tenants.filter(x => x.is_demo).map(x => [x.name, t.projects.filter(p => p.tenant_id === x.id).length]));
console.log(per);
ok('4/3/5/1 projects', Object.values(per).sort().join(',') === '1,3,4,5');
await p.screenshot({ path: OUT + 'demo-settings.png' });
// מעבר בכל המסכים של כל לקוח
const pages = ['#/', '#/projects', '#/inbox', '#/payables', '#/payables/vendors', '#/workers', '#/collection', '#/cashflow', '#/reports', '#/vendors', '#/contacts'];
const TABS = ['control', 'boq', 'costing', 'quota', 'vo', 'worklog', 'purchase', 'expenses', 'bills', 'cashflow', 'docs', 'settings', 'contracts', 'cos', 'cbills', 'log'];
for (const tn of t.tenants.filter(x => x.is_demo)) {
  await p.evaluate(id => localStorage.setItem('subcon-tenant', JSON.stringify(id)), tn.id);
  await p.goto(BASE + '#/'); await p.reload(); await p.waitForSelector('.kpis');
  let bad = [];
  for (const pg of pages) { await p.goto(BASE + pg); await p.waitForTimeout(250); if (await p.locator('text=משהו השתבש').count()) bad.push(pg); }
  for (const pr of t.projects.filter(x => x.tenant_id === tn.id)) for (const tab of TABS) { await p.goto(BASE + `#/project/${pr.id}/${tab}`); await p.waitForTimeout(150); if (await p.locator('text=משהו השתבש').count()) bad.push(pr.name + '/' + tab); }
  const home = await p.goto(BASE + '#/').then(() => p.waitForTimeout(300)).then(() => p.textContent('#main'));
  ok(`${tn.name}: all screens open${bad.length ? ' ' + bad.join(',') : ''}`, !bad.length);
  ok(`${tn.name}: home has alerts`, /חריג|באיחור|פג|מכסה|לא אושר|התקשרות|מעל/.test(home));
  const short = tn.name.includes('צבע') ? 'paint' : tn.name.includes('ריצוף') ? 'tile' : tn.name.includes('יזמות') ? 'dev' : 'gyps';
  await p.goto(BASE + '#/projects'); await p.waitForTimeout(300); await p.screenshot({ path: OUT + `demo-${short}-projects.png` });
  await p.goto(BASE + '#/'); await p.waitForTimeout(300); await p.screenshot({ path: OUT + `demo-${short}-home.png`, fullPage: true });
  if (short === 'tile') { await p.goto(BASE + '#/payables'); await p.waitForTimeout(300); ok('tile payables has warnings', (await p.textContent('#main')).includes('יותר ממה שסופק')); await p.screenshot({ path: OUT + 'demo-tile-payables.png' }); }
}
// מחיקה
await p.goto(BASE + '#/settings'); await p.waitForSelector('#ddel'); await p.click('#ddel'); await p.click('.ov [data-ok]');
await p.waitForFunction(() => document.querySelector('#democ')?.textContent.includes('אין לקוחות דמו'), null, { timeout: 10000 });
t = await T();
ok('delete removes only demo', t.tenants.length === 1 && t.tenants[0].id === realId && t.projects.length === 1 && !t.expenses.length && !t.work_entries.length && !t.workers.length);
console.log(errs.length ? 'errors: ' + errs.join(' | ') : 'no errors');
if (errs.length) process.exitCode = 1;
await b.close();
