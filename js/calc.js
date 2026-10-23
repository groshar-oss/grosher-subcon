// חישובי מכירה, תמחיר, צפי ורווחיות. פונקציות טהורות, בלי גישה לנתונים.

export const n = v => {
  if (v === null || v === undefined || v === '') return 0;
  const x = typeof v === 'number' ? v : parseFloat(String(v).replace(/[,₪\s]/g, ''));
  return isFinite(x) ? x : 0;
};

export const COST_KINDS = {
  material: 'חומר', labor: 'עבודה עצמית', piece: 'עבודה בקבלנות',
  sub: 'קבלן משנה', equipment: 'ציוד', transport: 'הובלה', other: 'אחר'
};

export const VO_STATUS = {
  draft: 'טיוטה', submitted: 'הוגש', approved: 'אושר', partial: 'אושר חלקית',
  rejected: 'נדחה', executed_unapproved: 'בוצע בלי אישור'
};
export const VO_APPROVED = ['approved', 'partial'];
export const VO_AT_RISK = ['submitted', 'executed_unapproved'];

// מצבי תצוגת רווחיות
export const PROFIT_MODES = {
  contract: 'חוזה בלבד, בלי הוראות שינוי',
  approved: 'כולל הוראות שינוי מאושרות',
  all: 'כולל הוראות שינוי שטרם אושרו'
};

export const itemSale = it => n(it.qty) * n(it.unit_price);

export function lineCost(l) {
  const base = n(l.qty) * n(l.unit_cost);
  return l.kind === 'material' ? base * (1 + n(l.waste_pct) / 100) : base;
}

// עלות מתוכננת לסעיף: ישירה + תקורה באחוזים מהישירה
export function itemPlanned(lines, overheadPct = 0) {
  const direct = lines.reduce((s, l) => s + lineCost(l), 0);
  const overhead = direct * n(overheadPct) / 100;
  return { direct, overhead, total: direct + overhead };
}

// צפי עלות לסיום: בפועל + יתרת תמחיר לפי אחוז ביצוע, אלא אם הוזן צפי ידני
export function itemForecast({ planned, actual = 0, progressPct = 0, manual = null }) {
  if (manual !== null && manual !== undefined && manual !== '') return n(manual);
  const p = Math.min(Math.max(n(progressPct), 0), 100) / 100;
  return n(actual) + Math.max(0, n(planned) * (1 - p));
}

export const overrunPct = (forecast, planned) => n(planned) > 0 ? (n(forecast) - n(planned)) / n(planned) * 100 : 0;

// רמת חריגה לפי כללי הצבעים: עד 3% צהוב, 3-5 כתום, 5-10 אדום, מעל 10 אדום כהה (מתכהה)
export function overrunLevel(pct, critPct = 15) {
  const p = Math.round(n(pct) * 100) / 100;
  if (p <= 0) return { cls: '', crit: false };
  const crit = p >= n(critPct);
  if (p <= 3) return { cls: 'al-y', crit };
  if (p <= 5) return { cls: 'al-o', crit };
  if (p <= 10) return { cls: 'al-r', crit };
  return { cls: 'al-dr', crit, depth: Math.min(1, (p - 10) / 20) };
}

// בקרה ברמת סעיף
// commit: התקשרויות פתוחות (הזמנות רכש שעוד לא חויבו). הצפי לא יורד מתחת לבפועל + התקשרויות.
export function itemControl(item, lines, actual, overheadPct, commit = 0) {
  const sale = itemSale(item);
  const plan = itemPlanned(lines, overheadPct);
  let forecast = itemForecast({ planned: plan.total, actual, progressPct: item.progress_pct, manual: item.forecast_manual });
  const manual = item.forecast_manual !== null && item.forecast_manual !== undefined && item.forecast_manual !== '';
  if (!manual && n(commit) > 0) forecast = Math.max(forecast, n(actual) + n(commit));
  const spentPct = plan.total > 0 ? n(actual) / plan.total * 100 : 0;
  return {
    sale, planned: plan.total, direct: plan.direct, actual: n(actual), commit: n(commit), forecast,
    profit: sale - forecast, profitPct: sale ? (sale - forecast) / sale * 100 : 0,
    plannedProfit: sale - plan.total,
    progress: n(item.progress_pct), spentPct,
    overrun: overrunPct(forecast, plan.total),
    noCosting: lines.length === 0,
    lossPlanned: lines.length > 0 && plan.total > sale && sale > 0,
    spendAhead: lines.length > 0 && spentPct > n(item.progress_pct) + 0.0001 && n(actual) > 0
  };
}

const sum = (arr, k) => arr.reduce((s, x) => s + n(x[k]), 0);

// סיכום פרויקט לפי מצב תצוגת רווחיות
// data: { project, items, lines, variations, actualByItem: {itemId: amount} }
export function projectSummary(data, mode = 'approved') {
  const { project, items, lines, variations = [], actualByItem = {}, commitByItem = {} } = data;
  const oh = n(project?.overhead_pct);
  const linesBy = {};
  for (const l of lines) (linesBy[l.boq_item_id] ||= []).push(l);
  const voById = Object.fromEntries(variations.map(v => [v.id, v]));
  const rows = items.map(it => ({ item: it, vo: it.variation_id ? voById[it.variation_id] : null,
    c: itemControl(it, linesBy[it.id] || [], actualByItem[it.id] || 0, oh, commitByItem[it.id] || 0) }));

  const contractRows = rows.filter(r => !r.item.variation_id);
  const voGroups = variations.map(v => {
    const vr = rows.filter(r => r.item.variation_id === v.id);
    const requested = vr.reduce((s, r) => s + r.c.sale, 0);
    const approvedSale = VO_APPROVED.includes(v.status)
      ? (v.approved_amount !== null && v.approved_amount !== undefined && v.approved_amount !== '' ? n(v.approved_amount) : requested) : 0;
    return {
      vo: v, rows: vr, requested, approvedSale,
      planned: vr.reduce((s, r) => s + r.c.planned, 0),
      actual: vr.reduce((s, r) => s + r.c.actual, 0),
      forecast: vr.reduce((s, r) => s + r.c.forecast, 0)
    };
  });

  const agg = (rs) => ({
    sale: rs.reduce((s, r) => s + r.c.sale, 0), planned: rs.reduce((s, r) => s + r.c.planned, 0),
    actual: rs.reduce((s, r) => s + r.c.actual, 0), forecast: rs.reduce((s, r) => s + r.c.forecast, 0)
  });
  const contract = agg(contractRows);
  const approvedVOs = voGroups.filter(g => VO_APPROVED.includes(g.vo.status));
  const riskVOs = voGroups.filter(g => VO_AT_RISK.includes(g.vo.status));
  const voSum = (gs, saleKey) => ({
    sale: gs.reduce((s, g) => s + g[saleKey], 0), planned: gs.reduce((s, g) => s + g.planned, 0),
    actual: gs.reduce((s, g) => s + g.actual, 0), forecast: gs.reduce((s, g) => s + g.forecast, 0)
  });
  const approved = voSum(approvedVOs, 'approvedSale');
  const atRisk = voSum(riskVOs, 'requested');

  let tot = { ...contract };
  if (mode === 'approved' || mode === 'all') tot = addT(tot, approved);
  if (mode === 'all') tot = addT(tot, atRisk);
  tot.profit = tot.sale - tot.forecast;
  tot.profitPct = tot.sale ? tot.profit / tot.sale * 100 : 0;
  tot.plannedProfit = tot.sale - tot.planned;
  tot.plannedProfitPct = tot.sale ? tot.plannedProfit / tot.sale * 100 : 0;
  tot.overrun = overrunPct(tot.forecast, tot.planned);
  tot.spentPct = tot.planned ? tot.actual / tot.planned * 100 : 0;
  tot.progress = tot.planned ? rows.filter(r => inMode(r, mode)).reduce((s, r) => s + r.c.planned * r.c.progress / 100, 0) / tot.planned * 100 : 0;

  // עלות שכבר הוצאה על הוראות שינוי שלא נכללות בתצוגה (כדי שלא תוסתר)
  const excluded = voGroups.filter(g => !inModeVO(g.vo, mode));
  const excludedActual = excluded.reduce((s, g) => s + g.actual, 0);

  return { mode, rows, contractRows, voGroups, contract, approved, atRisk, total: tot, excludedActual,
    riskAmount: riskVOs.reduce((s, g) => s + g.requested, 0) };
}

function addT(a, b) { return { sale: a.sale + b.sale, planned: a.planned + b.planned, actual: a.actual + b.actual, forecast: a.forecast + b.forecast }; }
export function inModeVO(vo, mode) {
  if (mode === 'contract') return false;
  if (mode === 'approved') return VO_APPROVED.includes(vo.status);
  return VO_APPROVED.includes(vo.status) || VO_AT_RISK.includes(vo.status);
}
export function inMode(row, mode) { return !row.item.variation_id || (row.vo && inModeVO(row.vo, mode)); }

// סיכום כמה פרויקטים (לכל הלקוח)
export function portfolio(summaries) {
  const t = { sale: 0, planned: 0, actual: 0, forecast: 0, contractSale: 0, voSale: 0 };
  for (const s of summaries) {
    t.sale += s.total.sale; t.planned += s.total.planned; t.actual += s.total.actual; t.forecast += s.total.forecast;
    t.contractSale += s.contract.sale; t.voSale += s.total.sale - s.contract.sale;
  }
  t.profit = t.sale - t.forecast; t.profitPct = t.sale ? t.profit / t.sale * 100 : 0;
  t.plannedProfitPct = t.sale ? (t.sale - t.planned) / t.sale * 100 : 0;
  t.overrun = overrunPct(t.forecast, t.planned);
  return t;
}

export const EXPENSE_KINDS = {
  material: 'חומרים', labor: 'עבודה', piece: 'קבלנות', sub: 'קבלן משנה',
  equipment: 'ציוד', transport: 'הובלה', general: 'כללי לפרויקט', other: 'אחר'
};
export const EXPENSE_STATUS = { expected: 'צפוי', invoice: 'התקבלה חשבונית', approved: 'אושר', paid: 'שולם' };

// חלוקת הוצאות לסעיפים: הוצאה עם סעיף נרשמת לסעיף; הוצאה של הוראת שינוי בלי סעיף מתחלקת בין סעיפי ההוראה;
// הוצאה כללית לפרויקט מתחלקת בין סעיפי החוזה לפי משקל העלות המתוכננת.
export function actualsByItem(items, lines, expenses, overheadPct = 0) {
  const out = {};
  const linesBy = {};
  for (const l of lines) (linesBy[l.boq_item_id] ||= []).push(l);
  const planned = id => itemPlanned(linesBy[id] || [], overheadPct).total;
  const spread = (group, amount) => {
    if (!group.length || !amount) return false;
    let w = group.map(i => planned(i.id));
    let tw = w.reduce((a, b) => a + b, 0);
    if (tw <= 0) { w = group.map(i => itemSale(i) || 1); tw = w.reduce((a, b) => a + b, 0); }
    group.forEach((i, k) => out[i.id] = (out[i.id] || 0) + amount * w[k] / tw);
    return true;
  };
  const ids = new Set(items.map(i => i.id));
  let unallocated = 0;
  for (const e of expenses) {
    const amt = n(e.amount);
    if (e.boq_item_id && ids.has(e.boq_item_id)) out[e.boq_item_id] = (out[e.boq_item_id] || 0) + amt;
    else if (e.variation_id) { if (!spread(items.filter(i => i.variation_id === e.variation_id), amt)) unallocated += amt; }
    else if (!spread(items.filter(i => !i.variation_id), amt)) unallocated += amt;
  }
  return { byItem: out, unallocated };
}
