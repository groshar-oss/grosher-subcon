// בדיקת חבילה 24: חתימת יזם על חשבון קבלן, חתימת קבלן ראשי על הוראת שינוי, חתימת מפקח ביומן (לא חובה)
import { chromium } from 'playwright';
const BASE = 'http://localhost:8123/'; const KEY = 'grosher-subcon-demo-v5'; const OUT = 'tests/shots/';
const b = await chromium.launch();
const ok = (name, cond) => { console.log((cond ? 'ok   ' : 'FAIL ') + name); if (!cond) process.exitCode = 1; };
const errs = [];
const ctx = await b.newContext({ viewport: { width: 1440, height: 950 } });
await ctx.addInitScript(() => {
  window.__G__ = []; let gid = 0;
  window.__GOOGLE_MOCK__ = { fetch: async (url, opt = {}) => {
    const rec = { url, method: opt.method || 'GET' };
    if (typeof opt.body === 'string') { try { const j = JSON.parse(opt.body); rec.name = j.name; rec.raw = j.raw ? j.raw.length : 0; rec.rawText = j.raw || ''; } catch {} }
    else if (opt.body && opt.body.get) { const m = JSON.parse(await opt.body.get('metadata').text()); rec.name = m.name; rec.upload = true; }
    window.__G__.push(rec);
    if (url.includes('files?fields=files(id)')) return { files: [] };
    return { id: 'g' + (++gid) };
  } };
  window.open = (u) => { window.__OPENED__ = u; return null; };
});
const p = await ctx.newPage(); p.on('pageerror', e => { errs.push(e.message); console.log('PERR', e.stack); }); p.on('console', m => { if (m.type() === 'error' && !m.text().includes('favicon')) errs.push(m.text()); });
p.on('console', m => { if (m.type() === 'warning') console.log('WARN', m.text()); });
const T = () => p.evaluate(k => JSON.parse(localStorage.getItem(k)).tables, KEY);
const draw = async (pg, sel) => { await pg.$eval(sel, c => c.scrollIntoView({ block: 'center' })); await pg.waitForTimeout(100); const bx = await pg.$eval(sel, c => { const r = c.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
  await pg.mouse.move(bx.x + 30, bx.y + bx.h / 2); await pg.mouse.down(); for (let i = 0; i < 18; i++) await pg.mouse.move(bx.x + 30 + i * 12, bx.y + bx.h / 2 + Math.sin(i / 2) * 30); await pg.mouse.up(); };
await p.goto(BASE); await p.waitForSelector('.kpis'); await p.evaluate(() => localStorage.clear()); await p.reload(); await p.waitForSelector('.kpis');
let t = await T();
const dT = t.tenants.find(x => x.name.includes('יזמות')), dp = t.projects.find(x => x.project_type === 'dev' && x.tenant_id === dT.id);
const sT = t.tenants.find(x => x.name.includes('גבס'));
await p.selectOption('#tsel', dT.id); await p.waitForTimeout(700);

// ===== 1. חשבון קבלן: שליחה ליזם =====
const cb = t.cbills.find(x => x.project_id === dp.id && x.number === 4);
await p.goto(BASE + `#/project/${dp.id}/cbill/${cb.id}`); await p.waitForSelector('#dsign');
ok('bill: sign card waits for "recommended"', (await p.textContent('#dsign')).includes('הומלץ לתשלום') && !(await p.$('#dsign [data-dact=send]')));
await p.selectOption('.billv select[name=status]', 'recommended'); await p.click('#save'); await p.waitForTimeout(900);
await p.goto(BASE + `#/project/${dp.id}/cbill/${cb.id}`); await p.waitForSelector('#dsign [data-dact=send]');
await p.click('#dsign [data-dact=send]'); await p.waitForSelector('.dlg [data-how=mail]');
await p.screenshot({ path: OUT + 'p24-how.png' });
ok('send chooser: mail / WhatsApp / copy', !!(await p.$('.dlg [data-how=wa]')) && !!(await p.$('.dlg [data-how=copy]')));
await p.click('.dlg [data-how=mail]'); await p.waitForSelector('.dlg [name=to]', { timeout: 20000 });
await p.fill('.dlg [name=to]', 'yazam@example.com'); await p.click('.dlg:last-of-type [data-ok]'); await p.waitForTimeout(1600);
const gm = await p.evaluate(() => window.__G__.filter(g => g.url.includes('gmail')).pop());
ok('bill mail sent via Gmail (with link)', !!gm && gm.raw > 1000);
t = await T(); let so = t.doc_signoffs.find(s => s.cbill_id === cb.id);
ok('doc signoff pending with bill snapshot', so && so.status === 'pending' && so.kind === 'cbill' && so.sent_to === 'yazam@example.com' && so.snapshot.rows.length > 3 && so.snapshot.totals.total > 0);
ok('bill stays "recommended" while waiting', t.cbills.find(x => x.id === cb.id).status === 'recommended');
await p.goto(BASE + `#/project/${dp.id}/cbills`); await p.waitForTimeout(700);
ok('bills list chip: waiting for signature', (await p.textContent('#main')).includes('✍ ממתין'));

// ===== 2. דף החתימה של היזם (טלפון) =====
const link = await p.evaluate(() => window.__LAST_SIGN_LINK__);
ok('sign link is doc kind', link.includes('sign.html?k=d&t='));
const s = await ctx.newPage(); s.on('pageerror', e => errs.push('sign: ' + e.message));
await s.setViewportSize({ width: 390, height: 900 }); await s.goto(link); await s.waitForSelector('#cv');
ok('sign page: bill sheet + title', (await s.textContent('main')).includes('בדיקת חשבון והמלצה לתשלום') && (await s.textContent('header')).includes('אישור חשבון לתשלום'));
ok('sign page: agree text for bill', (await s.textContent('#form')).includes('תשלום החשבון'));
ok('sign page: no horizontal page scroll', (await s.evaluate(() => document.documentElement.scrollWidth)) <= 392);
await s.screenshot({ path: OUT + 'p24-sign-bill-phone.png', fullPage: true });
await s.fill('#nm', 'משה יזם'); await draw(s, '#cv'); await s.check('#agree'); await s.click('#yes'); await s.waitForSelector('.done', { timeout: 10000 });
ok('sign page: approved screen', (await s.textContent('.done')).includes('החשבון אושר לתשלום'));
t = await T(); so = t.doc_signoffs.find(x => x.id === so.id);
const cb2 = t.cbills.find(x => x.id === cb.id);
ok('bill approved by signature', so.status === 'approved' && so.signature.startsWith('data:image/png') && cb2.status === 'approved' && !!cb2.approved_date);
const ex = t.expenses.find(e => e.cbill_id === cb.id);
ok('payment entered cashflow (expense approved, net amount)', ex && ex.status === 'approved' && Math.abs(ex.amount - so.snapshot.totals.net) < 0.02);
await s.reload(); await s.waitForSelector('.done'); ok('sign link cannot be reused', !(await s.$('#yes')));
// בחזרה למערכת: המסמך החתום נשמר, הדף מציג את החתימה
await p.reload(); await p.waitForSelector('.kpis'); await p.goto(BASE + `#/project/${dp.id}/cbills`); await p.waitForTimeout(2500);
t = await T(); so = t.doc_signoffs.find(x => x.id === so.id);
const f = t.files.find(x => x.id === so.filed_file_id);
ok('signed bill PDF filed and linked to the bill', !!f && f.name.includes('מאושר בחתימה') && f.links.some(l => l.table === 'cbills' && l.id === cb.id) && f.doc_type === 'approved_bill');
ok('signed PDF mirrored to Drive', await p.evaluate(n => window.__G__.some(g => g.upload && g.name === n), f?.name));
await p.goto(BASE + `#/project/${dp.id}/cbill/${cb.id}`); await p.waitForSelector('#dsign img.sigimg');
ok('bill view: signature shown', (await p.textContent('#dsign')).includes('משה יזם'));
await p.$eval('#dsign', e => e.scrollIntoView({ block: 'center' })); await p.screenshot({ path: OUT + 'p24-bill-signed.png' });
await p.goto(BASE + `#/project/${dp.id}/cbillpdf/${cb.id}`); await p.waitForTimeout(600);
ok('recommendation page: developer signature filled', (await p.textContent('.rpage')).includes('משה יזם') && !!(await p.$('.rpage .sig img')));
await p.goto(BASE + '#/'); await p.waitForSelector('.kpis'); await p.waitForTimeout(500); await p.click('#moreacts').catch(() => {}); await p.waitForTimeout(300);
ok('home: developer approved alert', (await p.textContent('#main')).includes('היזם אישר בחתימה'));

// ===== 3. שינוי בחשבון מבטל קישור פתוח =====
const cb3 = t.cbills.find(x => x.project_id === dp.id && x.status === 'received');
await p.goto(BASE + `#/project/${dp.id}/cbill/${cb3.id}`); await p.waitForSelector('.billv');
await p.selectOption('.billv select[name=status]', 'recommended'); await p.click('#save'); await p.waitForTimeout(900);
await p.goto(BASE + `#/project/${dp.id}/cbill/${cb3.id}`); await p.waitForSelector('#dsign [data-dact=send]');
await p.click('#dsign [data-dact=send]'); await p.waitForSelector('.dlg [data-how=copy]'); await p.click('.dlg [data-how=copy]');
await p.waitForSelector('.dlg input[readonly]'); ok('copy: link shown', (await p.inputValue('.dlg input[readonly]')).includes('sign.html?k=d&t=')); await p.click('.dlg [data-x]'); await p.waitForTimeout(700);
t = await T(); const so3 = t.doc_signoffs.find(x => x.cbill_id === cb3.id);
ok('copy: signoff pending', so3 && so3.status === 'pending');
await p.goto(BASE + `#/project/${dp.id}/cbill/${cb3.id}`); await p.waitForSelector('#lt input[data-k=cum_qty_app]');
await p.fill('#lt input[data-k=cum_qty_app] >> nth=0', '1'); await p.press('#lt input[data-k=cum_qty_app] >> nth=0', 'Tab'); await p.waitForTimeout(200); await p.click('#save'); await p.waitForTimeout(900);
t = await T(); ok('bill changed → pending link cancelled', t.doc_signoffs.find(x => x.id === so3.id).status === 'cancelled');

// ===== 4. הוראת שינוי מול הקבלן הראשי =====
await p.selectOption('#tsel', sT.id); await p.waitForTimeout(700);
const v7 = t.variations.find(v => v.number === 'VO-07' && t.projects.find(x => x.id === v.project_id)?.tenant_id === sT.id);
await p.goto(BASE + `#/project/${v7.project_id}/vo`); await p.waitForTimeout(900);
const det = `details:has-text("VO-07")`;
await p.$eval(det, d => d.open = true); await p.waitForTimeout(200);
ok('VO: sign block for main contractor', (await p.textContent(det)).includes('אישור הקבלן הראשי בחתימה'));
await p.click(`${det} [data-dact=send]`); await p.waitForSelector('.dlg [data-how=wa]'); await p.click('.dlg [data-how=wa]'); await p.waitForTimeout(900);
const opened = await p.evaluate(() => window.__OPENED__ || '');
ok('VO: WhatsApp opened with sign link', opened.startsWith('https://wa.me/') && decodeURIComponent(opened).includes('sign.html?k=d&t='));
t = await T(); let sv = t.doc_signoffs.find(x => x.variation_id === v7.id);
ok('VO signoff pending with items', sv && sv.status === 'pending' && sv.snapshot.items.length > 0 && sv.snapshot.party === 'קבלן ראשי');
const s2 = await ctx.newPage(); s2.on('pageerror', e => errs.push('sign2: ' + e.message)); await s2.setViewportSize({ width: 390, height: 900 });
await s2.goto(await p.evaluate(() => window.__LAST_SIGN_LINK__)); await s2.waitForSelector('#cv');
ok('VO sign page: sheet', (await s2.textContent('main')).includes('בקשה לאישור הוראת שינוי') && (await s2.textContent('main')).includes('VO-07'));
await s2.screenshot({ path: OUT + 'p24-sign-vo-phone.png', fullPage: true });
await s2.fill('#nm', 'אבי קבלן ראשי'); await draw(s2, '#cv'); await s2.check('#agree'); await s2.click('#yes'); await s2.waitForSelector('.done');
t = await T(); const v7b = t.variations.find(v => v.id === v7.id);
ok('VO approved + written order by signature', v7b.status === 'approved' && v7b.has_written_order);
await p.reload(); await p.waitForSelector('#main'); await p.goto(BASE + `#/project/${v7.project_id}/vo`); await p.waitForTimeout(2500);
t = await T(); sv = t.doc_signoffs.find(x => x.id === sv.id);
const fv = t.files.find(x => x.id === sv.filed_file_id);
ok('signed VO PDF attached to the VO (goes to bill appendix)', !!fv && fv.links.some(l => l.table === 'variations' && l.id === v7.id) && fv.doc_type === 'vo');
await p.$eval(det, d => d.open = true); await p.$eval(det, d => d.scrollIntoView()); await p.screenshot({ path: OUT + 'p24-vo-signed.png' });
ok('VO list chip: signed', (await p.textContent(det)).includes('נחתם'));
// דחייה
const v21 = t.variations.find(v => v.number === 'VO-01' && v.status === 'submitted' && t.projects.find(x => x.id === v.project_id)?.tenant_id === sT.id);
await p.goto(BASE + `#/project/${v21.project_id}/vo`); await p.waitForTimeout(900);
const det2 = `details:has-text("${v21.title}")`; await p.$eval(det2, d => d.open = true);
await p.click(`${det2} [data-dact=send]`); await p.waitForSelector('.dlg [data-how=copy]'); await p.click('.dlg [data-how=copy]'); await p.waitForSelector('.dlg input[readonly]'); await p.click('.dlg [data-x]'); await p.waitForTimeout(600);
const s3 = await ctx.newPage(); await s3.goto(await p.evaluate(() => window.__LAST_SIGN_LINK__)); await s3.waitForSelector('#cv');
await s3.fill('#nm', 'אבי'); await s3.click('#nope'); ok('reject needs a note', (await s3.textContent('#err')).includes('הערה'));
await s3.fill('#note', 'המחיר גבוה'); await s3.click('#nope'); await s3.waitForSelector('.done');
t = await T(); ok('VO rejected by signature with note', t.variations.find(v => v.id === v21.id).status === 'rejected' && t.variations.find(v => v.id === v21.id).notes.includes('המחיר גבוה'));
await p.goto(BASE + '#/'); await p.waitForSelector('.kpis'); await p.waitForTimeout(500); await p.click('#moreacts').catch(() => {}); await p.waitForTimeout(300);
ok('home: rejected alert', (await p.textContent('#main')).includes('נדחה בחתימה'));
await p.screenshot({ path: OUT + 'p24-home.png', fullPage: false });

// ===== 5. חתימת מפקח ביומן (טלפון, מנהל עבודה) =====
const store = await p.evaluate(() => Object.fromEntries(Object.entries(localStorage)));
const ph = await (await b.newContext({ viewport: { width: 390, height: 844 } })).newPage(); ph.on('pageerror', e => { errs.push('ph: ' + e.message); console.log('PERR', e.stack); });
await ph.goto(BASE); await ph.evaluate(st => { for (const [k, v] of Object.entries(st)) localStorage.setItem(k, v); }, store); await ph.reload(); await ph.waitForSelector('#demoRole');
await ph.selectOption('#demoRole', 'foreman'); await ph.waitForSelector('text=הפרויקטים שלי', { timeout: 15000 }); await ph.waitForTimeout(300);
await ph.click('text=יומן עבודה להיום'); await ph.waitForSelector('.dayv'); await ph.waitForTimeout(300);
const pid = await ph.evaluate(() => location.hash.split('/')[2]);
ok('day: supervisor card (optional)', (await ph.textContent('#supc')).includes('לא חובה') && !!(await ph.$('#supgo')));
await ph.click('#addx'); await ph.fill('.xrow:nth-child(1) [data-k=description]', 'פתיחה נוספת בגבס'); await ph.dispatchEvent('.xrow:nth-child(1) [data-k=description]', 'change');
await ph.fill('.xrow:nth-child(1) [data-k=qty]', '2'); await ph.dispatchEvent('.xrow:nth-child(1) [data-k=qty]', 'change');
await ph.check('.xrow:nth-child(1) [data-k=is_vo]'); await ph.dispatchEvent('.xrow:nth-child(1) [data-k=is_vo]', 'change');
await ph.click('#supgo'); await ph.waitForSelector('.dlg .sigpad canvas'); await ph.waitForTimeout(150);
const dtx = await ph.textContent('.dlg'); ok('supervisor dialog lists the extra', dtx.includes('פתיחה נוספת בגבס: 2') || console.log(dtx.slice(0, 300)));
await ph.click('.dlg [data-ok]'); ok('supervisor: name + signature required', (await ph.textContent('.dlg .err')).length > 0);
await ph.fill('.dlg [name=name]', 'רונן מפקח'); await draw(ph, '.dlg .sigpad canvas');
await ph.screenshot({ path: OUT + 'p24-sup-phone.png' });
ok('phone: supervisor dialog no overflow', (await ph.evaluate(() => document.documentElement.scrollWidth)) <= 392);
await ph.click('.dlg [data-ok]'); await ph.waitForTimeout(400);
ok('day shows supervisor signed', (await ph.textContent('#supc')).includes('אושר ע"י המפקח רונן מפקח'));
await ph.click('#save'); await ph.waitForTimeout(1000);
let t2 = await ph.evaluate(k => JSON.parse(localStorage.getItem(k)).tables, KEY);
const today = await ph.evaluate(() => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); });
let wd = t2.work_days.find(x => x.project_id === pid && x.log_date === today);
ok('work day saved with supervisor signature', wd && wd.sup_name === 'רונן מפקח' && wd.sup_sig.startsWith('data:image/png') && wd.sup_snapshot.lines.some(l => l.includes('פתיחה נוספת בגבס')));
const ftx = await ph.textContent('#main'); ok('field list: supervisor chip', ftx.includes('✍ מפקח') || console.log(await ph.evaluate(() => location.hash), ftx.slice(0, 300)));
// שינוי כמות אחרי החתימה → אזהרה והסרה
await ph.goto(BASE + `#/project/${pid}/day/${today}`); await ph.waitForSelector('#supc .supok');
await ph.fill('.xrow:nth-child(1) [data-k=qty]', '5'); await ph.dispatchEvent('.xrow:nth-child(1) [data-k=qty]', 'change'); await ph.waitForTimeout(200);
ok('changed after signature: warning', (await ph.textContent('#supc')).includes('השתנו אחרי החתימה'));
await ph.click('#save'); await ph.waitForSelector('.dlg [data-ok]'); await ph.click('.dlg [data-ok]'); await ph.waitForTimeout(1000);
t2 = await ph.evaluate(k => JSON.parse(localStorage.getItem(k)).tables, KEY); wd = t2.work_days.find(x => x.project_id === pid && x.log_date === today);
ok('save after change removes signature', wd && !wd.sup_sig);
// יום בלי חתימה נשמר רגיל
ok('day without signature saves fine', !!wd);
// המשרד: נספח החשבון מציג אישור מפקח לתוספת מהשטח
await ph.goto(BASE + `#/project/${pid}/day/${today}`); await ph.waitForSelector('#supgo'); await ph.click('#supgo'); await ph.waitForSelector('.dlg .sigpad canvas'); await ph.waitForTimeout(150);
await ph.fill('.dlg [name=name]', 'רונן מפקח'); await draw(ph, '.dlg .sigpad canvas'); await ph.click('.dlg [data-ok]'); await ph.waitForTimeout(300); await ph.click('#save'); await ph.waitForTimeout(1000);
t2 = await ph.evaluate(k => JSON.parse(localStorage.getItem(k)).tables, KEY);
const fx = t2.work_extras.find(x => x.description === 'פתיחה נוספת בגבס'), fvo = t2.variations.find(v => v.id === fx.variation_id);
ok('field extra became VO', !!fvo);
const st2 = await ph.evaluate(() => Object.fromEntries(Object.entries(localStorage)));
await p.evaluate(st => { for (const [k, v] of Object.entries(st)) localStorage.setItem(k, v); }, st2); await p.reload(); await p.waitForSelector('#demoRole'); await p.selectOption('#demoRole', 'admin'); await p.waitForTimeout(800);
await p.selectOption('#tsel', sT.id).catch(() => {}); await p.waitForTimeout(600);
await p.goto(BASE + `#/project/${pid}/worklog`); await p.waitForTimeout(800);
ok('office worklog: supervisor chip on date', (await p.textContent('#t')).includes('✍ מפקח'));
// מחיר לסעיף ההוראה ובדיקת השליחה: הדף מציין אישור מפקח
const tt = await T(); const it = tt.boq_items.find(i => i.variation_id === fvo.id);
await p.evaluate(([k, id]) => { const d = JSON.parse(localStorage.getItem(k)); d.tables.boq_items.find(i => i.id === id).unit_price = 450; localStorage.setItem(k, JSON.stringify(d)); }, [KEY, it.id]);
await p.goto(BASE + `#/project/${pid}/vo`); await p.reload(); await p.waitForTimeout(1200);
const det3 = `details:has-text("${fvo.number}")`; await p.$eval(det3, d => d.open = true);
await p.click(`${det3} [data-dact=send]`); await p.waitForSelector('.dlg [data-how=copy]'); await p.click('.dlg [data-how=copy]'); await p.waitForSelector('.dlg input[readonly]'); await p.click('.dlg [data-x]'); await p.waitForTimeout(600);
const tt2 = await T(); const sf = tt2.doc_signoffs.find(x => x.variation_id === fvo.id);
ok('field VO snapshot carries supervisor approval', sf && sf.snapshot.field && sf.snapshot.field.sup_name === 'רונן מפקח');

ok('no page errors: ' + errs.slice(0, 3).join(' | '), errs.length === 0);
await b.close();
