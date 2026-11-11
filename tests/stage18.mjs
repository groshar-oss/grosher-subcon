// בדיקת חבילה 17: אישור יזם בחתימה, מייל ישיר מה-Gmail, לוגו וואטסאפ, ₪ בשורות סיכום
import { chromium } from 'playwright';
const BASE = 'http://localhost:8123/'; const KEY = 'grosher-subcon-demo-v5'; const OUT = 'tests/shots/';
const b = await chromium.launch();
const ok = (name, cond) => { console.log((cond ? 'ok   ' : 'FAIL ') + name); if (!cond) process.exitCode = 1; };
const ctx = await b.newContext({ viewport: { width: 1440, height: 950 } });
await ctx.addInitScript(() => {
  window.__G__ = []; let gid = 0;
  window.__GOOGLE_MOCK__ = { fetch: async (url, opt = {}) => {
    const rec = { url, method: opt.method || 'GET' };
    if (typeof opt.body === 'string') { try { const j = JSON.parse(opt.body); rec.name = j.name; rec.parents = j.parents; rec.raw = j.raw ? j.raw.length : 0; } catch {} }
    else if (opt.body && opt.body.get) { const m = JSON.parse(await opt.body.get('metadata').text()); rec.name = m.name; rec.upload = true; }
    window.__G__.push(rec);
    if (url.includes('files?fields=files(id)')) return { files: [] };
    return { id: 'g' + (++gid) };
  } };
});
const p = await ctx.newPage();
const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
const T = () => p.evaluate(k => JSON.parse(localStorage.getItem(k)).tables, KEY);
await p.goto(BASE); await p.waitForSelector('.kpis'); await p.evaluate(() => localStorage.clear()); await p.reload(); await p.waitForSelector('.kpis');
let t = await T();
const dt = t.tenants.find(x => x.name.includes('יזמות')); const dp = t.projects.find(x => x.project_type === 'dev' && x.tenant_id === dt.id);
await p.selectOption('#tsel', dt.id); await p.waitForTimeout(600);

// 1. ₪ בשורות סיכום, כותרות
await p.goto(BASE + '#/reports/d-cbills'); await p.waitForSelector('#rep table');
const tot = await p.$$eval('#rep tr.tot td', tds => tds.map(td => td.textContent.trim()).filter(Boolean));
ok('cbills report: totals carry ₪', tot.filter(x => /\d/.test(x)).every(x => x.includes('₪')) && tot.length > 4);
ok('cbills report: header renamed', (await p.textContent('#rep thead')).includes('הוגש'));
await p.goto(BASE + '#/cashflow'); await p.waitForTimeout(800);
ok('cashflow totals with ₪', (await p.$$eval('tr.tot td.n', tds => tds.slice(0, 5).map(t => t.textContent))).every(x => x.includes('₪')));

// 2. וואטסאפ ומייל בהתרעות
await p.goto(BASE + '#/'); await p.waitForSelector('[data-ml]');
await p.screenshot({ path: OUT + 'side-role.png', clip: { x: 1200, y: 0, width: 240, height: 230 } });
await p.screenshot({ path: OUT + 'alert-icons.png', clip: { x: 0, y: 0, width: 1200, height: 950 } });
ok('alerts: WhatsApp logo icon', (await p.$$('[data-wa] svg.wa-ic')).length > 0);
await p.click('[data-ml]'); await p.waitForSelector('.dlg [name=to]');
ok('mail opens in-app composer (no mailto)', (await p.evaluate(() => location.href)).startsWith(BASE));
await p.fill('.dlg [name=to]', 'client@example.com'); await p.screenshot({ path: OUT + 'mail-compose.png' }); await p.click('.dlg [data-ok]'); await p.waitForTimeout(800);
const gm = await p.evaluate(() => window.__LAST_GMAIL__);
ok('alert mail sent through Gmail API', gm && gm.to[0] === 'client@example.com' && (await p.evaluate(() => window.__G__.some(g => g.url.includes('gmail') && g.raw > 100))));

// 3. אישור יזם: מייל מאשר בהגדרות הפרויקט
await p.goto(BASE + '#/project/' + dp.id + '/settings'); await p.waitForTimeout(700);
const hasApprover = await p.$('[data-cp=pca_0] .cpq');
ok('project settings: approver fields', !!hasApprover);
t = await T();
// הוראה שנייה בבקשה (לבדיקת דחייה)
await p.evaluate(([k, pid]) => { const d = JSON.parse(localStorage.getItem(k)); const T = d.tables; const src = T.change_orders.find(c => c.project_id === pid && c.number === 'CO-03');
  const nid = crypto.randomUUID(); T.change_orders.push({ ...src, id: nid, number: 'CO-06', title: 'תוספת מעקה בגג', stage: 'request' });
  T.co_lines.push({ ...T.co_lines.find(l => l.co_id === src.id), id: crypto.randomUUID(), co_id: nid, price_approved: 700 }); localStorage.setItem(k, JSON.stringify(d)); }, [KEY, dp.id]);
await p.reload(); await p.waitForTimeout(500);
t = await T();
const co = t.change_orders.find(c => c.project_id === dp.id && c.number === 'CO-03');
ok('found pending change order: ' + (co && co.number), !!co);
await p.goto(BASE + '#/project/' + dp.id + '/cos'); await p.waitForSelector(`[data-co="${co.id}"]`);
await p.click(`[data-co="${co.id}"] td:nth-child(2)`); await p.waitForSelector('.signbox');
ok('CO dialog: 7-step path incl. developer approval', (await p.textContent('.stepper')).includes('ממתין לאישור יזם'));
await p.click('[data-sact=send]'); await p.waitForTimeout(1500);
ok('send blocked without approved price', !(await p.$('.dlg [name=to]')) && (await p.textContent('.dlg .err')).includes('מחיר מאושר'));
{ const i = await p.$('#ll [data-f=price_approved]'); await i.fill('760'); await i.dispatchEvent('change'); }
await p.click('[data-sact=send]'); await p.waitForTimeout(500);
ok('send blocked without price analysis', (await p.textContent('.dlg .err')).includes('ניתוח מחיר'));
await p.fill('.dlg [name=price_analysis]', 'לפי 2 הצעות מחיר: 740-790 ₪ למ"ר');
await p.click('[data-sact=send]'); await p.waitForSelector('.dlg [name=to]', { timeout: 20000 });
await p.waitForTimeout(300);
const toVal = await p.inputValue('.dlg [name=to]');
await p.fill('.dlg [name=to]', 'yazam@example.com'); await p.click('.dlg:last-of-type [data-ok]'); await p.waitForTimeout(1500);
const gm2 = await p.evaluate(() => window.__LAST_GMAIL__);
{ const q = await b.newPage({ viewport: { width: 940, height: 800 } }); await q.setContent(`<html dir=rtl><body style="background:#fff;padding:16px;width:900px">${gm2.html}</body></html>`); await q.screenshot({ path: OUT + 'approval-mail.png', fullPage: true }); await q.close(); }
ok('approval mail ok: PDF attached + sign link + sheet', gm2.attachments.length === 1 && gm2.attachments[0].name.endsWith('.pdf') && gm2.attachments[0].size > 5000 && gm2.html.includes('sign.html?t=') && gm2.html.includes('% רווח'));
t = await T();
let so = t.co_signoffs.find(s => s.co_id === co.id);
ok('signoff saved with snapshot', so && so.status === 'pending' && so.sent_to === 'yazam@example.com' && so.snapshot.lines.length > 0);
ok('CO stage → waiting for developer', t.change_orders.find(c => c.id === co.id).stage === 'dev_approval');
ok('approver email remembered on project', toVal === '' ? t.projects.find(x => x.id === dp.id).approver_email === 'yazam@example.com' : true);
await p.goto(BASE + '#/project/' + dp.id + '/cos'); await p.waitForTimeout(800);
ok('list chip: waiting', (await p.textContent(`[data-co="${co.id}"]`)).includes('ממתין'));

// 4. דף החתימה (חלון חדש, בלי כניסה)
const link = await p.evaluate(() => window.__LAST_SIGN_LINK__);
const s = await ctx.newPage(); s.on('pageerror', e => errs.push('sign: ' + e.message));
await s.setViewportSize({ width: 390, height: 900 });
await s.goto(link); await s.waitForSelector('#cv');
await s.screenshot({ path: OUT + 'sign-phone.png', fullPage: true });
await s.click('#yes'); ok('sign: requires name/signature', !(await s.isHidden('#err')));
await s.fill('#nm', 'משה יזם');
const bx = await s.$eval('#cv', c => { const r = c.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
await s.mouse.move(bx.x + 40, bx.y + 100); await s.mouse.down(); for (let i = 0; i < 20; i++) await s.mouse.move(bx.x + 40 + i * 12, bx.y + 100 + Math.sin(i / 2) * 40); await s.mouse.up();
await s.click('#yes'); ok('sign: requires agree checkbox', (await s.textContent('#err')).includes('תיבת'));
await s.check('#agree'); await s.click('#yes'); await s.waitForSelector('.done', { timeout: 10000 });
ok('sign: approved screen', (await s.textContent('.done')).includes('אושרה'));
await s.screenshot({ path: OUT + 'sign-done.png', fullPage: true });
t = await T(); so = t.co_signoffs.find(x => x.id === so.id);
const co2 = t.change_orders.find(c => c.id === co.id);
ok('signoff approved with signature image', so.status === 'approved' && so.signature.startsWith('data:image/png') && so.signer_name === 'משה יזם');
ok('CO auto-approved with signer', co2.stage === 'approved' && co2.approved_by === 'משה יזם' && co2.approval_ref.includes('חתימה אלקטרונית'));
await s.reload(); await s.waitForSelector('.done'); ok('sign: link cannot be reused', (await s.textContent('.done')).includes('אושרה') && !(await s.$('#yes')));

// 5. חזרה למערכת: המסמך החתום נשמר, תווית "נחתם"
await p.goto(BASE + '#/'); await p.waitForTimeout(400); await p.goto(BASE + '#/project/' + dp.id + '/cos'); await p.waitForTimeout(4000);
t = await T();
const f = t.files.find(x => x.links?.some(l => l.id === co.id) && x.doc_type === 'vo');
ok('signed PDF stored in project docs', !!f && f.name.includes('מאושר בחתימה'));
ok('signed PDF mirrored to Drive', await p.evaluate(n => window.__G__.some(g => g.upload && g.name === n), f?.name));
ok('list chip: signed', (await p.textContent(`[data-co="${co.id}"]`)).includes('נחתם'));
await p.click(`[data-co="${co.id}"] td:nth-child(2)`); await p.waitForSelector('.signbox');
ok('dialog shows signature + send to contractor', !!(await p.$('.signbox img.sigimg')) && !!(await p.$('[data-sact=tomail]')) && !!(await p.$('[data-sact=towa] svg.wa-ic')));
await p.screenshot({ path: OUT + 'co-signed.png' });
// שינוי מחיר אחרי האישור → התרעה
const inp = await p.$('#ll [data-f=price_approved]'); await inp.fill('999999'); await inp.dispatchEvent('change');
await p.click('.dlg [data-ok]'); await p.waitForTimeout(1200);
ok('changed after signoff: red chip', (await p.textContent(`[data-co="${co.id}"]`)).includes('שונתה אחרי אישור'));
await p.goto(BASE + '#/'); await p.waitForTimeout(1200);
ok('home alert: changed after developer approval', (await p.textContent('#main')).includes('שונתה אחרי אישור היזם'));

// 6. דחייה
t = await T();
const co3 = t.change_orders.find(c => c.project_id === dp.id && ['request', 'pricing'].includes(c.stage) && c.id !== co.id);
if (co3) {
  await p.goto(BASE + '#/project/' + dp.id + '/cos'); await p.waitForSelector(`[data-co="${co3.id}"]`);
  await p.click(`[data-co="${co3.id}"] td:nth-child(2)`); await p.waitForSelector('.signbox');
  await p.fill('.dlg [name=price_analysis]', 'הצעה יחידה'); await p.click('[data-sact=send]'); await p.waitForSelector('.dlg [name=to]', { timeout: 20000 }); await p.click('.dlg:last-of-type [data-ok]'); await p.waitForTimeout(1500);
  const l3 = await p.evaluate(() => window.__LAST_SIGN_LINK__);
  await s.goto(l3); await s.waitForSelector('#nope'); await s.fill('#nm', 'משה יזם'); await s.click('#nope');
  ok('reject requires note', (await s.textContent('#err')).includes('הערה'));
  await s.fill('#note', 'המחיר גבוה, לבקש הצעה נוספת'); await s.click('#nope'); await s.waitForSelector('.done');
  t = await T();
  ok('rejected: CO stage rejected + note', t.change_orders.find(c => c.id === co3.id).stage === 'rejected' && t.co_signoffs.some(x => x.co_id === co3.id && x.status === 'rejected'));
} else ok('second pending CO for reject test', false);

// 7. ספר טלפונים: מייל ישיר ווואטסאפ
await p.goto(BASE + '#/contacts'); await p.waitForTimeout(800);
const ml = await p.$('[data-mail]'); if (ml) { await ml.click(); ok('contacts: mail opens composer', !!(await p.waitForSelector('.dlg [name=to]'))); await p.click('.dlg [data-x]'); }
ok('contacts: WhatsApp logo', (await p.$$('.wa-a svg')).length > 0 || !ml);
ok('no page errors ' + errs.slice(0, 3).join(' | '), !errs.length);
await b.close();
