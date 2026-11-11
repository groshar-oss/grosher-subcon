import { chromium, devices } from 'playwright';
const b = await chromium.launch(); const ctx = await b.newContext({ ...devices['Pixel 7'], colorScheme: 'dark' }); const p = await ctx.newPage();
const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.goto('http://localhost:8123/'); await p.waitForSelector('.kpis');
await p.evaluate(() => localStorage.clear()); await p.reload(); await p.waitForSelector('.kpis');
await p.goto('http://localhost:8123/#/settings'); await p.waitForSelector('#dload'); await p.click('#dload'); await p.click('.ov [data-ok]');
await p.waitForFunction(() => document.querySelector('#democ')?.textContent.includes('4 לקוחות דמו'), null, { timeout: 30000 });
const T = await p.evaluate(() => JSON.parse(localStorage.getItem('grosher-subcon-demo-v5')).tables);
const TABS = ['control', 'boq', 'costing', 'quota', 'vo', 'worklog', 'purchase', 'expenses', 'bills', 'cashflow', 'docs', 'log', 'settings', 'contracts', 'cos', 'cbills'];
const G = ['#/', '#/projects', '#/inbox', '#/workers', '#/collection', '#/payables', '#/payables/vendors', '#/cashflow', '#/reports', '#/reports/labor', '#/reports/expenses', '#/reports/vo', '#/reports/retention', '#/reports/client', '#/vendors', '#/contacts', '#/guide', '#/settings', '#/clients'];
const bad = [];
for (const tn of T.tenants) {
  await p.evaluate(id => localStorage.setItem('subcon-tenant', JSON.stringify(id)), tn.id); await p.goto('http://localhost:8123/#/'); await p.reload(); await p.waitForTimeout(600);
  const urls = [...G, '#/client/' + tn.id, ...T.projects.filter(x => x.tenant_id === tn.id).flatMap(pr => [...TABS.map(t => `#/project/${pr.id}/${t}`), ...T.bills.filter(b => b.project_id === pr.id).slice(0, 1).map(b => `#/project/${pr.id}/bill/${b.id}`)])];
  for (const u of urls) { await p.goto('http://localhost:8123/' + u); await p.waitForTimeout(250);
    const sw = await p.evaluate(() => document.documentElement.scrollWidth); if (sw > 413) bad.push(tn.name.slice(0, 8) + ' ' + u.replace(/[0-9a-f-]{36}/g, 'X') + ' ' + sw); }
}
console.log(bad.length ? bad.join('\n') : 'all pages fit'); console.log(errs.join('|') || 'no errors');
const id = T.projects.find(x => x.name.includes('פתח תקווה')).id;
await p.evaluate(id => localStorage.setItem('subcon-tenant', JSON.stringify(id)), T.projects.find(x => x.id === id).tenant_id);
await p.goto(`http://localhost:8123/#/project/${id}/control`); await p.reload(); await p.waitForTimeout(800); await p.screenshot({ path: '/tmp/sh/mob-after.png' });
await p.goto(`http://localhost:8123/#/project/${id}/bills`); await p.waitForTimeout(600); await p.screenshot({ path: '/tmp/sh/mob-bills.png' });
await b.close();
