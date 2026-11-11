// בדיקת חבילה 13: הוראות שינוי ליזם (4 מחירים, 6 שלבים), חשבונות קבלנים, בדיקה, המלצה לתשלום, חשבונית כחוק ושער מסמכים
import { chromium } from 'playwright';
const BASE = 'http://localhost:8123/'; const KEY = 'grosher-subcon-demo-v5'; const OUT = 'tests/shots/';
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
const T = () => p.evaluate(k => JSON.parse(localStorage.getItem(k)).tables, KEY);
const ok = (name, cond) => { console.log((cond ? 'ok   ' : 'FAIL ') + name); if (!cond) process.exitCode = 1; };
const main = () => p.textContent('#main');
await p.goto(BASE); await p.waitForSelector('.kpis'); await p.evaluate(() => localStorage.clear()); await p.reload(); await p.waitForSelector('.kpis');
let t = await T();
const dt = t.tenants.find(x => x.name.includes('יזמות')); const dp = t.projects.find(x => x.project_type === 'dev');
await p.selectOption('#tsel', dt.id); await p.waitForTimeout(500); await p.waitForSelector('.kpis');
if (await p.locator('#moreacts').count()) await p.click('#moreacts');
const home = await main();
ok('home shows CO + contractor bill alerts', home.includes('שינוי בוצע בלי אישור בכתב') && home.includes('חשבון קבלן ממתין לבדיקה'));

// ===== הוראות שינוי =====
await p.goto(BASE + `#/project/${dp.id}/cos`); await p.waitForSelector('#tb');
const nav = await p.textContent('.ptabs'); ok('nav tabs text', nav.includes('הוראות שינוי') && nav.includes('חשבונות קבלנים'));
const cos = await main();
ok('CO list: stages and alerts', cos.includes('CO-01') && cos.includes('נדחה') && cos.includes('בדיקה ותמחור') && cos.includes('נדרש ניתוח מחיר') && cos.includes('לא נכלל בחשבון'));
await p.screenshot({ path: OUT + 'co-list.png', fullPage: true });
// הוראה חדשה עם שורה מהחוזה ושורה חדשה
const cMain = t.contracts.find(c => c.number === 'C-04');
await p.click('#add'); await p.waitForSelector('.ov');
ok('auto number', (await p.inputValue('.ov [name=number]')) === 'CO-06');
await p.fill('.ov [name=title]', 'הגבהת מעקות במרפסות');
await p.selectOption('.ov [name=contract_id]', cMain.id);
const firstLine = t.contract_lines.find(l => l.contract_id === cMain.id && l.code === '04.02');
await p.selectOption('#pickcl', firstLine.id); await p.waitForTimeout(150);
ok('line from contract fills sale + contract price', await p.inputValue('#ll [data-f=price_contract]') === '1820' && await p.inputValue('#ll [data-f=price_sale]') === '1850');
ok('budget item auto-filled', (await p.inputValue('.ov [name=boq_item_id]')) === firstLine.boq_item_id);
await p.fill('#ll [data-k="0"][data-f=qty]', '10'); await p.press('#ll [data-k="0"][data-f=qty]', 'Tab');
await p.fill('#ll [data-k="0"][data-f=price_requested]', '2000'); await p.press('#ll [data-k="0"][data-f=price_requested]', 'Tab'); await p.waitForTimeout(100);
ok('requested vs contract % shown', (await p.textContent('#ll')).includes('מהחוזה'));
await p.click('#addfree'); await p.waitForTimeout(100);
await p.fill('#ll [data-k="1"][data-f=description]', 'מעקה זכוכית'); await p.press('#ll [data-k="1"][data-f=description]', 'Tab');
await p.fill('#ll [data-k="1"][data-f=qty]', '40'); await p.press('#ll [data-k="1"][data-f=qty]', 'Tab');
await p.fill('#ll [data-k="1"][data-f=price_requested]', '950'); await p.press('#ll [data-k="1"][data-f=price_requested]', 'Tab'); await p.waitForTimeout(100);
ok('needs analysis marked', (await p.textContent('#ll')).includes('נדרש ניתוח מחיר') && (await p.textContent('#ltot')).includes('ניתוח מחיר'));
await p.fill('.ov [name=schedule_days]', '4'); await p.selectOption('.ov [name=initiator]', 'buyer');
// אישור בלי מחיר מאושר לשורה החדשה ובלי ניתוח: חסום
await p.selectOption('.ov [name=stage]', 'approved'); await p.waitForTimeout(100);
ok('approved date auto-filled', !!(await p.inputValue('.ov [name=approved_date]')));
await p.click('.ov [data-ok]'); await p.waitForTimeout(200);
ok('approve blocked: no approved price', (await p.textContent('.ov .err')).includes('מחיר מאושר'));
await p.fill('#ll [data-k="1"][data-f=price_approved]', '900'); await p.press('#ll [data-k="1"][data-f=price_approved]', 'Tab');
await p.click('.ov [data-ok]'); await p.waitForTimeout(200);
ok('approve blocked: needs price analysis', (await p.textContent('.ov .err')).includes('ניתוח מחיר'));
await p.fill('.ov [name=price_analysis]', '2 הצעות: 880 ו-940 ₪ למ"א');
await p.fill('#ll [data-k="0"][data-f=price_sale]', '1900'); await p.press('#ll [data-k="0"][data-f=price_sale]', 'Tab'); await p.waitForTimeout(100);
ok('sale price editable + gap total', (await p.textContent('#ltot')).includes('פער'));
await p.screenshot({ path: OUT + 'co-dialog.png' });
await p.click('.ov [data-ok]'); await p.waitForTimeout(600);
t = await T();
const nco = t.change_orders.find(c => c.number === 'CO-06');
const nl = t.co_lines.filter(l => l.co_id === nco?.id);
ok('CO saved with 4 prices', nco && nco.stage === 'approved' && nco.schedule_days === 4 && nco.vendor_name === cMain.vendor_name && nl.length === 2 && nl[0].price_sale === 1900 && nl[0].price_contract === 1820 && nl[0].price_requested === 2000 && nl[0].price_approved == null && nl[1].price_approved === 900);
ok('CO logged', t.change_log.some(c => c.entity_id === nco.id && c.field === 'הוראת שינוי חדשה'));
// אישור של CO-02 (בוצע בלי אישור)
const co2 = t.change_orders.find(c => c.number === 'CO-02');
await p.click(`[data-co="${co2.id}"] td:nth-child(2)`); await p.waitForSelector('.ov');
ok('stepper warns missing approval', await p.locator('.ov .stepper li.warn').count() === 1);
await p.fill('.ov [name=approved_date]', '2026-10-20'); await p.fill('.ov [name=approval_ref]', 'מייל יזם 20/10');
await p.fill('#ll [data-k="0"][data-f=price_approved]', '1880'); await p.press('#ll [data-k="0"][data-f=price_approved]', 'Tab');
await p.click('.ov [data-ok]'); await p.waitForTimeout(600);
t = await T(); ok('CO-02 approved at manual price', t.change_orders.find(c => c.id === co2.id).approved_date === '2026-10-20' && t.co_lines.find(l => l.co_id === co2.id).price_approved === 1880);
ok('alert for CO-02 gone', !(await main()).includes('שינוי בוצע בלי אישור בכתב: CO-02'));

// ===== חשבונות קבלנים =====
await p.goto(BASE + `#/project/${dp.id}/cbills`); await p.waitForSelector('.kpis');
const cb = await main();
ok('bills list', cb.includes('ממתינים לבדיקה') && cb.includes('ש.ב. בנייה') && cb.includes('ק.ל. אלומיניום') && cb.includes('שולם'));
await p.screenshot({ path: OUT + 'cbill-list.png', fullPage: true });
const b4 = t.cbills.find(x => x.contract_id === cMain.id && x.number === 4);
await p.goto(BASE + `#/project/${dp.id}/cbill/${b4.id}`); await p.waitForSelector('#lt table');
let v = await main();
ok('bill 4: CO-02 now approved, flags: price diff', v.includes('מחיר שונה') && (await p.textContent('#chk')).includes('מחיר שונה ממחיר החוזה') && (await p.textContent('#chk')).includes('חשבונית כחוק'));
ok('bill 4: new CO-06 lines listed', v.includes('הגבהת מעקות'));
ok('summary: retention + advance', (await p.textContent('#sum')).includes('עיכבון 5%') && (await p.textContent('#sum')).includes('קיזוז מקדמה'));
await p.screenshot({ path: OUT + 'cbill-view.png', fullPage: true });
// קיצוץ בשורה
const l402 = t.contract_lines.find(l => l.contract_id === cMain.id && l.code === '04.02');
await p.fill(`[data-key="c:${l402.id}"][data-k=cum_qty_app]`, '1250'); await p.press(`[data-key="c:${l402.id}"][data-k=cum_qty_app]`, 'Tab'); await p.waitForTimeout(150);
ok('cut shown', (await p.textContent('#sum')).includes('קוצץ בבדיקה'));
// המלצה
await p.selectOption('[name=status]', 'recommended'); await p.click('#save'); await p.waitForTimeout(600);
t = await T(); let B = t.cbills.find(x => x.id === b4.id);
ok('recommended saved with date + line', B.status === 'recommended' && !!B.recommended_date && t.cbill_lines.some(l => l.cbill_id === b4.id && l.contract_line_id === l402.id && l.cum_qty_app === 1250));
ok('no expense before approval', !t.expenses.some(e => e.cbill_id === b4.id));
// אישור בלי חשבונית כחוק: דורש סיבה
await p.selectOption('[name=status]', 'approved'); await p.click('#save'); await p.waitForSelector('.ov');
ok('gate dialog lists legal invoice', (await p.textContent('.ov')).includes('חשבונית כחוק'));
await p.click('.ov [data-ok]'); await p.waitForTimeout(150); ok('gate needs reason', (await p.textContent('.ov .err')).includes('סיבה'));
await p.click('.ov [data-x]'); await p.waitForTimeout(200);
await p.check('[name=invoice_legal]'); await p.click('#save'); await p.waitForTimeout(700);
t = await T(); B = t.cbills.find(x => x.id === b4.id);
const ex4 = t.expenses.find(e => e.cbill_id === b4.id);
ok('approved with legal invoice (vendor docs ok) + expense created', B.status === 'approved' && B.invoice_legal === true && ex4 && ex4.status === 'approved' && ex4.contract_id === cMain.id && ex4.amount > 3000000);
ok('CO-01 now "נכלל בחשבון"', await p.goto(BASE + `#/project/${dp.id}/cos`).then(() => p.waitForTimeout(400)).then(() => main()).then(x => x.includes('נכלל בחשבון') && x.includes('חשבון 4')));
// דף המלצה לתשלום
await p.goto(BASE + `#/project/${dp.id}/cbillpdf/${b4.id}`); await p.waitForSelector('.rpage');
const sh = await p.textContent('.rpage');
ok('recommendation sheet', sh.includes('בדיקת חשבון והמלצה לתשלום') && sh.includes('סכום מומלץ לתשלום') && sh.includes('ש.ב. בנייה') && sh.includes('אושר לתשלום ע"י היזם'));
await p.screenshot({ path: OUT + 'cbill-sheet.png', fullPage: true });
await p.emulateMedia({ media: 'print' }); await p.screenshot({ path: OUT + 'cbill-sheet-print.png', fullPage: true }); await p.emulateMedia({ media: 'screen' });
const pdf = await p.pdf({ format: 'A4' }); ok('PDF renders', pdf.length > 20000);
// ספק עם מסמכים חסרים: אישור עם סיבה
const cAlu = t.contracts.find(c => c.number === 'C-05'); const ba = t.cbills.find(x => x.contract_id === cAlu.id);
await p.goto(BASE + `#/project/${dp.id}/cbill/${ba.id}`); await p.waitForSelector('#chk');
const chk = await p.textContent('#chk'); ok('alu: missing docs listed', chk.includes('פג תוקף: ביטוח') && chk.includes('חסר: רישיון קבלן'));
await p.check('[name=invoice_legal]'); await p.selectOption('[name=status]', 'approved'); await p.click('#save'); await p.waitForSelector('.ov');
await p.fill('.ov [name=why]', 'הספק הציג ביטוח מחודש במייל, יועלה מחר'); await p.click('.ov [data-ok]'); await p.waitForTimeout(700);
t = await T(); const BA = t.cbills.find(x => x.id === ba.id);
ok('override saved + logged', BA.status === 'approved' && BA.doc_override.includes('ביטוח מחודש') && t.change_log.some(c => c.entity_id === ba.id && c.field === 'אישור למרות חוסר במסמכים'));
// תשלום
await p.selectOption('[name=status]', 'paid'); await p.click('#save'); await p.waitForTimeout(600);
t = await T(); ok('paid: expense paid', t.cbills.find(x => x.id === ba.id).paid_date && t.expenses.find(e => e.cbill_id === ba.id).status === 'paid');
// חשבון חדש
await p.goto(BASE + `#/project/${dp.id}/cbills`); await p.waitForSelector('#add');
await p.click('#add'); await p.waitForSelector('.ov'); await p.selectOption('.ov [name=contract_id]', cAlu.id); await p.fill('.ov [name=invoice_no]', 'KL-55'); await p.click('.ov [data-ok]');
await p.waitForSelector('#lt table');
const h1 = await p.textContent('#tab h1'); ok('new bill opens as number 2', h1.includes('חשבון 2'));
const la = t.contract_lines.find(l => l.contract_id === cAlu.id);
ok('prev cumulative from bill 1', (await p.textContent('#lt')).includes('800'));
await p.fill(`[data-key="c:${la.id}"][data-k=cum_qty_sub]`, '1500'); await p.press(`[data-key="c:${la.id}"][data-k=cum_qty_sub]`, 'Tab'); await p.waitForTimeout(150);
ok('duplicate invoice detected', (await p.textContent('#chk')).includes('מספר חשבונית שכבר נרשם'));
await p.click('#save'); await p.waitForTimeout(500);
// בקרה תקציבית: שינויים בתהליך וכלולים
await p.goto(BASE + `#/project/${dp.id}/control`); await p.waitForSelector('#ctl table');
const ctl = await p.textContent('#ctl'); ok('control shows CO chips', ctl.includes('שינויים') && ctl.includes('בתהליך'));
await p.goto(BASE + `#/project/${dp.id}/contracts`); await p.waitForSelector('#tb');
ok('contracts show CO amount', (await p.textContent('#tb')).includes('כולל שינויים'));
// טלפון
await p.setViewportSize({ width: 390, height: 844 });
for (const [path, name] of [[`cos`, 'co-phone'], [`cbill/${b4.id}`, 'cbill-phone'], [`cbills`, 'cbills-phone']]) {
  await p.goto(BASE + `#/project/${dp.id}/${path}`); await p.waitForTimeout(500);
  const over = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  ok(`phone ${path}: no page overflow (${over})`, over <= 2); await p.screenshot({ path: OUT + name + '.png', fullPage: true });
}
console.log(errs.length ? 'errors: ' + errs.join(' | ') : 'no errors');
if (errs.length) process.exitCode = 1;
await b.close();
