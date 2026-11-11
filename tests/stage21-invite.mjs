// בדיקת הזמנת משתמש (חבילה 20)
import { chromium } from 'playwright';
const BASE = 'http://localhost:8123/'; const KEY = 'grosher-subcon-demo-v5'; const OUT = 'tests/shots/';
const b = await chromium.launch();
const ok = (name, cond) => { console.log((cond ? 'ok   ' : 'FAIL ') + name); if (!cond) process.exitCode = 1; };
for (const [vw, tag] of [[{ width: 1440, height: 950 }, 'pc'], [{ width: 390, height: 844 }, 'phone']]) {
  const ctx = await b.newContext({ viewport: vw }); const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  const T = () => p.evaluate(k => JSON.parse(localStorage.getItem(k)).tables, KEY);
  await p.goto(BASE); await p.waitForSelector('.kpis'); await p.evaluate(() => localStorage.clear()); await p.reload(); await p.waitForSelector('.kpis');
  const tenant = await p.$eval('#tsel', s => s.value);
  await p.goto(BASE + '#/client/' + tenant); await p.waitForSelector('#addm');
  ok(tag + ': invite button text', (await p.textContent('#addm')).includes('הזמנת משתמש'));
  await p.click('#addm'); await p.waitForSelector('.dlg [name=email]');
  await p.fill('.dlg [name=email]', 'new.person@example.com'); await p.selectOption('.dlg [name=role]', 'accountant');
  await p.click('.dlg [data-ok]'); await p.waitForSelector('.dlg #invlink');
  ok(tag + ': send dialog shows link', (await p.inputValue('#invlink')).includes('?invite=new.person%40example.com'));
  ok(tag + ': whatsapp + mail + copy options', !!(await p.$('#invwa')) && !!(await p.$('#invml')) && !!(await p.$('[data-how=copy]')));
  ok(tag + ': wa text has link', decodeURIComponent(await p.getAttribute('#invwa', 'href')).includes('?invite=new.person'));
  await (await p.$('.dlg')).screenshot({ path: OUT + `p20-invite-${tag}.png` });
  await p.click('.dlg [data-x]'); await p.waitForSelector('.dlg', { state: 'detached' }); await p.waitForTimeout(400);
  let t = await T();
  ok(tag + ': invite stored', t.member_invites?.some(i => i.email === 'new.person@example.com' && i.role === 'accountant' && i.tenant_id === tenant));
  const main = await p.textContent('main');
  ok(tag + ': pending row shown', main.includes('new.person@example.com') && main.includes('ממתין להרשמה'));
  await p.screenshot({ path: OUT + `p20-invite-list-${tag}.png`, fullPage: true });
  await p.click('[data-resend]'); await p.waitForSelector('.dlg #invlink'); ok(tag + ': resend reopens', true);
  await p.click('.dlg [data-x]'); await p.waitForSelector('.dlg', { state: 'detached' });
  // משתמש קיים מתווסף ישירות
  await p.click('[data-uninv]'); await p.waitForSelector('.dlg [data-ok]'); await p.click('.dlg [data-ok]'); await p.waitForTimeout(600);
  t = await T(); ok(tag + ': invite cancelled', !t.member_invites.some(i => i.email === 'new.person@example.com'));
  ok(tag + ': no errors', !errs.length); if (errs.length) console.log(errs);
  await ctx.close();
}
await b.close();
