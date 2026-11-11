// בדיקת חבילה 25: אחוזים בשורת קומפלט, חריגה מוסברת (הערה / הוראת שינוי) בחשבון קבלן
import { chromium } from 'playwright';
const BASE = 'http://localhost:8123/'; const KEY = 'grosher-subcon-demo-v5'; const OUT = 'tests/shots/';
const b = await chromium.launch();
const ok = (name, cond) => { console.log((cond ? 'ok   ' : 'FAIL ') + name); if (!cond) process.exitCode = 1; };
const errs = [];
const p = await (await b.newContext({ viewport: { width: 1440, height: 950 } })).newPage(); p.on('pageerror', e => errs.push(e.message));
const T = () => p.evaluate(k => JSON.parse(localStorage.getItem(k)).tables, KEY);
await p.goto(BASE); await p.waitForSelector('.kpis'); await p.evaluate(() => localStorage.clear()); await p.reload(); await p.waitForSelector('.kpis');
let t = await T();
const dT = t.tenants.find(x => x.name.includes('יזמות')), dp = t.projects.find(x => x.project_type === 'dev' && x.tenant_id === dT.id);
const cArch = t.contracts.find(c => c.project_id === dp.id && c.number === 'C-01');
await p.selectOption('#tsel', dT.id); await p.waitForTimeout(600);
// חשבון חדש לאדריכל (שורת קומפלט אחת)
await p.goto(BASE + `#/project/${dp.id}/cbills`); await p.waitForSelector('#add'); await p.click('#add'); await p.waitForSelector('.dlg select[name=contract_id]');
await p.selectOption('.dlg select[name=contract_id]', cArch.id); await p.click('.dlg [data-ok]'); await p.waitForSelector('.billv'); await p.waitForTimeout(400);
ok('lump-sum row: percent inputs', (await p.$$('#lt .pctin')).length === 2);
await p.fill('#lt input[data-k=cum_qty_sub]', '40'); await p.press('#lt input[data-k=cum_qty_sub]', 'Tab'); await p.waitForTimeout(200);
ok('40% submitted = 580,000', (await p.textContent('#lt .tot')).includes('580,000'));
await p.fill('#lt input[data-k=cum_qty_app]', '50'); await p.press('#lt input[data-k=cum_qty_app]', 'Tab'); await p.waitForTimeout(200);
ok('approved 50% = 725,000 (not 72.5M)', (await p.textContent('#lt .tot')).includes('725,000') && !(await p.textContent('#lt')).includes('72,500,000'));
ok('exceed chip + explain button', (await p.textContent('#lt')).includes('חריגה: מאושר מעל המוגש') && !!(await p.$('#lt [data-ovr]')));
await p.screenshot({ path: OUT + 'p25-exceed.png', clip: { x: 0, y: 0, width: 1440, height: 700 } });
// שמירה בלי הסבר: נפתח חלון, לא נשמר בלי הסבר
await p.click('#save'); await p.waitForSelector('.dlg [name=note_0]');
await p.screenshot({ path: OUT + 'p25-exceed-dialog.png' });
await p.click('.dlg [data-ok]'); ok('dialog requires note or CO', (await p.textContent('.dlg .err')).includes('הוראת שינוי או כותבים הערה'));
await p.fill('.dlg [name=note_0]', 'לפי אבן דרך שאושרה בפגישה'); await p.click('.dlg [data-ok]'); await p.waitForTimeout(1000);
t = await T();
const bill = t.cbills.filter(x => x.contract_id === cArch.id).sort((a, b) => b.number - a.number)[0];
const bl = t.cbill_lines.find(l => l.cbill_id === bill.id);
ok('saved as fractions + reason', bl && Math.abs(bl.cum_qty_sub - 0.4) < 1e-9 && Math.abs(bl.cum_qty_app - 0.5) < 1e-9 && bl.over_reason === 'לפי אבן דרך שאושרה בפגישה');
ok('change log: explained exceed', t.change_log.some(c => c.field === 'חריגה מוסברת' && (c.reason || '').includes('אבן דרך')));
await p.goto(BASE + `#/project/${dp.id}/cbill/${bill.id}`); await p.waitForSelector('#lt');
ok('reopen: explained, percent shown', (await p.textContent('#lt')).includes('✓ הוסבר') && (await p.inputValue('#lt input[data-k=cum_qty_app]')) === '50');
// קישור להוראת שינוי במקום הערה (אם יש הוראה בהתקשרות הראשית)
const cMain = t.contracts.find(c => c.project_id === dp.id && c.number === 'C-04');
const b4 = t.cbills.find(x => x.contract_id === cMain?.id && x.number === 4);
if (b4) {
  await p.goto(BASE + `#/project/${dp.id}/cbill/${b4.id}`); await p.waitForSelector('#lt input[data-k=cum_qty_app]');
  await p.fill('#lt input[data-k=cum_qty_app] >> nth=0', '99999'); await p.press('#lt input[data-k=cum_qty_app] >> nth=0', 'Tab'); await p.waitForTimeout(200);
  await p.click('#save'); await p.waitForSelector('.dlg select[name=co_0]');
  const n = (await p.$$('.dlg .ovrbox')).length;
  for (let k = 0; k < n; k++) { const opt = await p.$$eval(`.dlg select[name=co_${k}] option`, os => os.map(o => o.value).filter(Boolean)); if (opt.length) await p.selectOption(`.dlg select[name=co_${k}]`, opt[0]); else await p.fill(`.dlg [name=note_${k}]`, 'מדידה'); }
  await p.click('.dlg [data-ok]'); await p.waitForTimeout(1000); t = await T();
  ok(`main bill: ${n} exceed rows explained via CO`, n >= 1 && t.cbill_lines.filter(l => l.cbill_id === b4.id && (l.over_co_id || l.over_reason)).length >= n);
  await p.goto(BASE + `#/project/${dp.id}/cbillpdf/${b4.id}`); await p.waitForTimeout(600);
  ok('recommendation page: exceed section with CO', (await p.textContent('.rpage')).includes('חריגות שאושרו') && (await p.textContent('.rpage')).includes('הוראת שינוי'));
}
await p.goto(BASE + `#/project/${dp.id}/cbillpdf/${bill.id}`); await p.waitForTimeout(600);
const sh = await p.textContent('.rpage');
ok('recommendation page: percents + reason', sh.includes('50%') && sh.includes('40%') && sh.includes('לפי אבן דרך'));
await p.screenshot({ path: OUT + 'p25-sheet.png', fullPage: true });
// דף החתימה של היזם מציג את החריגות
await p.goto(BASE + `#/project/${dp.id}/cbill/${bill.id}`); await p.waitForSelector('.billv'); await p.selectOption('.billv select[name=status]', 'recommended'); await p.click('#save'); await p.waitForTimeout(900);
await p.goto(BASE + `#/project/${dp.id}/cbill/${bill.id}`); await p.waitForSelector('#dsign [data-dact=send]'); await p.click('#dsign [data-dact=send]'); await p.waitForSelector('.dlg [data-how=copy]'); await p.click('.dlg [data-how=copy]');
await p.waitForSelector('.dlg input[readonly]'); await p.click('.dlg [data-x]'); await p.waitForTimeout(500);
const s = await p.context().newPage(); await s.setViewportSize({ width: 390, height: 900 }); await s.goto(await p.evaluate(() => window.__LAST_SIGN_LINK__)); await s.waitForSelector('#cv');
const st = await s.textContent('main');
ok('sign page: exceed + percent', st.includes('חריגות שאושרו') && st.includes('לפי אבן דרך') && st.includes('50%'));
// טלפון
await p.setViewportSize({ width: 390, height: 844 }); await p.goto(BASE + `#/project/${dp.id}/cbill/${bill.id}`); await p.waitForSelector('#lt'); await p.waitForTimeout(300);
ok('phone: no page overflow', (await p.evaluate(() => document.documentElement.scrollWidth)) <= 392);
ok('no page errors: ' + errs.slice(0, 2).join(' | '), errs.length === 0);
await b.close();
