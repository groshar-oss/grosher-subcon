// בדיקת חבילה 19: פרויקט ביצוע (מזמין), פריסה ארוכה (עקומת S וקומות), קליטת קובץ מתוכנת התמחיר
import { chromium } from 'playwright';
import fs from 'fs';
const BASE = 'http://localhost:8123/'; const KEY = 'grosher-subcon-demo-v5'; const OUT = 'tests/shots/';
const SAMPLE = 'tests/private/fitout-sample.json'; // קובץ תמחור אמיתי: נשמר מחוץ לריפו (tests/private), ראו tests/README.md
const b = await chromium.launch();
const ok = (name, cond) => { console.log((cond ? 'ok   ' : 'FAIL ') + name); if (!cond) process.exitCode = 1; };
const ctx = await b.newContext({ viewport: { width: 1440, height: 950 } });
const p = await ctx.newPage();
const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
const T = () => p.evaluate(k => JSON.parse(localStorage.getItem(k)).tables, KEY);
const go = async h => { await p.goto(BASE + '#/'); await p.waitForTimeout(250); await p.goto(BASE + h); await p.waitForTimeout(700); };
const cur = new Date().toISOString().slice(0, 7);
const addM = (m, k) => { const [y, mo] = m.split('-').map(Number); return new Date(Date.UTC(y, mo - 1 + k, 1)).toISOString().slice(0, 7); };

await p.goto(BASE); await p.waitForSelector('.kpis'); await p.evaluate(() => localStorage.clear()); await p.reload(); await p.waitForSelector('.kpis');
const tenant = await p.$eval('#tsel', s => s.value);

// 1. פרויקט ביצוע חדש
await go('#/projects'); await p.click('#add'); await p.waitForSelector('.dlg [name=project_type]');
ok('new project: 3 types', (await p.$$('.dlg [name=project_type]')).length === 3);
await p.check('.dlg [name=project_type][value=exec]'); await p.waitForTimeout(150);
ok('exec: party label is מזמין', (await p.textContent('.dlg .mclbl')) === 'מזמין' && (await p.textContent('.dlg .mcnew')).includes('מזמין חדש'));
ok('exec: hint text', (await p.textContent('#ptyhint')).includes('מול המזמין'));
ok('exec: sub modules shown with defaults', await p.$eval('.dlg [name=mod_workers]', i => i.checked && !i.closest('.modrow').hidden) && !(await p.$eval('.dlg [name=mod_spread]', i => i.checked)));
await p.fill('.dlg [name=name]', 'מגדלי הים · ביצוע (בדיקה)');
await p.fill('.dlg [name=start_date]', addM(cur, -2) + '-01'); await p.fill('.dlg [name=end_date]', addM(cur, 16) + '-28');
await p.check('.dlg [name=mod_spread]'); await p.waitForTimeout(100);
ok('spread editor appears when module on', await p.$eval('.dlg .spreadonly', e => !e.hidden));
ok('spread preview drawn', (await p.$$('.dlg .spbars > div')).length >= 18);
await p.screenshot({ path: OUT + 'p19-new-exec.png' });
await p.click('.dlg [data-ok]'); await p.waitForTimeout(900);
let t = await T();
const ep = t.projects.find(x => x.name.startsWith('מגדלי הים'));
ok('exec project saved', ep && ep.project_type === 'exec' && ep.modules?.spread === true && ep.spread?.curve === 's');
ok('exec opens on BOQ tab', (await p.evaluate(() => location.hash)).includes('/boq'));

// 2. קליטה מתוכנת התמחיר
await go(`#/project/${ep.id}/boq`); await p.waitForSelector('#imp');
ok('import button mentions pricing app', (await p.textContent('#imp')).includes('תמחיר'));
await p.setInputFiles('#file', SAMPLE); await p.waitForSelector('#impbox .kpis');
const box = await p.textContent('#impbox');
ok('fitout: 41 items read (options excluded)', box.includes('41'));
ok('fitout: note with K, options, cost + overhead options', box.includes('קובץ מתוכנת התמחיר') && /1\.44[23]/.test(box) && box.includes('2 חלופות') && !!(await p.$('[name=fo_cost]')) && !!(await p.$('[name=fo_oh]')));
ok('fitout: total = pricing app sell total', box.includes('699,5'));
await (await p.$('.dlg')).screenshot({ path: OUT + 'p19-fitout-import.png' });
await p.click('.dlg [data-ok]'); await p.waitForTimeout(1200);
t = await T();
const items = t.boq_items.filter(i => i.project_id === ep.id);
const lines = t.cost_lines.filter(l => l.project_id === ep.id);
const sale = items.reduce((a, i) => a + i.qty * i.unit_price, 0);
ok('BOQ created from pricing app (41 items, ≈699,519)', items.length === 41 && Math.abs(sale - 699519) < 50);
ok('costing lines created from pricing costs', lines.length === 47 && Math.abs(lines.reduce((a, l) => a + l.qty * l.unit_cost * (l.kind === 'material' ? 1 + (l.waste_pct || 0) / 100 : 1), 0) - 484937) < 50);
const pr = t.projects.find(x => x.id === ep.id);
ok('project overhead set from site overheads (21.4%)', Math.abs(pr.overhead_pct - 21.4) < 0.05);
ok('chapters kept', new Set(items.map(i => i.chapter)).size >= 10);
await go(`#/project/${ep.id}/control`); await p.waitForTimeout(400);
const ctl = await p.textContent('main');
ok('control shows planned profit', ctl.includes('רווח'));

// 3. תוויות "מזמין" בפרויקט ביצוע
ok('project header: no main contractor label', !(await p.textContent('.top')).includes('קבלן ראשי'));
await go(`#/project/${ep.id}/cashflow`); await p.waitForSelector('.cft');
const cf = await p.textContent('.cft'), bar = await p.evaluate(() => document.querySelector('#dl').parentElement.textContent);
ok('cashflow: receipts from client (מזמין)', cf.includes('תקבולים מהמזמין') && bar.includes('בתשלומי המזמין'));
// פריסה בעקומת S: חשבונות עתידיים לא שווים בכל חודש, סה"כ נשמר
const fut = await p.evaluate(async pid => { const { cfFor } = await import('./js/views/cashflow.js'); const { loadTenantData } = await import('./js/app.js'); const d = await loadTenantData(); const r = cfFor(d, [pid], { ahead: 24, delay: 0 }); return r.months.map(m => Math.round(m.rows.in_future)).filter(Boolean); }, ep.id);
ok('S-curve: uneven monthly receipts (middle > edges)', fut.length > 8 && Math.max(...fut) > fut[0] * 1.5 && Math.max(...fut) > fut[fut.length - 1] * 1.5);
await go(`#/project/${ep.id}/vo`); await p.click('#add').catch(() => {}); await p.waitForTimeout(300);
if (await p.$('.dlg [name=source]')) { ok('VO source: בקשת המזמין', (await p.textContent('.dlg [name=source]')).includes('בקשת המזמין')); await p.click('.dlg [data-x]'); await p.waitForTimeout(200); }

// 4. קומות: יצירה מהירה, שמירה, השפעה על התזרים
await go(`#/project/${ep.id}/settings`); await p.waitForSelector('.spreadonly');
ok('settings: type select (sub/exec)', (await p.$eval('select[name=project_type]', s => s.value)) === 'exec');
await p.evaluate(() => { document.querySelector('.spreadonly details').open = true; });
await p.fill('#spn', '8'); await p.fill('#spm', addM(cur, 1)); await p.fill('#spk', '2'); await p.click('#spgen'); await p.waitForTimeout(200);
ok('floors generated: 8 rows', (await p.$$('#spt tr')).length === 8 && (await p.inputValue('#spt tr:nth-child(8) [data-f=to_month]')) === addM(cur, 16));
await (await p.$('.spreadonly')).screenshot({ path: OUT + 'p19-spread.png' });
await p.click('#pf button.btn:not(.ghost)'); await p.waitForTimeout(800);
t = await T();
const ep2 = t.projects.find(x => x.id === ep.id);
ok('floors saved', ep2.spread.floors.length === 8 && ep2.spread.floors[0].name === 'קומה 1');
ok('spread change logged', t.change_log.some(c => c.project_id === ep.id && c.label === 'פריסה לאורך הפרויקט'));
const fut2 = await p.evaluate(async pid => { const { cfFor } = await import('./js/views/cashflow.js'); const { loadTenantData } = await import('./js/app.js'); const d = await loadTenantData(); const r = cfFor(d, [pid], { ahead: 24, delay: 0 }); return r.months.filter(m => !m.past).map(m => Math.round(m.rows.in_future)); }, ep.id);
ok('floors: nothing billed before first floor month', fut2.slice(0, 2).every(x => x === 0) && fut2.some(x => x > 0));
// החלפה לקבלן משנה מחזירה את התווית
await p.selectOption('select[name=project_type]', 'sub'); await p.waitForTimeout(100);
ok('switch to sub: label back to קבלן ראשי', (await p.textContent('.mclbl')) === 'קבלן ראשי');
await p.selectOption('select[name=project_type]', 'exec');

// 5. רשימת פרויקטים והגדרות לקוח
await go('#/projects'); await p.waitForTimeout(300);
const pl = await p.textContent('main');
ok('projects list: exec chip + mixed header', pl.includes('ביצוע') && pl.includes('קבלן ראשי / מזמין'));
await go(`#/client/${tenant}`);
ok('client page: main contractors and clients', (await p.textContent('main')).includes('קבלנים ראשיים ומזמינים'));

// 6. תקציב יזם מקובץ התמחיר (בלי עלויות)
t = await T();
const dt = t.tenants.find(x => x.name.includes('יזמות'));
await p.selectOption('#tsel', dt.id); await p.waitForTimeout(600);
await go('#/projects'); await p.click('#add'); await p.waitForSelector('.dlg [name=project_type]');
await p.check('.dlg [name=project_type][value=dev]'); await p.fill('.dlg [name=name]', 'יזם מתמחיר (בדיקה)'); await p.click('.dlg [data-ok]'); await p.waitForTimeout(900);
t = await T(); const dp = t.projects.find(x => x.name === 'יזם מתמחיר (בדיקה)');
await go(`#/project/${dp.id}/boq`); await p.setInputFiles('#file', SAMPLE); await p.waitForSelector('#impbox .kpis');
ok('dev import: no costing checkboxes', !(await p.$('[name=fo_cost]')));
await p.click('.dlg [data-ok]'); await p.waitForTimeout(1000);
t = await T();
ok('dev budget from pricing app', t.boq_items.filter(i => i.project_id === dp.id).length === 41 && !t.cost_lines.some(l => l.project_id === dp.id));

// 7. קובץ לא נכון
await p.setInputFiles('#file', { name: 'x.json', mimeType: 'application/json', buffer: Buffer.from('{"a":1}') }); await p.waitForTimeout(500);
ok('wrong json: clear message', (await p.textContent('body')).includes('לא קובץ פרויקט של תוכנת התמחיר'));

// 8. טלפון
await p.selectOption('#tsel', tenant); await p.waitForTimeout(500);
const ph = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const q = await ph.newPage(); q.on('pageerror', e => errs.push('phone: ' + e.message));
const state = await p.evaluate(k => localStorage.getItem(k), KEY);
await q.goto(BASE); await q.evaluate(([k, v]) => localStorage.setItem(k, v), [KEY, state]); await q.reload(); await q.waitForTimeout(800);
for (const [h, sel, name] of [[`#/project/${ep.id}/settings`, '.spreadonly', 'spread'], [`#/project/${ep.id}/boq`, 'table', 'boq'], [`#/project/${ep.id}/cashflow`, '.cft', 'cash']]) {
  await q.goto(BASE + '#/'); await q.waitForTimeout(200); await q.goto(BASE + h); await q.waitForTimeout(800);
  const el = await q.$(sel); ok(`phone: ${name} renders`, !!el);
  ok(`phone: ${name} no page overflow`, (await q.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 1);
  if (el) { await el.scrollIntoViewIfNeeded(); await q.screenshot({ path: OUT + `p19-phone-${name}.png` }); }
}
ok('no page errors', errs.length === 0); if (errs.length) console.log(errs.slice(0, 8));
await b.close();
