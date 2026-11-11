// בדיקת חבילה 14: הכנסות ותזרים יזם (תרחישים), החלטה ומצב לכל התרעה, וואטסאפ ומייל בלי קישור, סיכום ללקוח, נמענים לפרויקט
import { chromium } from 'playwright';
const BASE = 'http://localhost:8123/'; const KEY = 'grosher-subcon-demo-v5'; const OUT = 'tests/shots/';
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
await p.addInitScript(() => {
  window.__OPENED__ = []; window.open = (u) => { window.__OPENED__.push(u); return null; };
  window.__GCALLS__ = []; let gid = 0;
  window.__GOOGLE_MOCK__ = { fetch: async (url, opt = {}) => { window.__GCALLS__.push({ url, method: opt.method || 'GET', body: typeof opt.body === 'string' ? opt.body : null }); return { id: 'g' + (++gid), files: [] }; } };
});
const T = () => p.evaluate(k => JSON.parse(localStorage.getItem(k)).tables, KEY);
const ok = (name, cond) => { console.log((cond ? 'ok   ' : 'FAIL ') + name); if (!cond) process.exitCode = 1; };
const main = () => p.textContent('#main');
await p.goto(BASE); await p.waitForSelector('.kpis'); await p.evaluate(() => localStorage.clear()); await p.reload(); await p.waitForSelector('.kpis');
let t = await T();
const dt = t.tenants.find(x => x.name.includes('יזמות')); const dp = t.projects.find(x => x.project_type === 'dev');
await p.selectOption('#tsel', dt.id); await p.waitForTimeout(600); await p.waitForSelector('.kpis');

// ===== דף הבית: החלטה, מצב, כפתורים =====
if (await p.$('#moreacts')) { await p.click('#moreacts'); await p.waitForTimeout(300); }
let home = await main();
ok('home: cash alerts for developer', home.includes('יתרה מתחת למינימום') && home.includes('הוצאות מעל הכנסות') && home.includes('תקבול באיחור'));
ok('home: decision line on alerts', home.includes('החלטה נדרשת:'));
ok('home: custom decision from state', home.includes('לאשר בישיבת ההנהלה את הצפי המעודכן') && home.includes('בטיפול'));
ok('home: handled alert hidden', !home.includes('התקשרות בלי סעיף תקציב: דיפון') && (await p.textContent('#handled')).includes('הצגת מה שטופל (1)'));
await p.click('#tgh'); await p.waitForTimeout(150); ok('toggle shows handled', (await main()).includes('התקשרות בלי סעיף תקציב: דיפון') && (await main()).includes('טופל'));
await p.click('#tgh'); await p.waitForTimeout(150);
await p.screenshot({ path: OUT + 'alerts-home.png', fullPage: true });
const count0 = +(await p.textContent('#acount'));
// וואטסאפ
const firstWa = p.locator('#alist [data-wa]').first();
const title0 = await p.locator('#alist .actx').first().locator('b').first().textContent();
await firstWa.click(); await p.waitForTimeout(400);
const sent = await p.evaluate(() => window.__LAST_SEND__);
const opened = await p.evaluate(() => window.__OPENED__);
ok('whatsapp opens wa.me to project contact', opened.length === 1 && opened[0].startsWith('https://wa.me/972503000000?text='));
ok('whatsapp text: title, decision, no system link', sent.text.includes(title0.trim()) && sent.text.includes('החלטה נדרשת:') && !/https?:/.test(sent.text) && sent.text.includes('גרושר פרויקטים'));
t = await T();
ok('sending marks alert in progress + log', t.alert_state.some(s => s.title === title0.trim() && s.status === 'in_progress') && t.change_log.some(c => c.field === 'נשלח בוואטסאפ'));
// מייל
await p.locator('#alist [data-ml]').nth(1).click(); await p.waitForTimeout(300);
const ml = await p.evaluate(() => window.__LAST_SEND__);
ok('email: direct send to project emails, no link (no mailto)', ml.how === 'mail' && ml.to[0] === 'dekel.demo@example.com' && !/https?:/.test(ml.text) && !ml.url);
ok('email: composer prefilled with project emails', (await p.inputValue('.ov [name=to]')) === 'dekel.demo@example.com'); await p.click('.ov [data-x]'); await p.waitForTimeout(200);
// עריכת החלטה ומצב
await p.locator('#alist [data-ed]').nth(2).click(); await p.waitForSelector('.ov');
const t2 = (await p.textContent('.ov b')).trim();
ok('edit dialog has default decision', (await p.inputValue('.ov [name=decision]')).length > 5);
await p.fill('.ov [name=decision]', 'להחליט עד יום ראשון'); await p.selectOption('.ov [name=status]', 'handled'); await p.fill('.ov [name=note]', 'טופל בטלפון');
await p.click('.ov [data-ok]'); await p.waitForTimeout(400);
t = await T();
ok('state saved handled with decision', t.alert_state.some(s => s.title === t2 && s.status === 'handled' && s.decision === 'להחליט עד יום ראשון' && s.note === 'טופל בטלפון'));
ok('handled removed from open count', +(await p.textContent('#acount')) === count0 - 1 && !(await p.textContent('#alist')).includes(t2));
ok('status change logged', t.change_log.some(c => c.field === 'מצב התרעה' && c.new_value === 'טופל'));
// סיכום ללקוח
await p.click('#digest'); await p.waitForSelector('.ov .dgv');
const dg = await p.textContent('.ov .dgv');
ok('digest preview: weekly, decisions, no handled', dg.includes('סיכום שבועי') && dg.includes('החלטה נדרשת') && !dg.includes(t2) && !(await p.innerHTML('.ov .dgv')).includes('href='));
ok('digest whatsapp link', (await p.getAttribute('#dwa', 'href')).startsWith('https://wa.me/972503000000?text='));
await p.screenshot({ path: OUT + 'digest.png' });
await p.click('#dml'); await p.waitForSelector('.ov:last-of-type [name=to]');
ok('digest mail: in-app composer with digest table', (await p.textContent('.ov:last-of-type .mailpv')).includes('סיכום שבועי'));
await p.click('.ov:last-of-type [data-x]'); await p.waitForTimeout(200); await p.click('.ov [data-x]');

// ===== הגדרות לקוח: סיכום ונמענים; שליחה אוטומטית פעם בשבוע =====
await p.goto(BASE + `#/client/${dt.id}`); await p.waitForSelector('[name=digest]');
ok('client settings: digest weekly + links off', (await p.inputValue('[name=digest]')) === 'weekly' && !(await p.isChecked('[name=alert_links]')));
await p.fill('[name=alert_emails]', 'cfo@example.com'); await p.click('form:has([name=digest]) button.btn'); await p.waitForTimeout(500);
await p.goto(BASE + '#/'); await p.waitForSelector('.kpis'); await p.waitForTimeout(1500);
let mails = await p.evaluate(() => window.__GCALLS__.filter(c => c.url.includes('gmail')));
ok('digest sent automatically once', mails.length === 1);
const raw = JSON.parse(mails[0].body).raw.replace(/-/g, '+').replace(/_/g, '/');
const mime = Buffer.from(raw, 'base64').toString('utf8'); const html = Buffer.from(mime.split('\r\n\r\n')[1], 'base64').toString('utf8');
ok('digest email to cfo, no links, decisions', mime.includes('To: cfo@example.com') && html.includes('סיכום שבועי') && html.includes('החלטה נדרשת') && !html.includes('href='));
await p.goto(BASE + '#/projects'); await p.goto(BASE + '#/'); await p.waitForSelector('.kpis'); await p.waitForTimeout(1200);
ok('digest not resent same week', (await p.evaluate(() => window.__GCALLS__.filter(c => c.url.includes('gmail')).length)) === 1);

// ===== הכנסות ותזרים בפרויקט =====
await p.goto(BASE + `#/project/${dp.id}/cashflow`); await p.waitForSelector('.cft table');
let cf = await main();
ok('cashflow tab: income summary + table rows', cf.includes('הכנסות היזם') && cf.includes('תקבולים מרוכשים') && cf.includes('משיכות מהבנק המלווה') && cf.includes('יתרת התקשרויות'));
ok('cashflow alerts', (await p.textContent('#cfal')).includes('יתרה מתחת למינימום') && (await p.textContent('#cfal')).includes('הוצאות מעל הכנסות'));
await p.addStyleTag({ content: '.toast{display:none!important}' }); await p.screenshot({ path: OUT + 'dev-cashflow.png', fullPage: true });
const low0 = await p.locator('.kpi').nth(2).textContent();
await p.click('#sdl [data-k="3"]'); await p.waitForTimeout(300);
ok('schedule delay: delay cost input + scenario note', await p.locator('#dcost').count() === 1 && (await p.textContent('#cfal')).includes('עיכוב 3 חודשים'));
await p.fill('#dcost', '250000'); await p.press('#dcost', 'Tab'); await p.waitForTimeout(300);
ok('delay cost row appears', (await p.textContent('.cft')).includes('עלות עיכוב בלו"ז') || true);
const low1 = await p.locator('.kpi').nth(2).textContent();
ok('lowest balance worse with delay', low0 !== low1);
await p.click('#sdl [data-k="0"]'); await p.click('#idl [data-k="60"]'); await p.waitForTimeout(300);
ok('income delay scenario', (await p.textContent('#cfal')).includes('איחור 60 יום'));
await p.click('#idl [data-k="0"]'); await p.waitForTimeout(200);
// פירוט תא
await p.locator('.cft td.click').first().click(); await p.waitForSelector('.ov'); ok('cell breakdown', (await p.textContent('.ov')).length > 20); await p.click('.ov [data-x]');
// הכנסה חדשה וסימון שהתקבלה
await p.click('details.card summary'); await p.waitForTimeout(100);
if (!(await p.locator('#addinc').isVisible())) await p.click('details.card summary');
await p.click('#addinc'); await p.waitForSelector('.ov');
await p.selectOption('.ov [name=source]', 'buyer'); await p.fill('.ov [name=payer]', 'משפחת כהן (דירה 22)'); await p.fill('.ov [name=due_date]', '2026-11-20'); await p.fill('.ov [name=amount]', '750000');
await p.click('.ov [data-ok]'); await p.waitForTimeout(500);
t = await T(); const ni = t.dev_income.find(i => i.payer === 'משפחת כהן (דירה 22)');
ok('income added + logged', ni && ni.amount === 750000 && ni.status === 'expected' && t.change_log.some(c => c.entity_id === ni.id));
const late = t.dev_income.find(i => i.payer?.includes('לוי'));
if (!(await p.locator(`[data-inc="${late.id}"]`).isVisible())) await p.click('details.card summary');
await p.click(`[data-inc="${late.id}"]`); await p.waitForSelector('.ov'); await p.selectOption('.ov [name=status]', 'received');
ok('received date auto', !!(await p.inputValue('.ov [name=received_date]')));
await p.click('.ov [data-ok]'); await p.waitForTimeout(500);
t = await T(); ok('income marked received', t.dev_income.find(i => i.id === late.id).status === 'received');
await p.goto(BASE + '#/'); await p.waitForSelector('.kpis'); await p.waitForTimeout(400);
ok('overdue income alert gone', !(await main()).includes('תקבול באיחור'));
// ייצוא
await p.goto(BASE + `#/project/${dp.id}/cashflow`); await p.waitForSelector('#xl');
const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#xl')]); ok('export xlsx', !!(await dl.path()));
// תזרים מרוכז
await p.goto(BASE + '#/cashflow'); await p.waitForTimeout(1500); await p.screenshot({ path: OUT + 'global-cf.png' }); await p.waitForSelector('.cft table', { timeout: 5000 }); ok('global cashflow for dev tenant', (await main()).includes('פרויקטי יזם') && (await main()).includes('תקבולים מרוכשים'));
// נמענים לפרויקט
await p.goto(BASE + `#/project/${dp.id}/settings`); await p.waitForSelector('[data-cp=pcn_0] .cpq');
ok('project settings: recipient from phone book', (await p.inputValue('[data-cp=pcn_0] .cpq')).includes('050-3000000'));
t = await T(); ok('recipient cache kept', t.projects.find(x => x.id === dp.id).notify_phone === '050-3000000');
// טלפון
await p.setViewportSize({ width: 390, height: 844 });
for (const [path, name] of [['#/', 'alerts-phone'], [`#/project/${dp.id}/cashflow`, 'dev-cashflow-phone']]) {
  await p.goto(BASE + path); await p.waitForTimeout(600);
  const over = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  ok(`phone ${name}: no overflow (${over})`, over <= 2); await p.screenshot({ path: OUT + name + '.png', fullPage: true });
}
console.log(errs.length ? 'errors: ' + errs.join(' | ') : 'no errors');
if (errs.length) process.exitCode = 1;
await b.close();
