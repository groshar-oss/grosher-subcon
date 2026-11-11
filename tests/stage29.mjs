// בדיקת חבילה 29: פרק "תקורות אתר" (סעיפים פנימיים עם עלות, בלי מכירה, לא בחשבונות)
import { chromium } from 'playwright';
const BASE = 'http://localhost:8123/'; const KEY = 'grosher-subcon-demo-v5'; const OUT = 'tests/shots/';
const b = await chromium.launch();
const ok = (name, cond) => { console.log((cond ? 'ok   ' : 'FAIL ') + name); if (!cond) process.exitCode = 1; };
const errs = [];
const p = await (await b.newContext({ viewport: { width: 1440, height: 950 } })).newPage(); p.on('pageerror', e => errs.push(e.message));
const T = () => p.evaluate(k => JSON.parse(localStorage.getItem(k)).tables, KEY);
await p.goto(BASE); await p.waitForSelector('.kpis'); await p.evaluate(() => localStorage.clear()); await p.reload(); await p.waitForSelector('.kpis');
await p.goto(BASE + '#/settings'); await p.waitForSelector('#dload'); await p.click('#dload'); await p.waitForTimeout(500);
if (await p.$('.dlg [data-ok]')) await p.click('.dlg [data-ok]');
await p.waitForFunction(k => JSON.parse(localStorage.getItem(k)).tables.tenants.some(x => x.name.includes('ריצוף')), KEY, { timeout: 20000 }); await p.waitForTimeout(800);
let t = await T();
const tl = t.tenants.find(x => x.name.includes('ריצוף'));
const p3 = t.projects.find(x => x.tenant_id === tl.id && x.name.includes('נתניה'));
const p2 = t.projects.find(x => x.tenant_id === tl.id && x.name.includes('רמת גן'));
await p.selectOption('#tsel', tl.id); await p.waitForTimeout(700);
// כתב כמויות: פרק פנימי, לא בסה"כ
await p.goto(BASE + `#/project/${p3.id}/boq`); await p.waitForSelector('#tb');
const boq = await p.textContent('#tb');
ok('boq: overhead section, internal chip', boq.includes('תקורות אתר') && boq.includes('פנימי · לא מופיע למזמין') && boq.includes('מנהל עבודה'));
ok('boq: overhead rows not red (no price needed)', !(await p.$$eval('#tb tr.al-r', rs => rs.some(r => r.textContent.includes('OH.')))));
const saleSum = t.boq_items.filter(i => i.project_id === p3.id && !i.variation_id && !i.is_overhead).reduce((a, i) => a + i.qty * i.unit_price, 0);
ok('boq total = client items only', (await p.textContent('#tb tr.tot')).includes(Math.round(saleSum).toLocaleString('en-US')));
ok('no "add overhead chapter" when one exists', !(await p.$('#ohadd')));
await p.screenshot({ path: OUT + 'p29-boq.png', fullPage: true });
// בקרה: תקורה עם עלות, ביצוע אוטומטי
await p.goto(BASE + `#/project/${p3.id}/control`); await p.waitForSelector('#ctl table');
const ctl = await p.textContent('#ctl');
ok('control: overhead chapter + auto progress', ctl.includes('פנימי · עלות בלבד') && ctl.includes("אוטו'"));
const ohRow = await p.$eval('#ctl tr[data-item]:has-text("OH.01")', r => [...r.cells].map(c => c.textContent.trim()));
ok('control: overhead sale 0, planned 231,000', ohRow[2].includes('0') && ohRow[3].includes('231,000'));
await p.screenshot({ path: OUT + 'p29-control.png', fullPage: true });
// תמחיר: בלי % תקורה על סעיף תקורה
await p.goto(BASE + `#/project/${p3.id}/costing`); await p.waitForSelector('#tb');
ok('costing: overhead chip', (await p.textContent('#tb')).includes('תקורה · פנימי'));
// חשבון למזמין: בלי סעיפי תקורה
await p.goto(BASE + `#/project/${p3.id}/bills`); await p.waitForTimeout(500);
const billId = t.bills.filter(x => x.project_id === p3.id).sort((a, b) => b.number - a.number)[0]?.id;
if (billId) { await p.goto(BASE + `#/project/${p3.id}/bill/${billId}`); await p.waitForTimeout(800); ok('bill: no overhead items', !(await p.textContent('#main')).includes('OH.0')); }
// הוספת פרק תקורות לפרויקט קיים
await p.goto(BASE + `#/project/${p2.id}/boq`); await p.waitForSelector('#ohadd'); await p.click('#ohadd'); await p.waitForSelector('.dlg [data-ok]'); await p.click('.dlg [data-ok]'); await p.waitForTimeout(900);
t = await T();
ok('add chapter: 7 internal items', t.boq_items.filter(i => i.project_id === p2.id && i.is_overhead).length === 7);
// סעיף תקורה חדש
await p.click('#ohnew'); await p.waitForSelector('.dlg [name=description]'); await p.fill('.dlg [name=description]', 'צוות בטיחות'); await p.click('.dlg [data-ok]'); await p.waitForTimeout(800);
t = await T();
ok('new overhead item', t.boq_items.some(i => i.project_id === p2.id && i.is_overhead && i.description === 'צוות בטיחות' && i.code === 'OH.08'));
// פרויקט חדש: ברירת מחדל פרק תקורות, תקורה 0%
await p.goto(BASE + '#/projects'); await p.waitForSelector('#add'); await p.click('#add'); await p.waitForSelector('.dlg [name=name]');
ok('new project: overhead chapter checkbox, % hidden', await p.isChecked('.dlg [name=oh_chapter]') && await p.isHidden('.dlg .ohpct'));
await p.screenshot({ path: OUT + 'p29-newproject.png' });
await p.fill('.dlg [name=name]', 'בדיקת תקורות'); await p.click('.dlg [data-ok]'); await p.waitForTimeout(1200);
t = await T();
const np = t.projects.find(x => x.name === 'בדיקת תקורות');
ok('new project: 7 overhead items, overhead_pct 0', np && np.overhead_pct === 0 && t.boq_items.filter(i => i.project_id === np.id && i.is_overhead).length === 7);
// טלפון
await p.setViewportSize({ width: 390, height: 844 });
for (const tab of ['boq', 'control', 'costing']) { await p.goto(BASE + `#/project/${p3.id}/${tab}`); await p.waitForTimeout(500); ok(`phone ${tab}: no overflow`, (await p.evaluate(() => document.documentElement.scrollWidth)) <= 392); }
await p.goto(BASE + `#/project/${p3.id}/boq`); await p.waitForTimeout(400); await p.screenshot({ path: OUT + 'p29-phone.png', fullPage: true });
ok('no page errors: ' + errs.slice(0, 2).join(' | '), errs.length === 0);
await b.close();
