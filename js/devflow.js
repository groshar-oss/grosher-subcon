// פרויקט יזם: הוראות שינוי (6 שלבים) וחשבונות קבלנים (בדיקה והמלצה לתשלום). פונקציות טהורות.
import { n } from './calc.js';

export const CO_STEPS = ['request', 'pricing', 'approved', 'executed', 'billed', 'paid'];
export const CO_STAGES = { request: 'בקשה', pricing: 'בדיקה ותמחור', approved: 'אושר בכתב', executed: 'בוצע ונמדד', billed: 'נכלל בחשבון', paid: 'שולם', rejected: 'נדחה' };
// שלבים שהמשתמש קובע. "נכלל בחשבון" ו"שולם" נקבעים לבד לפי חשבונות הקבלן
export const CO_MANUAL = ['request', 'pricing', 'approved', 'executed', 'rejected'];
export const CO_INITIATORS = { developer: 'היזם', architect: 'אדריכל / מתכנן', consultant: 'יועץ', contractor: 'קבלן', authority: 'רשות', buyer: 'רוכש / דייר', other: 'אחר' };
export const CBILL_STATUS = { received: 'התקבל', checked: 'נבדק', recommended: 'הומלץ לתשלום', approved: 'אושר ע"י היזם', paid: 'שולם' };
export const CBILL_STEPS = ['received', 'checked', 'recommended', 'approved', 'paid'];
export const CBILL_APPROVED = ['approved', 'paid'];
export const NOT_BILLED_DAYS = 60;
const EPS = 1e-6;
const has = v => v !== null && v !== undefined && v !== '';
const days = (a, b) => Math.round((new Date(a) - new Date(b)) / 864e5);

// הוראת שינוי מאושרת = יש תאריך אישור בכתב ולא נדחתה
export const coApproved = co => co.stage !== 'rejected' && !!co.approved_date;
// מחיר מאושר לשורה: מה שהוזן, ואם ריק מחיר החוזה
export const coPrice = l => has(l.price_approved) ? n(l.price_approved) : has(l.price_contract) ? n(l.price_contract) : null;
export const coLineAmount = (l, f) => n(l.qty) * n(f ? l[f] : coPrice(l));
export const coLinesOf = (coLines, coId) => coLines.filter(l => l.co_id === coId);
// שורה בלי מחיר חוזה ובלי מחיר מכירה: צריך ניתוח מחיר
export const needsAnalysis = l => !has(l.price_contract) && !has(l.price_sale);

/** סכומי הוראת שינוי: מבוקש, מאושר, לפי מחיר מכירה ולפי מחיר חוזה */
export function coTotals(co, coLines) {
  const ls = coLinesOf(coLines, co.id);
  const sum = f => ls.reduce((a, l) => a + (f === 'approved' ? coLineAmount(l) : coLineAmount(l, f)), 0);
  const requested = sum('price_requested'), approvedAmt = sum('approved'), sale = sum('price_sale'), contract = sum('price_contract');
  // פער מכירה: רק בשורות שיש להן מחיר מכירה (מה שמכרת פחות מה שאושר לקבלן)
  const withSale = ls.filter(l => has(l.price_sale));
  const gapSale = withSale.length ? withSale.reduce((a, l) => a + n(l.qty) * (n(l.price_sale) - n(coPrice(l))), 0) : null;
  return { lines: ls, requested, approved: approvedAmt, sale, contract, analysis: ls.some(needsAnalysis), gapSale };
}

// ===== חשבונות קבלנים =====
// שורות חשבון: כל שורות החוזה + שורות הוראות השינוי של אותה התקשרות (שלא נדחו)
function billRowsFor(contract, cLines, cos, coLines) {
  const rows = cLines.filter(l => l.contract_id === contract.id).sort((a, b) => n(a.sort) - n(b.sort))
    .map(l => ({ key: 'c:' + l.id, kind: 'c', ref: l, code: l.code, description: l.description, unit: l.unit, qty: n(l.qty), price: n(l.unit_price), item: l.boq_item_id }));
  for (const co of cos.filter(c => c.contract_id === contract.id && c.stage !== 'rejected'))
    for (const l of coLinesOf(coLines, co.id)) rows.push({ key: 'o:' + l.id, kind: 'o', ref: l, co, code: co.number, description: l.description, unit: l.unit, qty: n(l.qty), price: coPrice(l), item: co.boq_item_id, approved: coApproved(co) });
  return rows;
}
const keyOf = bl => bl.contract_line_id ? 'c:' + bl.contract_line_id : 'o:' + bl.co_line_id;

/**
 * כל החשבונות של התקשרות אחת, לפי הסדר. כל חשבון מצטבר: הקודם = המצטבר המאושר בחשבון הקודם.
 * המחיר המאושר תמיד מחיר החוזה (או המחיר המאושר בהוראת השינוי). מה שהקבלן ביקש נשמר להשוואה.
 */
export function contractBills({ contract, cLines = [], cos = [], coLines = [], bills = [], bLines = [], vatPct = 18 }) {
  const list = bills.filter(b => b.contract_id === contract.id).sort((a, b) => n(a.number) - n(b.number));
  const base = billRowsFor(contract, cLines, cos, coLines);
  const contractAmt = base.filter(r => r.kind === 'c').reduce((a, r) => a + r.qty * r.price, 0);
  const coAmt = base.filter(r => r.kind === 'o' && r.approved).reduce((a, r) => a + r.qty * n(r.price), 0);
  const prevApp = {}; let prevAdvance = 0, prevRet = 0, prevNet = 0;
  const out = [];
  for (const bill of list) {
    const byKey = Object.fromEntries(bLines.filter(l => l.cbill_id === bill.id).map(l => [keyOf(l), l]));
    const rows = base.map(r => {
      const bl = byKey[r.key] || null, prev = prevApp[r.key] || 0;
      const cumSub = bl && has(bl.cum_qty_sub) ? n(bl.cum_qty_sub) : prev;
      const priceSub = bl && has(bl.price_sub) ? n(bl.price_sub) : r.price;
      let cumApp = bl && has(bl.cum_qty_app) ? n(bl.cum_qty_app) : cumSub;
      const blocked = r.kind === 'o' && !r.approved;
      if (blocked) cumApp = prev;
      const price = n(r.price);
      const flags = [];
      if (cumSub > r.qty + EPS) flags.push(r.kind === 'o' ? 'co_over' : 'over_qty');
      if (bl && has(bl.price_sub) && r.price != null && Math.abs(priceSub - price) > 0.005) flags.push('price_diff');
      if (blocked && cumSub > prev + EPS) flags.push('unapproved_co');
      if (cumApp < cumSub - EPS && !blocked) flags.push('cut');
      return { ...r, line: bl, prev, cumSub, curSub: cumSub - prev, priceSub, cumApp, curApp: cumApp - prev, blocked,
        amtCum: cumApp * price, amtPrev: prev * price, amtCur: (cumApp - prev) * price, claimedCur: cumSub * priceSub - prev * price, flags };
    });
    const sum = f => rows.reduce((a, r) => a + r[f], 0);
    const gross = sum('amtCur'), grossCum = sum('amtCum'), claimed = sum('claimedCur');
    const C = contract;
    const indexDiff = C.indexation && n(C.base_index) && n(bill.index_value) ? gross * (n(bill.index_value) / n(C.base_index) - 1) : 0;
    const retention = Math.max(0, gross) * n(C.retention_pct) / 100;
    const advance = Math.min(Math.max(0, gross) * n(C.advance_offset_pct) / 100, Math.max(0, n(C.advance_amount) - prevAdvance));
    const other = n(bill.other_deductions);
    const net = gross + indexDiff - retention - advance - other;
    const vat = net * vatPct / 100;
    const flags = [];
    for (const r of rows) for (const f of r.flags) if (f !== 'cut') flags.push({ type: f, row: r });
    if (grossCum > contractAmt + coAmt + 0.5) flags.push({ type: 'over_contract', amount: grossCum - contractAmt - coAmt });
    const res = { bill, contract, rows, gross, grossCum, claimed, indexDiff, retention, advance, other, net, vat, total: net + vat,
      cut: claimed - gross, retentionCum: prevRet + retention, advanceCum: prevAdvance + advance, netCum: prevNet + net, contractAmt, coAmt, flags };
    out.push(res);
    for (const r of rows) prevApp[r.key] = r.cumApp;
    prevAdvance += advance; prevRet += retention; prevNet += net;
  }
  return { bills: out, byId: Object.fromEntries(out.map(x => [x.bill.id, x])), contractAmt, coAmt, rows: base };
}

export const FLAG_TEXT = {
  over_qty: 'כמות מצטברת מעל הכמות בחוזה', price_diff: 'מחיר שונה ממחיר החוזה', unapproved_co: 'הוראת שינוי שלא אושרה בכתב',
  co_over: 'הוראת שינוי מחויבת מעבר לכמות שאושרה (חיוב כפול?)', over_contract: 'המצטבר עובר את סכום ההתקשרות כולל שינויים מאושרים',
  dup_invoice: 'מספר חשבונית שכבר נרשם אצל אותו ספק', docs: 'חסרים מסמכים של הקבלן', legal_invoice: 'לא התקבלה חשבונית כחוק'
};

// חשבונית כפולה: אותו מספר חשבונית לאותו ספק, בחשבון קבלן אחר או בהוצאה
export function dupInvoice(bill, contract, allBills, contracts, expenses) {
  const no = String(bill.invoice_no || '').trim(); if (!no) return null;
  const vname = String(contract.vendor_name || '').trim();
  const cById = Object.fromEntries(contracts.map(c => [c.id, c]));
  const b = allBills.find(x => x.id !== bill.id && String(x.invoice_no || '').trim() === no && String(cById[x.contract_id]?.vendor_name || '').trim() === vname);
  if (b) return `חשבון ${b.number} של ${vname}`;
  const e = expenses.find(x => x.cbill_id !== bill.id && String(x.doc_no || '').trim() === no && String(x.supplier_name || '').trim() === vname);
  return e ? `הוצאה מ-${e.doc_date || ''}` : null;
}

/** מסמכים לפני אישור/תשלום: מסמכי הקבלן (מ-vendorStatus) + חשבונית כחוק */
export function docGate(bill, vstat) {
  const miss = [];
  if (vstat) { for (const t of vstat.missing) miss.push({ type: 'docs', doc: t }); for (const d of vstat.expired) miss.push({ type: 'docs', doc: d.doc_type, expired: true }); }
  if (!bill.invoice_legal) miss.push({ type: 'legal_invoice' });
  return miss;
}

/** מצב הוראת שינוי לפי החשבונות: באיזה חשבון נכללה, כמה חויב וכמה שולם */
export function coBilling(co, coLines, results) {
  const ids = new Set(coLinesOf(coLines, co.id).map(l => 'o:' + l.id));
  let firstBill = null, billedAmt = 0, paidAmt = 0, over = false, anyBill = null;
  for (const R of results) {
    const rs = R.rows.filter(r => ids.has(r.key));
    if (!rs.length) continue;
    const appCum = rs.reduce((a, r) => a + r.amtCum, 0);
    if (rs.some(r => r.cumSub > r.prev + EPS) && !anyBill) anyBill = R.bill;
    if (rs.some(r => r.flags.includes('co_over'))) over = true;
    if (CBILL_APPROVED.includes(R.bill.status)) { if (appCum > 0.5 && !firstBill) firstBill = R.bill; billedAmt = appCum; }
    if (R.bill.status === 'paid') paidAmt = appCum;
  }
  return { firstBill, anyBill, billedAmt, paidAmt, over };
}

/** השלב בפועל: מה שנקבע ידנית, ואחריו "נכלל בחשבון" / "שולם" לפי החשבונות */
export function coStage(co, totals, billing) {
  if (co.stage === 'rejected') return 'rejected';
  if (coApproved(co) && billing.billedAmt > 0.5) return billing.paidAmt >= totals.approved - 0.5 ? 'paid' : 'billed';
  return co.stage || 'request';
}

/** כל המצב של הוראות השינוי והחשבונות בפרויקט */
export function devFlow({ contracts = [], cLines = [], cos = [], coLines = [], cbills = [], cbLines = [], vatPct = 18 }) {
  const byContract = {}; const results = [];
  for (const c of contracts) { const r = contractBills({ contract: c, cLines, cos, coLines, bills: cbills, bLines: cbLines, vatPct }); byContract[c.id] = r; results.push(...r.bills); }
  const coRows = cos.map(co => {
    const totals = coTotals(co, coLines);
    const billing = coBilling(co, coLines, results.filter(R => R.contract.id === co.contract_id));
    return { co, ...totals, billing, stage: coStage(co, totals, billing), isApproved: coApproved(co) };
  });
  return { byContract, results, byBill: Object.fromEntries(results.map(R => [R.bill.id, R])), cos: coRows };
}

/** התרעות על הוראות שינוי וחשבונות קבלנים */
export function flowAlerts(flow, { today, filesFor = null } = {}) {
  const out = [];
  for (const x of flow.cos) {
    const co = x.co, lbl = `${co.number || ''} ${co.title}`.trim();
    if (x.stage === 'rejected') continue;
    if (['executed', 'billed'].includes(co.stage) && !x.isApproved) out.push({ type: 'co_exec_unapproved', crit: true, co, title: `שינוי בוצע בלי אישור בכתב: ${lbl}`, detail: `${co.vendor_name || ''} · מבוקש ${Math.round(x.requested).toLocaleString('en-US')} ₪`, amount: x.requested });
    if (x.isApproved && !x.billing.firstBill && !x.billing.anyBill && today && days(today, co.approved_date) > NOT_BILLED_DAYS) out.push({ type: 'co_not_billed', co, title: `שינוי מאושר שלא נכלל בחשבון ${NOT_BILLED_DAYS}+ יום: ${lbl}`, detail: `אושר ב-${co.approved_date} · ${co.vendor_name || ''}`, amount: x.approved });
    if (x.billing.over) out.push({ type: 'co_over_billed', crit: true, co, title: `הוראת שינוי חויבה מעבר למאושר: ${lbl}`, detail: 'ייתכן חיוב כפול. לבדוק בחשבון הקבלן', amount: null });
    if (['request', 'pricing'].includes(co.stage) && x.analysis && !String(co.price_analysis || '').trim()) out.push({ type: 'co_needs_analysis', co, title: `נדרש ניתוח מחיר: ${lbl}`, detail: 'יש שורה בלי מחיר בחוזה ובלי מחיר בכתב הכמויות', amount: x.requested });
    if (x.isApproved && !String(co.approval_ref || '').trim() && filesFor && !filesFor(co.id).length) out.push({ type: 'co_no_doc', co, title: `אין אישור חתום מצורף: ${lbl}`, detail: 'מצרפים את האישור בכתב (📎) או רושמים אסמכתא', amount: null });
  }
  for (const R of flow.results) {
    const b = R.bill, lbl = `${R.contract.vendor_name || ''} · חשבון ${b.number}`;
    if (['received', 'checked'].includes(b.status)) out.push({ type: 'cbill_open', bill: b, title: `חשבון קבלן ממתין לבדיקה: ${lbl}`, detail: `הוגש ${Math.round(R.claimed).toLocaleString('en-US')} ₪${R.flags.length ? ` · ${R.flags.length} ממצאים בבדיקה` : ''}`, amount: R.claimed });
    if (b.status === 'recommended') out.push({ type: 'cbill_recommended', bill: b, title: `חשבון הומלץ וממתין לאישור היזם: ${lbl}`, detail: `מומלץ ${Math.round(R.total).toLocaleString('en-US')} ₪ כולל מע"מ`, amount: R.total });
  }
  return out;
}
