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
let t = await T(); const dp = t.projects.find(x => x.project_type === 'dev');
await p.evaluate(id => localStorage.setItem('subcon-tenant', JSON.stringify(id)), dp.tenant_id);
// בלי מייל מאשר בפרויקט, עם מייל בכרטיס הלקוח
await p.evaluate(([k, pid]) => { const d = JSON.parse(localStorage.getItem(k)); const pr = d.tables.projects.find(x => x.id === pid); pr.approver_email = null; pr.approver_name = null; pr.notify_emails = null; pr.notify_phone = null;
  const tn = d.tables.tenants.find(x => x.id === pr.tenant_id); tn.email = 'owner@example.com'; tn.contact_name = 'דניאל חביב'; localStorage.setItem(k, JSON.stringify(d)); }, [KEY, dp.id]);
await p.reload(); await p.waitForTimeout(600);
await p.goto(BASE + '#/project/' + dp.id + '/cos'); await p.waitForTimeout(900);
await p.click('#add'); await p.waitForSelector('.dlg [name=title]');
await p.fill('.dlg [name=title]', 'ניסיון'); await p.click('[data-sact=send]'); await p.waitForTimeout(600);
ok('empty CO: error shown as toast', ((await p.textContent('body')).match(/אין שורות בהוראת השינוי/g) || []).length >= 2);
await p.click('.dlg [data-x]'); await p.waitForTimeout(300);
const co = t.change_orders.find(c => c.project_id === dp.id && c.number === 'CO-03');
await p.click(`[data-co="${co.id}"] td:nth-child(2)`); await p.waitForSelector('.signbox');
{ const i = await p.$('#ll [data-f=price_approved]'); await i.fill('760'); await i.dispatchEvent('change'); }
await p.fill('.dlg [name=price_analysis]', 'בדיקה');
await p.click('[data-sact=send]'); await p.waitForSelector('.dlg [name=to]', { timeout: 20000 }); await p.waitForTimeout(300);
ok('approver falls back to client contact email', (await p.inputValue('.dlg [name=to]')) === 'owner@example.com');
ok('note explains fallback', (await p.textContent('.dlg:last-of-type')).includes('דניאל חביב'));
await p.click('.dlg:last-of-type [data-ok]'); await p.waitForTimeout(1500);
t = await T(); const pr = t.projects.find(x => x.id === dp.id);
ok('approver saved on project', pr.approver_email === 'owner@example.com' && pr.approver_name === 'דניאל חביב');
ok('no errors', !errs.length); if (errs.length) console.log(errs);
await b.close();
