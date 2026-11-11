// יומן עבודה בלי קליטה: נשמר בתור בטלפון ונשלח כשהקליטה חוזרת (בדיקת קבלה 10)
import { chromium } from 'playwright';
const BASE = 'http://localhost:8123/'; const KEY = 'grosher-subcon-demo-v5';
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 390, height: 844 } });
const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.goto(BASE); await p.waitForSelector('.kpis');
await p.evaluate(k => { localStorage.removeItem(k); localStorage.removeItem('subcon-outbox'); }, KEY); await p.reload(); await p.waitForSelector('.kpis');
const pid = await p.evaluate(k => JSON.parse(localStorage.getItem(k)).tables.projects[1].id, KEY);
// ניתוק: כל קריאה לשמירת יום נכשלת כתקלת רשת
await p.evaluate(async () => { const { db } = await import('/js/db.js'); db._rpc = db.rpc; db.rpc = async (n, a) => { if (n === 'save_work_day') { const e = new Error('Failed to fetch'); e.offline = true; throw e; } return db._rpc(n, a); }; });
await p.goto(BASE + `#/project/${pid}/day/2026-10-20`); await p.waitForSelector('.dayv');
await p.click('.wrow input[type=checkbox] >> nth=0');
await p.click('#save'); await p.waitForTimeout(700);
const q1 = await p.evaluate(() => JSON.parse(localStorage.getItem('subcon-outbox') || '[]').length);
const e1 = await p.evaluate(([k, pid]) => JSON.parse(localStorage.getItem(k)).tables.work_entries.filter(e => e.project_id === pid && e.log_date === '2026-10-20').length, [KEY, pid]);
console.log('offline: queued', q1, '· saved to db', e1);
await p.goto(BASE + `#/project/${pid}/worklog`); await p.waitForTimeout(500);
console.log('pending note shown:', await p.evaluate(() => /ממתינים לשליחה/.test(document.body.innerText)));
// חזרת קליטה
await p.evaluate(async () => { const { db } = await import('/js/db.js'); db.rpc = db._rpc; window.dispatchEvent(new Event('online')); });
await p.waitForTimeout(1000);
const q2 = await p.evaluate(() => JSON.parse(localStorage.getItem('subcon-outbox') || '[]').length);
const e2 = await p.evaluate(([k, pid]) => JSON.parse(localStorage.getItem(k)).tables.work_entries.filter(e => e.project_id === pid && e.log_date === '2026-10-20').length, [KEY, pid]);
console.log('online: queued', q2, '· saved to db', e2);
console.log(errs.join('\n') || 'no errors'); await b.close();
