// בדיקת חבילה 11: הוראות שינוי שטרם אושרו בחשבון לקבלן הראשי
import { chromium } from 'playwright';
const BASE = 'http://localhost:8123/'; const KEY = 'grosher-subcon-demo-v5'; const OUT = 'tests/shots/';
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
const T = () => p.evaluate(k => JSON.parse(localStorage.getItem(k)).tables, KEY);
const ok = (name, cond) => { console.log((cond ? 'ok   ' : 'FAIL ') + name); if (!cond) process.exitCode = 1; };
const num = s => +String(s).replace(/[^\d.-]/g, '');
await p.goto(BASE); await p.waitForSelector('.kpis'); await p.evaluate(() => localStorage.clear()); await p.reload(); await p.waitForSelector('.kpis');
let t = await T(); const p1 = t.projects.find(x => x.name.includes('הרצליה')).id;
const vo7 = t.boq_items.find(i => i.project_id === p1 && i.code === 'VO-07.1');
await p.goto(BASE + `#/project/${p1}/bills`); await p.waitForSelector('#add'); await p.click('#add'); await p.waitForSelector('.sum3');
ok('pending VO chapter in bill', (await p.textContent('tr.sec.pend')).includes('לאישור') && (await p.textContent('tr.sec.pend')).includes('VO-07'));
const before = await p.$$eval('.sum3 tr', rs => rs.slice(1).map(r => r.cells[1].textContent));
await p.fill(`[data-i="${vo7.id}"][data-k="cum_qty_sub"]`, '46'); await p.dispatchEvent(`[data-i="${vo7.id}"][data-k="cum_qty_sub"]`, 'change'); await p.waitForTimeout(200);
const rows = await p.$$eval('.sum3 tr', rs => rs.slice(1).map(r => [r.cells[0].textContent, r.cells[1].textContent, r.cells[2].textContent]));
console.log(rows);
ok('three summary lines', rows.length === 3 && rows[0][0].includes('לפי חוזה') && rows[1][0].includes('מאושרות') && rows[2][0].includes('שטרם אושרו'));
ok('pending adds 18,400 to third line only', Math.abs(num(rows[2][2]) - num(rows[1][2]) - 18400) < 1 && num(rows[1][1]) === num(before[1]));
ok('expected-to-receive line shown', (await p.textContent('#sum')).includes('צפוי להתקבל בלי הוראות שינוי'));
await p.screenshot({ path: OUT + 'bill-pending.png', fullPage: true });
await p.selectOption('[name=status]', 'submitted'); await p.click('#save'); await p.waitForTimeout(800);
if (await p.locator('.ov [data-ok]').count()) { await p.click('.ov [data-ok]'); await p.waitForTimeout(800); }
t = await T(); const bill = t.bills.filter(x => x.project_id === p1).sort((a, b) => b.number - a.number)[0];
ok('bill saved as submitted with VO line', bill.status === 'submitted' && t.bill_lines.find(l => l.bill_id === bill.id && l.boq_item_id === vo7.id)?.cum_qty_sub === 46);
await p.goto(BASE + '#/collection'); await p.waitForTimeout(500);
const rowTxt = await p.$$eval('tbody tr', rs => rs.map(r => r.textContent).find(x => x.includes(' · הוגש') && x.includes('הרצליה') && x.includes('4')) || '');
ok('bill with only unapproved VO is not counted for collection', !rowTxt);
// אישור החשבון בלי לאשר את ההוראה
await p.goto(BASE + `#/project/${p1}/bill/${bill.id}`); await p.waitForSelector('.sum3');
await p.selectOption('[name=status]', 'approved'); await p.click('#save'); await p.waitForTimeout(800);
if (await p.locator('.ov [data-ok]').count()) { await p.click('.ov [data-ok]'); await p.waitForTimeout(800); }
t = await T();
const l7 = t.bill_lines.find(l => l.bill_id === bill.id && l.boq_item_id === vo7.id);
ok('approving bill freezes pending VO at approved 0', l7.cum_qty_app === 0 && (l7.cut_reason || '').includes('טרם אושרה'));
// ייצוא
await p.goto(BASE + `#/project/${p1}/bill/${bill.id}`); await p.waitForSelector('#xl');
const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#xl')]); ok('bill export works', !!(await dl.path()));
console.log(errs.length ? 'errors: ' + errs.join(' | ') : 'no errors'); if (errs.length) process.exitCode = 1;
await b.close();
