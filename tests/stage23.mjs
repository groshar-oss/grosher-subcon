// בדיקת חבילה 22: ספר טלפונים כמקום אחד
import { chromium } from 'playwright';
const BASE = 'http://localhost:8123/'; const KEY = 'grosher-subcon-demo-v5'; const OUT = 'tests/shots/';
const b = await chromium.launch();
const ok = (name, cond) => { console.log((cond ? 'ok   ' : 'FAIL ') + name); if (!cond) process.exitCode = 1; };
const ctx = await b.newContext({ viewport: { width: 1440, height: 950 } }); const p = await ctx.newPage();
const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
const T = () => p.evaluate(k => JSON.parse(localStorage.getItem(k)).tables, KEY);
const go = async h => { await p.goto(BASE + '#/'); await p.waitForTimeout(250); await p.goto(BASE + h); await p.waitForTimeout(1000); };
const okDlg = async () => { await p.click('.dlg [data-ok]'); await p.waitForSelector('.dlg', { state: 'detached' }); await p.waitForTimeout(1000); };
const pick = async (sel, q, text) => { await p.fill(`${sel} .cpq`, q); await p.waitForTimeout(200); await p.dispatchEvent(`${sel} .cpres button:has-text("${text}")`, 'mousedown'); await p.waitForTimeout(200); };
await p.goto(BASE); await p.waitForSelector('.kpis'); await p.evaluate(() => localStorage.clear()); await p.reload(); await p.waitForSelector('.kpis');
let t = await T(); const dp = t.projects.find(x => x.project_type === 'dev'); const tid = dp.tenant_id;
await p.evaluate(id => localStorage.setItem('subcon-tenant', JSON.stringify(id)), tid); await p.reload(); await p.waitForTimeout(1200);
await go('#/'); t = await T();
// 1. העברה
const pcs = t.project_contacts.filter(r => r.project_id === dp.id);
const dana = t.contacts.find(c => c.phone === '050-3000000');
ok('existing recipients moved into phone book', !!dana && pcs.some(r => r.contact_id === dana.id && r.role === 'notify'));
ok('client card linked', !!t.tenants.find(x => x.id === tid).contact_id);
// 2. ספר טלפונים: בשימוש ב
await go('#/contacts');
ok('phone book shows usage', (await p.textContent('main')).includes('התרעות · מגדל הדקל'));
await p.check('#fu'); await p.waitForTimeout(200); ok('filter used only', (await p.$$('.ccard')).length >= 1 && (await p.$$('.ccard')).length < t.contacts.length);
await p.screenshot({ path: OUT + 'p22-phonebook.png' });
// 3. עריכת מספר מתעדכנת לבד
await p.click(`[data-c="${dana.id}"]`); await p.waitForSelector('.dlg [name=phone]');
ok('dialog lists where used', (await p.textContent('.dlg')).includes('בשימוש ב'));
await p.fill('.dlg [name=name]', 'דניאל חביב'); await p.fill('.dlg [name=phone]', '0500000001'); await p.fill('.dlg [name=email]', 'owner@example.com');
await okDlg();
t = await T(); let pr = t.projects.find(x => x.id === dp.id);
ok('project recipient updated automatically', pr.notify_phone === '0500000001' && pr.notify_name === 'דניאל חביב' && pr.notify_emails.includes('owner@example.com'));
await go('#/'); await p.evaluate(() => { window.open = () => null; }); await p.click('[data-wa]'); await p.waitForTimeout(400);
ok('whatsapp goes to new number', (await p.evaluate(() => window.__LAST_SEND__?.url || '')).includes('972505335795'));
// 4. כרטיס לקוח: בחירה מהספר
await go(`#/client/${tid}`);
ok('client card has picker, no phone field', !!(await p.$('#tf .cpick')) && !(await p.$('#tf [name=phone]')));
await pick('#tf .cpick', 'דניאל', 'דניאל חביב');
await p.click('#tf button.btn:has-text("שמירת פרטים")'); await p.waitForTimeout(1000);
t = await T(); const tn = t.tenants.find(x => x.id === tid);
ok('client card saved from phone book', tn.phone === '0500000001' && tn.email === 'owner@example.com' && tn.contact_name === 'דניאל חביב');
await (await p.$('#tf')).screenshot({ path: OUT + 'p22-client-card.png' });
// 5. אנשי קשר בפרויקט: מאשר
await go(`#/project/${dp.id}/settings`);
ok('project contacts block', (await p.textContent('.pcblock')).includes('מאשר הוראות שינוי') && (await p.inputValue('[data-cp=pcn_0] .cpq')).includes('דניאל'));
// 6. + חדש מתוך הבחירה
await p.click('[data-cp=pca_0] .cpnew'); await p.waitForSelector('.dlg:last-of-type [name=name]');
await p.fill('.dlg:last-of-type [name=name]', 'נועה מאשרת'); await p.fill('.dlg:last-of-type [name=email]', 'noa@example.com');
await p.click('.dlg:last-of-type [data-ok]'); await p.waitForTimeout(900);
ok('new contact selected in picker', (await p.inputValue('[data-cp=pca_0] .cpq')).includes('נועה'));
await p.click('[data-pcadd=notify]'); await p.waitForTimeout(400);
await pick('[data-cp=pcn_1]', 'נועה', 'נועה מאשרת');
await (await p.$('.pcblock')).screenshot({ path: OUT + 'p22-project-contacts.png' });
await p.click('#pf > button.btn'); await p.waitForTimeout(1200);
t = await T(); pr = t.projects.find(x => x.id === dp.id);
ok('approver + 2 recipients saved', pr.approver_email === 'noa@example.com' && pr.notify_emails.includes('noa@example.com') && pr.notify_emails.includes('owner@example.com') && t.project_contacts.filter(r => r.project_id === dp.id).length === 3);
// 7. ספק
await go('#/vendors'); await p.click('[data-v]'); await p.waitForSelector('.dlg .cpick');
await pick('.dlg .cpick', 'נועה', 'נועה מאשרת'); await okDlg();
t = await T(); ok('vendor contact from phone book', t.vendors.some(v => v.email === 'noa@example.com' && v.contact_id));
// 8. מחיקה מנקה
await go('#/contacts'); const noa = t.contacts.find(c => c.name === 'נועה מאשרת');
await p.click(`[data-c="${noa.id}"]`); await p.waitForSelector('#delc'); await p.click('#delc'); await p.waitForTimeout(400); await p.locator('.ov').last().locator('[data-ok]').click(); await p.waitForTimeout(1200);
t = await T(); pr = t.projects.find(x => x.id === dp.id);
ok('deleting contact clears it everywhere', !pr.approver_email && !pr.notify_emails.includes('noa') && !t.vendors.some(v => v.email === 'noa@example.com'));
// טלפון
const ph = await (await b.newContext({ viewport: { width: 390, height: 844 } })).newPage(); ph.on('pageerror', e => errs.push(e.message));
await ph.goto(BASE); await ph.waitForTimeout(400); await ph.evaluate(all => { for (const [k, v] of Object.entries(all)) localStorage.setItem(k, v); }, await p.evaluate(() => Object.fromEntries(Object.entries(localStorage))));
for (const [hsh, nm] of [['#/contacts', 'book'], [`#/project/${dp.id}/settings`, 'settings'], [`#/client/${tid}`, 'client']]) {
  await ph.goto(BASE + hsh); await ph.reload(); await ph.waitForTimeout(1300);
  ok(`phone ${nm}: no overflow`, (await ph.evaluate(() => document.documentElement.scrollWidth)) <= 392);
  if (nm === 'settings') { await ph.fill('[data-cp=pcn_0] .cpq', 'דנ'); await ph.waitForTimeout(300); await (await ph.$('.pcblock')).screenshot({ path: OUT + 'p22-picker-phone.png' }); }
}
ok('no errors', !errs.length); if (errs.length) console.log(errs);
await b.close();
