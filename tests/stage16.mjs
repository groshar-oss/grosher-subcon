// בדיקת חבילה 15: שמונת דוחות היזם, אקסל ו-PDF, סינון לפרויקט, ולקוח קבלן משנה בלי שינוי
import { chromium } from 'playwright';
const BASE = 'http://localhost:8123/'; const KEY = 'grosher-subcon-demo-v5'; const OUT = 'tests/shots/';
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
const T = () => p.evaluate(k => JSON.parse(localStorage.getItem(k)).tables, KEY);
const ok = (name, cond) => { console.log((cond ? 'ok   ' : 'FAIL ') + name); if (!cond) process.exitCode = 1; };
const main = () => p.textContent('#main');
await p.goto(BASE); await p.waitForSelector('.kpis'); await p.evaluate(() => localStorage.clear()); await p.reload(); await p.waitForSelector('.kpis');
let t = await T();
const subT = t.tenants.find(x => !x.name.includes('יזמות'));
// לקוח קבלן משנה: הדוחות הקיימים בלי לשוניות יזם
await p.selectOption('#tsel', subT.id); await p.waitForTimeout(500);
await p.goto(BASE + '#/reports'); await p.waitForSelector('#rep table');
ok('sub tenant: old reports, no dev tabs', (await main()).includes('רווחיות') && !(await main()).includes('יומן הוראות שינוי'));
const dt = t.tenants.find(x => x.name.includes('יזמות')); const dp = t.projects.find(x => x.project_type === 'dev');
await p.selectOption('#tsel', dt.id); await p.waitForTimeout(600);
await p.goto(BASE + '#/reports'); await p.waitForSelector('#rep table');
ok('dev tenant: reports open on budget control', (await p.textContent('.tabs a.on')) === 'בקרה תקציבית' && (await main()).includes('01 תכנון ויועצים'));
const R = {
  'd-budget': ['בסיס נעול', 'צפי סופי', 'שינויים בתהליך', 'סטייה מהבסיס', 'התקשרויות ושינויים בלי סעיף תקציב'],
  'd-cash': ['3 חודשים', '6 חודשים', '12 חודשים', 'תקבולים מרוכשים', 'יתרה מצטברת', 'תקבולים באיחור'],
  'd-cos': ['CO-01', 'CO-02', 'בוצע בלי אישור', 'נדרש ניתוח מחיר', 'נדחה', 'פער ממחיר המכירה', 'ימי לו"ז'],
  'd-cbills': ['מאושר ברוטו', 'קוצץ', 'עיכבון', 'קיזוז מקדמה', 'מחיר שונה ממחיר החוזה', 'חשבונית כחוק', 'שולם'],
  'd-vendors': ['ש.ב. בנייה וביצוע', 'יתרה לתשלום', 'עיכבון שנצבר', 'מתוך 2,000,000', 'ביצוע', 'מקדמה'],
  'd-docs': ['ביטוח', 'רישיון קבלן', 'אישור ניכוי מס במקור', 'חסר', 'פג 30.09.2026', 'מסמך יפוג בקרוב'],
  'd-group': ['מגדל הדקל', 'הכנסות שהתקבלו', 'נטו 12 חודשים', 'אדומות'],
  'd-alerts': ['החלטה נדרשת', 'יתרה מתחת למינימום', 'בטיפול', 'לאשר בישיבת ההנהלה']
};
for (const [k, words] of Object.entries(R)) {
  await p.goto(BASE + '#/reports/' + k); await p.waitForSelector('#rep table'); await p.waitForTimeout(200);
  const txt = await main(); const miss = words.filter(w => !txt.includes(w));
  ok(`${k}: content ${miss.length ? 'missing ' + miss.join(', ') : ''}`, !miss.length);
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#xl')]); ok(`${k}: excel`, !!(await dl.path()));
  await p.screenshot({ path: OUT + 'rep-' + k + '.png', fullPage: true });
}
// אקסל: כמה גיליונות בדוח התזרים
await p.goto(BASE + '#/reports/d-cash'); await p.waitForSelector('#rep table');
const sheets = await p.$$eval('#rep [data-sheet]', els => els.map(e => e.dataset.sheet)); ok('cash report: 2 sheets', sheets.join('|') === 'סיכום 3-6-12|חודשי');
await p.selectOption('#hz', '3'); await p.waitForTimeout(400);
const cols3 = await p.$$eval('#rep [data-sheet="חודשי"] thead th', x => x.length); await p.selectOption('#hz', '12'); await p.waitForTimeout(400);
const cols12 = await p.$$eval('#rep [data-sheet="חודשי"] thead th', x => x.length); ok(`monthly horizon 3 vs 12 (${cols3}/${cols12})`, cols12 - cols3 === 9);
// פירוט לפי סעיף
await p.goto(BASE + '#/reports/d-budget'); await p.waitForSelector('#rep table'); const r0 = (await p.$$('#rep tbody tr')).length;
await p.check('#items'); await p.waitForTimeout(400); const r1 = (await p.$$('#rep tbody tr')).length; ok(`budget by item (${r0} -> ${r1})`, r1 > r0 + 10);
await p.uncheck('#items'); await p.waitForTimeout(300);
// התרעות: כולל מה שטופל
await p.goto(BASE + '#/reports/d-alerts'); await p.waitForSelector('#rep table'); ok('alerts: handled hidden', !(await main()).includes('דיפון, עוגנים וחפירה'));
await p.check('#handled'); await p.waitForTimeout(400); ok('alerts: handled shown', (await main()).includes('דיפון, עוגנים וחפירה') && (await main()).includes('טופל'));
await p.uncheck('#handled'); await p.waitForTimeout(300);
// סינון לפרויקט
await p.goto(BASE + '#/reports/d-cos'); await p.waitForSelector('#pid'); await p.selectOption('#pid', dp.id); await p.waitForTimeout(400);
ok('project filter', (await p.textContent('.rephead span')).includes(dp.name));
// PDF: תצוגת הדפסה בלי תפריט
await p.goto(BASE + '#/reports/d-cbills'); await p.waitForSelector('#rep table'); await p.emulateMedia({ media: 'print' });
ok('print view hides menu and buttons', !(await p.isVisible('.side')) && !(await p.isVisible('#xl')) && (await p.isVisible('.rephead')));
await p.pdf({ path: OUT + 'rep-cbills.pdf', format: 'A4', landscape: true }); await p.emulateMedia({ media: 'screen' });
// קישור מהדוח לחשבון
await p.click('#rep tbody a'); await p.waitForTimeout(500); ok('bill link opens bill', p.url().includes('/cbill/'));
// טלפון
await p.setViewportSize({ width: 390, height: 844 });
for (const k of ['d-budget', 'd-cbills', 'd-group']) {
  await p.goto(BASE + '#/reports/' + k); await p.waitForTimeout(500);
  const over = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth); ok(`phone ${k}: no overflow (${over})`, over <= 2);
}
await p.screenshot({ path: OUT + 'rep-phone.png', fullPage: true });
console.log(errs.length ? 'errors: ' + errs.join(' | ') : 'no errors');
if (errs.length) process.exitCode = 1;
await b.close();
