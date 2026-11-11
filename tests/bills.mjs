// בדיקת אינטראקציה לשלב 4: חשבון חדש ממשיך מהמצטבר, אישור, קנס, תקבול, עדכון אחוזי ביצוע
import { chromium } from 'playwright';
const BASE = 'http://localhost:8123/'; const KEY = 'grosher-subcon-demo-v5';
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
const T = () => p.evaluate(k => JSON.parse(localStorage.getItem(k)).tables, KEY);
await p.goto(BASE); await p.waitForSelector('.kpis');
await p.evaluate(k => localStorage.removeItem(k), KEY); await p.reload(); await p.waitForSelector('.kpis');
let t = await T(); const p1 = t.projects[0].id;
const i001 = t.boq_items.find(i => i.code === '02.001');
await p.goto(BASE + `#/project/${p1}/bills`); await p.waitForTimeout(500);
await p.click('#add'); await p.waitForSelector('.billv'); await p.waitForTimeout(300);
t = await T(); const b4 = t.bills.find(x => x.number === 4);
const l4 = t.bill_lines.find(l => l.bill_id === b4.id && l.boq_item_id === i001.id);
console.log('bill 4 created, 02.001 starts at bill-3 cum (1280):', l4.cum_qty_sub);
// מוגש לפי אחוז ביצוע, קנס, אישור
await p.click('#fromprog'); await p.waitForTimeout(200);
await p.fill(`input[data-i="${i001.id}"][data-k="cum_qty_sub"]`, '1400'); await p.press(`input[data-i="${i001.id}"][data-k="cum_qty_sub"]`, 'Tab');
await p.click('#addf'); await p.fill('#fl input[data-k=description]', 'בדיקה'); await p.fill('#fl input[data-k=amount]', '1000'); await p.press('#fl input[data-k=amount]', 'Tab');
await p.click('#appall'); await p.waitForTimeout(200);
await p.fill(`input[data-i="${i001.id}"][data-k="cum_qty_app"]`, '1380'); await p.press(`input[data-i="${i001.id}"][data-k="cum_qty_app"]`, 'Tab');
const sumText = await p.textContent('#sum');
await p.click('#save'); await p.waitForTimeout(800);
t = await T();
const nb = t.bills.find(x => x.id === b4.id), nl = t.bill_lines.find(l => l.bill_id === b4.id && l.boq_item_id === i001.id);
console.log('saved status:', nb.status, '· 02.001 sub/app:', nl.cum_qty_sub, nl.cum_qty_app, '· fines:', t.bill_fines.filter(f => f.bill_id === b4.id).length, '· cut shown:', /קיצץ/.test(sumText));
// עדכון אחוזי ביצוע לפי החשבון
await p.goto(BASE + `#/project/${p1}/bill/${b4.id}`); await p.waitForSelector('.billv');
await p.click('#prog'); await p.waitForSelector('.ov'); await p.click('.ov [data-ok]'); await p.waitForTimeout(800);
t = await T(); console.log('02.001 progress after:', t.boq_items.find(i => i.id === i001.id).progress_pct, '(1380/1600 = 86.3)');
// תקבול מלא -> שולם
await p.goto(BASE + `#/project/${p1}/bill/${b4.id}`); await p.waitForSelector('.billv');
await p.click('#addp'); await p.waitForSelector('.ov'); await p.click('.ov [data-ok]'); await p.waitForTimeout(800);
t = await T(); console.log('after full payment status:', t.bills.find(x => x.id === b4.id).status);
await p.goto(BASE + '#/collection'); await p.waitForTimeout(500);
console.log('collection shows overdue row:', await p.evaluate(() => document.querySelectorAll('tr.al-r').length));
await p.screenshot({ path: 'tests/shots/collection-after.png', fullPage: true });
console.log(errs.join('\n') || 'no errors'); await b.close();
