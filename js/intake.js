// קליטה חכמה של מסמכים: סוגי מסמכים, הקשר שנשלח ל-Claude, פענוח התשובה ובדיקות התאמה.
// פונקציות טהורות (בלי DOM ובלי גישה לנתונים), כדי שאפשר לבדוק אותן לבד.
import { n } from './calc.js';

export const INTAKE_TYPES = {
  invoice: { label: 'חשבונית ספק / קבלן ביצוע', folder: 'חשבוניות', stage: 1 },
  delivery: { label: 'תעודת משלוח', folder: 'תעודות משלוח', stage: 1 },
  po: { label: 'הזמנת רכש לספק', folder: 'הזמנות רכש', stage: 1 },
  contract: { label: 'חוזה עם קבלן ראשי', folder: 'חוזים', stage: 2 },
  boq: { label: 'כתב כמויות', folder: 'כתבי כמויות', stage: 2 },
  vo: { label: 'הוראת שינוי', folder: 'הוראות שינוי', stage: 2 },
  approved_bill: { label: 'חשבון מאושר מהקבלן הראשי', folder: 'חשבונות', stage: 2 },
  payment: { label: 'תשלום מהקבלן הראשי', folder: 'תשלומים', stage: 2 },
  vendor_doc: { label: 'אישור (ביטוח, ניכוי מס, ניהול ספרים, רישיון)', folder: 'אישורים', stage: 3 },
  guarantee: { label: 'ערבות בנקאית', folder: 'ערבויות', stage: 3 },
  worker: { label: 'פרטי עובד', folder: 'עובדים', stage: 3 },
  other: { label: 'מסמך אחר (שמירה בלבד)', folder: 'מסמכים', stage: 0 }
};

const s = v => String(v ?? '').replace(/[|\n\r]+/g, ' ').trim();
const ACTIVE = p => p.status !== 'closed';

// הקשר מקוצר: מזהים קצרים (P1, V3, O2, I14) במקום מזהי מערכת, כדי שהמודל יבחר מתוך רשימה ולא ימציא
export function buildContext(data, { projectId = null, maxItems = 500 } = {}) {
  const map = {}; const L = [];
  const projects = data.projects.filter(p => p.id === projectId || (!projectId && ACTIVE(p)));
  const mcName = id => data.mcs?.find(m => m.id === id)?.name || '';
  L.push('פרויקטים (מזהה|שם|כתובת|קבלן ראשי):');
  projects.forEach((p, i) => { const k = 'P' + (i + 1); map[k] = { t: 'project', id: p.id }; L.push(`${k}|${s(p.name)}|${s(p.address)}|${s(mcName(p.main_contractor_id))}`); });
  L.push('קבלנים ראשיים (מזהה|שם|ח.פ.):');
  (data.mcs || []).forEach((m, i) => { const k = 'M' + (i + 1); map[k] = { t: 'mc', id: m.id }; L.push(`${k}|${s(m.name)}|${s(m.company_no)}`); });
  L.push('ספקים וקבלני ביצוע (מזהה|שם|ח.פ.):');
  const names = new Map();
  (data.vendors || []).forEach(v => names.set(v.name.trim(), { id: v.id, company_no: v.company_no }));
  for (const e of [...(data.expenses || []), ...(data.pos || [])]) if (e.supplier_name && !names.has(e.supplier_name.trim())) names.set(e.supplier_name.trim(), { id: null });
  [...names.entries()].forEach(([name, v], i) => { const k = 'V' + (i + 1); map[k] = { t: 'vendor', id: v.id, name }; L.push(`${k}|${s(name)}|${s(v.company_no)}`); });
  const pids = new Set(projects.map(p => p.id));
  const pk = id => Object.keys(map).find(k => map[k].t === 'project' && map[k].id === id) || '';
  L.push('הזמנות רכש פתוחות (מזהה|פרויקט|מספר|ספק|שורות: מזהה שורה=תיאור;כמות;יחידה;מחיר;סופק):');
  (data.pos || []).filter(po => pids.has(po.project_id) && po.status !== 'cancelled').forEach((po, i) => {
    const k = 'O' + (i + 1); map[k] = { t: 'po', id: po.id };
    const ls = (data.poLines || []).filter(l => l.po_id === po.id).map((l, j) => { const lk = `${k}.${j + 1}`; map[lk] = { t: 'po_line', id: l.id }; return `${lk}=${s(l.description)};${n(l.qty)};${s(l.unit)};${n(l.unit_price)};${n(l.delivered_qty)}`; });
    L.push(`${k}|${pk(po.project_id)}|${s(po.number)}|${s(po.supplier_name)}|${ls.join(' / ')}`);
  });
  L.push('סעיפי כתב הכמויות (מזהה|פרויקט|קוד|תיאור|יחידה):');
  (data.items || []).filter(it => pids.has(it.project_id)).slice(0, maxItems).forEach((it, i) => { const k = 'I' + (i + 1); map[k] = { t: 'item', id: it.id }; L.push(`${k}|${pk(it.project_id)}|${s(it.code)}|${s(it.description).slice(0, 70)}|${s(it.unit)}`); });
  L.push('הוראות שינוי קיימות (מזהה|פרויקט|מספר|נושא):');
  (data.vos || []).filter(v => pids.has(v.project_id)).forEach((v, i) => { const k = 'C' + (i + 1); map[k] = { t: 'vo', id: v.id }; L.push(`${k}|${pk(v.project_id)}|${s(v.number)}|${s(v.title)}`); });
  L.push('חשבונות לקבלן הראשי (מזהה|פרויקט|מספר חשבון|עד תאריך):');
  (data.bills || []).filter(b => pids.has(b.project_id)).forEach((b, i) => { const k = 'B' + (i + 1); map[k] = { t: 'bill', id: b.id }; L.push(`${k}|${pk(b.project_id)}|${b.number}|${s(b.period_to)}`); });
  return { text: L.join('\n'), map };
}

const SHAPE = `{
 "doc_type": "invoice|delivery|po|contract|boq|vo|approved_bill|payment|vendor_doc|guarantee|worker|other",
 "confidence": 0.0-1.0,
 "summary": "משפט אחד בעברית: מה המסמך",
 "project": "P? או null", "vendor": "V? או null", "vendor_name": "שם הספק כפי שמופיע במסמך", "vendor_company_no": "ח.פ./ע.מ.",
 "main_contractor": "M? או null", "main_contractor_name": "",
 "doc_no": "", "doc_date": "YYYY-MM-DD", "due_date": "YYYY-MM-DD",
 "po": "O? או null", "po_number": "", "delivery_notes": ["מספרי תעודות משלוח שמוזכרים"],
 "amount_net": 0, "vat_pct": 18, "amount_total": 0,
 "lines": [{"description": "", "qty": 0, "unit": "", "unit_price": 0, "total": 0, "code": "", "item": "I? או null", "po_line": "O?.? או null"}],
 "contract": {"project_name": "", "address": "", "contract_type": "measure|milestones|percent|mixed", "contract_total": 0, "pay_terms_days": 0, "retention_pct": 0, "retention_cap": 0, "insurance_pct": 0, "shared_pct": 0, "indexation": false, "base_index": 0, "start_date": "", "end_date": "", "owner_name": "", "guarantees": [{"kind": "performance|advance|warranty|other", "pct": 0, "amount": 0}]},
 "vo": {"vo": "C? אם זו הוראה קיימת, אחרת null", "number": "", "title": "", "source": "change_order|supervisor|main_request|daywork", "has_written_order": true, "signed": false, "amount": 0},
 "bill": {"bill": "B? או null", "number": 0, "period_to": "", "approved_total": 0, "lines": [{"item": "I?", "code": "", "cum_qty_app": 0, "cut_reason": ""}], "fines": [{"description": "", "amount": 0}]},
 "payment": {"bill": "B? או null", "bill_number": 0, "amount": 0, "date": "", "method": ""},
 "vendor_doc": {"owner": "vendor|own", "doc_type": "insurance|license|books|tax|safety|other", "number": "", "issue_date": "", "expiry": ""},
 "guarantee": {"kind": "performance|advance|warranty|tender|other", "bank": "", "number": "", "amount": 0, "issue_date": "", "expiry": ""},
 "worker": {"name": "", "id_no": "", "phone": "", "trade": "", "pay_type": "salary|daily|hourly|piece", "rate": 0, "is_foreign": false},
 "warnings": ["דברים חשודים או לא ברורים במסמך"]
}`;

export function buildPrompt(ctx, { hint = null, fileName = '' } = {}) {
  const system = `את/ה מקליד/ה מסמכים במשרד של קבלן משנה בבנייה בישראל (גבס, תקרות, גמרים וכו'). קוראים מסמך אחד ומחזירים JSON בלבד, בלי טקסט נוסף.
כללים:
- מספרים: בלי פסיקים ובלי ₪. סכומים לפני מע"מ ב-amount_net. תאריכים YYYY-MM-DD (תאריכים ישראליים הם יום/חודש/שנה).
- שיוך: בוחרים מזהה מהרשימות שבהקשר (P1, V2, O3, O3.1, I14, C2, B1) רק כשההתאמה ברורה. אם אין התאמה: null. לא ממציאים מזהים.
- ספק: אם הספק לא ברשימה, vendor=null ו-vendor_name כפי שמופיע במסמך.
- קבלן המשנה הוא הלקוח שלנו. במסמכים מול הקבלן הראשי (חוזה, הוראת שינוי, חשבון מאושר, תשלום) הצד השני הוא הקבלן הראשי.
- חשבונית: כל שורה עם כמות, יחידה ומחיר. אם יש הזמנה או תעודת משלוח קשורה, מציינים.
- תעודת משלוח: הכמויות שסופקו בפועל, וכל שורה משויכת לשורת הזמנה (po_line) אם אפשר.
- חוזה: ממלאים את contract. כתב כמויות: כל סעיף כשורה ב-lines עם code, תיאור, כמות, יחידה ומחיר יחידה.
- חשבון מאושר: הכמויות המצטברות שאושרו לכל סעיף, קיצוצים עם הסיבה, וקנסות או קיזוזים.
- שדות שלא רלוונטיים לסוג המסמך: משמיטים.
- warnings: כל דבר שנראה לא תקין (סכום שלא מסתכם, מסמך לא חתום, תאריך תוקף שעבר, כפילות).
מבנה התשובה:
${SHAPE}`;
  const user = `${hint ? `המשתמש סימן שזה: ${INTAKE_TYPES[hint]?.label || hint}.\n` : ''}${fileName ? `שם הקובץ: ${fileName}\n` : ''}הקשר מהמערכת:\n${ctx.text}\n\nקרא/י את המסמך המצורף והחזר/י JSON לפי המבנה.`;
  return { system, user };
}

// חילוץ JSON מהתשובה (גם אם עטוף ב-```json)
export function extractJson(text) {
  const t = String(text || '');
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(t);
  const body = fence ? fence[1] : t;
  const a = body.indexOf('{'), b = body.lastIndexOf('}');
  if (a < 0 || b <= a) throw new Error('התשובה לא הייתה בפורמט הצפוי');
  return JSON.parse(body.slice(a, b + 1));
}

const num = v => (v === null || v === undefined || v === '' ? null : n(v));
const date = v => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v || '')); if (m) return m[0];
  const il = /^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/.exec(String(v || '').trim()); if (!il) return null;
  const y = il[3].length === 2 ? '20' + il[3] : il[3]; return `${y}-${il[2].padStart(2, '0')}-${il[1].padStart(2, '0')}`; };

// תרגום מזהים קצרים חזרה למזהי מערכת וניקוי ערכים
export function normalize(raw, map) {
  const ref = (k, t) => (k && map[k] && map[k].t === t ? map[k].id : null);
  const r = raw || {};
  const type = INTAKE_TYPES[r.doc_type] ? r.doc_type : 'other';
  const vk = r.vendor && map[r.vendor]?.t === 'vendor' ? map[r.vendor] : null;
  const out = {
    doc_type: type, confidence: Math.max(0, Math.min(1, n(r.confidence))), summary: s(r.summary),
    project_id: ref(r.project, 'project'), vendor_id: vk?.id || null, vendor_name: s(vk?.name || r.vendor_name), vendor_company_no: s(r.vendor_company_no),
    main_contractor_id: ref(r.main_contractor, 'mc'), main_contractor_name: s(r.main_contractor_name),
    doc_no: s(r.doc_no), doc_date: date(r.doc_date), due_date: date(r.due_date),
    po_id: ref(r.po, 'po'), po_number: s(r.po_number), delivery_notes: (r.delivery_notes || []).map(s).filter(Boolean),
    amount_net: num(r.amount_net), vat_pct: r.vat_pct === undefined || r.vat_pct === null ? 18 : n(r.vat_pct), amount_total: num(r.amount_total),
    lines: (r.lines || []).map(l => ({ description: s(l.description), qty: num(l.qty), unit: s(l.unit), unit_price: num(l.unit_price), total: num(l.total), code: s(l.code),
      item_id: ref(l.item, 'item'), po_line_id: ref(l.po_line, 'po_line') })),
    warnings: (r.warnings || []).map(s).filter(Boolean)
  };
  for (const l of out.lines) if (l.total === null && l.qty !== null && l.unit_price !== null) l.total = Math.round(l.qty * l.unit_price * 100) / 100;
  if (out.amount_net === null && out.lines.length) out.amount_net = Math.round(out.lines.reduce((a, l) => a + n(l.total), 0) * 100) / 100;
  if (r.contract) { const c = r.contract; out.contract = { project_name: s(c.project_name), address: s(c.address), owner_name: s(c.owner_name), contract_type: ['measure', 'milestones', 'percent', 'mixed'].includes(c.contract_type) ? c.contract_type : 'measure',
    contract_total: num(c.contract_total), pay_terms_days: num(c.pay_terms_days), retention_pct: num(c.retention_pct), retention_cap: num(c.retention_cap), insurance_pct: num(c.insurance_pct), shared_pct: num(c.shared_pct),
    indexation: !!c.indexation, base_index: num(c.base_index), start_date: date(c.start_date), end_date: date(c.end_date), guarantees: (c.guarantees || []).map(g => ({ kind: g.kind || 'other', pct: num(g.pct), amount: num(g.amount) })) }; }
  if (r.vo) { const v = r.vo; out.vo = { vo_id: ref(v.vo, 'vo'), number: s(v.number), title: s(v.title), source: ['change_order', 'supervisor', 'main_request', 'daywork'].includes(v.source) ? v.source : 'change_order', has_written_order: v.has_written_order !== false, signed: !!v.signed, amount: num(v.amount) }; }
  if (r.bill) { const b = r.bill; out.bill = { bill_id: ref(b.bill, 'bill'), number: num(b.number), period_to: date(b.period_to), approved_total: num(b.approved_total),
    lines: (b.lines || []).map(l => ({ item_id: ref(l.item, 'item'), code: s(l.code), cum_qty_app: num(l.cum_qty_app), cut_reason: s(l.cut_reason) })), fines: (b.fines || []).map(f => ({ description: s(f.description), amount: num(f.amount) })).filter(f => f.amount) }; }
  if (r.payment) { const p = r.payment; out.payment = { bill_id: ref(p.bill, 'bill'), bill_number: num(p.bill_number), amount: num(p.amount), date: date(p.date), method: s(p.method) }; }
  if (r.vendor_doc) { const d = r.vendor_doc; out.vendor_doc = { owner: d.owner === 'own' ? 'own' : 'vendor', doc_type: ['insurance', 'license', 'books', 'tax', 'safety'].includes(d.doc_type) ? d.doc_type : 'other', number: s(d.number), issue_date: date(d.issue_date), expiry: date(d.expiry) }; }
  if (r.guarantee) { const g = r.guarantee; out.guarantee = { kind: ['performance', 'advance', 'warranty', 'tender'].includes(g.kind) ? g.kind : 'other', bank: s(g.bank), number: s(g.number), amount: num(g.amount), issue_date: date(g.issue_date), expiry: date(g.expiry) }; }
  if (r.worker) { const w = r.worker; out.worker = { name: s(w.name), id_no: s(w.id_no), phone: s(w.phone), trade: s(w.trade), pay_type: ['salary', 'daily', 'hourly', 'piece'].includes(w.pay_type) ? w.pay_type : 'daily', rate: num(w.rate), is_foreign: !!w.is_foreign }; }
  return out;
}

// התאמה מקומית כשהמודל לא שייך: הזמנה לפי מספר, ספק לפי שם או ח.פ.
export function fillMatches(doc, data) {
  const d = { ...doc };
  const norm = x => String(x || '').replace(/["'״׳.,\-\s]|בע"?מ/g, '').toLowerCase();
  if (!d.vendor_id && (d.vendor_name || d.vendor_company_no)) {
    const v = (data.vendors || []).find(v => (d.vendor_company_no && String(v.company_no || '').replace(/\D/g, '') === d.vendor_company_no.replace(/\D/g, '')) || (d.vendor_name && norm(v.name) === norm(d.vendor_name)));
    if (v) { d.vendor_id = v.id; d.vendor_name = v.name; }
  }
  if (!d.po_id && d.po_number) { const po = (data.pos || []).find(p => String(p.number || '').trim() === d.po_number.trim() && (!d.project_id || p.project_id === d.project_id)); if (po) d.po_id = po.id; }
  if (d.po_id && !d.project_id) d.project_id = (data.pos || []).find(p => p.id === d.po_id)?.project_id || null;
  if (d.po_id && !d.vendor_name) d.vendor_name = (data.pos || []).find(p => p.id === d.po_id)?.supplier_name || '';
  if (!d.main_contractor_id && d.main_contractor_name) { const m = (data.mcs || []).find(m => norm(m.name) === norm(d.main_contractor_name)); if (m) d.main_contractor_id = m.id; }
  // סעיף לפי שורת ההזמנה
  for (const l of d.lines || []) if (!l.item_id && l.po_line_id) l.item_id = (data.poLines || []).find(x => x.id === l.po_line_id)?.boq_item_id || null;
  // סעיף לפי קוד, אם הפרויקט ידוע
  if (d.project_id) for (const l of d.lines || []) if (!l.item_id && l.code) l.item_id = (data.items || []).find(i => i.project_id === d.project_id && String(i.code).trim() === l.code)?.id || null;
  return d;
}

// בדיקות לפני קליטה: מחזיר אזהרות בעברית
export function checks(doc, data) {
  const W = [];
  const sup = String(doc.vendor_name || '').trim();
  if (['invoice', 'po', 'delivery', 'vo', 'approved_bill', 'payment', 'boq'].includes(doc.doc_type) && !doc.project_id) W.push('לא נבחר פרויקט');
  if (doc.doc_type === 'invoice') {
    if (doc.doc_no && (data.expenses || []).some(e => String(e.doc_no || '').trim() === doc.doc_no && String(e.supplier_name || '').trim() === sup)) W.push(`חשבונית ${doc.doc_no} של ${sup} כבר קיימת במערכת`);
    const sumLines = (doc.lines || []).reduce((a, l) => a + n(l.total), 0);
    if (doc.lines?.length && doc.amount_net && Math.abs(sumLines - doc.amount_net) > Math.max(1, doc.amount_net * 0.005)) W.push(`סכום השורות (${Math.round(sumLines).toLocaleString('en-US')}) לא שווה לסכום החשבונית (${Math.round(doc.amount_net).toLocaleString('en-US')})`);
    if (doc.po_id) {
      const ls = (data.poLines || []).filter(l => l.po_id === doc.po_id);
      const delivered = ls.reduce((a, l) => a + n(l.delivered_qty) * n(l.unit_price), 0);
      const invoiced = (data.expenses || []).filter(e => e.po_id === doc.po_id).reduce((a, e) => a + n(e.amount), 0);
      if (delivered > 0 && invoiced + n(doc.amount_net) > delivered + 1) W.push(`החשבונית מביאה את החיוב על ההזמנה ל-${Math.round(invoiced + n(doc.amount_net)).toLocaleString('en-US')} ₪, יותר ממה שסופק (${Math.round(delivered).toLocaleString('en-US')} ₪)`);
      for (const l of doc.lines || []) { const pl = ls.find(x => x.id === l.po_line_id); if (pl && l.unit_price !== null && Math.abs(n(l.unit_price) - n(pl.unit_price)) > 0.01) W.push(`מחיר ${l.description || pl.description}: ${l.unit_price} בחשבונית מול ${pl.unit_price} בהזמנה`);
        if (pl && l.qty !== null && n(l.qty) > n(pl.delivered_qty) + 1e-6) W.push(`${l.description || pl.description}: חויבו ${l.qty} ${pl.unit || ''}, סופקו ${n(pl.delivered_qty)}`); }
    }
  }
  if (doc.doc_type === 'delivery') {
    if (!doc.po_id) W.push('לא נמצאה הזמנה מתאימה. אפשר לבחור הזמנה או ליצור חדשה');
    else for (const l of doc.lines || []) { const pl = (data.poLines || []).find(x => x.id === l.po_line_id); if (pl && n(pl.delivered_qty) + n(l.qty) > n(pl.qty) + 1e-6) W.push(`${pl.description}: עם התעודה הזו סופקו ${n(pl.delivered_qty) + n(l.qty)} מתוך ${n(pl.qty)} שהוזמנו`); }
    if (doc.doc_no && (data.pos || []).some(p => String(p.delivery_notes || '').split(/[,\s]+/).includes(doc.doc_no))) W.push(`תעודת משלוח ${doc.doc_no} כבר נקלטה`);
  }
  if (doc.doc_type === 'vo' && doc.vo && !doc.vo.signed) W.push('הוראת השינוי לא חתומה. כדאי להשיג חתימה לפני הביצוע');
  if (doc.doc_type === 'vendor_doc' && doc.vendor_doc?.expiry && doc.vendor_doc.expiry < new Date().toISOString().slice(0, 10)) W.push('תוקף האישור כבר עבר');
  if (doc.doc_type === 'guarantee' && doc.guarantee?.expiry && doc.guarantee.expiry < new Date().toISOString().slice(0, 10)) W.push('תוקף הערבות כבר עבר');
  if (['invoice', 'delivery'].includes(doc.doc_type) && sup && !doc.vendor_id && !(data.expenses || []).some(e => String(e.supplier_name || '').trim() === sup)) W.push(`ספק חדש: ${sup}. כדאי לפתוח לו כרטיס עם מסמכים`);
  return [...new Set([...(doc.warnings || []), ...W])];
}

// המרת קובץ לבקשה: PDF ותמונה נשלחים כקובץ, אקסל/CSV/Word כטקסט
export const fileKind = (name, mime) => {
  const e = (/\.([a-z0-9]+)$/i.exec(name || '')?.[1] || '').toLowerCase();
  if (mime === 'application/pdf' || e === 'pdf') return 'pdf';
  if (/^image\/(jpeg|png|gif|webp)$/.test(mime || '') || ['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(e)) return 'image';
  if (['xlsx', 'xls', 'csv'].includes(e)) return 'sheet';
  if (e === 'docx') return 'docx';
  if (['txt', 'eml'].includes(e)) return 'text';
  return 'other';
};
