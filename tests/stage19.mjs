// בדיקת חבילה 18: מודולים בפרויקט, מדד חודשי והצמדה, עלויות חודשיות קבועות, תצוגת תזרים לפי שבוע/חודש/רבעון/שנה
import { chromium } from 'playwright';
const BASE = 'http://localhost:8123/'; const KEY = 'grosher-subcon-demo-v5'; const OUT = 'tests/shots/';
const b = await chromium.launch();
const ok = (name, cond) => { console.log((cond ? 'ok   ' : 'FAIL ') + name); if (!cond) process.exitCode = 1; };
const ctx = await b.newContext({ viewport: { width: 1440, height: 950 } });
const p = await ctx.newPage();
const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
const T = () => p.evaluate(k => JSON.parse(localStorage.getItem(k)).tables, KEY);
const go = async h => { await p.goto(BASE + '#/'); await p.waitForTimeout(250); await p.goto(BASE + h); await p.waitForTimeout(700); };
// עריכה ישירה של נתוני הדמו, ואז טעינה מחדש כדי שהאפליקציה תקרא אותם
const patch = async (table, id, row) => { await p.evaluate(([k, table, id, row]) => { const d = JSON.parse(localStorage.getItem(k)); const r = d.tables[table].find(x => x.id === id); Object.assign(r, row); localStorage.setItem(k, JSON.stringify(d)); }, [KEY, table, id, row]); await p.reload(); await p.waitForTimeout(600); };
const cur = new Date().toISOString().slice(0, 7);
const addM = (m, k) => { const [y, mo] = m.split('-').map(Number); return new Date(Date.UTC(y, mo - 1 + k, 1)).toISOString().slice(0, 7); };

await p.goto(BASE); await p.waitForSelector('.kpis'); await p.evaluate(() => localStorage.clear()); await p.reload(); await p.waitForSelector('.kpis');
let t = await T();
const tenant = await p.$eval('#tsel', s => s.value);
const sp = t.projects.find(x => x.tenant_id === tenant && x.project_type !== 'dev' && x.status !== 'closed');
ok('demo sub project found', !!sp);

// 1. חלק המודולים בהגדרות הפרויקט
await go(`#/project/${sp.id}/settings`);
await p.waitForSelector('fieldset.mods');
const modNames = await p.$$eval('fieldset.mods .modrow:not([hidden]) input', a => a.map(i => i.name));
ok('settings: modules section lists 6 sub modules', ['mod_workers', 'mod_purchase', 'mod_guarantees', 'mod_fines', 'mod_index', 'mod_fixed'].every(n => modNames.includes(n)));
ok('old project: existing parts on', await p.$eval('[name=mod_workers]', i => i.checked) && await p.$eval('[name=mod_guarantees]', i => i.checked));
ok('old project: new modules off', !(await p.$eval('[name=mod_fixed]', i => i.checked)));
await (await p.$('fieldset.mods')).screenshot({ path: OUT + 'p18-modules.png' });

// כיבוי עובדים: לשונית יומן נעלמת, הנתונים נשמרים
const entriesBefore = (await T()).work_entries.filter(e => e.project_id === sp.id).length;
await p.uncheck('[name=mod_workers]');
await p.check('[name=mod_index]'); await p.waitForSelector('.idxonly:not([hidden])');
await p.fill('[name=base_index]', '130');
await p.check('[name=mod_fixed]');
await p.click('#pf button.btn:not(.ghost)'); await p.waitForTimeout(800);
t = await T(); let pr = t.projects.find(x => x.id === sp.id);
ok('saved modules json', pr.modules && pr.modules.workers === false && pr.modules.index === true && pr.modules.fixed === true);
ok('indexation synced with module', pr.indexation === true && Number(pr.base_index) === 130);
ok('change log for modules', t.change_log.some(c => c.project_id === sp.id && c.label === 'מודולים בפרויקט'));
await go(`#/project/${sp.id}/control`);
const tabs = await p.$$eval('.ptabs a, .tabs a', a => a.map(x => x.textContent.trim()));
ok('worklog tab hidden when workers module off', !tabs.some(x => x.includes('יומן עבודה')) && tabs.some(x => x.includes('תזרים')));
ok('work log data kept', (await T()).work_entries.filter(e => e.project_id === sp.id).length === entriesBefore);

// 2. מדד חודשי בהגדרות הלקוח
await go(`#/client/${tenant}`);
await p.waitForSelector('#idxcard');
ok('client page: index card shown (project with index module)', (await p.textContent('#idxcard')).includes(sp.name));
for (const [m, v] of [[addM(cur, -3), '131.2'], [addM(cur, -2), '132.4']]) {
  await p.click('#addix'); await p.waitForSelector('.dlg [name=month]'); await p.waitForTimeout(200);
  await p.fill('.dlg [name=month]', m); await p.fill('.dlg [name=value]', v); await p.click('.dlg [data-ok]'); await p.waitForTimeout(400); if (await p.$('.dlg')) console.log('DLG', await p.$$eval('.dlg', a => a.length), await p.$$eval('.dlg [name=value]', a => a.map(x => x.value))); await p.waitForSelector('.dlg', { state: 'detached', timeout: 3000 }); await p.waitForTimeout(500);
}
// כפילות חודש נחסמת
await p.click('#addix'); await p.waitForSelector('.dlg [name=month]'); await p.waitForTimeout(200); await p.fill('.dlg [name=month]', addM(cur, -2)); await p.fill('.dlg [name=value]', '140'); await p.click('.dlg [data-ok]'); await p.waitForTimeout(300);
ok('duplicate index month blocked', (await p.textContent('.dlg .err')).includes('כבר יש ערך')); await p.click('.dlg [data-x]'); await p.waitForTimeout(300);
t = await T();
ok('index series saved', t.index_series.filter(x => x.tenant_id === tenant).length === 2);
ok('index card shows latest + change', (await p.textContent('#idxcard')).includes('אחרון') && (await p.textContent('#idxcard')).includes('0.91%'));
await (await p.$('#idxcard')).screenshot({ path: OUT + 'p18-index-card.png' });

// מילוי אוטומטי בחשבון טיוטה
const draft = t.bills.find(x => x.project_id === sp.id && x.status === 'draft') || t.bills.find(x => x.project_id === sp.id);
await patch('bills', draft.id, { status: 'draft', index_value: null, period_to: null });
await go(`#/project/${sp.id}/bill/${draft.id}`);
await p.waitForSelector('[name=index_value]');
ok('bill: index auto-filled with latest', (await p.inputValue('[name=index_value]')) === '132.4');
ok('bill: hint names latest index', (await p.textContent('.billv .card')).includes('מולא אוטומטית'));
await (await p.$('.billv .card')).screenshot({ path: OUT + 'p18-bill-index.png' });

// 3. הצמדה בתזרים
await go(`#/project/${sp.id}/cashflow`);
await p.waitForSelector('.cft table');
let cfText = await p.textContent('.cft');
ok('cashflow: expected linkage row', cfText.includes('הפרש הצמדה צפוי'));
const idxCell = await p.$('[data-cell$="|in_index"]');
if (idxCell) { await idxCell.click(); await p.waitForSelector('.dlg'); ok('linkage detail shows rate', (await p.textContent('.dlg')).includes('1.8%')); await p.click('.dlg [data-ok]'); await p.waitForTimeout(200); } else ok('linkage cell clickable', false);

// 4. עלויות חודשיות קבועות
await go(`#/project/${sp.id}/expenses`);
await p.waitForSelector('#fixedcard');
await p.click('#addfc'); await p.waitForSelector('.dlg [name=name]');
await p.fill('.dlg [name=name]', 'שמירה'); await p.fill('.dlg [name=supplier_name]', 'מוקד ביטחון'); await p.fill('.dlg [name=amount]', '4000');
await p.fill('.dlg [name=from_month]', addM(cur, -1)); await p.fill('.dlg [name=to_month]', addM(cur, 4));
const item = t.boq_items.find(i => i.project_id === sp.id && !i.variation_id);
await p.selectOption('.dlg [name=boq_item_id]', item.id);
await p.dispatchEvent('.dlg [name=amount]', 'input');
ok('fixed dialog: live total', (await p.textContent('#fcsum')).includes('6 חודשים') && (await p.textContent('#fcsum')).includes('24,000'));
await p.click('.dlg [data-ok]'); await p.waitForTimeout(700);
t = await T();
const fc = t.fixed_costs.find(x => x.project_id === sp.id);
ok('fixed cost saved', fc && fc.amount === 4000 && fc.boq_item_id === item.id && fc.vat === true);
ok('fixed card: remaining 5 months', (await p.textContent('#fixedcard')).includes('20,000'));
await p.evaluate(() => { document.querySelector('#fixedcard').open = true; });
await (await p.$('#fixedcard')).screenshot({ path: OUT + 'p18-fixed-card.png' });
// רישום חשבונית לחודש
await p.evaluate(() => { document.querySelector('#fixedcard').open = true; }); await p.click('[data-fexp]'); await p.waitForSelector('.dlg [name=amount]');
ok('record invoice: prefilled amount + supplier', (await p.inputValue('.dlg [name=amount]')) === '4000' && (await p.inputValue('.dlg [name=supplier_name]')) === 'מוקד ביטחון');
await p.click('.dlg [data-x]'); await p.waitForTimeout(300);
await go(`#/project/${sp.id}/cashflow`); await p.waitForSelector('.cft table');
cfText = await p.textContent('.cft');
ok('cashflow: fixed costs row', cfText.includes('עלויות חודשיות קבועות'));
const fixedCells = await p.$$eval('[data-cell$="|out_fixed"]', a => a.length);
ok('cashflow: fixed costs spread over months', fixedCells >= 4);
// בקרה: התקשרות על הסעיף
const commit = await p.evaluate(async ([pid, iid]) => { const { summarize, projData } = await import('./js/views/common.js'); const { loadTenantData } = await import('./js/app.js'); const d = await loadTenantData(); const s = summarize(projData(d, pid)); return s.rows.find(r => r.item.id === iid)?.c.commit; }, [sp.id, item.id]);
ok('control: fixed cost counted as commitment on item', commit >= 20000);

// 5. תצוגה לפי תקופה
await p.click('#per button[data-k=quarter]'); await p.waitForTimeout(400);
let heads = await p.$$eval('.cft thead th', a => a.map(x => x.textContent));
ok('quarter view: quarter columns', heads.some(h => h.includes('רבעון')) && heads.length < 9);
const cumQ = await p.$$eval('.cft tbody tr.tot:nth-last-child(3) td', a => a.length);
await p.click('#per button[data-k=year]'); await p.waitForTimeout(400);
heads = await p.$$eval('.cft thead th', a => a.map(x => x.textContent));
ok('year view: 2-3 year columns', heads.length >= 3 && heads.length <= 4);
await p.click('#per button[data-k=week]'); await p.waitForTimeout(400);
heads = await p.$$eval('.cft thead th', a => a.map(x => x.textContent));
ok('week view: week columns + split note', heads.filter(h => h.includes('שבוע')).length > 40 && (await p.textContent('.cft + p, p.small.mut')).length > 0);
// הסכומים נשמרים בין התצוגות
const totals = await p.evaluate(async pid => { const { cfFor } = await import('./js/views/cashflow.js'); const { groupPeriods } = await import('./js/cashflow.js'); const { loadTenantData } = await import('./js/app.js');
  const d = await loadTenantData(); const r = cfFor(d, [pid]); const s = v => Math.round(v.reduce((a, m) => a + m.net, 0));
  return { m: s(r.months), w: s(groupPeriods(r.months, 'week', r.cur)), q: s(groupPeriods(r.months, 'quarter', r.cur)), y: s(groupPeriods(r.months, 'year', r.cur)), last: Math.round(r.months.at(-1).cum), lastW: Math.round(groupPeriods(r.months, 'week', r.cur).at(-1).cum) }; }, sp.id);
ok('period views keep the same totals and closing balance', totals.m === totals.w && totals.m === totals.q && totals.m === totals.y && totals.last === totals.lastW);
await p.click('#per button[data-k=quarter]'); await p.waitForTimeout(300);
await p.screenshot({ path: OUT + 'p18-cash-quarter.png', fullPage: false });
await p.click('#per button[data-k=month]'); await p.waitForTimeout(300);

// 6. פרויקט חדש: ברירות מחדל
await go('#/projects'); await p.click('#add'); await p.waitForSelector('.dlg [name=name]');
ok('new sub project: workers+purchase on', await p.$eval('.dlg [name=mod_workers]', i => i.checked) && await p.$eval('.dlg [name=mod_purchase]', i => i.checked));
ok('new sub project: guarantees+fines+index+fixed off', !(await p.$eval('.dlg [name=mod_guarantees]', i => i.checked)) && !(await p.$eval('.dlg [name=mod_fines]', i => i.checked)) && !(await p.$eval('.dlg [name=mod_index]', i => i.checked)) && !(await p.$eval('.dlg [name=mod_fixed]', i => i.checked)));
await p.click('.dlg [data-x]'); await p.waitForTimeout(300);

// 7. יזם: הצמדה בהתקשרות + תזרים ודוח לפי תקופה
t = await T();
const dt = t.tenants.find(x => x.name.includes('יזמות')); const dp = t.projects.find(x => x.project_type === 'dev' && x.tenant_id === dt.id && x.status !== 'closed');
await p.selectOption('#tsel', dt.id); await p.waitForTimeout(700);
const dc = t.contracts.find(c => c.project_id === dp.id && ['signed'].includes(c.status));
await go(`#/project/${dp.id}/contracts`);
await p.click(`[data-c="${dc.id}"] td:nth-child(2)`); await p.waitForSelector('.dlg [name=title]');
ok('dev contract: no index fields while module off', !(await p.$('.dlg [name=indexation]')));
await p.click('.dlg [data-x]'); await p.waitForTimeout(300);
await patch('projects', dp.id, { modules: { guarantees: true, index: true, fixed: true }, indexation: true });
await patch('contracts', dc.id, { indexation: true, base_index: 128 });
await p.evaluate(([k, tid, m]) => { const d = JSON.parse(localStorage.getItem(k)); (d.tables.index_series ||= []).push({ id: crypto.randomUUID(), tenant_id: tid, month: m, value: 131.84, note: null }); localStorage.setItem(k, JSON.stringify(d)); }, [KEY, dt.id, addM(cur, -2)]); await p.reload(); await p.waitForTimeout(600);
await go(`#/project/${dp.id}/contracts`);
await p.click(`[data-c="${dc.id}"] td:nth-child(2)`); await p.waitForSelector('.dlg [name=title]');
ok('dev contract: index fields when module on', !!(await p.$('.dlg [name=indexation]')) && (await p.inputValue('.dlg [name=base_index]')) === '128');
await p.click('.dlg [data-x]'); await p.waitForTimeout(300);
await go(`#/project/${dp.id}/cashflow`); await p.waitForSelector('.cft table');
ok('dev cashflow: linkage row (3%)', (await p.textContent('.cft')).includes('הפרש הצמדה צפוי'));
const dIdx = await p.$('[data-cell$="|out_index"]'); if (dIdx) { await dIdx.click(); await p.waitForSelector('.dlg'); ok('dev linkage detail 3.0%', (await p.textContent('.dlg')).includes('3.0%')); await p.click('.dlg [data-ok]'); }
await p.click('#per button[data-k=quarter]'); await p.waitForTimeout(400);
ok('dev cashflow: quarter view', (await p.$$eval('.cft thead th', a => a.map(x => x.textContent))).some(h => h.includes('רבעון')));
await go('#/reports/d-cash'); await p.waitForSelector('#rep table');
await p.selectOption('#per', 'quarter'); await p.waitForTimeout(800);
ok('dev report: quarter table', (await p.textContent('#rep')).includes('לפי רבעון'));
await p.selectOption('#per', 'month'); await p.waitForTimeout(500);

// 8. טלפון
const ph = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const q = await ph.newPage(); q.on('pageerror', e => errs.push('phone: ' + e.message));
const state = await p.evaluate(k => localStorage.getItem(k), KEY);
await q.goto(BASE); await q.evaluate(([k, v]) => localStorage.setItem(k, v), [KEY, state]); await q.reload(); await q.waitForTimeout(800);
await q.selectOption('#tsel', tenant).catch(() => {}); await q.waitForTimeout(500);
for (const [h, sel, name] of [[`#/project/${sp.id}/settings`, 'fieldset.mods', 'modules'], [`#/project/${sp.id}/expenses`, '#fixedcard', 'fixed'], [`#/project/${sp.id}/cashflow`, '.cft', 'cash'], [`#/client/${tenant}`, '#idxcard', 'index']]) {
  await q.goto(BASE + '#/'); await q.waitForTimeout(200); await q.goto(BASE + h); await q.waitForTimeout(800);
  const el = await q.$(sel); ok(`phone: ${name} renders`, !!el);
  const over = await q.evaluate(() => document.documentElement.scrollWidth - innerWidth); ok(`phone: ${name} no page overflow`, over <= 1);
  if (el) { await el.scrollIntoViewIfNeeded(); await q.screenshot({ path: OUT + `p18-phone-${name}.png` }); }
}
ok('no page errors', errs.length === 0); if (errs.length) console.log(errs.slice(0, 8));
await b.close();
