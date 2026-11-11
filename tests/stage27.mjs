// בדיקת חבילה 26: תפריט לפי סוג הלקוח, שם הגבייה, חשבון חדש ממסך הגבייה
import { chromium } from 'playwright';
const BASE = 'http://localhost:8123/'; const KEY = 'grosher-subcon-demo-v5'; const OUT = 'tests/shots/';
const b = await chromium.launch();
const ok = (name, cond) => { console.log((cond ? 'ok   ' : 'FAIL ') + name); if (!cond) process.exitCode = 1; };
const errs = [];
const p = await (await b.newContext({ viewport: { width: 1440, height: 950 } })).newPage(); p.on('pageerror', e => errs.push(e.message));
const T = () => p.evaluate(k => JSON.parse(localStorage.getItem(k)).tables, KEY);
const nav = () => p.$$eval('#side .nav a', as => as.map(a => a.textContent.trim()));
await p.goto(BASE); await p.waitForSelector('.kpis'); await p.evaluate(() => localStorage.clear()); await p.reload(); await p.waitForSelector('.kpis');
let t = await T();
const dT = t.tenants.find(x => x.name.includes('יזמות')), sT = t.tenants.find(x => x.name.includes('גבס'));
await p.selectOption('#tsel', sT.id); await p.waitForTimeout(800);
let n = await nav();
ok('sub client: collection renamed', n.some(x => x.includes('גבייה מקבלנים ראשיים')) && !n.some(x => x.includes('חשבונות וגבייה')));
ok('sub client: workers shown', n.some(x => x.includes('עובדים ונוכחות')));
await p.goto(BASE + '#/collection'); await p.waitForSelector('#newbill');
ok('collection title + subtitle', (await p.textContent('h1')).includes('גבייה מקבלנים ראשיים') && (await p.textContent('.top .sub')).includes('מחכים לתשלום'));
const before = (await T()).bills.length;
await p.click('#newbill'); await p.waitForSelector('.dlg select[name=pid]');
const ps = await p.$$eval('.dlg select[name=pid] option', os => os.map(o => o.value));
let made = false;
for (const pid of ps) {
  await p.selectOption('.dlg select[name=pid]', pid); await p.click('.dlg [data-ok]'); await p.waitForTimeout(900);
  if ((await p.evaluate(() => location.hash)).includes('/bill/')) { made = true; break; }
  await p.click('#newbill'); await p.waitForSelector('.dlg select[name=pid]');
}
t = await T();
ok('new bill opened from collection screen', made && t.bills.length === before + 1 && t.bills.some(x => x.status === 'draft'));
await p.screenshot({ path: OUT + 'p26-newbill.png' });
// לקוח יזם בלבד: המסכים מוסתרים
await p.selectOption('#tsel', dT.id); await p.waitForTimeout(800);
n = await nav();
ok('dev-only client: no collection, no workers', !n.some(x => x.includes('גבייה')) && !n.some(x => x.includes('עובדים ונוכחות')));
await p.screenshot({ path: OUT + 'p26-nav-dev.png', clip: { x: 1200, y: 0, width: 240, height: 760 } });
await p.goto(BASE + '#/collection'); await p.waitForTimeout(700);
ok('hidden screen: friendly note', (await p.textContent('#main')).includes('מוסתר אצל הלקוח הזה'));
// הגדרה: תמיד להציג
await p.goto(BASE + `#/client/${dT.id}`); await p.waitForSelector('select[name=nav_workers]');
await p.selectOption('select[name=nav_workers]', 'show'); await p.click('#sf button.btn'); await p.waitForTimeout(1000);
n = await nav();
ok('client setting: show workers anyway', n.some(x => x.includes('עובדים ונוכחות')) && !n.some(x => x.includes('גבייה')));
await p.screenshot({ path: OUT + 'p26-settings.png', fullPage: false });
// להסתיר אצל לקוח קבלן משנה
await p.selectOption('#tsel', sT.id); await p.waitForTimeout(800);
await p.goto(BASE + `#/client/${sT.id}`); await p.waitForSelector('select[name=nav_collection]');
await p.selectOption('select[name=nav_collection]', 'hide'); await p.click('#sf button.btn'); await p.waitForTimeout(1000);
n = await nav(); ok('client setting: hide collection', !n.some(x => x.includes('גבייה')));
await p.setViewportSize({ width: 390, height: 844 }); await p.goto(BASE + '#/'); await p.waitForTimeout(500);
ok('phone: no overflow', (await p.evaluate(() => document.documentElement.scrollWidth)) <= 392);
ok('no page errors: ' + errs.slice(0, 2).join(' | '), errs.length === 0);
await b.close();
