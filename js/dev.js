// פרויקט יזם: תקציב לפי סעיפים, בסיס נעול, התקשרויות עם קבלנים, ספקים ויועצים, וצפי עלות לסיום. פונקציות טהורות.
import { n, itemSale, overrunPct } from './calc.js';
import { devFlow, flowAlerts, CBILL_APPROVED } from './devflow.js';

export const isDev = p => p?.project_type === 'dev';
export const PROJECT_TYPES = { sub: 'קבלן משנה', dev: 'יזם / בעלים' };
export const CONTRACT_KINDS = { contractor: 'קבלן', supplier: 'ספק', consultant: 'יועץ / מתכנן', other: 'אחר' };
export const CONTRACT_STATUS = { draft: 'טיוטה', signed: 'חתום', closed: 'סגור', cancelled: 'בוטל' };
// התקשרות שנכנסת לצפי: חתומה או סגורה. טיוטה מוצגת בנפרד
export const COMMITTED = ['signed', 'closed'];

export const lineAmount = l => n(l.qty) * n(l.unit_price);
export const contractTotal = (lines, contractId) => lines.filter(l => l.contract_id === contractId).reduce((a, l) => a + lineAmount(l), 0);
// הוצאה שנחשבת כחיוב בפועל (לא "צפוי")
export const isInvoiced = e => e.status !== 'expected';

// צילום בסיס: סכום כל סעיף בתקציב ברגע הנעילה
export function baselineSnapshot(items) {
  const out = { items: {}, total: 0 };
  for (const it of items.filter(i => !i.variation_id)) { const a = itemSale(it); out.items[it.id] = a; out.total += a; }
  out.total = Math.round(out.total * 100) / 100;
  return out;
}

/**
 * סיכום פרויקט יזם.
 * לכל סעיף: תקציב, בסיס, התקשרויות, חויב, שולם, צפי לסיום וסטייה.
 * צפי לסיום = צפי ידני אם הוזן, אחרת התקשרויות (אם יש), אחרת התקציב (מסומן "הערכה"). הצפי לא יורד מתחת למה שכבר חויב.
 */
export function devSummary({ project, items = [], contracts = [], cLines = [], expenses: allExpenses = [], cos = [], coLines = [], cbills = [], cbLines = [], vatPct = 18 }) {
  const base = project?.baseline || null;
  // הוצאה שנוצרה מחשבון קבלן היא רק רישום התשלום. הבקרה סופרת את החשבון עצמו (ברוטו לפי שורות)
  const expenses = allExpenses.filter(e => !e.cbill_id);
  const flow = devFlow({ contracts, cLines, cos, coLines, cbills, cbLines, vatPct });
  const live = new Set(contracts.filter(c => COMMITTED.includes(c.status)).map(c => c.id));
  const draft = new Set(contracts.filter(c => c.status === 'draft').map(c => c.id));
  const budgetItems = items.filter(i => !i.variation_id);
  const itemIds = new Set(budgetItems.map(i => i.id));
  const commitBy = {}, draftBy = {}, invBy = {}, paidBy = {};
  const add = (m, k, v) => { m[k] = (m[k] || 0) + v; };
  for (const l of cLines) {
    if (!l.boq_item_id || !itemIds.has(l.boq_item_id)) continue;
    if (live.has(l.contract_id)) add(commitBy, l.boq_item_id, lineAmount(l));
    else if (draft.has(l.contract_id)) add(draftBy, l.boq_item_id, lineAmount(l));
  }
  for (const e of expenses) {
    if (!e.boq_item_id || !itemIds.has(e.boq_item_id)) continue;
    if (isInvoiced(e)) add(invBy, e.boq_item_id, n(e.amount));
    if (e.status === 'paid') add(paidBy, e.boq_item_id, n(e.amount));
  }
  // הוראות שינוי: מאושרות נכנסות להתקשרויות, בתהליך מוצגות בנפרד
  const coBy = {}, coPendBy = {}; const coOutside = [];
  for (const x of flow.cos) {
    if (x.stage === 'rejected' || !live.has(x.co.contract_id) && x.co.contract_id) continue;
    const it = x.co.boq_item_id && itemIds.has(x.co.boq_item_id) ? x.co.boq_item_id : null;
    if (x.isApproved) { if (it) add(coBy, it, x.approved); else if (x.approved > 0.5) coOutside.push(x); }
    else if (it) add(coPendBy, it, x.requested);
  }
  // חשבונות קבלנים: המצטבר המאושר בחשבון האחרון שאושר (ושבחשבון האחרון ששולם)
  const cbInv = {}, cbPaid = {}; let cbUnallocInv = 0, cbUnallocPaid = 0; const cbByContract = {};
  for (const c of contracts) {
    const R = flow.byContract[c.id]?.bills || [];
    const lastApp = [...R].reverse().find(x => CBILL_APPROVED.includes(x.bill.status)), lastPaid = [...R].reverse().find(x => x.bill.status === 'paid');
    cbByContract[c.id] = { invoiced: lastApp?.grossCum || 0, paid: lastPaid?.grossCum || 0 };
    for (const [X, m, k] of [[lastApp, cbInv, 'inv'], [lastPaid, cbPaid, 'paid']]) for (const r of X?.rows || []) {
      if (!r.amtCum) continue;
      if (r.item && itemIds.has(r.item)) add(m, r.item, r.amtCum); else if (k === 'inv') cbUnallocInv += r.amtCum; else cbUnallocPaid += r.amtCum;
    }
  }
  for (const [k, v] of Object.entries(cbInv)) add(invBy, k, v);
  for (const [k, v] of Object.entries(cbPaid)) add(paidBy, k, v);
  for (const [k, v] of Object.entries(coBy)) add(commitBy, k, v);
  const rows = budgetItems.map(item => {
    const budget = itemSale(item);
    const baseAmt = base?.items ? (base.items[item.id] ?? null) : null;
    const committed = commitBy[item.id] || 0, invoiced = invBy[item.id] || 0, paid = paidBy[item.id] || 0;
    const manual = item.forecast_manual != null && item.forecast_manual !== '' ? n(item.forecast_manual) : null;
    const estimate = manual == null && committed <= 0 && invoiced <= budget + 0.5; // בלי התקשרות: הערכה לפי התקציב, אלא אם כבר חויב יותר
    const forecast = Math.max(manual ?? (committed > 0 ? committed : budget), invoiced);
    return { item, budget, base: baseAmt, committed, draft: draftBy[item.id] || 0, co: coBy[item.id] || 0, coPending: coPendBy[item.id] || 0, invoiced, paid, forecast, estimate, manual: manual != null,
      dev: budget > 0 ? overrunPct(forecast, budget) : (forecast > 0 ? 100 : 0),
      devBase: baseAmt ? overrunPct(forecast, baseAmt) : null,
      overBudget: committed > budget + 0.5, newItem: base?.items ? baseAmt == null : false };
  });

  // שורות התקשרות בלי סעיף תקציב: נכנסות לצפי כ"מחוץ לתקציב"
  const outside = [];
  for (const c of contracts.filter(c => live.has(c.id))) {
    const ls = cLines.filter(l => l.contract_id === c.id && (!l.boq_item_id || !itemIds.has(l.boq_item_id)));
    const amt = ls.reduce((a, l) => a + lineAmount(l), 0);
    if (amt > 0.5) outside.push({ contract: c, lines: ls, amount: amt });
  }
  for (const x of coOutside) outside.push({ contract: contracts.find(c => c.id === x.co.contract_id) || { title: x.co.title, vendor_name: x.co.vendor_name }, lines: x.lines, amount: x.approved, co: x.co });
  const outsideTotal = outside.reduce((a, x) => a + x.amount, 0);

  // הוצאות בלי סעיף: לפי התקשרות (אם יש) או כלליות
  const unalloc = expenses.filter(e => !e.boq_item_id || !itemIds.has(e.boq_item_id));
  const unallocInv = unalloc.filter(isInvoiced).reduce((a, e) => a + n(e.amount), 0) + cbUnallocInv;
  const unallocPaid = unalloc.filter(e => e.status === 'paid').reduce((a, e) => a + n(e.amount), 0) + cbUnallocPaid;

  // פרקים
  const chapters = new Map();
  for (const r of rows) { const k = r.item.chapter || 'ללא פרק'; if (!chapters.has(k)) chapters.set(k, []); chapters.get(k).push(r); }
  const sumRows = rs => {
    const s = rs.reduce((a, r) => ({ budget: a.budget + r.budget, base: a.base + n(r.base), committed: a.committed + r.committed, draft: a.draft + r.draft, invoiced: a.invoiced + r.invoiced, paid: a.paid + r.paid, forecast: a.forecast + r.forecast }),
      { budget: 0, base: 0, committed: 0, draft: 0, invoiced: 0, paid: 0, forecast: 0 });
    s.dev = s.budget > 0 ? overrunPct(s.forecast, s.budget) : 0;
    s.devBase = s.base > 0 ? overrunPct(s.forecast, s.base) : null;
    return s;
  };
  const chapterList = [...chapters.entries()].map(([name, rs]) => ({ name, rows: rs, ...sumRows(rs) }));
  const t = sumRows(rows);
  // חשבון קבלן על שורה בלי סעיף כבר נספר ב"מחוץ לתקציב" (ההתקשרות), לכן לצפי נכנס רק מה שעובר אותה
  const unallocFc = Math.max(0, unallocInv - cbUnallocInv) + Math.max(0, cbUnallocInv - outsideTotal);
  const total = { ...t, forecast: t.forecast + outsideTotal + unallocFc, invoiced: t.invoiced + unallocInv, paid: t.paid + unallocPaid,
    coApproved: rows.reduce((a, r) => a + r.co, 0) + coOutside.reduce((a, x) => a + x.approved, 0), coPending: rows.reduce((a, r) => a + r.coPending, 0),
    uncommitted: rows.filter(r => r.estimate).reduce((a, r) => a + r.budget, 0), outside: outsideTotal, unalloc: unallocInv,
    baseTotal: base?.total ?? null };
  total.dev = total.budget > 0 ? overrunPct(total.forecast, total.budget) : 0;
  total.devBase = total.baseTotal ? overrunPct(total.forecast, total.baseTotal) : null;

  // התקשרויות: סכום, חויב, שולם, יתרה
  const contractRows = contracts.map(c => {
    const base = contractTotal(cLines, c.id), coAmt = flow.byContract[c.id]?.coAmt || 0, amount = base + coAmt;
    const ex = expenses.filter(e => e.contract_id === c.id);
    const invoiced = ex.filter(isInvoiced).reduce((a, e) => a + n(e.amount), 0) + cbByContract[c.id].invoiced;
    const paid = ex.filter(e => e.status === 'paid').reduce((a, e) => a + n(e.amount), 0) + cbByContract[c.id].paid;
    return { contract: c, amount, base, coAmt, invoiced, paid, balance: amount - paid, over: invoiced > amount + 0.5, lines: cLines.filter(l => l.contract_id === c.id) };
  });

  return { rows, chapters: chapterList, outside, total, contracts: contractRows, unallocated: unalloc, expenses, flow, hasBaseline: !!base?.items, baselineAt: project?.baseline_at || null };
}

/** התרעות לפרויקט יזם: מחזיר רשימה עם סוג, כותרת, פירוט, סכום ואחוז */
export function devAlerts(s, { critPct = 15, vendorsWithContracts = null, today = null, filesFor = null } = {}) {
  const out = [];
  for (const r of s.rows) {
    const label = `${r.item.code || ''} ${r.item.description}`.trim();
    if (r.overBudget) out.push({ type: 'commit_over_budget', item: r.item, title: `התקשרות מעל התקציב: ${label}`, detail: `תקציב ${Math.round(r.budget).toLocaleString('en-US')} ₪, התקשרויות ${Math.round(r.committed).toLocaleString('en-US')} ₪`, amount: r.committed - r.budget, pct: r.dev });
    else if (!r.estimate && r.dev > 0.05) out.push({ type: 'forecast_over_budget', item: r.item, title: `צפי מעל התקציב: ${label}`, detail: `תקציב ${Math.round(r.budget).toLocaleString('en-US')} ₪, צפי ${Math.round(r.forecast).toLocaleString('en-US')} ₪`, amount: r.forecast - r.budget, pct: r.dev });
    if (r.devBase != null && r.devBase > 0.05 && r.base != null && Math.abs(r.base - r.budget) > 0.5) out.push({ type: 'over_baseline', item: r.item, title: `שינוי מול הבסיס: ${label}`, detail: `בסיס ${Math.round(r.base).toLocaleString('en-US')} ₪, צפי ${Math.round(r.forecast).toLocaleString('en-US')} ₪`, amount: r.forecast - r.base, pct: r.devBase });
  }
  for (const o of s.outside) out.push({ type: 'outside_budget', title: `התקשרות בלי סעיף תקציב: ${o.contract.title}`, detail: `${o.lines.length} שורות בלי שיוך לסעיף`, amount: o.amount, pct: null });
  for (const c of s.contracts) if (c.over) out.push({ type: 'invoiced_over_contract', title: `חויב מעל ההתקשרות: ${c.contract.title}`, detail: `התקשרות ${Math.round(c.amount).toLocaleString('en-US')} ₪, חויב ${Math.round(c.invoiced).toLocaleString('en-US')} ₪`, amount: c.invoiced - c.amount, pct: c.amount ? overrunPct(c.invoiced, c.amount) : null });
  const una = s.unallocated.filter(isInvoiced);
  if (una.length) out.push({ type: 'expense_no_item', title: `${una.length} הוצאות בלי סעיף תקציב`, detail: 'צריך לשייך כל הוצאה לסעיף כדי שהבקרה תהיה מלאה', amount: una.reduce((a, e) => a + n(e.amount), 0), pct: null });
  if (vendorsWithContracts) {
    const names = [...new Set((s.expenses || []).filter(e => e.supplier_name && !e.contract_id && !vendorsWithContracts.has(e.supplier_name.trim())).map(e => e.supplier_name.trim()))];
    for (const nm of names) out.push({ type: 'vendor_no_contract', title: `ספק בלי התקשרות: ${nm}`, detail: 'יש הוצאות לגורם שאין לו התקשרות בפרויקט', amount: null, pct: null });
  }
  if (s.total.devBase != null && s.total.devBase > 0.05) out.push({ type: 'total_over_baseline', title: 'עלות הפרויקט מעל הבסיס המאושר', detail: `בסיס ${Math.round(s.total.baseTotal).toLocaleString('en-US')} ₪, צפי ${Math.round(s.total.forecast).toLocaleString('en-US')} ₪`, amount: s.total.forecast - s.total.baseTotal, pct: s.total.devBase });
  if (s.flow) out.push(...flowAlerts(s.flow, { today, filesFor }));
  return out.map(a => ({ ...a, crit: !!a.crit || (a.pct != null && a.pct >= critPct) }));
}
