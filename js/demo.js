import { computeBills } from './bills.js';
// נתוני דמו: קבלן גבס ותקרות עם 3 פרויקטים בשלבים שונים. כל השמות והמספרים מומצאים.
export function demoData(uuid) {
  const T = { tenants: [], memberships: [], main_contractors: [], projects: [], variations: [], boq_items: [], cost_lines: [], expenses: [], change_log: [], members_demo: [],
    workers: [], work_days: [], work_entries: [], work_qty: [], purchase_orders: [], po_lines: [], bills: [], bill_lines: [], bill_fines: [], bill_payments: [],
    vendors: [], documents: [], guarantees: [], contacts: [] };
  const tenant = { id: uuid(), name: 'א.ב. גבס ותקרות בע"מ (דמו)', company_no: '510000000', trades: 'גבס, תקרות, בידוד', contact_name: 'אבי ב.', phone: '050-0000000', email: 'demo@example.com',
    settings: { employer_factor: 1.3, crit_pct: 15, vat_pct: 18, overhead_pct: 0, work_days_month: 22, day_hours: 9, quota_warn_pct: 80, quota_gap_pct: 10, cash_opening: 80000, cash_asof: '2026-10', cash_min: 400000, supplier_terms_days: 60 }, is_demo: true };
  T.tenants.push(tenant);
  const t = tenant.id;
  const mc = (name, days) => { const r = { id: uuid(), tenant_id: t, name, pay_terms_days: days, contact_name: '', phone: '', email: '' }; T.main_contractors.push(r); return r.id; };
  const mc1 = mc('ש.ד. בנייה (דמו)', 60), mc2 = mc('א.מ. הנדסה (דמו)', 45), mc3 = mc('י.ח. ביצוע (דמו)', 60);
  T.members_demo.push({ id: uuid(), tenant_id: t, email: 'avi@example.com', role: 'owner', project_ids: [] },
    { id: uuid(), tenant_id: t, email: 'yossi.foreman@example.com', role: 'foreman', project_ids: [] },
    { id: uuid(), tenant_id: t, email: 'books@example.com', role: 'accountant', project_ids: [] });

  let sort = 0;
  const proj = p => { const r = { id: uuid(), tenant_id: t, is_demo: true, indexation: false, base_index: null, retention_cap: null, tax_pct: 0, ...p }; T.projects.push(r); return r.id; };
  const vo = (project_id, v) => { const r = { id: uuid(), tenant_id: t, project_id, has_written_order: true, notes: '', approved_amount: null, ...v }; T.variations.push(r); return r.id; };
  // item: [chapter, code, desc, unit, qty, price, progress, lines[[kind,desc,qty,unit,cost,waste]], expenses[[kind,supplier,amount,status,date]]]
  const item = (project_id, variation_id, [chapter, code, description, unit, qty, unit_price, progress_pct, lines = [], exps = []]) => {
    const id = uuid();
    T.boq_items.push({ id, tenant_id: t, project_id, variation_id, chapter, code, description, unit, qty, unit_price, billing_method: 'measure', progress_pct, forecast_manual: null, forecast_note: null, sort: sort++ });
    lines.forEach(([kind, d, q, u, c, w = 0, x = {}], k) => T.cost_lines.push({ id: uuid(), tenant_id: t, project_id, boq_item_id: id, kind, description: d, qty: q, unit: u, unit_cost: c, waste_pct: w, labor_type: null, crew: null, sort: k, ...x }));
    exps.forEach(([kind, supplier_name, amount, status, doc_date], k) => T.expenses.push({ id: uuid(), tenant_id: t, project_id, boq_item_id: id, variation_id, kind, supplier_name, doc_no: String(1000 + T.expenses.length), doc_date, description: description, amount, vat_pct: 18, status, pay_date: null, notes: '' }));
  };

  // פרויקט 1: באמצע, חריגה בתקרות מינרליות וחריג שבוצע בלי אישור
  const p1 = proj({ main_contractor_id: mc1, name: 'משרדי הייטק · הרצליה פיתוח', address: 'הרצליה פיתוח', owner_name: 'יזם דמו', start_date: '2026-04-01', end_date: '2027-01-31', contract_type: 'measure', pay_terms_days: 60, retention_pct: 5, insurance_pct: 0.5, shared_pct: 1.5, overhead_pct: 0, status: 'active' });
  const M = 'גבס-מרכז (ספק דמו)', K = 'צוות התקנה ס. (קבלנות)', C = 'אורבן תקרות (ספק דמו)';
  [
    ['01 מוקדמות', '01.001', 'התארגנות באתר, כלים ומכולה', "קומפ'", 1, 45000, 70, [['equipment', 'מכולה וכלים', 1, "קומפ'", 18000], ['labor', 'ימי עבודה להתארגנות', 20, 'יום', 750], ['transport', 'הובלות', 1, "קומפ'", 4500]], [['equipment', 'השכרת מכולה', 12600, 'paid', '2026-05-10'], ['labor', 'שכר צוות', 13400, 'paid', '2026-05-31']]],
    ['02 מחיצות ותקרות גבס', '02.001', 'קיר גבס דו-צדדי 10 ס"מ', 'מ"ר', 1600, 195, 80, [['material', 'לוחות, פרופילים וברגים', 1600, 'מ"ר', 82, 5], ['piece', 'התקנה בקבלנות', 1600, 'מ"ר', 70], ['transport', 'הובלה והנפה', 1, "קומפ'", 8240]], [['material', M, 118000, 'paid', '2026-06-15'], ['piece', K, 90000, 'approved', '2026-08-31'], ['transport', 'הובלות דמו', 6000, 'paid', '2026-06-20']]],
    ['02 מחיצות ותקרות גבס', '02.002', 'קיר גבס אקוסטי כפול', 'מ"ר', 600, 310, 70, [['material', 'לוחות אקוסטיים ובידוד', 600, 'מ"ר', 135, 5], ['piece', 'התקנה בקבלנות', 600, 'מ"ר', 100], ['transport', 'הובלה', 1, "קומפ'", 5950]], [['material', M, 72500, 'paid', '2026-07-01'], ['piece', K, 49000, 'invoice', '2026-09-30']]],
    ['02 מחיצות ותקרות גבס', '02.008', 'תקרת גבס מישורית', 'מ"ר', 1400, 160, 65, [['material', 'לוחות ותלייה', 1400, 'מ"ר', 68, 5], ['piece', 'התקנה בקבלנות', 1400, 'מ"ר', 55], ['equipment', 'במות', 1, "קומפ'", 5040]], [['material', M, 64000, 'paid', '2026-07-15'], ['piece', K, 48000, 'approved', '2026-09-30'], ['equipment', 'במות דמו', 4000, 'paid', '2026-07-20']]],
    ['02 מחיצות ותקרות גבס', '02.014', 'תקרה מינרלית 60/60', 'מ"ר', 2000, 134, 45, [['material', 'אריחים ופרופילים', 2000, 'מ"ר', 61, 5], ['piece', 'התקנה בקבלנות', 2000, 'מ"ר', 36], ['transport', 'הובלה ופינוי', 1, "קומפ'", 13900]], [['material', C, 80600, 'approved', '2026-09-05'], ['piece', K, 36000, 'invoice', '2026-09-30'], ['transport', 'הובלות דמו', 7500, 'paid', '2026-09-06']]],
    ['02 מחיצות ותקרות גבס', '02.020', 'סינרים וקרניזים', 'מ"א', 580, 100, 50, [['material', 'לוחות ופרופילים', 580, 'מ"א', 35, 5], ['labor', 'צוות שכירים: 2 עובדים', 30, 'יום', 750, 0, { labor_type: 'salary', crew: 2 }], ['other', 'שונות', 1, "קומפ'", 2185]], [['material', M, 10000, 'paid', '2026-08-10']]],
    ['02 מחיצות ותקרות גבס', '02.031', 'בידוד צמר סלעים 5 ס"מ', 'מ"ר', 2000, 37, 90, [['material', 'צמר סלעים', 2000, 'מ"ר', 22, 5], ['piece', 'פריסה בקבלנות', 2000, 'מ"ר', 6.9]], [['material', 'בידוד דמו', 44500, 'paid', '2026-06-01'], ['piece', K, 12000, 'paid', '2026-07-31']]],
    ['02 מחיצות ותקרות גבס', '02.040', 'פתחי ביקורת בתקרה', "יח'", 110, 200, 50, [['material', 'פתחי ביקורת', 110, "יח'", 95], ['labor', 'יומיות להתקנה', 10, 'יום', 550, 0, { labor_type: 'daily' }], ['other', 'שונות', 1, "קומפ'", 1050]], [['material', M, 4800, 'invoice', '2026-10-01']]],
    ['03 צבע', '03.001', 'צבע אקרילי לקירות גבס', 'מ"ר', 4400, 22, 20, [['material', 'צבע ושפכטל', 4400, 'מ"ר', 6, 8], ['piece', 'צביעה בקבלנות', 4400, 'מ"ר', 11]], [['material', 'צבעים דמו', 8000, 'paid', '2026-10-05']]]
  ].forEach(r => item(p1, null, r));
  T.expenses.push({ id: uuid(), tenant_id: t, project_id: p1, boq_item_id: null, variation_id: null, kind: 'general', supplier_name: 'פינוי פסולת דמו', doc_no: '2001', doc_date: '2026-09-15', description: 'פינוי פסולת ומכולות', amount: 9000, vat_pct: 18, status: 'paid', pay_date: null, notes: '' });
  const v3 = vo(p1, { number: 'VO-03', title: 'סגירת פיר מערכות בגבס עמיד אש', source: 'change_order', vo_date: '2026-07-20', status: 'approved' });
  item(p1, v3, ['חריגים', 'VO-03.1', 'סגירת פיר מערכות בגבס עמיד אש', "קומפ'", 1, 26000, 100, [['material', 'גבס עמיד אש', 1, "קומפ'", 9500], ['piece', 'התקנה', 1, "קומפ'", 8000]], [['material', M, 9900, 'paid', '2026-08-05'], ['piece', K, 8000, 'paid', '2026-08-31']]]);
  const v5 = vo(p1, { number: 'VO-05', title: 'תוספת פתחי ביקורת למערכות', source: 'supervisor', vo_date: '2026-08-25', status: 'approved' });
  item(p1, v5, ['חריגים', 'VO-05.1', 'תוספת פתחי ביקורת למערכות', "קומפ'", 1, 38000, 50, [['material', 'פתחים ופרופילים', 1, "קומפ'", 14000], ['piece', 'התקנה', 1, "קומפ'", 12500], ['other', 'שונות', 1, "קומפ'", 7000]], [['material', M, 9000, 'approved', '2026-09-20'], ['piece', K, 6000, 'invoice', '2026-09-30']]]);
  const v7 = vo(p1, { number: 'VO-07', title: 'פתחים לגרילים', source: 'supervisor', has_written_order: false, vo_date: '2026-10-08', status: 'executed_unapproved', notes: 'בוצע לפי הנחיה בעל פה של מפקח הראשי. אין הוראת שינוי חתומה.' });
  item(p1, v7, ['חריגים', 'VO-07.1', 'פתחים לגרילים בתקרות', "יח'", 46, 400, 100, [['material', 'מסגרות ופרופילים', 46, "יח'", 113], ['labor', 'ימי עבודה', 6, 'יום', 750]], [['material', M, 4300, 'invoice', '2026-10-10']]]);

  // פרויקט 2: בתחילת הדרך
  const p2 = proj({ main_contractor_id: mc2, name: 'מגדל מגורים · בת ים', address: 'בת ים', owner_name: 'יזם דמו 2', start_date: '2026-07-01', end_date: '2027-06-30', contract_type: 'milestones', pay_terms_days: 45, retention_pct: 5, insurance_pct: 0.4, shared_pct: 1, overhead_pct: 4, status: 'active' });
  [
    ['01 גבס', '1.01', 'קירות גבס דו-צדדיים בדירות', 'מ"ר', 3200, 150, 35, [['material', 'לוחות ופרופילים', 3200, 'מ"ר', 60, 5], ['piece', 'התקנה בקבלנות', 3200, 'מ"ר', 52]], [['material', 'גבס-דרום (ספק דמו)', 78000, 'paid', '2026-08-15'], ['piece', 'צוות התקנה מ. (קבלנות)', 57000, 'approved', '2026-09-30']]],
    ['01 גבס', '1.02', 'תקרות גבס בחדרי רחצה ומסדרונות', 'מ"ר', 1600, 140, 20, [['material', 'לוחות ירוקים ותלייה', 1600, 'מ"ר', 52, 5], ['piece', 'התקנה בקבלנות', 1600, 'מ"ר', 48]], [['material', 'גבס-דרום (ספק דמו)', 18000, 'paid', '2026-09-01'], ['piece', 'צוות התקנה מ. (קבלנות)', 15000, 'invoice', '2026-09-30']]],
    ['01 גבס', '1.03', 'סגירות מערכות וקורות', 'מ"א', 1800, 85, 15, [['material', 'לוחות ופרופילים', 1800, 'מ"א', 28, 5], ['piece', 'התקנה בקבלנות', 1800, 'מ"א', 30]], [['material', 'גבס-דרום (ספק דמו)', 9500, 'paid', '2026-09-10'], ['piece', 'צוות התקנה מ. (קבלנות)', 8000, 'invoice', '2026-09-30']]],
    ['02 בידוד', '2.01', 'בידוד אקוסטי בין דירות', 'מ"ר', 3200, 38.4, 25, [['material', 'צמר סלעים', 3200, 'מ"ר', 20, 5], ['piece', 'פריסה בקבלנות', 3200, 'מ"ר', 8]], [['material', 'בידוד דמו', 24000, 'paid', '2026-08-20']]],
    ['01 גבס', '1.04', 'פתחי שירות בתקרות', "יח'", 60, 180, 0, [], []]
  ].forEach(r => item(p2, null, r));
  const v21 = vo(p2, { number: 'VO-01', title: 'הגבהת תקרה בלובי', source: 'main_request', vo_date: '2026-10-01', status: 'submitted' });
  item(p2, v21, ['חריגים', 'VO-01.1', 'הגבהת תקרה בלובי כולל קרניז', "קומפ'", 1, 24000, 0, [['material', 'לוחות ופרופילים', 1, "קומפ'", 7000], ['piece', 'התקנה', 1, "קומפ'", 8000]], []]);

  // פרויקט 3: לקראת חשבון סופי
  const p3 = proj({ main_contractor_id: mc3, name: 'קניון · ראשון לציון', address: 'ראשון לציון', owner_name: 'יזם דמו 3', start_date: '2025-11-01', end_date: '2026-11-15', contract_type: 'measure', pay_terms_days: 60, retention_pct: 5, insurance_pct: 0.5, shared_pct: 1.5, overhead_pct: 3, status: 'closing' });
  [
    ['01 מחיצות', '01.01', 'מחיצות גבס בחנויות', 'מ"ר', 2800, 180, 100, [['material', 'לוחות ופרופילים', 2800, 'מ"ר', 75, 5], ['piece', 'התקנה בקבלנות', 2800, 'מ"ר', 62]], [['material', 'גבס-מרכז (ספק דמו)', 226000, 'paid', '2026-02-01'], ['piece', 'צוות התקנה ס. (קבלנות)', 174000, 'paid', '2026-04-30']]],
    ['02 תקרות', '02.01', 'תקרות מינרליות', 'מ"ר', 3600, 120, 95, [['material', 'אריחים ופרופילים', 3600, 'מ"ר', 55, 5], ['piece', 'התקנה בקבלנות', 3600, 'מ"ר', 36]], [['material', 'אורבן תקרות (ספק דמו)', 196000, 'paid', '2026-05-01'], ['piece', 'צוות התקנה ס. (קבלנות)', 122000, 'paid', '2026-07-31']]],
    ['02 תקרות', '02.02', 'קרניזים ותאורה נסתרת', 'מ"א', 1400, 110, 85, [['material', 'לוחות ופרופילים', 1400, 'מ"א', 30, 5], ['labor', 'ימי עבודה', 60, 'יום', 750], ['piece', 'התקנה בקבלנות', 1400, 'מ"א', 20]], [['material', 'גבס-מרכז (ספק דמו)', 42000, 'paid', '2026-06-01'], ['labor', 'שכר צוות', 38000, 'paid', '2026-08-31'], ['piece', 'צוות התקנה ס. (קבלנות)', 21000, 'paid', '2026-08-31']]],
    ['03 חיפויים', '03.01', 'חיפוי גבס לעמודים', "יח'", 60, 2500, 90, [['material', 'לוחות ופרופילים', 60, "יח'", 900], ['piece', 'התקנה בקבלנות', 60, "יח'", 850]], [['material', 'גבס-מרכז (ספק דמו)', 48000, 'paid', '2026-07-01'], ['piece', 'צוות התקנה ס. (קבלנות)', 44000, 'approved', '2026-09-30']]]
  ].forEach(r => item(p3, null, r));
  const v32 = vo(p3, { number: 'VO-02', title: 'תוספת תקרה במתחם המזון', source: 'change_order', vo_date: '2026-06-10', status: 'partial', approved_amount: 38000, notes: 'התבקש 45,000, אושר 38,000' });
  item(p3, v32, ['חריגים', 'VO-02.1', 'תוספת תקרה במתחם המזון', "קומפ'", 1, 45000, 100, [['material', 'אריחים ופרופילים', 1, "קומפ'", 16000], ['piece', 'התקנה', 1, "קומפ'", 13000]], [['material', 'אורבן תקרות (ספק דמו)', 16500, 'paid', '2026-07-01'], ['piece', 'צוות התקנה ס. (קבלנות)', 12000, 'paid', '2026-07-31']]]);
  // ===== שלב 3: עובדים, יומן עבודה ורכש =====
  const wk = (name, pay_type, x) => { const r = { id: uuid(), tenant_id: t, name, pay_type, id_no: null, phone: null, trade: null, monthly_salary: null, daily_rate: null, piece_rate: null, ot_rate: null, cost_factor: null, is_foreign: false, agency: null, active: true, notes: null, ...x }; T.workers.push(r); return r.id; };
  const moshe = wk('משה כ. (דמו)', 'salary', { trade: 'גבסן', monthly_salary: 9000 });
  const samir = wk('סמיר ח. (דמו)', 'salary', { trade: 'גבסן', monthly_salary: 8500 });
  const dani = wk('דני ל. (דמו)', 'salary', { trade: 'עוזר', monthly_salary: 7200 });
  const ahmad = wk('אחמד ע. (דמו)', 'daily', { trade: 'גבסן', daily_rate: 550 });
  const vasil = wk('ואסיל פ. (דמו)', 'daily', { trade: 'עוזר', daily_rate: 450, is_foreign: true, agency: 'כוח אדם דמו' });
  const rami = wk('רמי הצבעי (דמו)', 'piece', { trade: 'צבעי' });
  const code = (pid, c) => T.boq_items.find(i => i.project_id === pid && i.code === c);
  const workdays = (from, to) => { const out = []; for (let d = new Date(from + 'T12:00:00Z'); d <= new Date(to + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + 1)) if (d.getUTCDay() <= 4) out.push(d.toISOString().slice(0, 10)); return out; };
  const ent = (pid, date, worker_id, item, x = {}) => T.work_entries.push({ id: uuid(), tenant_id: t, project_id: pid, log_date: date, worker_id, boq_item_id: item?.id || null, variation_id: item?.variation_id || null, cost_line_id: null, days: 1, ot_hours: 0, piece_qty: null, piece_rate: null, note: null, ...x });
  const i020 = code(p1, '02.020'), i040 = code(p1, '02.040'), i301 = code(p1, '03.001'), vo7 = code(p1, 'VO-07.1'), r202 = code(p3, '02.02');
  const oct = workdays('2026-10-01', '2026-10-21');
  // 02.020: תומחרו 2 שכירים ביום. ב-13.10 הגיעו 3
  oct.slice(0, 8).forEach(d => { ent(p1, d, moshe, i020); ent(p1, d, samir, i020, d === oct[3] ? { ot_hours: 2 } : {}); });
  ent(p1, oct[8], moshe, i020); ent(p1, oct[8], samir, i020); ent(p1, oct[8], dani, i020, { note: 'הצטרף לעזרה בקרניזים' });
  // חריג VO-07 (בוצע בלי אישור): שני שכירים יומיים
  oct.slice(9, 11).forEach(d => { ent(p1, d, moshe, vo7); ent(p1, d, samir, vo7); });
  oct.slice(11).forEach(d => { ent(p1, d, moshe, i020, { days: 0.5 }); ent(p1, d, moshe, code(p1, '02.001'), { days: 0.5 }); });
  // 02.040: תומחרו 10 יומיות, כבר נוצלו 8 כשהסעיף בביצוע 50%
  oct.slice(2, 6).forEach(d => { ent(p1, d, ahmad, i040); ent(p1, d, vasil, i040); });
  // 03.001: צבעי בקבלנות לפי מ"ר (לא לפי שעות)
  oct.slice(4, 12).forEach((d, k) => ent(p1, d, rami, i301, { piece_qty: [100, 120, 110, 95, 130, 115, 105, 125][k] }));
  // דני עובד בעיקר בראשון לציון: העלות החודשית שלו מתחלקת בין הפרויקטים לפי ימים
  oct.filter(d => d !== oct[8]).forEach(d => ent(p3, d, dani, r202));
  [...new Set(T.work_entries.map(e => e.project_id + '|' + e.log_date))].forEach(k => { const [pid, d] = k.split('|'); T.work_days.push({ id: uuid(), tenant_id: t, project_id: pid, log_date: d, weather: null, delays: d === oct[6] ? 'הלוחות לקרניזים הגיעו בצהריים' : null, notes: null }); });
  T.work_days.find(x => x.log_date === oct[8] && x.project_id === p1).notes = 'דני הצטרף לצוות הקרניזים';
  oct.slice(0, 9).forEach((d, k) => T.work_qty.push({ id: uuid(), tenant_id: t, project_id: p1, log_date: d, boq_item_id: i020.id, qty: [30, 32, 28, 35, 30, 33, 25, 34, 40][k], note: null }));

  // רכש: תקרה מינרלית הוזמנה מעבר לכמות שתומחרה (2,000 מ"ר + 5% פחת = 2,100)
  const po = (pid, x, lines) => { const r = { id: uuid(), tenant_id: t, project_id: pid, expected_date: null, delivery_notes: null, notes: null, ...x }; T.purchase_orders.push(r);
    lines.forEach(([item, description, qty, unit, unit_price, delivered_qty], k) => T.po_lines.push({ id: uuid(), tenant_id: t, project_id: pid, po_id: r.id, boq_item_id: item?.id || null, variation_id: item?.variation_id || null, cost_line_id: null, description, qty, unit, unit_price, delivered_qty, sort: k })); return r.id; };
  const i014 = code(p1, '02.014'), i001 = code(p1, '02.001');
  const po101 = po(p1, { number: '101', supplier_name: C, order_date: '2026-08-28', status: 'delivered', delivery_notes: '5521, 5530' }, [[i014, 'אריחים 60/60 ופרופילים', 1300, 'מ"ר', 62, 1300]]);
  po(p1, { number: '102', supplier_name: C, order_date: '2026-10-12', expected_date: '2026-10-28', status: 'open', notes: 'הזמנה משלימה לקומה 4' }, [[i014, 'אריחים 60/60 ופרופילים', 1000, 'מ"ר', 61, 0]]);
  const po103 = po(p1, { number: '103', supplier_name: M, order_date: '2026-10-02', status: 'partial', delivery_notes: '7781' }, [[i001, 'לוחות גבס 12.5 מ"מ', 400, 'מ"ר', 82, 380]]);
  const e014 = T.expenses.find(e => e.boq_item_id === i014.id && e.kind === 'material');
  Object.assign(e014, { po_id: po101, qty: 1300, unit: 'מ"ר' });
  T.expenses.push({ id: uuid(), tenant_id: t, project_id: p1, boq_item_id: i001.id, variation_id: null, kind: 'material', supplier_name: M, doc_no: '3307', doc_date: '2026-10-15', description: 'לוחות גבס לפי הזמנה 103', amount: 32800, vat_pct: 18, status: 'invoice', pay_date: null, notes: 'חויב על 400 מ"ר, סופקו 380', po_id: po103, qty: 400, unit: 'מ"ר' });
  // ===== שלב 4: חשבונות חלקיים =====
  const bill = (pid, x, qty, fines = []) => {
    const b = { id: uuid(), tenant_id: t, project_id: pid, due_date: null, index_value: null, offsets: 0, offsets_note: null, notes: null, approved_date: null, ...x }; T.bills.push(b);
    for (const [c, sub, app] of qty) { const it = code(pid, c); T.bill_lines.push({ id: uuid(), tenant_id: t, project_id: pid, bill_id: b.id, boq_item_id: it.id, cum_qty_sub: sub, cum_qty_app: app ?? null, cut_reason: app != null && app < sub ? (c === '02.001' ? 'כמות לא נמדדה / לא אושרה במדידה' : 'עבודה לא הושלמה') : null, note: null }); }
    for (const [description, amount, status = 'imposed'] of fines) T.bill_fines.push({ id: uuid(), tenant_id: t, project_id: pid, bill_id: b.id, description, amount, status, disputed: status === 'appeal', note: null });
    return b;
  };
  const hb1 = bill(p1, { number: 1, period_to: '2026-06-30', bill_date: '2026-07-02', submitted_date: '2026-07-05', approved_date: '2026-07-28', status: 'paid' },
    [['01.001', 0.3, 0.3], ['02.001', 600, 600], ['02.031', 1200, 1200]]);
  const hb2 = bill(p1, { number: 2, period_to: '2026-08-31', bill_date: '2026-09-02', submitted_date: '2026-09-05', approved_date: '2026-09-25', status: 'partial', notes: 'הפיקוח קיצץ בקירות ובתקרת הגבס' },
    [['01.001', 0.5, 0.5], ['02.001', 1100, 1050], ['02.002', 300, 300], ['02.008', 700, 650], ['02.031', 1800, 1800], ['VO-03.1', 1, 1]], [['ניקיון שטח לא בוצע (מכתב 14.08)', 2500], ['איחור בהגשת תוכניות עבודה', 1500, 'appeal'], ['פסולת בחדר מדרגות', 800, 'cancelled']]);
  bill(p1, { number: 3, period_to: '2026-09-30', bill_date: '2026-10-03', submitted_date: '2026-10-05', status: 'submitted' },
    [['01.001', 0.7], ['02.001', 1280], ['02.002', 420], ['02.008', 910], ['02.014', 900], ['02.020', 290], ['02.031', 1800], ['02.040', 33], ['03.001', 880], ['VO-03.1', 1], ['VO-05.1', 0.5]]);
  const rb1 = bill(p3, { number: 1, period_to: '2026-02-28', bill_date: '2026-03-02', submitted_date: '2026-03-04', approved_date: '2026-03-25', status: 'paid' },
    [['01.01', 1600, 1600], ['02.01', 1200, 1200]]);
  const rb2 = bill(p3, { number: 2, period_to: '2026-06-30', bill_date: '2026-07-01', submitted_date: '2026-07-05', approved_date: '2026-07-30', status: 'approved' },
    [['01.01', 2800, 2800], ['02.01', 3400, 3400], ['02.02', 1100, 1100], ['03.01', 50, 50], ['VO-02.1', 1, 1]]);
  // תקבולים: חשבון 1 שולם במלואו, חשבון 2 בהרצליה שולם חלקית, חשבון 2 בראשון לציון לא שולם (באיחור)
  const pay = (pid, b, date, part = 1, method = 'העברה בנקאית') => {
    const pr = T.projects.find(x => x.id === pid), f = a => a.filter(x => x.project_id === pid);
    const r = computeBills({ project: pr, items: f(T.boq_items), variations: f(T.variations), bills: f(T.bills), lines: f(T.bill_lines), fines: f(T.bill_fines), vatPct: 18 }).byBill[b.id];
    T.bill_payments.push({ id: uuid(), tenant_id: t, project_id: pid, bill_id: b.id, pay_date: date, amount: Math.round(r.totalWithVat * part), method, note: part < 1 ? 'תשלום חלקי' : null });
  };
  pay(p1, hb1, '2026-09-28'); pay(p1, hb2, '2026-10-20', 0.5); pay(p3, rb1, '2026-05-28');
  // ===== שלב 7: ספקים, מסמכים, ערבויות, ספר טלפונים, סגירה =====
  const ven = (name, kind, x = {}) => { const v = { id: uuid(), tenant_id: t, name, kind, company_no: null, contact_name: null, phone: null, email: null, bank: null, pay_terms_days: null, notes: null, active: true, ...x }; T.vendors.push(v); return v.id; };
  const doc = (x) => T.documents.push({ id: uuid(), tenant_id: t, vendor_id: null, main_contractor_id: null, project_id: null, title: null, number: null, issue_date: null, link: null, notes: null, ...x });
  const vM = ven(M, 'supplier', { contact_name: 'רונית (דמו)', phone: '03-0000001', pay_terms_days: 60 });
  const vC = ven(C, 'supplier', { contact_name: 'משה (דמו)', phone: '03-0000002', pay_terms_days: 90 });
  const vK = ven(K, 'contractor', { contact_name: 'סלים (דמו)', phone: '050-0000003', pay_terms_days: 30 });
  ven('פינוי פסולת דמו', 'service', { phone: '050-0000004' });
  doc({ vendor_id: vM, doc_type: 'books', expiry: '2027-03-31' }); doc({ vendor_id: vM, doc_type: 'tax', expiry: '2027-03-31' });
  doc({ vendor_id: vC, doc_type: 'books', expiry: '2026-11-10' }); doc({ vendor_id: vC, doc_type: 'tax', expiry: '2026-11-10' });
  doc({ vendor_id: vK, doc_type: 'insurance', title: 'ביטוח צד ג\' ומעבידים', number: 'POL-0001', expiry: '2026-09-30' }); doc({ vendor_id: vK, doc_type: 'books', expiry: '2027-03-31' }); doc({ vendor_id: vK, doc_type: 'tax', expiry: '2027-03-31' });
  doc({ doc_type: 'insurance', title: 'ביטוח עבודות קבלניות', number: 'POL-1001', expiry: '2027-01-31' }); doc({ doc_type: 'license', title: 'רישיון קבלן', number: 'REG-2002', expiry: '2027-06-30' });
  doc({ doc_type: 'books', expiry: '2027-03-31' }); doc({ doc_type: 'tax', expiry: '2027-03-31' }); doc({ main_contractor_id: mc1, doc_type: 'safety', title: 'אישור הדרכת עבודה בגובה לצוות', expiry: '2026-11-05' });
  const gu = x => T.guarantees.push({ id: uuid(), tenant_id: t, bank: 'בנק דמו', issue_date: null, returned_date: null, notes: null, status: 'active', ...x });
  gu({ project_id: p1, main_contractor_id: mc1, kind: 'performance', number: 'G-1001', amount: 64000, expiry: '2026-11-12' });
  gu({ project_id: p2, main_contractor_id: mc2, kind: 'performance', number: 'G-1002', amount: 49500, expiry: '2027-07-31' });
  gu({ project_id: p3, main_contractor_id: mc3, kind: 'advance', number: 'G-0990', amount: 60000, expiry: '2026-06-30', status: 'returned', returned_date: '2026-05-30' });
  gu({ project_id: p3, main_contractor_id: mc3, kind: 'performance', number: 'G-0991', amount: 62000, expiry: '2027-02-28' });
  Object.assign(T.projects.find(x => x.id === p3), { as_made_ok: true, rejects_ok: false, completion_date: null, warranty_months: 12, retention_released: 0 });
  for (const [name, company, role, phone, email] of [['אבי ב. (דמו)', 'א.ב. גבס ותקרות', 'בעלים', '050-0000000', 'avi@example.com'], ['רונית (דמו)', M, 'מכירות', '03-0000001', 'sales@example.com'],
    ['משה (דמו)', C, 'מנהל לקוחות', '03-0000002', null], ['סלים (דמו)', K, 'ראש צוות', '050-0000003', null], ['יוסי (דמו)', 'ש.ד. בנייה (דמו)', 'מנהל פרויקט', '052-0000005', 'pm1@example.com'],
    ['דנה (דמו)', 'ש.ד. בנייה (דמו)', 'מפקחת', '052-0000006', null], ['עמית (דמו)', 'א.מ. הנדסה (דמו)', 'מהנדס ביצוע', '054-0000007', 'pm2@example.com'], ['שירן (דמו)', 'י.ח. ביצוע (דמו)', 'הנהלת חשבונות', '03-0000008', 'acc3@example.com']])
    T.contacts.push({ id: uuid(), tenant_id: t, name, company, role, phone, phone2: null, email, vendor_id: null, main_contractor_id: null, notes: null });
  return T;
}
