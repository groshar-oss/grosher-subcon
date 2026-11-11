// בדיקת חבילה 23: מנהל עבודה (ספר טלפונים, עובד ועבודה שלא ברשימה, פירוט), טיפול במשרד, נספח הוראות שינוי בחשבון
import { chromium } from 'playwright';
const BASE = 'http://localhost:8123/'; const KEY = 'grosher-subcon-demo-v5'; const OUT = 'tests/shots/';
const b = await chromium.launch();
const ok = (name, cond) => { console.log((cond ? 'ok   ' : 'FAIL ') + name); if (!cond) process.exitCode = 1; };
const errs = [];
const T = p => p.evaluate(k => JSON.parse(localStorage.getItem(k)).tables, KEY);
// טלפון: מנהל עבודה
const ph = await (await b.newContext({ viewport: { width: 390, height: 844 } })).newPage(); ph.on('pageerror', e => errs.push(e.message));
await ph.goto(BASE); await ph.waitForSelector('.kpis'); await ph.evaluate(() => localStorage.clear()); await ph.reload(); await ph.waitForSelector('#demoRole');
await ph.selectOption('#demoRole', 'foreman'); await ph.waitForSelector('text=הפרויקטים שלי', { timeout: 15000 }); await ph.waitForTimeout(300);
ok('foreman: no phone book in menu', !(await ph.evaluate(() => [...document.querySelectorAll('.nav a')].some(a => a.getAttribute('href') === '#/contacts'))));
await ph.goto(BASE + '#/contacts'); await ph.waitForTimeout(700); ok('foreman: phone book blocked', (await ph.textContent('#main')).includes('אין הרשאה'));
await ph.goto(BASE + '#/'); await ph.waitForTimeout(600);
await ph.click('text=יומן עבודה להיום'); await ph.waitForSelector('.dayv'); await ph.waitForTimeout(300);
const pid = await ph.evaluate(() => location.hash.split('/')[2]);
// עובד חדש
await ph.click('#addw'); await ph.waitForSelector('.dlg [name=name]'); await ph.fill('.dlg [name=name]', 'מוחמד טייח חדש'); await ph.fill('.dlg [name=phone]', '052-7778899'); await ph.fill('.dlg [name=trade]', 'טייח');
await ph.click('.dlg [data-ok]'); await ph.waitForTimeout(700);
ok('new worker checked in day', (await ph.textContent('.wrow.on')).includes('מוחמד טייח חדש') && (await ph.textContent('#wl')).includes('ממתין לתעריף'));
// פירוט בשורת עובד
await ph.fill('.wrow.on .wnote >> nth=0', 'טיח פנים קומה 3'); await ph.dispatchEvent('.wrow.on .wnote >> nth=0', 'change');
// עבודה שלא ברשימה: אחת תוספת ואחת רגילה
await ph.click('#addx'); await ph.fill('.xrow:nth-child(1) [data-k=description]', 'פתיחה בקיר לצנרת'); await ph.dispatchEvent('.xrow:nth-child(1) [data-k=description]', 'change');
await ph.fill('.xrow:nth-child(1) [data-k=qty]', '3'); await ph.dispatchEvent('.xrow:nth-child(1) [data-k=qty]', 'change');
await ph.fill('.xrow:nth-child(1) [data-k=unit]', "יח'"); await ph.dispatchEvent('.xrow:nth-child(1) [data-k=unit]', 'change');
await ph.fill('.xrow:nth-child(1) [data-k=note]', 'לבקשת המפקח'); await ph.dispatchEvent('.xrow:nth-child(1) [data-k=note]', 'change');
await ph.check('.xrow:nth-child(1) [data-k=is_vo]'); await ph.dispatchEvent('.xrow:nth-child(1) [data-k=is_vo]', 'change');
await ph.click('#addx'); await ph.fill('.xrow:nth-child(2) [data-k=description]', 'ניקיון פסולת בקומה'); await ph.dispatchEvent('.xrow:nth-child(2) [data-k=description]', 'change');
await ph.screenshot({ path: OUT + 'p23-day-phone.png', fullPage: true });
ok('phone day: no overflow', (await ph.evaluate(() => document.documentElement.scrollWidth)) <= 392);
await ph.click('#save'); await ph.waitForTimeout(900);
let t = await T(ph);
const nw = t.workers.find(w => w.name === 'מוחמד טייח חדש');
ok('worker saved pending_rate', nw && nw.pending_rate && !nw.daily_rate);
ok('worker note saved', t.work_entries.some(e => e.worker_id === nw.id && e.note === 'טיח פנים קומה 3'));
const xv = t.work_extras.find(x => x.description === 'פתיחה בקיר לצנרת'), xn = t.work_extras.find(x => x.description === 'ניקיון פסולת בקומה');
const vo = t.variations.find(v => v.id === xv?.variation_id);
ok('VO extra opened draft variation from field', vo && vo.from_field && vo.status === 'draft' && vo.source === 'field' && t.boq_items.some(i => i.variation_id === vo.id && i.qty === 3));
ok('plain extra saved without VO', xn && !xn.variation_id && !xn.is_vo);
// עריכה חוזרת לא יוצרת הוראה כפולה
const day = xv.log_date; await ph.goto(BASE + `#/project/${pid}/day/${day}`); await ph.waitForSelector('.dayv'); await ph.waitForTimeout(400);
ok('reopen shows VO chip', (await ph.textContent('#xlst')).includes('נפתחה הוראת שינוי'));
await ph.click('#save'); await ph.waitForTimeout(800); t = await T(ph);
ok('resave keeps one VO', t.variations.filter(v => v.from_field).length === 1 && t.work_extras.filter(x => x.project_id === pid).length === 2);
const store = await ph.evaluate(() => Object.fromEntries(Object.entries(localStorage)));
// מחשב: משרד
const p = await (await b.newContext({ viewport: { width: 1440, height: 950 } })).newPage(); p.on('pageerror', e => errs.push(e.message));
await p.goto(BASE); await p.evaluate(s => { for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v); }, store); await p.reload(); await p.waitForSelector('#demoRole');
await p.selectOption('#demoRole', 'admin'); await p.waitForTimeout(800); await p.goto(BASE + '#/'); await p.waitForSelector('.kpis'); await p.waitForTimeout(600); await p.click('#moreacts').catch(() => {}); await p.waitForTimeout(300);
const home = await p.textContent('#main');
ok('home: new worker awaits rate', home.includes('עובד חדש ממתין לתעריף: מוחמד טייח חדש'));
ok('home: field VO to price', home.includes('תוספת מהשטח לתמחור'));
ok('home: unlisted work', home.includes('עבודה שלא ברשימה: ניקיון פסולת בקומה'));
await p.goto(BASE + `#/project/${pid}/worklog`); await p.waitForSelector('#xo .card'); await p.screenshot({ path: OUT + 'p23-worklog-extras.png', fullPage: true });
await p.click('#xo [data-xvo]'); await p.waitForTimeout(900); t = await T(p);
ok('office: open VO from unlisted work', !!t.work_extras.find(x => x.description === 'ניקיון פסולת בקומה').variation_id && t.variations.filter(v => v.from_field).length === 2);
await p.goto(BASE + `#/project/${pid}/vo`); await p.waitForTimeout(800); ok('VO tab shows field chip', (await p.textContent('#main')).includes('מהשטח'));
// עובד: השלמת תעריף מנקה את הסימון
await p.goto(BASE + '#/workers'); await p.waitForTimeout(700);
await p.click(`tr:has-text("מוחמד טייח חדש") >> text=עריכה`).catch(async () => { await p.click('tr:has-text("מוחמד טייח חדש")'); });
await p.waitForSelector('.dlg [name=daily_rate]'); await p.fill('.dlg [name=daily_rate]', '650'); await p.click('.dlg [data-ok]'); await p.waitForTimeout(800); t = await T(p);
ok('rate clears pending flag', t.workers.find(w => w.name === 'מוחמד טייח חדש').pending_rate === false);
// נספח בחשבון: חשבון שיש בו הוראת שינוי מאושרת
const bills = t.bills.filter(x => x.project_id === pid);
let target = null;
for (const bl of bills) { const ls = t.bill_lines.filter(l => l.bill_id === bl.id && Number(l.cum_qty_sub) > 0); const vIds = ls.map(l => t.boq_items.find(i => i.id === l.boq_item_id)?.variation_id).filter(Boolean);
  const ap = vIds.map(id => t.variations.find(v => v.id === id)).find(v => v && ['approved', 'partial'].includes(v.status)); if (ap) { target = { bill: bl, vo: ap }; } }
ok('found bill with approved VO: ' + (target?.vo?.number || 'none'), !!target);
if (target) {
  await p.goto(BASE + `#/project/${pid}/bill/${target.bill.id}`); await p.waitForSelector('.apx-page'); await p.waitForTimeout(500);
  ok('appendix page per VO', (await p.locator('.apx-page').count()) >= 1 && (await p.textContent('.apx-head')).includes('נספח'));
  const pg = p.locator(`.apx-page[data-vo="${target.vo.id}"]`);
  ok('approved VO without doc warns', (await pg.textContent()).includes('חסר מסמך האישור החתום'));
  // צירוף תמונה ו-PDF חתומים
  const pdfp = await (await b.newContext()).newPage(); await pdfp.setContent('<h1 style="font:40px sans-serif">אישור הוראת שינוי · חתום</h1><p>חתימה: ______</p>'); await pdfp.pdf({ path: '/tmp/signed.pdf', format: 'A4' }); await pdfp.close();
  await pg.locator('[data-att]').click(); await p.waitForTimeout(400);
  await p.locator('.ov').last().locator('input[type=file]').setInputFiles(['/tmp/signed.png']); await p.waitForTimeout(900);
  await p.locator('.ov').last().locator('input[type=file]').setInputFiles(['/tmp/signed.pdf']); await p.waitForTimeout(900);
  await p.locator('.ov').last().locator('[data-cancel], .x, button:has-text("סגירה")').first().click().catch(() => {}); await p.waitForTimeout(1200);
  await p.goto(BASE + `#/project/${pid}/bills`); await p.waitForTimeout(300); await p.goto(BASE + `#/project/${pid}/bill/${target.bill.id}`); await p.waitForSelector('.apx-page'); await p.waitForTimeout(3500);
  const imgs = await pg.locator('.apx-doc img').count();
  ok(`signed docs rendered (${imgs} images: png + pdf page)`, imgs >= 2 && (await pg.textContent()).includes('מסמך האישור החתום'));
  await p.emulateMedia({ media: 'print' }); await p.pdf({ path: '/tmp/bill-print.pdf', format: 'A4', printBackground: true }); await p.emulateMedia({ media: 'screen' });
  await pg.screenshot({ path: OUT + 'p23-bill-appendix.png' });
}
ok('no errors', !errs.length); if (errs.length) console.log(errs);
await b.close();
