// בדיקת חבילה 12: פרויקט יזם, תקציב, בסיס נעול, התקשרויות, הוצאה עם התקשרות, הקמת פרויקט יזם חדש
import { chromium } from 'playwright';
const BASE = 'http://localhost:8123/'; const KEY = 'grosher-subcon-demo-v5'; const OUT = 'tests/shots/';
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
const T = () => p.evaluate(k => JSON.parse(localStorage.getItem(k)).tables, KEY);
const ok = (name, cond) => { console.log((cond ? 'ok   ' : 'FAIL ') + name); if (!cond) process.exitCode = 1; };
await p.goto(BASE); await p.waitForSelector('.kpis'); await p.evaluate(() => localStorage.clear()); await p.reload(); await p.waitForSelector('.kpis');
let t = await T();
const dt = t.tenants.find(x => x.name.includes('יזמות')); const dp = t.projects.find(x => x.project_type === 'dev');
ok('app renamed', (await p.title()).includes('בקרת עלויות ותזרים') && (await p.textContent('.brand')).includes('בקרת עלויות ותזרים'));
await p.selectOption('#tsel', dt.id); await p.waitForTimeout(500); await p.waitForSelector('.kpis');
ok('dev home KPIs', (await p.textContent('.kpis')).includes('תקציב מאושר'));
await p.goto(BASE + '#/projects'); await p.waitForTimeout(400);
ok('projects list shows dev table', (await p.textContent('#main')).includes('צפי לסיום') && (await p.textContent('#main')).includes('מגדל הדקל'));
await p.screenshot({ path: OUT + 'dev-projects.png' });
await p.goto(BASE + `#/project/${dp.id}/control`); await p.waitForSelector('#ctl table');
const navTxt = await p.textContent('.ptabs');
ok('dev project nav tabs', ['בקרה תקציבית', 'תקציב', 'התקשרויות', 'הוצאות ותשלומים'].every(x => navTxt.includes(x)) && !navTxt.includes('תמחיר') && !navTxt.includes('יומן עבודה'));
const ctl = await p.textContent('#ctl');
ok('control shows estimate chip and outside budget', ctl.includes('הערכה') && ctl.includes('מחוץ לתקציב') && ctl.includes('הוצאות בלי סעיף תקציב'));
ok('alerts card', (await p.textContent('#al')).includes('התקשרות מעל התקציב'));
await p.screenshot({ path: OUT + 'dev-control.png', fullPage: true });
// צפי ידני
const it53 = t.boq_items.find(i => i.project_id === dp.id && i.code === '05.03');
await p.click(`[data-item="${it53.id}"]`); await p.waitForSelector('.ov');
await p.fill('.ov [name=forecast_manual]', '2000000'); await p.click('.ov [data-ok]'); await p.waitForTimeout(200);
ok('manual forecast requires note', (await p.textContent('.ov .err')).includes('הסבר'));
await p.fill('.ov [name=forecast_note]', 'הצעת מחיר בעל פה'); await p.click('.ov [data-ok]'); await p.waitForTimeout(600);
t = await T(); ok('manual forecast saved + logged', t.boq_items.find(i => i.id === it53.id).forecast_manual === 2000000 && t.change_log.some(c => c.entity_id === it53.id && c.field === 'צפי ידני'));
ok('manual chip shown', (await p.textContent('#ctl')).includes('צפי ידני'));
// בסיס חדש דורש סיבה
await p.click('#lock'); await p.waitForSelector('.ov'); await p.click('.ov [data-ok]'); await p.waitForTimeout(200);
ok('re-baseline needs reason', (await p.textContent('.ov .err')).includes('סיבה'));
await p.fill('.ov [name=note]', 'אישור תקציב מעודכן'); await p.click('.ov [data-ok]'); await p.waitForTimeout(600);
t = await T(); const pr = t.projects.find(x => x.id === dp.id);
const bud = t.boq_items.filter(i => i.project_id === dp.id).reduce((a, i) => a + i.qty * i.unit_price, 0);
ok('baseline relocked to current budget', Math.abs(pr.baseline.total - bud) < 1 && pr.baseline_note === 'אישור תקציב מעודכן' && t.change_log.some(c => c.project_id === dp.id && c.field === 'בסיס חדש'));
// ייצוא
const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#xl')]); console.log(dl.suggestedFilename()); ok('control export', !!(await dl.path()));
// התקשרויות
await p.goto(BASE + `#/project/${dp.id}/contracts`); await p.waitForSelector('#tb');
ok('contracts list', (await p.$$('#tb tr[data-c]')).length === 7 && (await p.textContent('#tb')).includes('טיוטה'));
await p.screenshot({ path: OUT + 'dev-contracts.png', fullPage: true });
await p.click('#add'); await p.waitForSelector('.ov #cl');
await p.fill('.ov [name=vendor_name]', 'ח.ש. חשמל (דמו)'); await p.fill('.ov [name=title]', 'חשמל ותקשורת');
await p.click('.ov [data-ok]'); await p.waitForTimeout(200); ok('contract needs lines', (await p.textContent('.ov .err')).includes('אין שורות'));
await p.selectOption('#pickch', '07 מערכות'); await p.waitForTimeout(200);
ok('chapter added 4 lines', (await p.$$('#cl tr')).length === 4);
// מחיר שונה בשורה הראשונה + הסרת שורות 2-4
const it71 = t.boq_items.find(i => i.project_id === dp.id && i.code === '07.01');
await p.fill('#cl tr:nth-child(1) [data-f=unit_price]', '5900000'); await p.dispatchEvent('#cl tr:nth-child(1) [data-f=unit_price]', 'change'); await p.waitForTimeout(150);
ok('price deviation shown', (await p.textContent('#cl tr:nth-child(1)')).includes('+5.4%'));
for (let k = 0; k < 3; k++) { await p.click('#cl tr:nth-child(2) [data-rm]'); await p.waitForTimeout(100); }
await p.screenshot({ path: OUT + 'dev-contract-dialog.png' });
await p.click('.ov [data-ok]'); await p.waitForTimeout(700);
t = await T();
const nc = t.contracts.find(c => c.vendor_name === 'ח.ש. חשמל (דמו)');
ok('contract saved with 1 line + vendor card', nc && t.contract_lines.filter(l => l.contract_id === nc.id).length === 1 && t.contract_lines.find(l => l.contract_id === nc.id).unit_price === 5900000 && t.vendors.some(v => v.name === 'ח.ש. חשמל (דמו)' && v.tenant_id === dt.id));
await p.goto(BASE + `#/project/${dp.id}/control`); await p.waitForSelector('#ctl table');
ok('control picks up new commitment', (await p.textContent(`[data-item="${it71.id}"]`)).includes('5,900,000'));
// עריכת התקשרות: שינוי סכום נרשם ביומן
await p.goto(BASE + `#/project/${dp.id}/contracts`); await p.waitForSelector('#tb');
await p.click(`[data-c="${nc.id}"]`); await p.waitForSelector('.ov #cl');
await p.fill('#cl tr:nth-child(1) [data-f=unit_price]', '5800000'); await p.dispatchEvent('#cl tr:nth-child(1) [data-f=unit_price]', 'change'); await p.waitForTimeout(150);
await p.click('.ov [data-ok]'); await p.waitForTimeout(700);
t = await T(); ok('contract edit logged', t.contract_lines.find(l => l.contract_id === nc.id).unit_price === 5800000 && t.change_log.some(c => c.entity_id === nc.id && c.field === 'סכום התקשרות'));
// הוצאה עם התקשרות
await p.goto(BASE + `#/project/${dp.id}/expenses`); await p.waitForSelector('#add'); await p.click('#add'); await p.waitForSelector('.ov #ctr');
await p.selectOption('#ctr', nc.id); await p.waitForTimeout(150);
ok('contract fills supplier and item', (await p.inputValue('.ov [name=supplier_name]')) === 'ח.ש. חשמל (דמו)' && (await p.inputValue('#lnk')) === 'i:' + it71.id);
await p.fill('.ov [name=amount]', '700000'); await p.selectOption('.ov [name=status]', 'paid'); await p.click('.ov [data-ok]'); await p.waitForTimeout(600);
t = await T(); ok('expense saved with contract', t.expenses.some(e => e.contract_id === nc.id && e.boq_item_id === it71.id && e.amount === 700000));
await p.goto(BASE + `#/project/${dp.id}/contracts`); await p.waitForSelector('#tb');
ok('contract shows paid', (await p.textContent(`[data-c="${nc.id}"]`)).includes('700,000'));
// פרויקט יזם חדש
await p.goto(BASE + '#/projects'); await p.click('#add'); await p.waitForSelector('.ov [name=project_type]');
ok('sub fields visible by default', await p.isVisible('.ov [name=main_contractor_id]'));
await p.check('.ov [name=project_type][value=dev]'); await p.waitForTimeout(100);
await p.screenshot({ path: OUT + 'dev-new-project.png' }); ok('dev hides sub fields', !(await p.isVisible('.ov [name=main_contractor_id]')) && !(await p.isVisible('.ov [name=retention_pct]')) && (await p.textContent('#ptyhint')).includes('פרויקט יזם'));
await p.fill('.ov [name=name]', 'בניין משרדים חדש (בדיקה)'); await p.click('.ov [data-ok]'); await p.waitForTimeout(700);
t = await T(); const np = t.projects.find(x => x.name === 'בניין משרדים חדש (בדיקה)');
ok('new dev project created', np && np.project_type === 'dev' && np.tenant_id === dt.id);
ok('lands on budget tab', (await p.evaluate(() => location.hash)).endsWith('/boq') && (await p.textContent('#main')).includes('קליטת תקציב מאקסל'));
// קבלן משנה עדיין עובד כרגיל
const gt = t.tenants.find(x => x.name.includes('גבס'));
await p.selectOption('#tsel', gt.id); await p.waitForTimeout(500);
ok('sub home unchanged', (await p.textContent('.kpis')).includes('היקף מכירה'));
// טלפון
const m = p; await m.setViewportSize({ width: 390, height: 844 });
await m.goto(BASE); await m.waitForSelector('.kpis');
await m.evaluate(id => localStorage.setItem('subcon-tenant', JSON.stringify(id)), dt.id);
let over = [];
for (const h of ['#/', '#/projects', `#/project/${dp.id}/control`, `#/project/${dp.id}/contracts`, `#/project/${dp.id}/boq`, `#/project/${dp.id}/expenses`]) {
  await m.goto(BASE + h); await m.reload(); await m.waitForTimeout(500);
  if (await m.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)) over.push(h);
}
ok('phone: no sideways scroll on dev screens' + (over.length ? ' ' + over.join(',') : ''), !over.length);
await m.goto(BASE + `#/project/${dp.id}/control`); await m.reload(); await m.waitForTimeout(500); await m.screenshot({ path: OUT + 'dev-control-phone.png', fullPage: true });
console.log(errs.length ? 'errors: ' + errs.join(' | ') : 'no errors'); if (errs.length) process.exitCode = 1;
await b.close();
