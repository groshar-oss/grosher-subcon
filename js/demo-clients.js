// לקוחות דמו לטעינה במערכת החיה: קבלן גבס (4 פרויקטים), קבלן צבע (3) וקבלן ריצוף (5).
// כל השמות, החברות והמספרים מומצאים. כל לקוח מסומן is_demo ונמחק בלחיצה אחת.
import { computeBills } from './bills.js';
import { demoData } from './demo.js';

// סדר הטבלאות לטעינה (הורה לפני ילד)
export const DEMO_TABLES = ['tenants', 'main_contractors', 'projects', 'variations', 'boq_items', 'cost_lines', 'workers', 'purchase_orders', 'po_lines', 'expenses',
  'work_days', 'work_entries', 'work_qty', 'bills', 'bill_lines', 'bill_fines', 'bill_payments', 'vendors', 'documents', 'guarantees', 'contacts'];

const SETTINGS = { employer_factor: 1.3, crit_pct: 15, vat_pct: 18, overhead_pct: 0, work_days_month: 22, day_hours: 9, quota_warn_pct: 80, quota_gap_pct: 10, cash_asof: '2026-10', supplier_terms_days: 60 };

// ימי עבודה (ראשון עד חמישי) בטווח תאריכים
export const workdays = (from, to) => { const out = []; for (let d = new Date(from + 'T12:00:00Z'); d <= new Date(to + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + 1)) if (d.getUTCDay() <= 4) out.push(d.toISOString().slice(0, 10)); return out; };

// כלי בנייה של נתוני לקוח אחד
function builder(T, uuid, t) {
  let sort = 1000, docNo = 5000;
  const B = {
    mc: (name, days) => { const r = { id: uuid(), tenant_id: t, name, pay_terms_days: days, contact_name: '', phone: '', email: '' }; T.main_contractors.push(r); return r.id; },
    proj: p => { const r = { id: uuid(), tenant_id: t, is_demo: true, indexation: false, base_index: null, retention_cap: null, tax_pct: 0, contract_type: 'measure', pay_terms_days: 60, retention_pct: 5, insurance_pct: 0.5, shared_pct: 1.5, overhead_pct: 0, status: 'active', ...p }; T.projects.push(r); return r.id; },
    vo: (project_id, v) => { const r = { id: uuid(), tenant_id: t, project_id, has_written_order: true, notes: '', approved_amount: null, ...v }; T.variations.push(r); return r.id; },
    // [פרק, קוד, תיאור, יחידה, כמות, מחיר, ביצוע%, שורות תמחור[[סוג,תיאור,כמות,יחידה,עלות,פחת,נוסף]], הוצאות[[סוג,ספק,סכום,סטטוס,תאריך,נוסף]]]
    item: (project_id, variation_id, [chapter, code, description, unit, qty, unit_price, progress_pct, lines = [], exps = []]) => {
      const id = uuid();
      T.boq_items.push({ id, tenant_id: t, project_id, variation_id, chapter, code, description, unit, qty, unit_price, billing_method: 'measure', progress_pct, forecast_manual: null, forecast_note: null, sort: sort++ });
      lines.forEach(([kind, d, q, u, c, w = 0, x = {}], k) => T.cost_lines.push({ id: uuid(), tenant_id: t, project_id, boq_item_id: id, kind, description: d, qty: q, unit: u, unit_cost: c, waste_pct: w, labor_type: null, crew: null, sort: k, ...x }));
      exps.forEach(([kind, supplier_name, amount, status, doc_date, x = {}]) => B.exp(project_id, { boq_item_id: id, variation_id, kind, supplier_name, amount, status, doc_date, description, ...x }));
      return id;
    },
    exp: (project_id, x) => { const r = { id: uuid(), tenant_id: t, project_id, boq_item_id: null, variation_id: null, kind: 'material', doc_no: String(docNo++), vat_pct: 18, status: 'invoice', pay_date: null, notes: '', ...x }; T.expenses.push(r); return r; },
    wk: (name, pay_type, x) => { const r = { id: uuid(), tenant_id: t, name, pay_type, id_no: null, phone: null, trade: null, monthly_salary: null, daily_rate: null, piece_rate: null, ot_rate: null, cost_factor: null, is_foreign: false, agency: null, active: true, notes: null, ...x }; T.workers.push(r); return r.id; },
    code: (pid, c) => T.boq_items.find(i => i.project_id === pid && i.code === c),
    ent: (pid, date, worker_id, item, x = {}) => T.work_entries.push({ id: uuid(), tenant_id: t, project_id: pid, log_date: date, worker_id, boq_item_id: item?.id || null, variation_id: item?.variation_id || null, cost_line_id: null, days: 1, ot_hours: 0, piece_qty: null, piece_rate: null, note: null, ...x }),
    qty: (pid, date, item, qty) => T.work_qty.push({ id: uuid(), tenant_id: t, project_id: pid, log_date: date, boq_item_id: item.id, qty, note: null }),
    // ימי יומן לכל תאריך שיש בו רישום (פעם אחת בסוף)
    days: (notes = {}) => { const have = new Set(T.work_days.map(d => d.project_id + '|' + d.log_date));
      [...new Set(T.work_entries.filter(e => e.tenant_id === t).map(e => e.project_id + '|' + e.log_date))].filter(k => !have.has(k)).forEach(k => { const [pid, d] = k.split('|');
        T.work_days.push({ id: uuid(), tenant_id: t, project_id: pid, log_date: d, weather: null, delays: notes[k]?.delays || null, notes: notes[k]?.notes || null }); }); },
    po: (pid, x, lines) => { const r = { id: uuid(), tenant_id: t, project_id: pid, expected_date: null, delivery_notes: null, notes: null, ...x }; T.purchase_orders.push(r);
      lines.forEach(([item, description, qty, unit, unit_price, delivered_qty], k) => T.po_lines.push({ id: uuid(), tenant_id: t, project_id: pid, po_id: r.id, boq_item_id: item?.id || null, variation_id: item?.variation_id || null, cost_line_id: null, description, qty, unit, unit_price, delivered_qty, sort: k })); return r.id; },
    // שורות חשבון: [קוד, כמות מצטברת שהוגשה, כמות שאושרה]
    bill: (pid, x, qty, fines = []) => {
      const b = { id: uuid(), tenant_id: t, project_id: pid, due_date: null, index_value: null, offsets: 0, offsets_note: null, notes: null, approved_date: null, is_final: false, ...x }; T.bills.push(b);
      for (const [c, sub, app] of qty) { const it = B.code(pid, c); if (!it) throw new Error('demo: missing item ' + c);
        T.bill_lines.push({ id: uuid(), tenant_id: t, project_id: pid, bill_id: b.id, boq_item_id: it.id, cum_qty_sub: sub, cum_qty_app: app ?? null, cut_reason: app != null && app < sub ? 'כמות לא אושרה במדידה' : null, note: null }); }
      for (const [description, amount, status = 'imposed'] of fines) T.bill_fines.push({ id: uuid(), tenant_id: t, project_id: pid, bill_id: b.id, description, amount, status, disputed: status === 'appeal', note: null });
      return b;
    },
    pay: (pid, b, date, part = 1, method = 'העברה בנקאית') => {
      const pr = T.projects.find(x => x.id === pid), f = a => a.filter(x => x.project_id === pid);
      const r = computeBills({ project: pr, items: f(T.boq_items), variations: f(T.variations), bills: f(T.bills), lines: f(T.bill_lines), fines: f(T.bill_fines), vatPct: 18 }).byBill[b.id];
      T.bill_payments.push({ id: uuid(), tenant_id: t, project_id: pid, bill_id: b.id, pay_date: date, amount: Math.round(r.totalWithVat * part), method, note: part < 1 ? 'תשלום חלקי' : null });
    },
    ven: (name, kind, x = {}) => { const v = { id: uuid(), tenant_id: t, name, kind, company_no: null, contact_name: null, phone: null, email: null, bank: null, pay_terms_days: null, notes: null, active: true, ...x }; T.vendors.push(v); return v.id; },
    doc: x => T.documents.push({ id: uuid(), tenant_id: t, vendor_id: null, main_contractor_id: null, project_id: null, title: null, number: null, issue_date: null, link: null, notes: null, ...x }),
    gu: x => T.guarantees.push({ id: uuid(), tenant_id: t, bank: 'בנק דמו', issue_date: null, returned_date: null, notes: null, status: 'active', ...x }),
    contact: (name, company, role, phone, email = null) => T.contacts.push({ id: uuid(), tenant_id: t, name, company, role, phone, phone2: null, email, vendor_id: null, main_contractor_id: null, notes: null })
  };
  return B;
}

const tenantRow = (uuid, x) => ({ id: uuid(), company_no: '510000000', email: 'demo@example.com', is_demo: true, ...x, settings: { ...SETTINGS, ...x.settings } });
const OCT = workdays('2026-10-01', '2026-10-22');

// ===== קבלן גבס: הדמו הקיים (3 פרויקטים) ועוד הצעת מחיר אחת =====
function gypsum(T, uuid) {
  const G = demoData(uuid);
  delete G.members_demo; delete G.memberships; delete G.change_log;
  for (const k of Object.keys(G)) T[k] = (T[k] || []).concat(G[k]);
  const t = G.tenants[0].id;
  const B = builder(T, uuid, t);
  const mc4 = B.mc('ק.ל. הנדסה (דמו)', 60);
  const p = B.proj({ main_contractor_id: mc4, name: 'בניין משרדים · חולון (הצעת מחיר)', address: 'חולון', owner_name: 'יזם דמו 4', start_date: '2027-02-01', end_date: '2027-10-31', status: 'tender' });
  [
    ['01 מחיצות', '01.01', 'קיר גבס דו-צדדי 10 ס"מ כולל בידוד', 'מ"ר', 1200, 190, 0, [['material', 'לוחות, פרופילים וצמר סלעים', 1200, 'מ"ר', 92, 5], ['piece', 'התקנה בקבלנות', 1200, 'מ"ר', 68]]],
    ['01 מחיצות', '01.02', 'קיר גבס עמיד אש 2 שעות', 'מ"ר', 350, 285, 0, [['material', 'לוחות אש ופרופילים', 350, 'מ"ר', 128, 5], ['piece', 'התקנה בקבלנות', 350, 'מ"ר', 92]]],
    ['02 תקרות', '02.01', 'תקרה מינרלית 60/60', 'מ"ר', 1800, 130, 0, [['material', 'אריחים ופרופילים', 1800, 'מ"ר', 60, 5], ['piece', 'התקנה בקבלנות', 1800, 'מ"ר', 35]]],
    ['02 תקרות', '02.02', 'תקרת גבס מישורית', 'מ"ר', 900, 158, 0, [['material', 'לוחות ותלייה', 900, 'מ"ר', 66, 5], ['piece', 'התקנה בקבלנות', 900, 'מ"ר', 54]]],
    ['02 תקרות', '02.03', 'סינרים וקרניזים', 'מ"א', 400, 98, 0, [['material', 'לוחות ופרופילים', 400, 'מ"א', 34, 5], ['piece', 'התקנה בקבלנות', 400, 'מ"א', 38]]]
  ].forEach(r => B.item(p, null, r));
  B.contact('רוני (דמו)', 'ק.ל. הנדסה (דמו)', 'מנהל רכש', '052-0000009', 'buy4@example.com');
}

// ===== קבלן צבע: 3 פרויקטים =====
function paint(T, uuid) {
  const tn = tenantRow(uuid, { name: 'מ.ש. צבע וגמרים בע"מ (דמו)', company_no: '515000000', trades: 'צבע פנים, צבע חוץ, שפכטל, אפוקסי', contact_name: 'משה ש.', phone: '050-1000000',
    settings: { cash_opening: 60000, cash_min: 150000 } });
  T.tenants.push(tn);
  const B = builder(T, uuid, tn.id);
  const mc1 = B.mc('ב.ר. קבלנים (דמו)', 60), mc2 = B.mc('נ.ע. בנייה ופיתוח (דמו)', 90), mc3 = B.mc('ג.ל. הנדסה אזרחית (דמו)', 45);
  const S1 = 'צבעים וגוונים (ספק דמו)', S2 = 'צבעי חוץ השרון (ספק דמו)', EP = 'אפוקסי פלוס (ספק דמו)', SC = 'פיגומים ובמות (ספק דמו)', K = 'צוות צבעים ע. (קבלנות)';

  // פרויקט 1: תחילת ביצוע
  const p1 = B.proj({ main_contractor_id: mc1, name: 'בניין משרדים · פתח תקווה', address: 'פתח תקווה', owner_name: 'יזם דמו', start_date: '2026-09-01', end_date: '2027-03-31' });
  [
    ['01 צבע פנים', '01.01', 'שפכטל מלא 2 שכבות לקירות', 'מ"ר', 6500, 18, 15, [['material', 'שפכטל ונייר לטש', 6500, 'מ"ר', 4.5, 5], ['piece', 'שפכטל בקבלנות', 6500, 'מ"ר', 10]], [['material', S1, 4800, 'paid', '2026-09-08'], ['piece', K, 6500, 'approved', '2026-09-30']]],
    ['01 צבע פנים', '01.02', 'צבע אקרילי 2 שכבות לקירות', 'מ"ר', 6500, 26, 5, [['material', 'צבע אקרילי ופריימר', 6500, 'מ"ר', 7, 8], ['piece', 'צביעה בקבלנות', 6500, 'מ"ר', 12]], [['material', S1, 6200, 'invoice', '2026-10-12']]],
    ['01 צבע פנים', '01.03', 'צבע סופרקריל לתקרות גבס', 'מ"ר', 3800, 22, 0, [['material', 'צבע סופרקריל', 3800, 'מ"ר', 5.5, 8], ['piece', 'צביעה בקבלנות', 3800, 'מ"ר', 11]]],
    ['02 צבע חוץ', '02.01', 'צבע אקרילי חוץ על טיח', 'מ"ר', 2400, 58, 0, [['material', 'צבע חוץ ויסוד', 2400, 'מ"ר', 14, 8], ['piece', 'צביעה בקבלנות', 2400, 'מ"ר', 20], ['equipment', 'במה מתרוממת', 1, "קומפ'", 18000]]],
    ['03 מסגרות', '03.01', 'צבע לפרופילי פלדה ומעקות', 'מ"א', 900, 45, 0, [['material', 'צבע יסוד ועליון', 900, 'מ"א', 9, 5], ['labor', 'יומיות', 25, 'יום', 600, 0, { labor_type: 'daily' }]]]
  ].forEach(r => B.item(p1, null, r));
  B.bill(p1, { number: 1, period_to: '2026-09-30', bill_date: '2026-10-02', submitted_date: '2026-10-05', status: 'submitted' }, [['01.01', 1050], ['01.02', 300]]);

  // פרויקט 2: באמצע. חריגה בחומר בקירות, צוות שכירים מתקרב לניצול ימים, הוראת שינוי בלי אישור
  const p2 = B.proj({ main_contractor_id: mc2, name: 'שכונת מגורים · חריש (4 בניינים)', address: 'חריש', owner_name: 'יזם דמו 2', start_date: '2026-03-01', end_date: '2027-02-28', pay_terms_days: 90, retention_pct: 5, insurance_pct: 0.4, shared_pct: 1 });
  [
    ['01 דירות', '01.01', 'שפכטל וצבע אקרילי בדירות', 'מ"ר', 22000, 32, 60, [['material', 'שפכטל, פריימר וצבע', 22000, 'מ"ר', 9, 8], ['piece', 'שפכטל וצביעה בקבלנות', 22000, 'מ"ר', 15]],
      [['material', S1, 70000, 'paid', '2026-05-10'], ['material', S1, 52000, 'paid', '2026-07-10'], ['material', S1, 31000, 'invoice', '2026-10-08'], ['piece', K, 98000, 'paid', '2026-06-30'], ['piece', K, 60000, 'approved', '2026-09-30']]],
    ['01 דירות', '01.02', 'צבע סופרקריל לתקרות', 'מ"ר', 8800, 22, 55, [['material', 'צבע סופרקריל', 8800, 'מ"ר', 5.5, 8], ['piece', 'צביעה בקבלנות', 8800, 'מ"ר', 11]], [['material', S1, 24000, 'paid', '2026-07-10'], ['piece', K, 40000, 'approved', '2026-09-30']]],
    ['02 שטחים ציבוריים', '02.01', 'צבע אקרילי לחדרי מדרגות ולובי', 'מ"ר', 3600, 34, 40, [['material', 'צבע אקרילי ושפכטל', 3600, 'מ"ר', 9, 8], ['labor', 'צוות שכירים: 2 צבעים', 40, 'יום', 650, 0, { labor_type: 'salary', crew: 2 }]], [['material', S1, 12500, 'paid', '2026-08-20']]],
    ['02 שטחים ציבוריים', '02.02', 'צבע אפוקסי לרצפת חניון', 'מ"ר', 4200, 95, 0, [['material', 'אפוקסי שתי שכבות', 4200, 'מ"ר', 38, 5], ['sub', 'קבלן משנה לאפוקסי', 4200, 'מ"ר', 30], ['equipment', 'השחזת רצפה', 1, "קומפ'", 14000]]],
    ['03 חוץ', '03.01', 'צבע חוץ על שליכט', 'מ"ר', 9600, 52, 30, [['material', 'צבע חוץ ויסוד', 9600, 'מ"ר', 13, 8], ['piece', 'צביעה בקבלנות', 9600, 'מ"ר', 18], ['equipment', 'פיגומים', 1, "קומפ'", 48000]],
      [['equipment', SC, 32000, 'approved', '2026-08-15'], ['material', S2, 30000, 'paid', '2026-08-20'], ['piece', K, 45000, 'invoice', '2026-09-30']]]
  ].forEach(r => B.item(p2, null, r));
  const v1 = B.vo(p2, { number: 'VO-01', title: 'צביעת מעקות בטיחות בגגות', source: 'change_order', vo_date: '2026-06-15', status: 'approved' });
  B.item(p2, v1, ['הוראות שינוי', 'VO-01.1', 'צביעת מעקות בטיחות בגגות', 'מ"א', 640, 48, 100, [['material', 'צבע יסוד ועליון', 640, 'מ"א', 10], ['labor', 'יומיות', 12, 'יום', 550, 0, { labor_type: 'daily' }]], [['material', S1, 6800, 'paid', '2026-07-01']]]);
  const v2 = B.vo(p2, { number: 'VO-02', title: 'תיקוני צבע אחרי נזקי מים בבניין B', source: 'supervisor', vo_date: '2026-09-20', status: 'submitted' });
  B.item(p2, v2, ['הוראות שינוי', 'VO-02.1', 'תיקוני צבע אחרי נזקי מים בבניין B', "קומפ'", 1, 18500, 100, [['material', 'שפכטל וצבע', 1, "קומפ'", 3200], ['labor', 'יומיות', 18, 'יום', 550, 0, { labor_type: 'daily' }]]]);
  const v3 = B.vo(p2, { number: 'VO-03', title: 'גוון מיוחד בלובי לפי דרישת האדריכל', source: 'main_request', has_written_order: false, vo_date: '2026-10-06', status: 'executed_unapproved', notes: 'בוצע לפי בקשה בעל פה של מנהל הפרויקט מטעם הקבלן הראשי. אין הוראת שינוי חתומה.' });
  B.item(p2, v3, ['הוראות שינוי', 'VO-03.1', 'גוון מיוחד בלובי (צבע בהזמנה מיוחדת)', 'מ"ר', 420, 16, 100, [['material', 'צבע בגוון מיוחד', 420, 'מ"ר', 6]], [['material', S1, 2700, 'invoice', '2026-10-07']]]);
  const h1 = B.bill(p2, { number: 1, period_to: '2026-04-30', bill_date: '2026-05-03', submitted_date: '2026-05-05', approved_date: '2026-05-28', status: 'paid' }, [['01.01', 3000, 3000]]);
  const h2 = B.bill(p2, { number: 2, period_to: '2026-06-30', bill_date: '2026-07-02', submitted_date: '2026-07-05', approved_date: '2026-07-27', status: 'paid' }, [['01.01', 8000, 8000], ['01.02', 2000, 2000]]);
  B.bill(p2, { number: 3, period_to: '2026-08-31', bill_date: '2026-09-02', submitted_date: '2026-09-04', approved_date: '2026-09-24', status: 'partial', notes: 'המפקח קיצץ בדירות ובצבע החוץ' },
    [['01.01', 12000, 11500], ['01.02', 4000, 4000], ['02.01', 900, 900], ['03.01', 1500, 1200], ['VO-01.1', 640, 640]], [['פגיעה בחלונות אלומיניום בצבע (מכתב 02.09)', 3500], ['אי עמידה בלוח הזמנים בבניין C', 5000, 'appeal']]);
  B.bill(p2, { number: 4, period_to: '2026-09-30', bill_date: '2026-10-02', submitted_date: '2026-10-04', status: 'submitted' },
    [['01.01', 13200], ['01.02', 4840], ['02.01', 1440], ['03.01', 2880], ['VO-01.1', 640], ['VO-02.1', 1]]);
  B.pay(p2, h1, '2026-07-29'); B.pay(p2, h2, '2026-09-29');

  // פרויקט 3: הסתיים, ברווח נמוך מהתכנון (חריגה בחומר ובשכר יומיות)
  const p3 = B.proj({ main_contractor_id: mc3, name: 'בית ספר · מודיעין', address: 'מודיעין', owner_name: 'עירייה דמו', start_date: '2026-02-01', end_date: '2026-09-15', pay_terms_days: 45, status: 'closing' });
  [
    ['01 כיתות', '01.01', 'שפכטל וצבע אקרילי בכיתות', 'מ"ר', 9000, 30, 100, [['material', 'שפכטל, פריימר וצבע', 9000, 'מ"ר', 8.5, 8], ['piece', 'שפכטל וצביעה בקבלנות', 9000, 'מ"ר', 14]],
      [['material', S1, 52000, 'paid', '2026-04-10'], ['material', S1, 41000, 'paid', '2026-06-10'], ['piece', K, 72000, 'paid', '2026-05-31'], ['piece', K, 60000, 'paid', '2026-07-31']]],
    ['01 כיתות', '01.02', 'צבע סופרקריל לתקרות', 'מ"ר', 4200, 21, 100, [['material', 'צבע סופרקריל', 4200, 'מ"ר', 5, 8], ['piece', 'צביעה בקבלנות', 4200, 'מ"ר', 10]], [['material', S1, 24500, 'paid', '2026-05-15'], ['piece', K, 44000, 'paid', '2026-07-31']]],
    ['02 נגרות ומסגרות', '02.01', 'צבע שמן למשקופים ודלתות', "יח'", 180, 220, 100, [['material', 'צבע שמן ומדלל', 180, "יח'", 45], ['labor', 'יומיות', 30, 'יום', 550, 0, { labor_type: 'daily' }]], [['material', S1, 9200, 'paid', '2026-06-01'], ['labor', 'שכר יומיות', 24600, 'paid', '2026-07-31']]],
    ['03 אולם ספורט', '03.01', 'צבע אפוקסי לרצפת אולם ספורט', 'מ"ר', 900, 110, 100, [['material', 'אפוקסי ושכבת גמר', 900, 'מ"ר', 42, 5], ['sub', 'קבלן משנה לאפוקסי', 900, 'מ"ר', 32]], [['material', EP, 41000, 'paid', '2026-07-05'], ['sub', EP, 31000, 'paid', '2026-07-31']]]
  ].forEach(r => B.item(p3, null, r));
  const v31 = B.vo(p3, { number: 'VO-01', title: 'צביעת גדר בית הספר', source: 'change_order', vo_date: '2026-07-10', status: 'approved' });
  B.item(p3, v31, ['הוראות שינוי', 'VO-01.1', 'צביעת גדר בית הספר', 'מ"א', 380, 60, 100, [['material', 'צבע יסוד ועליון', 380, 'מ"א', 14], ['labor', 'יומיות', 14, 'יום', 550, 0, { labor_type: 'daily' }]], [['material', S2, 5600, 'paid', '2026-08-05']]]);
  const m1 = B.bill(p3, { number: 1, period_to: '2026-03-31', bill_date: '2026-04-02', submitted_date: '2026-04-03', approved_date: '2026-04-22', status: 'paid' }, [['01.01', 2500, 2500]]);
  const m2 = B.bill(p3, { number: 2, period_to: '2026-05-31', bill_date: '2026-06-02', submitted_date: '2026-06-03', approved_date: '2026-06-24', status: 'paid' }, [['01.01', 6500, 6500], ['01.02', 2400, 2400], ['02.01', 60, 60]]);
  const m3 = B.bill(p3, { number: 3, period_to: '2026-07-31', bill_date: '2026-08-02', submitted_date: '2026-08-03', approved_date: '2026-08-25', status: 'paid' },
    [['01.01', 9000, 9000], ['01.02', 4200, 4200], ['02.01', 160, 160], ['03.01', 900, 900]], [['ניקיון לקוי לפני מסירת כיתות', 2000]]);
  B.bill(p3, { number: 4, period_to: '2026-09-15', bill_date: '2026-09-28', submitted_date: '2026-10-01', status: 'submitted', is_final: true, notes: 'חשבון סופי' },
    [['01.01', 9000], ['01.02', 4200], ['02.01', 180], ['03.01', 900], ['VO-01.1', 380]]);
  B.pay(p3, m1, '2026-06-14'); B.pay(p3, m2, '2026-08-16'); B.pay(p3, m3, '2026-10-14');
  Object.assign(T.projects.find(x => x.id === p3), { as_made_ok: true, rejects_ok: true, completion_date: '2026-09-15', warranty_months: 12, retention_released: 0 });

  // עובדים ויומן אוקטובר
  const khaled = B.wk('ח\'אלד מ. (דמו)', 'salary', { trade: 'צבעי', monthly_salary: 9500 });
  const amir = B.wk('אמיר ס. (דמו)', 'salary', { trade: 'צבעי', monthly_salary: 9000 });
  const sergey = B.wk('סרגיי ב. (דמו)', 'salary', { trade: 'צבעי', monthly_salary: 8800 });
  const yuri = B.wk('יורי ק. (דמו)', 'daily', { trade: 'צבעי', daily_rate: 600 });
  const ali = B.wk('עלי הצבעי (דמו)', 'piece', { trade: 'צבעי' });
  const i11 = B.code(p1, '01.01'), i12 = B.code(p1, '01.02'), q21 = B.code(p2, '02.01'), q31 = B.code(p2, '03.01');
  OCT.slice(0, 12).forEach(d => B.ent(p1, d, khaled, i11));
  OCT.slice(4).forEach((d, k) => B.ent(p1, d, ali, i12, { piece_qty: [110, 125, 95, 140, 120, 130, 105, 115, 135, 100, 125, 120][k] ?? 110 }));
  // 02.01: תומחרו 40 ימי שכירים, כבר נוצלו 30 כשהסעיף בביצוע 40%
  OCT.slice(0, 15).forEach(d => { B.ent(p2, d, amir, q21); B.ent(p2, d, sergey, q21); });
  OCT.slice(6, 12).forEach(d => B.ent(p2, d, yuri, q31));
  OCT.slice(0, 10).forEach((d, k) => B.qty(p1, d, i11, [70, 75, 80, 65, 90, 85, 70, 80, 75, 60][k]));
  B.days({ [p2 + '|' + OCT[3]]: { delays: 'גשם, עבודות החוץ הופסקו' } });

  // רכש
  B.po(p1, { number: '501', supplier_name: S1, order_date: '2026-10-01', status: 'partial', delivery_notes: '88120' }, [[i12, 'צבע אקרילי לבן 18 ליטר', 120, 'דלי', 290, 70]]);
  B.po(p2, { number: '412', supplier_name: S2, order_date: '2026-10-11', expected_date: '2026-10-26', status: 'open' }, [[q31, 'צבע חוץ בגוון לפי תוכנית', 90, 'דלי', 410, 0]]);

  // ספקים, מסמכים, ערבויות, אנשי קשר
  const vS1 = B.ven(S1, 'supplier', { contact_name: 'גלית (דמו)', phone: '03-1000001', pay_terms_days: 60 });
  const vS2 = B.ven(S2, 'supplier', { contact_name: 'אורן (דמו)', phone: '09-1000002', pay_terms_days: 45 });
  const vEP = B.ven(EP, 'contractor', { contact_name: 'שי (דמו)', phone: '050-1000003', pay_terms_days: 30 });
  const vK = B.ven(K, 'contractor', { contact_name: 'עדנאן (דמו)', phone: '050-1000004', pay_terms_days: 30 });
  B.ven(SC, 'service', { phone: '050-1000005', pay_terms_days: 30 });
  B.doc({ vendor_id: vS1, doc_type: 'books', expiry: '2027-03-31' }); B.doc({ vendor_id: vS1, doc_type: 'tax', expiry: '2027-03-31' });
  B.doc({ vendor_id: vS2, doc_type: 'books', expiry: '2027-03-31' }); B.doc({ vendor_id: vS2, doc_type: 'tax', expiry: '2026-10-31' });
  B.doc({ vendor_id: vEP, doc_type: 'insurance', title: 'ביטוח צד ג\' ומעבידים', number: 'POL-3001', expiry: '2027-04-30' }); B.doc({ vendor_id: vEP, doc_type: 'books', expiry: '2027-03-31' }); B.doc({ vendor_id: vEP, doc_type: 'tax', expiry: '2027-03-31' });
  B.doc({ vendor_id: vK, doc_type: 'insurance', title: 'ביטוח צד ג\' ומעבידים', number: 'POL-3002', expiry: '2026-08-31' }); B.doc({ vendor_id: vK, doc_type: 'books', expiry: '2027-03-31' });
  B.doc({ doc_type: 'insurance', title: 'ביטוח עבודות קבלניות', number: 'POL-3100', expiry: '2027-02-28' }); B.doc({ doc_type: 'license', title: 'רישיון קבלן', number: 'REG-3200', expiry: '2027-06-30' });
  B.doc({ doc_type: 'books', expiry: '2027-03-31' }); B.doc({ doc_type: 'tax', expiry: '2027-03-31' });
  B.gu({ project_id: p1, main_contractor_id: mc1, kind: 'performance', number: 'G-3001', amount: 27000, expiry: '2027-04-30' });
  B.gu({ project_id: p2, main_contractor_id: mc2, kind: 'performance', number: 'G-3002', amount: 72000, expiry: '2026-11-15' });
  B.gu({ project_id: p3, main_contractor_id: mc3, kind: 'performance', number: 'G-3003', amount: 30000, expiry: '2026-12-31' });
  for (const c of [['משה ש. (דמו)', 'מ.ש. צבע וגמרים', 'בעלים', '050-1000000', 'moshe@example.com'], ['גלית (דמו)', S1, 'מכירות', '03-1000001', 'sales1@example.com'], ['אורן (דמו)', S2, 'מכירות', '09-1000002'],
    ['עדנאן (דמו)', K, 'ראש צוות', '050-1000004'], ['ליאת (דמו)', 'ב.ר. קבלנים (דמו)', 'מנהלת פרויקט', '052-1000006', 'pm.br@example.com'], ['אבי (דמו)', 'נ.ע. בנייה ופיתוח (דמו)', 'מהנדס ביצוע', '054-1000007'],
    ['רחל (דמו)', 'ג.ל. הנדסה אזרחית (דמו)', 'הנהלת חשבונות', '08-1000008', 'acc.gl@example.com']]) B.contact(...c);
}

// ===== קבלן ריצוף: 5 פרויקטים =====
function tiling(T, uuid) {
  const tn = tenantRow(uuid, { name: 'ר.ק. ריצוף וחיפוי בע"מ (דמו)', company_no: '516000000', trades: 'ריצוף, חיפוי, שיפועים ומדה, איטום', contact_name: 'רפי ק.', phone: '050-2000000',
    settings: { cash_opening: 120000, cash_min: 500000 } });
  T.tenants.push(tn);
  const B = builder(T, uuid, tn.id);
  const mc1 = B.mc('א.י. בנייה (דמו)', 60), mc2 = B.mc('ש.מ. יזמות וביצוע (דמו)', 75), mc3 = B.mc('ד.ב. קבלנים ראשיים (דמו)', 60), mc4 = B.mc('מ.ח. הנדסה ותשתיות (דמו)', 45);
  const TL = 'קרמיקה דרום (ספק דמו)', AD = 'דבקים ומלטים (ספק דמו)', SN = 'חול ומלט השפלה (ספק דמו)', ST = 'אבני שחם (ספק דמו)', HV = 'הובלות כבדות (ספק דמו)', MT = 'מתכות דמו', KH = 'צוות רצפים ח. (קבלנות)', KB = 'צוות רצפים ב. (קבלנות)';

  // פרויקט 1: הצעת מחיר
  const p1 = B.proj({ main_contractor_id: mc4, name: 'מלון · אילת (הצעת מחיר)', address: 'אילת', owner_name: 'רשת מלונות דמו', start_date: '2027-01-01', end_date: '2027-12-31', pay_terms_days: 45, status: 'tender' });
  [
    ['01 חדרים', '01.01', 'ריצוף פורצלן 60/60 בחדרים, אספקה והתקנה', 'מ"ר', 5200, 185, 0, [['material', 'אריחי פורצלן 60/60', 5200, 'מ"ר', 78, 7], ['material', 'דבק C2TE ורובה', 5200, 'מ"ר', 14, 5], ['piece', 'הנחה בקבלנות', 5200, 'מ"ר', 48]]],
    ['01 חדרים', '01.02', 'חיפוי קירות בחדרי רחצה 30/60, אספקה והתקנה', 'מ"ר', 4800, 175, 0, [['material', 'אריחי חיפוי 30/60', 4800, 'מ"ר', 62, 8], ['material', 'דבק ורובה', 4800, 'מ"ר', 13, 5], ['piece', 'חיפוי בקבלנות', 4800, 'מ"ר', 62]]],
    ['01 חדרים', '01.03', 'פנלים מפורצלן', 'מ"א', 3600, 32, 0, [['material', 'פנלים', 3600, 'מ"א', 9, 5], ['piece', 'התקנה בקבלנות', 3600, 'מ"א', 14]]],
    ['02 רטובים', '02.01', 'שיפוע מלט בחדרי רחצה', 'מ"ר', 1200, 68, 0, [['material', 'חול ומלט', 1200, 'מ"ר', 18, 5], ['piece', 'שיפועים בקבלנות', 1200, 'מ"ר', 28]]],
    ['02 רטובים', '02.02', 'איטום צמנטי דו-רכיבי בחדרי רחצה', 'מ"ר', 1200, 72, 0, [['material', 'חומר איטום ויריעת שריון', 1200, 'מ"ר', 26, 5], ['piece', 'איטום בקבלנות', 1200, 'מ"ר', 22]]],
    ['03 לובי', '03.01', 'ריצוף אבן טבעית 60/90 בלובי', 'מ"ר', 650, 420, 0, [['material', 'אבן טבעית 60/90', 650, 'מ"ר', 240, 8], ['piece', 'הנחה בקבלנות', 650, 'מ"ר', 85], ['equipment', 'ליטוש וקריסטליזציה', 1, "קומפ'", 19500]]]
  ].forEach(r => B.item(p1, null, r));

  // פרויקט 2: תחילת ביצוע, עובדים בקבלנות לפי מ"ר. האריחים מסופקים ע"י היזם
  const p2 = B.proj({ main_contractor_id: mc1, name: 'מגדל מגורים · רמת גן', address: 'רמת גן', owner_name: 'יזם דמו 5', start_date: '2026-08-15', end_date: '2027-08-31' });
  [
    ['01 דירות', '01.01', 'הנחת ריצוף 60/60 בדירות (אריחים ע"י היזם)', 'מ"ר', 7800, 82, 12, [['material', 'דבק C2TE ורובה', 7800, 'מ"ר', 14, 5], ['piece', 'הנחה בקבלנות', 7800, 'מ"ר', 50]], [['material', AD, 9800, 'paid', '2026-09-15'], ['piece', KH, 21000, 'invoice', '2026-09-30']]],
    ['01 דירות', '01.02', 'חיפוי קירות בחדרי רחצה ומטבחים', 'מ"ר', 5400, 98, 5, [['material', 'דבק ורובה', 5400, 'מ"ר', 13, 5], ['piece', 'חיפוי בקבלנות', 5400, 'מ"ר', 60]]],
    ['01 דירות', '01.03', 'פנלים', 'מ"א', 6200, 28, 0, [['material', 'דבק', 6200, 'מ"א', 3, 5], ['piece', 'התקנה בקבלנות', 6200, 'מ"א', 14]]],
    ['02 רטובים', '02.01', 'שיפועים בחדרי רחצה ומרפסות', 'מ"ר', 1900, 62, 10, [['material', 'חול ומלט', 1900, 'מ"ר', 17, 5], ['piece', 'שיפועים בקבלנות', 1900, 'מ"ר', 26]], [['material', SN, 4200, 'paid', '2026-09-10']]]
  ].forEach(r => B.item(p2, null, r));
  B.bill(p2, { number: 1, period_to: '2026-09-30', bill_date: '2026-10-02', submitted_date: '2026-10-04', status: 'submitted' }, [['01.01', 650], ['02.01', 160]]);

  // פרויקט 3: באמצע, ספקי חומר כבדים (פורצלן 120/60, דבקים, פילוס). הזמנה שחויבה מעל האספקה
  const p3 = B.proj({ main_contractor_id: mc2, name: 'קניון · נתניה', address: 'נתניה', owner_name: 'יזם דמו 6', start_date: '2026-04-01', end_date: '2027-02-28', pay_terms_days: 75 });
  [
    ['01 ריצוף', '01.01', 'ריצוף פורצלן 120/60 מעוצב, אספקה והתקנה', 'מ"ר', 6800, 265, 55, [['material', 'אריחי פורצלן 120/60', 6800, 'מ"ר', 132, 8], ['material', 'דבק C2TE S1 ורובה', 6800, 'מ"ר', 18, 5], ['piece', 'הנחה בקבלנות', 6800, 'מ"ר', 58], ['equipment', 'מלקחי ואקום ומלגזה', 1, "קומפ'", 26000]],
      [['material', AD, 42000, 'paid', '2026-07-05'], ['material', AD, 18500, 'approved', '2026-09-02'], ['piece', KB, 98000, 'paid', '2026-08-31'], ['piece', KB, 76000, 'approved', '2026-09-30'], ['equipment', HV, 14000, 'paid', '2026-06-20']]],
    ['01 ריצוף', '01.02', 'חיפוי פורצלן 60/120 בשירותים ציבוריים', 'מ"ר', 1400, 310, 30, [['material', 'אריחי פורצלן 60/120', 1400, 'מ"ר', 140, 10], ['material', 'דבק ורובה', 1400, 'מ"ר', 20, 5], ['piece', 'חיפוי בקבלנות', 1400, 'מ"ר', 78]], [['material', TL, 70000, 'approved', '2026-09-10']]],
    ['01 ריצוף', '01.03', 'פנלים מפורצלן', 'מ"א', 2900, 48, 20, [['material', 'פנלים', 2900, 'מ"א', 18, 8], ['piece', 'התקנה בקבלנות', 2900, 'מ"א', 16]]],
    ['02 תשתית', '02.01', 'מדה מפולסת (שפכטל צמנטי) לפני ריצוף', 'מ"ר', 6800, 42, 70, [['material', 'חומר פילוס', 6800, 'מ"ר', 16, 5], ['piece', 'פילוס בקבלנות', 6800, 'מ"ר', 14]], [['material', AD, 52000, 'paid', '2026-06-01'], ['piece', KB, 41000, 'paid', '2026-07-31']]],
    ['02 תשתית', '02.02', 'שיפוע מלט בגרעיני שירותים', 'מ"ר', 520, 75, 60, [['material', 'חול ומלט', 520, 'מ"ר', 22, 5], ['labor', 'צוות שכירים: 2 רצפים', 14, 'יום', 700, 0, { labor_type: 'salary', crew: 2 }]], [['material', SN, 8200, 'paid', '2026-08-01']]]
  ].forEach(r => B.item(p3, null, r));
  const n1 = B.vo(p3, { number: 'VO-01', title: 'שינוי דוגמת ריצוף במתחם המזון', source: 'main_request', vo_date: '2026-08-01', status: 'approved' });
  B.item(p3, n1, ['הוראות שינוי', 'VO-01.1', 'שינוי דוגמת ריצוף במתחם המזון (חיתוכים)', 'מ"ר', 450, 38, 100, [['piece', 'חיתוכים בקבלנות', 450, 'מ"ר', 22]], [['piece', KB, 9900, 'paid', '2026-08-31']]]);
  const n2 = B.vo(p3, { number: 'VO-02', title: 'פסי האטה ופסי הכוונה לעיוורים', source: 'change_order', vo_date: '2026-10-10', status: 'submitted' });
  B.item(p3, n2, ['הוראות שינוי', 'VO-02.1', 'פסי האטה ופסי הכוונה לעיוורים', 'מ"א', 240, 120, 50, [['material', 'אריחי הכוונה', 240, 'מ"א', 55], ['piece', 'התקנה בקבלנות', 240, 'מ"א', 30]]]);
  const t11 = B.code(p3, '01.01');
  const po301 = B.po(p3, { number: '301', supplier_name: TL, order_date: '2026-05-20', status: 'delivered', delivery_notes: '4410, 4425, 4470' }, [[t11, 'פורצלן 120/60 גוון אפור', 4000, 'מ"ר', 135, 4000]]);
  const po302 = B.po(p3, { number: '302', supplier_name: TL, order_date: '2026-09-20', expected_date: '2026-10-30', status: 'partial', delivery_notes: '4588', notes: 'הזמנה משלימה' }, [[t11, 'פורצלן 120/60 גוון אפור', 2800, 'מ"ר', 135, 500]]);
  B.po(p3, { number: '303', supplier_name: AD, order_date: '2026-10-14', expected_date: '2026-10-25', status: 'open' }, [[t11, 'דבק C2TE S1 שק 25 ק"ג', 600, 'שק', 42, 0]]);
  B.exp(p3, { boq_item_id: t11.id, kind: 'material', supplier_name: TL, doc_no: '9011', doc_date: '2026-06-10', description: 'פורצלן 120/60 לפי הזמנה 301', amount: 330000, status: 'paid', po_id: po301, qty: 2444, unit: 'מ"ר' });
  B.exp(p3, { boq_item_id: t11.id, kind: 'material', supplier_name: TL, doc_no: '9087', doc_date: '2026-08-20', description: 'פורצלן 120/60 לפי הזמנה 301', amount: 210000, status: 'approved', po_id: po301, qty: 1556, unit: 'מ"ר' });
  B.exp(p3, { boq_item_id: t11.id, kind: 'material', supplier_name: TL, doc_no: '9140', doc_date: '2026-10-06', description: 'פורצלן 120/60 לפי הזמנה 302', amount: 145000, status: 'invoice', po_id: po302, qty: 1074, unit: 'מ"ר', notes: 'חויב על 1,074 מ"ר, סופקו 500' });
  const n3b1 = B.bill(p3, { number: 1, period_to: '2026-05-31', bill_date: '2026-06-02', submitted_date: '2026-06-04', approved_date: '2026-06-28', status: 'paid' }, [['02.01', 2000, 2000], ['01.01', 600, 600]]);
  const n3b2 = B.bill(p3, { number: 2, period_to: '2026-07-31', bill_date: '2026-08-02', submitted_date: '2026-08-04', approved_date: '2026-08-27', status: 'approved' },
    [['02.01', 4300, 4300], ['01.01', 2400, 2300], ['02.02', 200, 200], ['VO-01.1', 450, 450]]);
  B.bill(p3, { number: 3, period_to: '2026-09-30', bill_date: '2026-10-02', submitted_date: '2026-10-05', status: 'submitted' },
    [['02.01', 4760], ['01.01', 3740], ['01.02', 420], ['01.03', 580], ['02.02', 312], ['VO-01.1', 450], ['VO-02.1', 120]]);
  B.pay(p3, n3b1, '2026-08-13'); B.pay(p3, n3b2, '2026-10-20', 0.7);

  // פרויקט 4: בית חולים. הוראת שינוי שבוצעה בלי אישור, קנסות, חשבונית קבלנות באיחור
  const p4 = B.proj({ main_contractor_id: mc3, name: 'בית חולים · באר שבע (אגף חדש)', address: 'באר שבע', owner_name: 'משרד ממשלתי דמו', start_date: '2026-01-15', end_date: '2026-12-31' });
  [
    ['01 ריצוף', '01.01', 'ריצוף פורצלן 60/60 אנטי-סליפ R10 במסדרונות', 'מ"ר', 5600, 178, 75, [['material', 'אריחי פורצלן R10', 5600, 'מ"ר', 72, 7], ['material', 'דבק C2TE ורובה', 5600, 'מ"ר', 14, 5], ['piece', 'הנחה בקבלנות', 5600, 'מ"ר', 50]],
      [['material', TL, 180000, 'paid', '2026-03-15'], ['material', TL, 120000, 'paid', '2026-06-01'], ['material', AD, 52000, 'paid', '2026-04-10'], ['piece', KH, 120000, 'paid', '2026-05-31'], ['piece', KH, 95000, 'approved', '2026-08-31']]],
    ['01 ריצוף', '01.02', 'חיפוי קירות בחדרי טיפול', 'מ"ר', 3200, 160, 65, [['material', 'אריחי חיפוי', 3200, 'מ"ר', 58, 8], ['material', 'דבק ורובה', 3200, 'מ"ר', 13, 5], ['piece', 'חיפוי בקבלנות', 3200, 'מ"ר', 58]],
      [['material', TL, 115000, 'paid', '2026-05-01'], ['piece', KH, 82000, 'approved', '2026-07-31']]],
    ['01 ריצוף', '01.03', 'פנלים', 'מ"א', 4100, 30, 50, [['material', 'פנלים', 4100, 'מ"א', 8, 5], ['piece', 'התקנה בקבלנות', 4100, 'מ"א', 14]], [['material', TL, 17500, 'paid', '2026-06-15']]],
    ['02 רטובים', '02.01', 'איטום ומדה בחדרי מקלחת', 'מ"ר', 900, 140, 80, [['material', 'איטום, חול ומלט', 900, 'מ"ר', 42, 5], ['piece', 'איטום ומדה בקבלנות', 900, 'מ"ר', 48]], [['material', SN, 28000, 'paid', '2026-04-20'], ['piece', KH, 30000, 'paid', '2026-06-30']]]
  ].forEach(r => B.item(p4, null, r));
  const b1v = B.vo(p4, { number: 'VO-01', title: 'פירוק והחלפת ריצוף פגום באגף C', source: 'supervisor', has_written_order: false, vo_date: '2026-09-14', status: 'executed_unapproved', notes: 'פורק והוחלף לפי הנחיית המפקח. האריחים הפגומים סופקו ע"י הקבלן הראשי. אין הוראת שינוי חתומה.' });
  B.item(p4, b1v, ['הוראות שינוי', 'VO-01.1', 'פירוק והחלפת ריצוף פגום באגף C', 'מ"ר', 380, 145, 100, [['material', 'דבק ורובה', 380, 'מ"ר', 14], ['piece', 'פירוק והנחה בקבלנות', 380, 'מ"ר', 70]], [['piece', KH, 26600, 'approved', '2026-09-30']]]);
  const b2v = B.vo(p4, { number: 'VO-02', title: 'פסי הפרדה מנירוסטה בין חללים', source: 'change_order', vo_date: '2026-07-01', status: 'approved' });
  B.item(p4, b2v, ['הוראות שינוי', 'VO-02.1', 'פסי הפרדה מנירוסטה', 'מ"א', 600, 85, 60, [['material', 'פסי נירוסטה', 600, 'מ"א', 42], ['piece', 'התקנה בקבלנות', 600, 'מ"א', 18]], [['material', MT, 25200, 'paid', '2026-07-20']]]);
  const b3v = B.vo(p4, { number: 'VO-03', title: 'ריצוף חדר שנאים (לא בחוזה)', source: 'main_request', vo_date: '2026-08-10', status: 'rejected', notes: 'הקבלן הראשי טוען שכלול במחיר היחידה' });
  B.item(p4, b3v, ['הוראות שינוי', 'VO-03.1', 'ריצוף חדר שנאים', 'מ"ר', 120, 190, 0, [['material', 'אריחים ודבק', 120, 'מ"ר', 90], ['piece', 'הנחה', 120, 'מ"ר', 50]]]);
  const k1 = B.bill(p4, { number: 1, period_to: '2026-03-31', bill_date: '2026-04-02', submitted_date: '2026-04-05', approved_date: '2026-04-28', status: 'paid' }, [['01.01', 1200, 1200], ['02.01', 300, 300]]);
  const k2 = B.bill(p4, { number: 2, period_to: '2026-05-31', bill_date: '2026-06-02', submitted_date: '2026-06-04', approved_date: '2026-06-26', status: 'paid' }, [['01.01', 2600, 2600], ['01.02', 900, 900], ['02.01', 600, 600]]);
  const k3 = B.bill(p4, { number: 3, period_to: '2026-07-31', bill_date: '2026-08-02', submitted_date: '2026-08-04', approved_date: '2026-08-25', status: 'partial', notes: 'קיצוץ בחיפוי: חדרים לא גמורים' },
    [['01.01', 3800, 3800], ['01.02', 1900, 1600], ['01.03', 1200, 1200], ['02.01', 720, 720], ['VO-02.1', 200, 200]], [['שבר אריחים בשטח מסור (מכתב 10.07)', 6000], ['איחור בהשלמת אגף B', 12000, 'appeal']]);
  B.bill(p4, { number: 4, period_to: '2026-09-30', bill_date: '2026-10-02', submitted_date: '2026-10-05', status: 'submitted' },
    [['01.01', 4200], ['01.02', 2080], ['01.03', 2050], ['02.01', 720], ['VO-02.1', 360], ['VO-01.1', 380]], [['ניקיון שטחים משותפים', 1500]]);
  B.pay(p4, k1, '2026-06-29'); B.pay(p4, k2, '2026-08-30'); B.pay(p4, k3, '2026-10-15', 0.5);

  // פרויקט 5: לקראת סגירה. חשבון סופי אושר, רשימת ליקויים פתוחה, עיכבון שוחרר חלקית
  const p5 = B.proj({ main_contractor_id: mc1, name: 'משרדים · הרצליה פיתוח', address: 'הרצליה פיתוח', owner_name: 'יזם דמו 7', start_date: '2025-10-01', end_date: '2026-08-31', status: 'closing' });
  [
    ['01 ריצוף', '01.01', 'ריצוף פורצלן 80/80 במשרדים, אספקה והתקנה', 'מ"ר', 3800, 195, 100, [['material', 'אריחי פורצלן 80/80', 3800, 'מ"ר', 88, 7], ['material', 'דבק C2TE ורובה', 3800, 'מ"ר', 15, 5], ['piece', 'הנחה בקבלנות', 3800, 'מ"ר', 52]],
      [['material', TL, 210000, 'paid', '2025-12-10'], ['material', TL, 150000, 'paid', '2026-03-10'], ['material', AD, 60000, 'paid', '2026-02-01'], ['piece', KB, 110000, 'paid', '2026-02-28'], ['piece', KB, 88000, 'paid', '2026-05-31']]],
    ['01 ריצוף', '01.02', 'חיפוי שירותים ומטבחונים', 'מ"ר', 900, 170, 100, [['material', 'אריחי חיפוי', 900, 'מ"ר', 64, 8], ['material', 'דבק ורובה', 900, 'מ"ר', 13, 5], ['piece', 'חיפוי בקבלנות', 900, 'מ"ר', 60]], [['material', TL, 64000, 'paid', '2026-04-01'], ['material', AD, 12500, 'paid', '2026-04-01'], ['piece', KB, 54000, 'paid', '2026-06-30']]],
    ['01 ריצוף', '01.03', 'פנלים', 'מ"א', 2400, 30, 100, [['material', 'פנלים', 2400, 'מ"א', 9, 5], ['piece', 'התקנה בקבלנות', 2400, 'מ"א', 13]], [['material', TL, 22000, 'paid', '2026-05-01'], ['piece', KB, 31000, 'paid', '2026-07-31']]],
    ['02 מרפסות', '02.01', 'ריצוף אבן במרפסות על פלטות', 'מ"ר', 420, 230, 100, [['material', 'אבן ופלטות', 420, 'מ"ר', 120, 5], ['piece', 'הנחה בקבלנות', 420, 'מ"ר', 55]], [['material', ST, 54000, 'paid', '2026-06-01'], ['piece', KB, 23100, 'paid', '2026-07-31']]]
  ].forEach(r => B.item(p5, null, r));
  const e1 = B.vo(p5, { number: 'VO-01', title: 'ריצוף חדר שרתים כולל רצפה צפה', source: 'change_order', vo_date: '2026-05-10', status: 'approved' });
  B.item(p5, e1, ['הוראות שינוי', 'VO-01.1', 'ריצוף חדר שרתים כולל רצפה צפה', 'מ"ר', 140, 320, 100, [['material', 'רצפה צפה ואריחים', 140, 'מ"ר', 160], ['piece', 'התקנה בקבלנות', 140, 'מ"ר', 60]], [['material', TL, 22400, 'paid', '2026-06-10'], ['piece', KB, 8400, 'paid', '2026-07-31']]]);
  const f1 = B.bill(p5, { number: 1, period_to: '2025-12-31', bill_date: '2026-01-02', submitted_date: '2026-01-04', approved_date: '2026-01-27', status: 'paid' }, [['01.01', 1100, 1100]]);
  const f2 = B.bill(p5, { number: 2, period_to: '2026-03-31', bill_date: '2026-04-02', submitted_date: '2026-04-05', approved_date: '2026-04-27', status: 'paid' }, [['01.01', 2900, 2900], ['01.02', 400, 400]]);
  const f3 = B.bill(p5, { number: 3, period_to: '2026-06-30', bill_date: '2026-07-02', submitted_date: '2026-07-05', approved_date: '2026-07-28', status: 'paid' }, [['01.01', 3800, 3800], ['01.02', 900, 900], ['01.03', 1700, 1700], ['02.01', 420, 420], ['VO-01.1', 140, 140]]);
  B.bill(p5, { number: 4, period_to: '2026-08-31', bill_date: '2026-09-03', submitted_date: '2026-09-06', approved_date: '2026-10-01', status: 'approved', is_final: true, notes: 'חשבון סופי. ליקויים ממסירה עדיין פתוחים' },
    [['01.01', 3800, 3800], ['01.02', 900, 900], ['01.03', 2400, 2380], ['02.01', 420, 420], ['VO-01.1', 140, 140]], [['ליקויים ברשימת המסירה שלא תוקנו (12 סעיפים)', 8000, 'appeal']]);
  B.pay(p5, f1, '2026-03-30'); B.pay(p5, f2, '2026-06-29'); B.pay(p5, f3, '2026-09-29');
  Object.assign(T.projects.find(x => x.id === p5), { as_made_ok: true, rejects_ok: false, completion_date: '2026-08-31', warranty_months: 24, retention_released: 25000 });

  // עובדים ויומן אוקטובר
  const hasan = B.wk('חסן ר. (דמו)', 'piece', { trade: 'רצף', piece_rate: 50 });
  const michael = B.wk('מיכאל ט. (דמו)', 'piece', { trade: 'רצף', piece_rate: 50 });
  const omer = B.wk('עומר ד. (דמו)', 'salary', { trade: 'רצף', monthly_salary: 9800 });
  const victor = B.wk('ויקטור ש. (דמו)', 'salary', { trade: 'רצף', monthly_salary: 9200 });
  const nadim = B.wk('נדים ע. (דמו)', 'daily', { trade: 'עוזר', daily_rate: 500 });
  const r11 = B.code(p2, '01.01'), r21 = B.code(p2, '02.01'), s22 = B.code(p3, '02.02'), s13 = B.code(p3, '01.03'), h13 = B.code(p4, '01.03');
  OCT.forEach((d, k) => { B.ent(p2, d, hasan, r11, { piece_qty: [38, 42, 40, 35, 45, 41, 39, 44, 36, 40, 43, 38, 41, 37, 42, 40][k] ?? 40 }); B.ent(p2, d, michael, r11, { piece_qty: [35, 40, 37, 33, 41, 38, 36, 40, 34, 37, 40, 35, 38, 36, 39, 37][k] ?? 37 }); });
  OCT.slice(0, 8).forEach(d => B.ent(p2, d, nadim, r21));
  // 02.02 בנתניה: תומחרו 14 ימי שכירים, כבר נרשמו 20 והסעיף רק ב-60%
  OCT.slice(0, 10).forEach(d => { B.ent(p3, d, omer, s22); B.ent(p3, d, victor, s22); });
  OCT.slice(10).forEach(d => { B.ent(p3, d, omer, s13); B.ent(p4, d, victor, h13); });
  OCT.forEach((d, k) => B.qty(p2, d, r11, 70 + (k % 4) * 4));
  B.days({ [p3 + '|' + OCT[5]]: { delays: 'משאית האריחים הגיעה באיחור של 3 שעות' }, [p2 + '|' + OCT[2]]: { notes: 'סיור עם מפקח הקבלן הראשי, אישור דוגמה בדירה 12' } });

  // רכש
  B.po(p2, { number: '201', supplier_name: AD, order_date: '2026-09-28', status: 'partial', delivery_notes: '6610' }, [[r11, 'דבק C2TE שק 25 ק"ג', 300, 'שק', 38, 180]]);
  B.po(p4, { number: '410', supplier_name: TL, order_date: '2026-10-08', expected_date: '2026-10-29', status: 'open' }, [[B.code(p4, '01.02'), 'אריחי חיפוי 30/60 לבן', 900, 'מ"ר', 58, 0]]);

  // ספקים, מסמכים, ערבויות, אנשי קשר
  const vTL = B.ven(TL, 'supplier', { contact_name: 'אילנה (דמו)', phone: '08-2000001', pay_terms_days: 60 });
  const vAD = B.ven(AD, 'supplier', { contact_name: 'דורון (דמו)', phone: '03-2000002', pay_terms_days: 30 });
  const vSN = B.ven(SN, 'supplier', { phone: '08-2000003', pay_terms_days: 30 });
  B.ven(ST, 'supplier', { phone: '04-2000004', pay_terms_days: 45 });
  B.ven(HV, 'service', { phone: '050-2000005', pay_terms_days: 30 });
  const vKH = B.ven(KH, 'contractor', { contact_name: 'חליל (דמו)', phone: '050-2000006', pay_terms_days: 30 });
  const vKB = B.ven(KB, 'contractor', { contact_name: 'בוריס (דמו)', phone: '050-2000007', pay_terms_days: 30 });
  B.doc({ vendor_id: vTL, doc_type: 'books', expiry: '2027-03-31' }); B.doc({ vendor_id: vTL, doc_type: 'tax', expiry: '2027-03-31' });
  B.doc({ vendor_id: vAD, doc_type: 'books', expiry: '2027-03-31' }); B.doc({ vendor_id: vAD, doc_type: 'tax', expiry: '2027-03-31' });
  B.doc({ vendor_id: vSN, doc_type: 'books', expiry: '2026-11-15' });
  B.doc({ vendor_id: vKH, doc_type: 'insurance', title: 'ביטוח צד ג\' ומעבידים', number: 'POL-4001', expiry: '2026-09-30' }); B.doc({ vendor_id: vKH, doc_type: 'books', expiry: '2027-03-31' }); B.doc({ vendor_id: vKH, doc_type: 'tax', expiry: '2027-03-31' });
  B.doc({ vendor_id: vKB, doc_type: 'insurance', title: 'ביטוח צד ג\' ומעבידים', number: 'POL-4002', expiry: '2027-05-31' }); B.doc({ vendor_id: vKB, doc_type: 'books', expiry: '2027-03-31' }); B.doc({ vendor_id: vKB, doc_type: 'tax', expiry: '2027-03-31' });
  B.doc({ doc_type: 'insurance', title: 'ביטוח עבודות קבלניות', number: 'POL-4100', expiry: '2027-01-31' }); B.doc({ doc_type: 'license', title: 'רישיון קבלן', number: 'REG-4200', expiry: '2027-06-30' });
  B.doc({ doc_type: 'books', expiry: '2027-03-31' }); B.doc({ doc_type: 'tax', expiry: '2027-03-31' }); B.doc({ main_contractor_id: mc3, doc_type: 'safety', title: 'אישור הדרכת בטיחות לעובדי האתר', expiry: '2026-11-08' });
  B.gu({ project_id: p2, main_contractor_id: mc1, kind: 'performance', number: 'G-4001', amount: 62000, expiry: '2027-09-30' });
  B.gu({ project_id: p3, main_contractor_id: mc2, kind: 'performance', number: 'G-4002', amount: 125000, expiry: '2027-03-31' });
  B.gu({ project_id: p3, main_contractor_id: mc2, kind: 'advance', number: 'G-4003', amount: 150000, expiry: '2026-11-30', notes: 'ערבות מקדמה לרכש פורצלן' });
  B.gu({ project_id: p4, main_contractor_id: mc3, kind: 'performance', number: 'G-4004', amount: 85000, expiry: '2026-11-10' });
  B.gu({ project_id: p5, main_contractor_id: mc1, kind: 'performance', number: 'G-3990', amount: 50000, expiry: '2026-10-31', status: 'returned', returned_date: '2026-10-05' });
  B.gu({ project_id: p5, main_contractor_id: mc1, kind: 'warranty', number: 'G-3991', amount: 30000, expiry: '2028-08-31' });
  for (const c of [['רפי ק. (דמו)', 'ר.ק. ריצוף וחיפוי', 'בעלים', '050-2000000', 'rafi@example.com'], ['אילנה (דמו)', TL, 'מכירות', '08-2000001', 'sales.tl@example.com'], ['דורון (דמו)', AD, 'מכירות', '03-2000002'],
    ['חליל (דמו)', KH, 'ראש צוות', '050-2000006'], ['בוריס (דמו)', KB, 'ראש צוות', '050-2000007'], ['יעל (דמו)', 'א.י. בנייה (דמו)', 'מנהלת פרויקט', '052-2000008', 'pm.ay@example.com'],
    ['גיל (דמו)', 'ש.מ. יזמות וביצוע (דמו)', 'מפקח', '054-2000009'], ['מאיר (דמו)', 'ד.ב. קבלנים ראשיים (דמו)', 'מהנדס ביצוע', '052-2000010', 'pm.db@example.com'], ['נועה (דמו)', 'מ.ח. הנדסה ותשתיות (דמו)', 'מנהלת רכש', '08-2000011', 'buy.mh@example.com']]) B.contact(...c);
}

// כל שלושת הלקוחות, מוכנים לטעינה
export function demoClients(uuid) {
  const T = Object.fromEntries(DEMO_TABLES.map(k => [k, []]));
  gypsum(T, uuid); paint(T, uuid); tiling(T, uuid);
  for (const k of Object.keys(T)) if (!DEMO_TABLES.includes(k)) delete T[k];
  return T;
}

// טעינה למסד הנתונים: מוחקת קודם לקוחות דמו קיימים, ואז מכניסה הכול לפי הסדר
export async function loadDemoClients(db, uuid, onStep = () => {}) {
  await removeDemoClients(db);
  const T = demoClients(uuid);
  for (const k of DEMO_TABLES) { if (!T[k].length) continue; onStep(k); await db.insert(k, T[k]); }
  return T;
}

// מחיקה: רק לקוחות שמסומנים כדמו. רישומי היומן נמחקים קודם כי עובד עם רישומים מוגן ממחיקה
export async function removeDemoClients(db) {
  const ids = (await db.select('tenants', { eq: { is_demo: true } })).map(t => t.id);
  if (!ids.length) return 0;
  await db.removeWhere('work_entries', { in: { tenant_id: ids } });
  await db.removeWhere('tenants', { in: { id: ids } });
  return ids.length;
}
