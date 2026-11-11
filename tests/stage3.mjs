// בדיקת אינטראקציה לשלב 3: עריכת תמחיר שומרת מזהי שורות, הזמנת רכש, חשבונית מקושרת, עובד חדש
import { chromium } from 'playwright';
const BASE = 'http://localhost:8123/'; const KEY = 'grosher-subcon-demo-v5';
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
const T = () => p.evaluate(k => JSON.parse(localStorage.getItem(k)).tables, KEY);
await p.goto(BASE); await p.waitForSelector('.kpis');
await p.evaluate(k => localStorage.removeItem(k), KEY); await p.reload(); await p.waitForSelector('.kpis');
let t = await T();
const p1 = t.projects[0].id; const i020 = t.boq_items.find(i => i.code === '02.020');
const ids0 = t.cost_lines.filter(l => l.boq_item_id === i020.id).map(l => l.id).sort().join();
// 1. תמחיר: שינוי צוות ל-3 ושמירה עם סיבה
await p.goto(BASE + `#/project/${p1}/costing`); await p.waitForTimeout(500);
await p.click(`tr[data-cost="${i020.id}"]`).catch(async () => { await p.click(`[data-cost="${i020.id}"]`); });
await p.waitForSelector('#lt');
await p.fill('#lt input[data-f="crew"]', '3');
await p.fill('input[name=reason]', 'בדיקה');
await p.click('.ov [data-ok]'); await p.waitForSelector('.ov', { state: 'detached' }); await p.waitForTimeout(400);
t = await T();
const ls = t.cost_lines.filter(l => l.boq_item_id === i020.id);
console.log('costing ids kept:', ls.map(l => l.id).sort().join() === ids0, '· crew:', ls.find(l => l.kind === 'labor').crew, '· type:', ls.find(l => l.kind === 'labor').labor_type);
// 2. הזמנת רכש חדשה
await p.goto(BASE + `#/project/${p1}/purchase`); await p.waitForTimeout(400);
await p.click('#add'); await p.waitForSelector('#pl');
await p.fill('input[name=supplier_name]', 'ספק בדיקה');
await p.selectOption('#pl select[data-f=boq_item_id]', i020.id);
await p.fill('#pl input[data-f=description]', 'פרופילים'); await p.fill('#pl input[data-f=qty]', '100'); await p.fill('#pl input[data-f=unit_price]', '20');
await p.click('.ov [data-ok]'); await p.waitForSelector('.ov', { state: 'detached' }); await p.waitForTimeout(400);
t = await T();
const po = t.purchase_orders.find(x => x.supplier_name === 'ספק בדיקה');
console.log('po saved:', !!po, '· lines:', t.po_lines.filter(l => l.po_id === po?.id).length);
// 3. חשבונית להזמנה
await p.click(`[data-inv="${po.id}"]`); await p.waitForSelector('#lnk');
await p.fill('input[name=amount]', '2000'); await p.fill('input[name=doc_no]', 'T-1');
await p.click('.ov [data-ok]'); await p.waitForSelector('.ov', { state: 'detached' }); await p.waitForTimeout(400);
t = await T();
const ex = t.expenses.find(e => e.doc_no === 'T-1');
console.log('invoice linked to po:', ex?.po_id === po.id, '· item:', ex?.boq_item_id === i020.id);
await p.screenshot({ path: 'tests/shots/purchase-after.png', fullPage: true });
// 4. עובד חדש
await p.goto(BASE + '#/workers'); await p.waitForTimeout(400);
await p.click('#add'); await p.fill('input[name=name]', 'עובד בדיקה'); await p.selectOption('#pt', 'salary'); await p.fill('input[name=monthly_salary]', '8000');
await p.click('.ov [data-ok]'); await p.waitForSelector('.ov', { state: 'detached' }); await p.waitForTimeout(400);
console.log('dlg err:', await p.evaluate(() => document.querySelector('.ov .err')?.textContent)); t = await T(); console.log('worker added:', t.workers.some(w => w.name === 'עובד בדיקה'));
// 5. יום עבודה במשרד: עריכת יום קיים ושמירה
await p.goto(BASE + `#/project/${p1}/day/2026-10-13`); await p.waitForSelector('.dayv');
const n0 = (await T()).work_entries.filter(e => e.project_id === p1 && e.log_date === '2026-10-13').length;
await p.click('#save'); await p.waitForTimeout(600);
const n1 = (await T()).work_entries.filter(e => e.project_id === p1 && e.log_date === '2026-10-13').length;
console.log('resave day keeps entries:', n0, '->', n1);
console.log(errs.join('\n') || 'no errors');
await b.close();
