// בדיקת חבילה 5: עובד שעתי, תיבת מסמכים (קריאה מדומה), קליטה לכל סוג, ביטול קליטה, דרייב ו-Gmail מדומים, צירוף קובץ, התראות במייל
import { chromium } from 'playwright';
const BASE = 'http://localhost:8123/'; const KEY = 'grosher-subcon-demo-v5';
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
const T = () => p.evaluate(k => JSON.parse(localStorage.getItem(k)).tables, KEY);
const ok = (name, cond) => { console.log((cond ? 'ok   ' : 'FAIL ') + name); if (!cond) process.exitCode = 1; };

// קריאה מדומה: לפי שם הקובץ מחזירה JSON כמו ש-Claude היה מחזיר, עם המזהים הקצרים מההקשר
await p.addInitScript(() => {
  window.__GCALLS__ = []; let gid = 0;
  window.__GOOGLE_MOCK__ = { fetch: async (url, opt = {}) => { window.__GCALLS__.push({ url, method: opt.method || 'GET', body: typeof opt.body === 'string' ? opt.body : null });
    if (url.includes('gmail')) return { id: 'm' + (++gid) };
    if (url.includes('files?fields=files')) return { files: [] };
    return { id: 'g' + (++gid) }; } };
  window.__INTAKE_CALLS__ = 0;
  window.__INTAKE_MOCK__ = async body => {
    window.__INTAKE_CALLS__++;
    const u = body.user, L = u.split('\n');
    const key = (re, txt) => (L.find(l => re.test(l) && l.includes(txt)) || '').split('|')[0] || null;
    const P1 = key(/^P\d+\|/, 'הרצליה'), M1 = key(/^M\d+\|/, '');
    const poLine = (num) => { const l = L.find(x => /^O\d+\|/.test(x) && x.split('|')[2] === num); return { po: l?.split('|')[0], line: /(O\d+\.\d+)=/.exec(l || '')?.[1] }; };
    const item = txt => key(/^I\d+\|/, txt);
    const bill = L.filter(x => /^B\d+\|/.test(x) && x.split('|')[1] === P1).map(x => x.split('|')[0])[0];
    const f = /שם הקובץ: (.*)/.exec(u)[1];
    const o = poLine('102');
    const R = {
      'delivery.jpg': { doc_type: 'delivery', confidence: 0.9, summary: 'תעודת משלוח', project: P1, vendor_name: 'צמנטכל בניה (דמו)', doc_no: 'DN-9001', doc_date: '2026-10-20', po: o.po, lines: [{ description: 'אריחים', qty: 400, unit: 'מ"ר', po_line: o.line }] },
      'invoice.pdf': { doc_type: 'invoice', confidence: 0.92, summary: 'חשבונית ספק', project: P1, vendor_name: 'צמנטכל בניה (דמו)', doc_no: 'INV-9', doc_date: '2026-10-21', po: o.po, amount_net: 24400, lines: [{ description: 'אריחים', qty: 400, unit: 'מ"ר', unit_price: 61, po_line: o.line }] },
      'po.pdf': { doc_type: 'po', confidence: 0.9, summary: 'הזמנה', project: P1, vendor_name: 'ספק חדש בדיקה', doc_no: 'PO-555', doc_date: '2026-10-22', lines: [{ description: 'ברגים', qty: 10, unit: 'קופסה', unit_price: 50 }, { description: 'פרופיל', qty: 20, unit: 'יח', unit_price: 12 }] },
      'contract.pdf': { doc_type: 'contract', confidence: 0.88, summary: 'חוזה', main_contractor: M1, contract: { project_name: 'פרויקט חוזה בדיקה', address: 'חיפה', contract_type: 'measure', contract_total: 500000, pay_terms_days: 75, retention_pct: 5, insurance_pct: 0.5, guarantees: [{ kind: 'performance', pct: 5 }] },
        lines: [{ code: '01.010', description: 'קיר גבס', qty: 100, unit: 'מ"ר', unit_price: 150 }, { code: '01.020', description: 'תקרה', qty: 200, unit: 'מ"ר', unit_price: 120 }, { code: '01.030', description: 'בידוד', qty: 300, unit: 'מ"ר', unit_price: 40 }] },
      'vo.pdf': { doc_type: 'vo', confidence: 0.9, summary: 'הוראת שינוי', project: P1, doc_date: '2026-10-22', vo: { number: 'VO-90', title: 'תוספת מחיצה בדיקה', source: 'change_order', signed: true, amount: 15000 }, lines: [{ description: 'מחיצה', qty: 50, unit: 'מ"ר', unit_price: 300 }] },
      'approved.pdf': { doc_type: 'approved_bill', confidence: 0.85, summary: 'חשבון מאושר', project: P1, doc_date: '2026-10-22', bill: { bill, lines: [{ item: item('02.001'), cum_qty_app: 1234 }], fines: [{ description: 'קנס ניקיון בדיקה', amount: 700 }] } },
      'payment.pdf': { doc_type: 'payment', confidence: 0.9, summary: 'תשלום', project: P1, payment: { bill, amount: 12345, date: '2026-10-22', method: 'העברה' } },
      'guarantee.pdf': { doc_type: 'guarantee', confidence: 0.9, summary: 'ערבות', project: P1, guarantee: { kind: 'performance', bank: 'בנק בדיקה', number: 'G-77', amount: 50000, issue_date: '2026-10-01', expiry: '2027-10-01' } },
      'worker.pdf': { doc_type: 'worker', confidence: 0.9, summary: 'עובד', worker: { name: 'עובד מסמך בדיקה', pay_type: 'hourly', rate: 60 } }
    }[f];
    if (!R) throw new Error('no mock for ' + f);
    return { text: 'הנה התשובה:\n```json\n' + JSON.stringify(R) + '\n```', model: 'mock' };
  };
});

await p.goto(BASE); await p.waitForSelector('.kpis');
await p.evaluate(k => { localStorage.removeItem(k); localStorage.removeItem('subcon-google'); }, KEY); await p.reload(); await p.waitForSelector('.kpis');
let t = await T(); const p1 = t.projects.find(x => x.name.includes('הרצליה')).id;

// 1. עובד שעתי ביומן
await p.goto(BASE + `#/project/${p1}/day/2026-10-21`); await p.waitForSelector('.dayv');
const yossi = t.workers.find(w => w.pay_type === 'hourly');
await p.click(`.wrow input[data-w="${yossi.id}"]`); await p.fill('.wrow.on input[data-k=hours]', '7'); await p.press('.wrow.on input[data-k=hours]', 'Tab');
await p.click('#save'); await p.waitForTimeout(700); t = await T();
const ye = t.work_entries.find(e => e.worker_id === yossi.id && e.log_date === '2026-10-21');
ok('hourly worker saved 7 hours (days = 7/9)', ye && ye.hours === 7 && Math.abs(ye.days - 0.778) < 0.001);

// 2. תיבת מסמכים
await p.goto(BASE + '#/'); await p.waitForSelector('.kpis');
ok('nav has document inbox', await p.locator('.nav a[href="#/inbox"]').count() === 1);
await p.goto(BASE + '#/inbox'); await p.waitForSelector('#drop');
const files = ['delivery.jpg', 'invoice.pdf', 'po.pdf', 'contract.pdf', 'vo.pdf', 'approved.pdf', 'payment.pdf', 'guarantee.pdf', 'worker.pdf']
  .map(name => ({ name, mimeType: name.endsWith('.jpg') ? 'image/jpeg' : 'application/pdf', buffer: Buffer.from('%PDF-1.4 test ' + name) }));
await p.setInputFiles('#fi', files); await p.waitForFunction(() => document.querySelectorAll('#fl tr[data-f]').length >= 9, null, { timeout: 15000 });
t = await T();
ok('9 files uploaded and read (status review)', t.files.length === 9 && t.files.every(f => f.status === 'review') && await p.evaluate(() => window.__INTAKE_CALLS__) === 9);
await p.waitForTimeout(500);
ok('files mirrored to Drive with folders', await p.evaluate(() => window.__GCALLS__.filter(c => c.url.includes('upload/drive')).length) >= 9 && await p.evaluate(() => window.__GCALLS__.some(c => (c.body || '').includes('גרושר - בקרת עלויות ותזרים'))));
t = await T(); ok('drive ids saved', t.files.every(f => f.drive_id));

const applyFile = async name => {
  await p.goto(BASE + '#/inbox'); await p.waitForSelector('#fl');
  await p.click(`#fl tr:has-text("${name}")`); await p.waitForSelector('.rv #apply');
  await p.click('.rv #apply'); await p.waitForSelector('.rv', { state: 'detached', timeout: 5000 }).catch(() => {});
  const still = await p.locator('.rv').count(); if (still) { console.log('   (dialog still open for', name + ')', await p.locator('.toast').allTextContents()); await p.keyboard.press('Escape'); }
  await p.waitForTimeout(400); return T();
};
const po102 = t.purchase_orders.find(x => x.project_id === p1 && x.number === '102');
const l102 = t.po_lines.find(l => l.po_id === po102.id);

t = await applyFile('delivery.jpg');
ok('delivery: qty added to PO line, status partial, note saved', t.po_lines.find(l => l.id === l102.id).delivered_qty === 400 && t.purchase_orders.find(x => x.id === po102.id).status === 'partial' && t.purchase_orders.find(x => x.id === po102.id).delivery_notes.includes('DN-9001'));
t = await applyFile('invoice.pdf');
const inv = t.expenses.find(e => e.doc_no === 'INV-9');
ok('invoice: expense linked to PO and item', inv && inv.amount === 24400 && inv.po_id === po102.id && inv.boq_item_id === l102.boq_item_id);
t = await applyFile('po.pdf');
const npo = t.purchase_orders.find(x => x.number === 'PO-555');
ok('po: new order with 2 lines', npo && t.po_lines.filter(l => l.po_id === npo.id).length === 2);
t = await applyFile('contract.pdf');
const np = t.projects.find(x => x.name === 'פרויקט חוזה בדיקה');
ok('contract: new project with terms, BOQ and guarantee', np && np.pay_terms_days === 75 && np.retention_pct === 5 && t.boq_items.filter(i => i.project_id === np.id).length === 3 && t.guarantees.some(g => g.project_id === np.id && g.amount === 25000));
t = await applyFile('vo.pdf');
const nvo = t.variations.find(v => v.number === 'VO-90');
ok('vo: new approved change order with item', nvo && nvo.status === 'approved' && t.boq_items.some(i => i.variation_id === nvo.id && i.qty === 50 && i.unit_price === 300));
t = await applyFile('approved.pdf');
const bf = t.bill_fines.find(f => f.description === 'קנס ניקיון בדיקה');
ok('approved bill: fine added and qty approved', bf && t.bill_lines.some(l => l.bill_id === bf.bill_id && l.cum_qty_app === 1234));
t = await applyFile('payment.pdf');
ok('payment recorded', t.bill_payments.some(x => x.amount === 12345));
t = await applyFile('guarantee.pdf');
ok('guarantee recorded', t.guarantees.some(g => g.number === 'G-77' && g.amount === 50000));
t = await applyFile('worker.pdf');
ok('worker recorded as hourly', t.workers.some(w => w.name === 'עובד מסמך בדיקה' && w.pay_type === 'hourly' && w.hourly_rate === 60));
ok('all files done with links', t.files.every(f => f.status === 'done' && (f.links || []).length));

// 3. ביטול קליטה: חוזה (פרויקט חדש נמחק עם הסעיפים), תעודת משלוח (הכמות חוזרת)
const undo = async name => {
  await p.goto(BASE + '#/inbox'); await p.waitForSelector('#ft');
  await p.click('#ft [data-t=done]'); await p.click(`#fl tr:has-text("${name}")`); await p.waitForSelector('.rv #undo');
  await p.click('.rv #undo'); await p.click('.ov:not(:has(.rv)) [data-ok]'); await p.waitForTimeout(600); return T();
};
t = await undo('contract.pdf');
ok('undo contract removes project, items, guarantee', !t.projects.some(x => x.name === 'פרויקט חוזה בדיקה') && !t.boq_items.some(i => i.project_id === np.id) && !t.guarantees.some(g => g.project_id === np.id));
t = await undo('delivery.jpg');
ok('undo delivery restores qty and status', t.po_lines.find(l => l.id === l102.id).delivered_qty === 0 && t.purchase_orders.find(x => x.id === po102.id).status === 'open');
ok('undone files back in review', t.files.filter(f => f.status === 'review').length === 2);

// 4. מסמכים בפרויקט וצירוף קובץ להוצאה
await p.goto(BASE + `#/project/${p1}/docs`); await p.waitForSelector('#drop');
ok('project documents tab lists project files', await p.locator('#fl tr[data-f]').count() >= 1);
await p.goto(BASE + `#/project/${p1}/expenses`); await p.waitForSelector('#tb');
ok('invoice expense shows attached file', await p.locator(`#tb [data-aid="${inv.id}"]`).textContent().then(s => s.includes('1')));
const anyExp = t.expenses.find(e => e.project_id === p1 && e.doc_no === '2001');
await p.click(`#tb [data-aid="${anyExp.id}"]`); await p.waitForSelector('#atb');
await p.setInputFiles('#atf', { name: 'scan.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF scan') }); await p.waitForTimeout(600);
t = await T();
ok('attached file linked to expense', t.files.some(f => f.name === 'scan.pdf' && f.status === 'stored' && f.links.some(l => l.id === anyExp.id)));
await p.click('.ov [data-ok]'); await p.waitForTimeout(400);

// 5. התראות במייל: נמענים בהגדרות, שליחה אוטומטית פעם אחת
await p.evaluate(k => { const d = JSON.parse(localStorage.getItem(k)); d.tables.tenants[0].settings = { ...(d.tables.tenants[0].settings || {}), alert_email_on: true, alert_emails: 'boss@example.com, pm@example.com' }; localStorage.setItem(k, JSON.stringify(d)); }, KEY);
await p.goto(BASE + '#/settings'); await p.reload(); await p.waitForSelector('#gf');
ok('settings shows Google card (mock connected)', (await p.textContent('#gf')).includes('Client ID') && await p.locator('#gdis').count() === 1);
await p.goto(BASE + '#/'); await p.waitForSelector('.kpis'); await p.waitForTimeout(1200);
const mails = await p.evaluate(() => window.__GCALLS__.filter(c => c.url.includes('gmail')));
t = await T();
ok('alert email sent once with red alerts', mails.length === 1 && t.alert_log.length > 0);
const raw = JSON.parse(mails[0].body).raw.replace(/-/g, '+').replace(/_/g, '/');
const mime = Buffer.from(raw, 'base64').toString('utf8');
ok('email addressed to both recipients', mime.includes('To: boss@example.com, pm@example.com'));
const html = Buffer.from(mime.split('\r\n\r\n')[1], 'base64').toString('utf8');
ok('email lists alerts in Hebrew', html.includes('התראות חדשות') && html.includes('dir="rtl"'));
await p.goto(BASE + '#/projects'); await p.goto(BASE + '#/'); await p.waitForSelector('.kpis'); await p.waitForTimeout(1000);
ok('no duplicate email on second visit', await p.evaluate(() => window.__GCALLS__.filter(c => c.url.includes('gmail')).length) === 1);
await p.click('#mailnow'); await p.waitForTimeout(500);
ok('manual send: nothing new', (await p.locator('.toast').allTextContents()).join(' ').includes('אין התראות אדומות חדשות'));

// 6. מונחים
await p.goto(BASE + `#/project/${p1}/control`); await p.waitForSelector('.kpis');
const body = await p.textContent('body');
ok('no "חריגים" in project screen', !body.includes('חריגים') && body.includes('הוראות שינוי'));

// 7. סנכרון לדרייב: גיבוי אקסל
await p.goto(BASE + '#/inbox'); await p.waitForSelector('#gsync'); const gc0 = await p.evaluate(() => window.__GCALLS__.length); await p.click('#gsync');
await p.waitForFunction(n => window.__GCALLS__.length > n + 3 && !document.querySelector('#gpill.busy'), gc0, { timeout: 30000 }); await p.waitForTimeout(1500);
ok('backup workbook uploaded', await p.evaluate(n => window.__GCALLS__.slice(n).some(c => c.url.includes('upload/drive')), gc0) && JSON.parse(await p.evaluate(() => localStorage.getItem('subcon-google'))).lastSync > 0);

await p.setViewportSize({ width: 390, height: 844 });
await p.goto(BASE + '#/inbox'); await p.waitForSelector('#fl'); await p.click('#ft [data-t=all]'); await p.click('#fl tr[data-f] >> nth=0'); await p.waitForSelector('.rv'); await p.waitForTimeout(400);
ok('review dialog fits phone width', await p.evaluate(() => document.documentElement.scrollWidth <= 392));
await p.screenshot({ path: 'tests/shots/review-phone.png' });
await p.setViewportSize({ width: 1440, height: 900 }); await p.keyboard.press('Escape');
await p.goto(BASE + '#/inbox'); await p.waitForSelector('#fl'); await p.click('#ft [data-t=open]'); await p.click('#fl tr[data-f] >> nth=0'); await p.waitForSelector('.rv'); await p.waitForTimeout(500);
await p.screenshot({ path: 'tests/shots/review-desktop.png' });

console.log(errs.length ? 'errors: ' + errs.join(' | ') : 'no errors');
if (errs.length) process.exitCode = 1;
await b.close();
