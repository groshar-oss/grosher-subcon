// בדיקת חבילה 16: חיווי Google, סנכרון אוטומטי, תיקייה לכל פרויקט (מסמכים / נתונים / דוחות), PDF לדרייב
import { chromium } from 'playwright';
const BASE = 'http://localhost:8123/'; const KEY = 'grosher-subcon-demo-v5'; const OUT = 'tests/shots/';
const b = await chromium.launch();
const ok = (name, cond) => { console.log((cond ? 'ok   ' : 'FAIL ') + name); if (!cond) process.exitCode = 1; };
// בלי Google: חיווי אדום
{ const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  await p.goto(BASE); await p.waitForSelector('.kpis'); await p.evaluate(() => localStorage.clear()); await p.reload(); await p.waitForSelector('#gpill');
  ok('no google: red pill, not configured', (await p.getAttribute('#gpill', 'class')).includes('off') && (await p.textContent('#gpill')).includes('לא מוגדר'));
  await p.click('#gpill'); await p.waitForTimeout(400); ok('not configured pill opens settings', (await p.evaluate(() => location.hash)) === '#/settings');
  await p.close(); }

const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
await p.addInitScript(() => {
  window.__G__ = []; let gid = 0; window.__GN__ = {};
  window.__GOOGLE_MOCK__ = { fetch: async (url, opt = {}) => {
    const rec = { url, method: opt.method || 'GET' };
    if (typeof opt.body === 'string') { try { const j = JSON.parse(opt.body); rec.name = j.name; rec.parents = j.parents; rec.folder = j.mimeType?.includes('folder'); } catch {} }
    else if (opt.body && opt.body.get) { const m = JSON.parse(await opt.body.get('metadata').text()); rec.name = m.name; rec.parents = m.parents; rec.upload = true; rec.size = opt.body.get('file').size; }
    window.__G__.push(rec);
    if (url.includes('files?fields=files(id)')) return { files: [] };
    const id = 'g' + (++gid); if (rec.name) window.__GN__[id] = rec; return { id };
  } };
});
const G = () => p.evaluate(() => window.__G__);
const pathOf = (g, id) => { const out = []; let cur = id; const byId = Object.fromEntries(Object.entries(g.N)); while (cur && byId[cur]) { out.unshift(byId[cur].name); cur = byId[cur].parents?.[0]; } return out.join('/'); };
const state = async () => ({ list: await G(), N: await p.evaluate(() => window.__GN__) });
await p.goto(BASE); await p.waitForSelector('.kpis'); await p.evaluate(() => localStorage.clear()); await p.reload(); await p.waitForSelector('.kpis');
const t = await p.evaluate(k => JSON.parse(localStorage.getItem(k)).tables, KEY);
const sT = t.tenants.find(x => x.name.includes('גבס')), dT = t.tenants.find(x => x.name.includes('יזמות'));
const sp = t.projects.find(x => x.name.includes('הייטק')), dp = t.projects.find(x => x.project_type === 'dev');
// סנכרון אוטומטי בכניסה
await p.waitForFunction(() => window.__G__.filter(x => x.upload).length > 5, null, { timeout: 30000 }); await p.waitForTimeout(2500);
let s = await state(); const ups = s.list.filter(x => x.upload);
const paths = ups.map(u => pathOf(s, u.parents?.[0]) + '/' + u.name);
ok(`auto sync on first open (${ups.length} uploads)`, ups.length >= 10);
const tn = sT.name.replace(/[\\/:*?"<>|]+/g, '-'), spn = sp.name.replace(/[\\/:*?"<>|]+/g, '-');
ok('project data file in project/נתונים', paths.some(x => x === `גרושר - בקרת עלויות ותזרים/${tn}/${spn}/נתונים/נתוני פרויקט - ${spn}.xlsx`));
ok('project reports in project/דוחות', paths.filter(x => x.startsWith(`גרושר - בקרת עלויות ותזרים/${tn}/${spn}/דוחות/`)).length >= 5);
ok('client backup file', paths.some(x => x === `גרושר - בקרת עלויות ותזרים/${tn}/גיבוי נתונים - כל הלקוח.xlsx`));
ok('every active project gets a folder', t.projects.filter(x => x.tenant_id === sT.id && x.status !== 'closed').every(pr => paths.some(x => x.includes('/' + pr.name.replace(/[\\/:*?"<>|]+/g, '-') + '/נתונים/'))));
ok('files are non-empty', ups.every(u => u.size > 200));
await p.waitForTimeout(500);
ok('pill green with sync time', (await p.getAttribute('#gpill', 'class')).includes('on') && (await p.textContent('#gpill')).includes('סונכרן היום'));
await p.screenshot({ path: OUT + 'gpill.png', clip: { x: 1200, y: 0, width: 240, height: 260 } });
// לא חוזר באותו יום
await p.reload(); await p.waitForSelector('.kpis'); await p.waitForTimeout(2500);
ok('no second auto sync same day', (await G()).length === 0); const n1 = 0;
// לחיצה: סנכרון עכשיו, מחליף קבצים קיימים (PATCH)
await p.click('#gpill'); await p.waitForFunction(n => window.__G__.length > n + 5, n1, { timeout: 30000 }); await p.waitForTimeout(2500);
s = await state(); const again = s.list.slice(n1).filter(x => x.upload);
ok('manual sync replaces files (PATCH, no duplicates)', again.length > 5 && again.every(u => u.method === 'PATCH' || !u.parents));
// יזם: התיקייה והדוחות שלו
await p.selectOption('#tsel', dT.id); await p.waitForTimeout(800);
await p.waitForFunction(() => window.__G__.some(x => x.name && x.name.includes('מגדל הדקל')), null, { timeout: 30000 }); await p.waitForTimeout(3000);
s = await state(); const dpn = dp.name.replace(/[\\/:*?"<>|]+/g, '-');
const dpaths = s.list.filter(x => x.upload).map(u => pathOf(s, u.parents?.[0]) + '/' + u.name);
ok('dev project: data + 7 reports', dpaths.some(x => x.endsWith(`${dpn}/נתונים/נתוני פרויקט - ${dpn}.xlsx`)) && dpaths.filter(x => x.includes(`${dpn}/דוחות/`)).length === 7);
ok('dev report names', ['בקרה תקציבית.xlsx', 'יומן הוראות שינוי.xlsx', 'בדיקת חשבונות קבלנים.xlsx'].every(n => dpaths.some(x => x.endsWith('/' + n))));
// PDF של דוח לתיקיית הפרויקט
await p.goto(BASE + '#/reports/d-budget'); await p.waitForSelector('#rep table'); await p.selectOption('#pid', dp.id); await p.waitForTimeout(500);
const n2 = (await G()).length; await p.click('#gdrive'); await p.waitForFunction(n => window.__G__.slice(n).some(x => x.upload), n2, { timeout: 60000 }); await p.waitForTimeout(400);
s = await state(); const pdf = s.list.slice(n2).find(x => x.upload);
ok(`report PDF saved to project/דוחות (${pathOf(s, pdf.parents[0])}/${pdf.name})`, pdf.name.startsWith('בקרה תקציבית ') && pdf.name.endsWith('.pdf') && pathOf(s, pdf.parents[0]).endsWith(`${dpn}/דוחות`) && pdf.size > 20000);
// דף המלצה לתשלום
const cb = t.cbills.find(x => x.number === 4);
await p.goto(BASE + `#/project/${dp.id}/cbillpdf/${cb.id}`); await p.waitForSelector('#gdrive');
const n3 = (await G()).length; await p.click('#gdrive'); await p.waitForFunction(n => window.__G__.slice(n).some(x => x.upload), n3, { timeout: 60000 });
s = await state(); const pdf2 = s.list.slice(n3).find(x => x.upload); ok('bill recommendation PDF to drive', pdf2.name.startsWith('בדיקת חשבון 4') && pdf2.name.endsWith('.pdf'));
// קובץ שמועלה: נכנס לתיקיית מסמכים של הפרויקט
await p.goto(BASE + `#/project/${dp.id}/docs`); await p.waitForTimeout(600);
const n4 = (await G()).length;
const inp = await p.$('input[type=file]');
if (inp) { await inp.setInputFiles({ name: 'אישור-ביטוח.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 test file '.repeat(30)) }); await p.waitForTimeout(2500);
  s = await state(); const f = s.list.slice(n4).find(x => x.upload && x.name === 'אישור-ביטוח.pdf');
  ok(`uploaded file mirrored to project/מסמכים (${f ? pathOf(s, f.parents[0]) : 'none'})`, !!f && pathOf(s, f.parents[0]).includes(`${dpn}/מסמכים/`)); }
else ok('file input on docs page', false);
// טלפון
await p.setViewportSize({ width: 390, height: 844 }); await p.goto(BASE + '#/'); await p.waitForTimeout(600);
ok('phone: green dot', (await p.getAttribute('.mobile-top .gdot', 'class')).includes('on'));
console.log(errs.length ? 'errors: ' + errs.join(' | ') : 'no errors');
if (errs.length) process.exitCode = 1;
await b.close();
