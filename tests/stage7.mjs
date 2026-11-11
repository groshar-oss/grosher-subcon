// הערה: בדפדפן בלי ממשק שם קובץ בעברית מופיע כ-download, לכן בודקים את תוכן הקובץ
// בדיקת אינטראקציה לשלבים 5-7: סיבת קיצוץ וקנס שבוטל, חשבון סופי מותנה, ערבות, ייבוא ספר טלפונים, תזרים ודוחות
import { chromium } from 'playwright';
import { createRequire } from 'node:module';
import { writeFileSync, readFileSync } from 'node:fs';
const XLSX = createRequire(import.meta.url)('../vendor/xlsx.full.min.js');
const BASE = 'http://localhost:8123/'; const KEY = 'grosher-subcon-demo-v5';
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
const T = () => p.evaluate(k => JSON.parse(localStorage.getItem(k)).tables, KEY);
const ok = (name, cond) => { console.log((cond ? 'ok   ' : 'FAIL ') + name); if (!cond) process.exitCode = 1; };
await p.goto(BASE); await p.waitForSelector('.kpis');
await p.evaluate(k => localStorage.removeItem(k), KEY); await p.reload(); await p.waitForSelector('.kpis');
let t = await T(); const p1 = t.projects[0].id, p3 = t.projects[2].id;
await p.click('#moreacts');
ok('home shows document / guarantee alerts', await p.locator('.act', { hasText: 'ערבות ביצוע' }).count() > 0 && await p.locator('.act', { hasText: 'צוות התקנה' }).count() > 0);
// סיבת קיצוץ נשמרת
const hb2 = t.bills.find(x => x.project_id === p1 && x.number === 2);
await p.goto(BASE + `#/project/${p1}/bill/${hb2.id}`); await p.waitForSelector('.billv'); await p.waitForTimeout(300);
await p.fill('input.cutr >> nth=0', 'בדיקת סיבה'); await p.press('input.cutr >> nth=0', 'Tab');
ok('cancelled fine not deducted (fines 4,000)', (await p.textContent('#sum')).includes('4,000'));
await p.click('#save'); await p.waitForTimeout(700); t = await T();
ok('cut reason saved', t.bill_lines.some(l => l.bill_id === hb2.id && l.cut_reason === 'בדיקת סיבה'));
ok('fine statuses kept', t.bill_fines.filter(f => f.bill_id === hb2.id).map(f => f.status).sort().join() === 'appeal,cancelled,imposed');
// חשבון סופי: חסום עד שמסמנים תנאים
await p.goto(BASE + `#/project/${p3}/bills`); await p.waitForTimeout(500);
ok('final bill blocked before conditions', await p.locator('#addfinal').count() === 0 && (await p.textContent('#cf')).length > 0);
await p.check('#cf [name=rejects_ok]'); await p.fill('#cf [name=completion_date]', '2026-10-15'); await p.click('#cf button'); await p.waitForTimeout(600);
await p.click('#addfinal'); await p.waitForSelector('.billv'); await p.waitForTimeout(300);
ok('final bill page', (await p.textContent('h1')).includes('חשבון סופי') && (await p.textContent('.billv .note')).includes('15.10.2027'));
t = await T(); ok('final bill saved with is_final', t.bills.some(x => x.project_id === p3 && x.is_final));
// ערבות חדשה מהפרויקט
await p.goto(BASE + `#/project/${p3}/bills`); await p.waitForTimeout(400);
ok('no new bill after final', await p.locator('#add').count() === 0);
await p.click('#addg'); await p.waitForSelector('.dlg'); await p.selectOption('.dlg [name=kind]', 'warranty'); await p.fill('.dlg [name=amount]', '25000'); await p.fill('.dlg [name=expiry]', '2027-10-15');
await p.click('.dlg [data-ok]'); await p.waitForTimeout(500); t = await T();
ok('warranty guarantee added', t.guarantees.some(g => g.kind === 'warranty' && g.amount === 25000 && g.project_id === p3));
// ייבוא ספר טלפונים (אחד כפול לפי נייד)
const ws = XLSX.utils.aoa_to_sheet([['רשימת אנשי קשר'], ['שם פרטי', 'שם משפחה', 'חברה', 'נייד', 'דוא"ל'], ['נועה', 'בדיקה', 'חברה א', '050-1111111', 'n@x.com'], ['כפול', 'דמו', 'אחרת', '050-0000003', ''], ['גיל', 'בדיקה', '', '+972-52-2222222', '']]);
const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'a'); writeFileSync('/tmp/contacts-test.xlsx', XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
await p.goto(BASE + '#/contacts'); await p.waitForSelector('#imp', { state: 'attached' }); await p.waitForTimeout(500); const before = (await T()).contacts.filter(c => c.tenant_id === t.tenants[0].id).length;
await p.setInputFiles('#imp', '/tmp/contacts-test.xlsx'); await p.waitForSelector('.dlg'); const msg = await p.textContent('.dlg'); await p.click('.dlg [data-ok]'); await p.waitForTimeout(600);
t = await T(); ok('contacts import: 2 new, 1 duplicate skipped (' + msg.trim().slice(0, 80) + ')', t.contacts.filter(c => c.tenant_id === t.tenants[0].id).length === before + 2 && t.contacts.some(c => c.name === 'נועה בדיקה'));
await p.fill('#q', '2222222'); await p.waitForTimeout(200); ok('search by phone digits', await p.locator('.ccard').count() === 1);
// תזרים: עיכוב 60 יום מזיז כניסות
await p.goto(BASE + '#/cashflow'); await p.waitForSelector('#dl');
const net0 = await p.textContent('.kpis .kpi:nth-child(2) .v');
await p.click('#dl button[data-k="60"]'); await p.waitForTimeout(300);
ok('delay scenario changes 3-month net', net0 !== await p.textContent('.kpis .kpi:nth-child(2) .v'));
await p.click('#dl button[data-k="0"]');
const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#xl')]); const wb1 = XLSX.read(readFileSync(await dl.path())); ok('cashflow excel download (sheet ' + wb1.SheetNames[0] + ')', wb1.SheetNames[0] === 'תזרים');
// דוחות: ייצוא
await p.goto(BASE + '#/reports/expenses'); await p.waitForSelector('#rep table');
const [d2] = await Promise.all([p.waitForEvent('download'), p.click('#xl')]); const wb2 = XLSX.read(readFileSync(await d2.path())); ok('report excel download (sheets ' + wb2.SheetNames.join(', ') + ')', wb2.SheetNames.length === 2);
// מנהל עבודה רואה ספר טלפונים אבל לא ספקים
await p.goto(BASE); await p.selectOption('#demoRole', 'foreman'); await p.waitForTimeout(600);
await p.goto(BASE + '#/contacts'); await p.waitForTimeout(400); ok('foreman: phone book blocked', await p.locator('.ccard').count() === 0 && (await p.textContent('#main')).includes('אין הרשאה'));
await p.goto(BASE + '#/vendors'); await p.waitForTimeout(300); ok('foreman blocked from vendors', (await p.textContent('#view, body')).includes('אין הרשאה'));
await p.goto(BASE + '#/cashflow'); await p.waitForTimeout(300); ok('foreman blocked from cashflow', (await p.textContent('body')).includes('אין הרשאה'));
console.log(errs.length ? errs.join('\n') : 'no errors');
await b.close();
