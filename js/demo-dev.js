import { contractBills } from './devflow.js';

// לקוח דמו מסוג יזם: קבוצת יזמות עם פרויקט מגורים אחד. כל השמות והמספרים מומצאים.
// תקציב לפי פרקים, בסיס שננעל באפריל, התקשרויות (חלקן מעל התקציב), טיוטה, שורה מחוץ לתקציב והוצאות.
export function devDemo(T, uuid) {
  for (const k of ['tenants', 'projects', 'boq_items', 'vendors', 'contracts', 'contract_lines', 'change_orders', 'co_lines', 'cbills', 'cbill_lines', 'dev_income', 'alert_state', 'expenses', 'documents', 'guarantees', 'contacts', 'change_log']) T[k] ||= [];
  const t = uuid();
  T.tenants.push({ id: t, name: 'קבוצת הדקל יזמות (דמו)', company_no: '520000000', trades: 'ייזום ובנייה למגורים', contact_name: 'דנה ש.', phone: '050-3000000', email: 'dekel.demo@example.com',
    settings: { crit_pct: 15, vat_pct: 18, cash_opening: 4500000, cash_asof: '2026-10', cash_min: 2000000, supplier_terms_days: 45, digest: 'weekly' }, is_demo: true });
  const pid = uuid();
  T.projects.push({ id: pid, tenant_id: t, project_type: 'dev', is_demo: true, name: 'מגדל הדקל · רחובות (דמו)', address: 'רחובות', owner_name: 'קבוצת הדקל יזמות', start_date: '2026-01-01', end_date: '2028-06-30',
    status: 'active', contract_type: 'measure', pay_terms_days: 45, retention_pct: 0, insurance_pct: 0, shared_pct: 0, tax_pct: 0, overhead_pct: 0, indexation: false, base_index: null, retention_cap: null, main_contractor_id: null,
    notify_name: 'דנה ש. (דמו)', notify_phone: '050-3000000', notify_emails: 'dekel.demo@example.com' });
  let sort = 0;
  const items = {};
  // [פרק, קוד, תיאור, יחידה, כמות, מחיר תקציב]
  for (const [chapter, code, description, unit, qty, unit_price] of [
    ['01 תכנון ויועצים', '01.01', 'אדריכלות ותכנון', "קומפ'", 1, 1450000], ['01 תכנון ויועצים', '01.02', 'קונסטרוקציה', "קומפ'", 1, 520000], ['01 תכנון ויועצים', '01.03', 'יועצי מערכות (חשמל, אינסטלציה, מיזוג)', "קומפ'", 1, 610000],
    ['01 תכנון ויועצים', '01.04', 'פיקוח וניהול פרויקט', 'חודש', 30, 52000],
    ['02 אגרות והיטלים', '02.01', 'אגרות בנייה והיטלי השבחה', "קומפ'", 1, 3200000], ['02 אגרות והיטלים', '02.02', 'חיבורי חשמל, מים וביוב', "קומפ'", 1, 1150000],
    ['03 דיפון וחפירה', '03.01', 'כלונסאות דיפון', 'מ"א', 2400, 950], ['03 דיפון וחפירה', '03.02', 'עוגני קרקע', "יח'", 180, 6200], ['03 דיפון וחפירה', '03.03', 'חפירה ופינוי', 'מ"ק', 26000, 62],
    ['04 שלד', '04.01', 'בטון יצוק באתר לרצפות ותקרות', 'מ"ק', 9800, 1650], ['04 שלד', '04.02', 'קירות וקורות בטון', 'מ"ק', 4200, 1850], ['04 שלד', '04.03', 'פלדת זיון', 'טון', 1450, 5400], ['04 שלד', '04.04', 'בלוקים ומחיצות בנויות', 'מ"ר', 21000, 165],
    ['05 גמר', '05.01', 'טיח פנים וחוץ', 'מ"ר', 52000, 92], ['05 גמר', '05.02', 'ריצוף וחיפוי בדירות', 'מ"ר', 11800, 330], ['05 גמר', '05.03', 'דלתות פנים וכניסה', "יח'", 630, 2900], ['05 גמר', '05.04', 'מטבחים', "יח'", 90, 24000],
    ['06 אלומיניום', '06.01', 'חלונות וויטרינות אלומיניום', 'מ"ר', 5200, 1300],
    ['07 מערכות', '07.01', 'חשמל ותקשורת', "קומפ'", 1, 5600000], ['07 מערכות', '07.02', 'אינסטלציה וכיבוי אש', "קומפ'", 1, 4300000], ['07 מערכות', '07.03', 'מיזוג אוויר', "קומפ'", 1, 3100000], ['07 מערכות', '07.04', 'מעליות', "יח'", 4, 520000]
  ]) { const id = uuid(); items[code] = id; T.boq_items.push({ id, tenant_id: t, project_id: pid, variation_id: null, chapter, code, description, unit, qty, unit_price, billing_method: 'measure', progress_pct: 0, forecast_manual: null, forecast_note: null, sort: sort++ }); }
  // בסיס ננעל באפריל. אחרי הנעילה הוגדל תקציב הריצוף (שדרוג לפורצלן)
  const baseItems = {}; let total = 0;
  for (const it of T.boq_items.filter(i => i.project_id === pid)) { const a = it.qty * it.unit_price * (it.code === '05.02' ? 300 / 330 : 1); baseItems[it.id] = Math.round(a * 100) / 100; total += baseItems[it.id]; }
  Object.assign(T.projects.find(p => p.id === pid), { baseline: { items: baseItems, total: Math.round(total * 100) / 100 }, baseline_at: '2026-04-15T09:00:00.000Z', baseline_note: 'תקציב שאושר בישיבת הנהלה' });
  T.change_log.push({ id: uuid(), tenant_id: t, project_id: pid, entity: 'project', entity_id: pid, label: 'בסיס תקציב', field: 'נעילת בסיס', old_value: null, new_value: String(Math.round(total)), reason: 'תקציב שאושר בישיבת הנהלה', user_name: 'demo', at: '2026-04-15T09:00:00.000Z' });
  T.change_log.push({ id: uuid(), tenant_id: t, project_id: pid, entity: 'boq_item', entity_id: items['05.02'], label: '05.02 ריצוף וחיפוי בדירות', field: 'מחיר יחידה', old_value: '300', new_value: '330', reason: 'שדרוג לפורצלן 120×60 לפי החלטת היזם', user_name: 'demo', at: '2026-07-02T10:00:00.000Z' });

  const vendor = (name, kind, x = {}) => { const id = uuid(); T.vendors.push({ id, tenant_id: t, name, kind, company_no: null, contact_name: null, phone: null, email: null, bank: null, pay_terms_days: 45, notes: null, active: true, ...x }); return id; };
  const contract = (vname, kind, vkind, c, lines) => {
    const vid = vendor(vname, vkind); const id = uuid();
    T.contracts.push({ id, tenant_id: t, project_id: pid, vendor_id: vid, vendor_name: vname, number: null, kind, status: 'signed', signed_date: '2026-03-01', pay_terms_days: 45, retention_pct: 5, advance_amount: 0, advance_offset_pct: 0, indexation: false, base_index: null, notes: null, ...c });
    lines.forEach(([code, description, unit, qty, unit_price], k) => T.contract_lines.push({ id: uuid(), tenant_id: t, project_id: pid, contract_id: id, boq_item_id: code ? items[code] : null, code: code || null, description, unit, qty, unit_price, sort: k }));
    return id;
  };
  const cArch = contract('א.ר. אדריכלים (דמו)', 'consultant', 'consultant', { number: 'C-01', title: 'תכנון אדריכלי', retention_pct: 0, signed_date: '2025-11-01' }, [['01.01', 'תכנון אדריכלי מלא', "קומפ'", 1, 1450000]]);
  const cStr = contract('מ.ק. הנדסת מבנים (דמו)', 'consultant', 'consultant', { number: 'C-02', title: 'תכנון קונסטרוקציה', retention_pct: 0, signed_date: '2025-11-15' }, [['01.02', 'תכנון קונסטרוקציה', "קומפ'", 1, 498000]]);
  const cShore = contract('ד.ח. דיפון וביסוס (דמו)', 'contractor', 'contractor', { number: 'C-03', title: 'דיפון, עוגנים וחפירה', signed_date: '2026-01-10' },
    [['03.01', 'כלונסאות דיפון', 'מ"א', 2400, 1010], ['03.02', 'עוגני קרקע', "יח'", 180, 6500], ['03.03', 'חפירה ופינוי', 'מ"ק', 26000, 64], [null, 'פינוי קרקע מזוהמת (לא בתקציב)', 'מ"ק', 1200, 180]]);
  const cMain = contract('ש.ב. בנייה וביצוע (דמו)', 'contractor', 'contractor', { number: 'C-04', title: 'קבלן ראשי: שלד', signed_date: '2026-03-01', advance_amount: 2000000, advance_offset_pct: 10 },
    [['04.01', 'בטון יצוק לרצפות ותקרות', 'מ"ק', 9800, 1620], ['04.02', 'קירות וקורות', 'מ"ק', 4200, 1820], ['04.03', 'פלדת זיון', 'טון', 1450, 5600], ['04.04', 'בלוקים ומחיצות', 'מ"ר', 21000, 158]]);
  const cAlu = contract('ק.ל. אלומיניום (דמו)', 'contractor', 'contractor', { number: 'C-05', title: 'אלומיניום', signed_date: '2026-06-20' }, [['06.01', 'חלונות וויטרינות', 'מ"ר', 5200, 1395]]);
  contract('ג.מ. גמרים (דמו)', 'contractor', 'contractor', { number: 'C-06', title: 'טיח וריצוף (בטיוטה)', status: 'draft', signed_date: null }, [['05.01', 'טיח פנים וחוץ', 'מ"ר', 52000, 95], ['05.02', 'ריצוף וחיפוי', 'מ"ר', 11800, 335]]);
  const cElev = contract('ע.מ. מעליות (דמו)', 'supplier', 'supplier', { number: 'C-07', title: 'מעליות', signed_date: '2026-05-05', retention_pct: 0 }, [['07.04', 'מעליות 13 תחנות', "יח'", 4, 515000]]);

  let docNo = 7000;
  const exp = (contract_id, code, supplier_name, amount, status, doc_date, description, x = {}) => T.expenses.push({ id: uuid(), tenant_id: t, project_id: pid, contract_id, boq_item_id: code ? items[code] : null, variation_id: null, kind: 'sub', supplier_name, doc_no: String(docNo++), doc_date, description, amount, vat_pct: 18, status, pay_date: null, notes: '', ...x });
  exp(cArch, '01.01', 'א.ר. אדריכלים (דמו)', 870000, 'paid', '2026-06-30', 'תכנון: שלבים א-ג');
  exp(cArch, '01.01', 'א.ר. אדריכלים (דמו)', 145000, 'invoice', '2026-10-05', 'תכנון: שלב ד');
  exp(cStr, '01.02', 'מ.ק. הנדסת מבנים (דמו)', 320000, 'paid', '2026-07-31', 'תכנון קונסטרוקציה');
  exp(null, '02.01', 'עיריית רחובות (דמו)', 3410000, 'paid', '2026-02-15', 'אגרות והיטל השבחה', { kind: 'general' });
  exp(cShore, '03.01', 'ד.ח. דיפון וביסוס (דמו)', 2424000, 'paid', '2026-04-30', 'חשבון 1-3 דיפון');
  exp(cShore, '03.03', 'ד.ח. דיפון וביסוס (דמו)', 1664000, 'paid', '2026-06-30', 'חשבון 4-5 חפירה');
  exp(cShore, null, 'ד.ח. דיפון וביסוס (דמו)', 216000, 'approved', '2026-07-31', 'פינוי קרקע מזוהמת');
  exp(cElev, '07.04', 'ע.מ. מעליות (דמו)', 412000, 'paid', '2026-05-20', 'מקדמה 20% מעליות');
  exp(null, null, 'שמירה ואבטחה דמו', 96000, 'paid', '2026-09-30', 'שמירה באתר ינואר-ספטמבר', { kind: 'general' });

  // ===== הוראות שינוי =====
  const cl = (cid, code) => T.contract_lines.find(l => l.contract_id === cid && l.code === code);
  const co = (x, lines) => {
    const id = uuid();
    T.change_orders.push({ id, tenant_id: t, project_id: pid, contract_id: null, vendor_name: null, boq_item_id: null, number: null, title: '', initiator: 'developer', initiator_name: null, reason: null, schedule_days: 0, stage: 'request',
      request_date: null, approved_date: null, approved_by: null, approval_ref: null, executed_date: null, price_analysis: null, decision_note: null, notes: null, ...x, boq_item_id: x.item ? items[x.item] : null });
    delete T.change_orders.at(-1).item;
    lines.forEach(([ln, description, unit, qty, price_sale, price_contract, price_requested, price_approved], k) => T.co_lines.push({ id: uuid(), tenant_id: t, project_id: pid, co_id: id, contract_line_id: ln?.id || null,
      description, unit, qty, price_sale, price_contract, price_requested, price_approved, sort: k }));
    return id;
  };
  const MAIN = 'ש.ב. בנייה וביצוע (דמו)';
  co({ contract_id: cMain, vendor_name: MAIN, item: '04.01', number: 'CO-01', title: 'חיזוק תקרת חניון לעומס רכב כיבוי', initiator: 'authority', initiator_name: 'רשות הכבאות', reason: 'דרישת כבאות בהיתר: רכב כיבוי על תקרת החניון',
    schedule_days: 7, stage: 'executed', request_date: '2026-07-20', approved_date: '2026-08-10', approved_by: 'דנה ש.', approval_ref: 'מכתב יזם 14/8', executed_date: '2026-09-15', decision_note: 'אושר במחירי החוזה' },
    [[cl(cMain, '04.01'), 'בטון נוסף לעיבוי תקרה', 'מ"ק', 120, 1650, 1620, 1700, 1620], [cl(cMain, '04.03'), 'פלדת זיון נוספת', 'טון', 18, 5400, 5600, 5900, 5600]]);
  co({ contract_id: cMain, vendor_name: MAIN, item: '04.02', number: 'CO-02', title: 'שינוי פתחים בקירות בטון בדירות 12-14', initiator: 'buyer', initiator_name: 'רוכשי דירות 12-14', reason: 'בקשת רוכשים לאיחוד חדרים',
    schedule_days: 3, stage: 'executed', request_date: '2026-09-01', executed_date: '2026-09-25', decision_note: 'לגבות מהרוכשים לפני אישור' },
    [[cl(cMain, '04.02'), 'קירות בטון: פירוק ויציקה מחדש', 'מ"ק', 35, 1850, 1820, 1950, null]]);
  co({ contract_id: cShore, vendor_name: 'ד.ח. דיפון וביסוס (דמו)', item: '03.01', number: 'CO-03', title: 'מסלעה בגבול המזרחי', initiator: 'consultant', initiator_name: 'יועץ הקרקע', reason: 'שכבת סלע לא צפויה בצד המזרחי',
    schedule_days: 10, stage: 'pricing', request_date: '2026-10-12' },
    [[null, 'קיר מסלעה', 'מ"ר', 140, null, null, 780, null]]);
  co({ contract_id: cAlu, vendor_name: 'ק.ל. אלומיניום (דמו)', item: '06.01', number: 'CO-04', title: 'זכוכית אקוסטית בחזית לרחוב', initiator: 'architect', initiator_name: 'א.ר. אדריכלים', reason: 'דרישה בהיתר לאחר סקר רעש',
    schedule_days: 0, stage: 'approved', request_date: '2026-07-01', approved_date: '2026-07-20', approved_by: 'דנה ש.', approval_ref: 'פרוטוקול 7', price_analysis: 'לפי 3 הצעות ספקי זכוכית: 105-128 ₪ למ"ר' },
    [[null, 'תוספת לזכוכית אקוסטית', 'מ"ר', 1800, 140, null, 125, 110]]);
  co({ contract_id: cMain, vendor_name: MAIN, item: '05.02', number: 'CO-05', title: 'החלפת ריצוף לובי לשיש', initiator: 'developer', reason: 'שדרוג לובי', stage: 'rejected', request_date: '2026-08-01', decision_note: 'נדחה: חריגה מהתקציב' },
    [[null, 'שיש בלובי', 'מ"ר', 220, 330, null, 690, null]]);

  // ===== חשבונות קבלנים (מצטברים) =====
  const cbill = (contract_id, x, lines) => {
    const id = uuid();
    T.cbills.push({ id, tenant_id: t, project_id: pid, contract_id, number: 1, period_to: null, received_date: null, invoice_no: null, invoice_date: null, invoice_legal: false, status: 'received', index_value: null, other_deductions: 0, other_note: null,
      checked_by: null, recommended_date: null, approved_date: null, paid_date: null, doc_override: null, notes: null, ...x });
    for (const [ln, cum_qty_sub, cum_qty_app = null, price_sub = null, note = null] of lines) T.cbill_lines.push({ id: uuid(), tenant_id: t, project_id: pid, cbill_id: id, contract_line_id: ln.contract_id ? ln.id : null, co_line_id: ln.co_id ? ln.id : null, cum_qty_sub, price_sub, cum_qty_app, note });
    return id;
  };
  const L = code => cl(cMain, code), CO = num => T.co_lines.filter(l => l.co_id === T.change_orders.find(c => c.number === num).id);
  cbill(cMain, { number: 1, period_to: '2026-05-31', received_date: '2026-06-03', invoice_no: 'SB-101', invoice_date: '2026-07-20', invoice_legal: true, status: 'paid', recommended_date: '2026-06-12', approved_date: '2026-06-15', paid_date: '2026-07-20' },
    [[L('04.01'), 1500], [L('04.03'), 220]]);
  cbill(cMain, { number: 2, period_to: '2026-07-31', received_date: '2026-08-04', invoice_no: 'SB-102', invoice_date: '2026-09-15', invoice_legal: true, status: 'paid', recommended_date: '2026-08-12', approved_date: '2026-08-14', paid_date: '2026-09-15' },
    [[L('04.01'), 3000], [L('04.02'), 400], [L('04.03'), 450]]);
  cbill(cMain, { number: 3, period_to: '2026-08-31', received_date: '2026-09-03', invoice_no: 'SB-103', invoice_legal: true, status: 'approved', recommended_date: '2026-09-11', approved_date: '2026-09-14' },
    [[L('04.01'), 4300, 4200, null, 'לפי מדידת הפיקוח'], [L('04.02'), 900], [L('04.03'), 640]]);
  // חשבון 4: ממתין לבדיקה. מחיר פלדה שונה מהחוזה, הוראת שינוי שלא אושרה, וחשבונית שעוד לא התקבלה
  cbill(cMain, { number: 4, period_to: '2026-09-30', received_date: '2026-10-05', invoice_no: 'SB-104', status: 'checked', checked_by: 'יונתן' },
    [[L('04.01'), 5600, 5400, null, 'מדידת פיקוח: 5,400 מ"ק'], [L('04.02'), 1300], [L('04.03'), 820, null, 5750], [L('04.04'), 3000],
     [CO('CO-01')[0], 120], [CO('CO-01')[1], 18], [CO('CO-02')[0], 35]]);
  // אלומיניום: חשבון ראשון, לספק חסרים מסמכים (ביטוח פג, אין רישיון ואישור ניכוי מס)
  cbill(cAlu, { number: 1, period_to: '2026-09-30', received_date: '2026-10-08', invoice_no: 'KL-55', status: 'received' }, [[cl(cAlu, '06.01'), 800]]);
  // הוצאה (רישום התשלום) לכל חשבון שאושר
  for (const c of T.contracts.filter(c => c.project_id === pid)) {
    const R = contractBills({ contract: c, cLines: T.contract_lines, cos: T.change_orders, coLines: T.co_lines, bills: T.cbills, bLines: T.cbill_lines, vatPct: 18 });
    for (const x of R.bills.filter(x => ['approved', 'paid'].includes(x.bill.status)))
      exp(c.id, null, c.vendor_name, Math.round(x.net), x.bill.status, x.bill.invoice_date || x.bill.approved_date, `חשבון ${x.bill.number} · ${c.title}`, { cbill_id: x.bill.id, doc_no: x.bill.invoice_no, pay_date: x.bill.paid_date || null });
  }

  // ===== הכנסות היזם: רוכשים, בנק מלווה, הון עצמי =====
  const inc = (source, payer, description, due_date, amount, status = 'expected', x = {}) => T.dev_income.push({ id: uuid(), tenant_id: t, project_id: pid, source, payer, description, due_date, amount, status,
    received_date: status === 'received' ? due_date : null, received_amount: status === 'received' ? amount : null, notes: null, ...x });
  inc('equity', 'קבוצת הדקל', 'הון עצמי', '2026-01-10', 15000000, 'received');
  [['2026-02-15', 1680000], ['2026-04-15', 2240000], ['2026-06-15', 1120000], ['2026-08-15', 1680000]].forEach(([d, a], k) => inc('buyer', 'רוכשים', `מקדמות חוזי מכר (סבב ${k + 1})`, d, a, 'received'));
  inc('bank', 'בנק דמו (ליווי)', 'משיכה 1 לפי דוח שמאי', '2026-06-20', 8000000, 'received');
  inc('bank', 'בנק דמו (ליווי)', 'משיכה 2 לפי דוח שמאי', '2026-09-20', 6000000, 'received');
  inc('buyer', 'משפחת לוי (דירה 14)', 'תשלום שני לפי חוזה', '2026-10-15', 480000);
  // רוכשים: תשלום חודשי לפי התקדמות עד המסירה; בנק: משיכה כל חודשיים לפי דוח שמאי
  for (let k = 0, m = '2026-11'; m <= '2028-06'; k++, m = new Date(Date.UTC(+m.slice(0, 4), +m.slice(5) , 1)).toISOString().slice(0, 7))
    inc('buyer', 'רוכשים', 'תשלומים לפי התקדמות', m + '-15', 900000 + Math.min(k, 12) * 50000);
  for (let k = 0, m = '2027-01'; m <= '2028-05'; k++, m = new Date(Date.UTC(+m.slice(0, 4), +m.slice(5) + 1, 1)).toISOString().slice(0, 7))
    inc('bank', 'בנק דמו (ליווי)', `משיכה ${k + 3} לפי דוח שמאי`, m + '-20', 6500000);

  // מצב התרעות: אחת בטיפול עם החלטה שנוסחה ללקוח, אחת שטופלה
  T.alert_state.push({ id: uuid(), tenant_id: t, project_id: pid, key: `dev|${pid}|total_over_baseline|עלות הפרויקט מעל הבסיס המאושר`, title: 'עלות הפרויקט מעל הבסיס המאושר', status: 'in_progress',
    decision: 'לאשר בישיבת ההנהלה את הצפי המעודכן, או לבחור בין החלפת מפרט האלומיניום לבין קיצוץ בגמרים', note: 'עלה בישיבה 27.10', updated_by: 'demo', updated_at: '2026-10-27T12:00:00.000Z' });
  T.alert_state.push({ id: uuid(), tenant_id: t, project_id: pid, key: `dev|${pid}|outside_budget|התקשרות בלי סעיף תקציב: דיפון, עוגנים וחפירה`, title: 'התקשרות בלי סעיף תקציב: דיפון, עוגנים וחפירה', status: 'handled',
    decision: 'לאשר פינוי קרקע מזוהמת כתוספת לפרק 03', note: 'אושר ע"י היזם 20.10', updated_by: 'demo', updated_at: '2026-10-20T12:00:00.000Z' });

  // מסמכים וערבויות לקבלנים
  const doc = x => T.documents.push({ id: uuid(), tenant_id: t, main_contractor_id: null, project_id: null, title: null, number: null, issue_date: null, link: null, notes: null, ...x });
  const vMain = T.vendors.find(v => v.name.startsWith('ש.ב.')).id, vAlu = T.vendors.find(v => v.name.startsWith('ק.ל.')).id;
  doc({ vendor_id: vMain, doc_type: 'insurance', title: 'ביטוח עבודות קבלניות', expiry: '2027-03-31' }); doc({ vendor_id: vMain, doc_type: 'license', expiry: '2027-06-30' }); doc({ vendor_id: vMain, doc_type: 'books', expiry: '2027-03-31' }); doc({ vendor_id: vMain, doc_type: 'tax', expiry: '2026-11-10' });
  doc({ vendor_id: vAlu, doc_type: 'insurance', expiry: '2026-09-30' }); doc({ vendor_id: vAlu, doc_type: 'books', expiry: '2027-03-31' });
  T.guarantees.push({ id: uuid(), tenant_id: t, project_id: pid, main_contractor_id: null, vendor_id: vMain, contract_id: cMain, kind: 'advance', bank: 'בנק דמו', number: 'G-5001', amount: 2000000, issue_date: '2026-03-01', expiry: '2026-12-31', status: 'active', returned_date: null, notes: 'ערבות מקדמה של הקבלן הראשי' });
  T.guarantees.push({ id: uuid(), tenant_id: t, project_id: pid, main_contractor_id: null, vendor_id: vMain, contract_id: cMain, kind: 'performance', bank: 'בנק דמו', number: 'G-5002', amount: 3500000, issue_date: '2026-03-01', expiry: '2027-12-31', status: 'active', returned_date: null, notes: null });
  T.contacts.push({ id: uuid(), tenant_id: t, name: 'דנה ש. (דמו)', company: 'קבוצת הדקל יזמות', role: 'סמנכ"לית כספים', phone: '050-3000000', phone2: null, email: 'dekel.demo@example.com', vendor_id: null, main_contractor_id: null, notes: null });
  return t;
}
