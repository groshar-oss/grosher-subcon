// שלב 3: עלות עבודה מיומן העבודה, התקשרויות רכש והתראות מכסה (בכמות ובכסף). פונקציות טהורות.
import { n, lineCost } from './calc.js';

export const PAY_TYPES = { salary: 'שכיר חודשי', daily: 'עובד יומי', piece: 'קבלנות' };
export const LABOR_TYPES = { '': 'כל סוג', salary: 'שכירים', daily: 'יומיים' };
export const PO_STATUS = { open: 'פתוחה', partial: 'סופקה חלקית', delivered: 'סופקה', closed: 'סגורה', cancelled: 'בוטלה' };
export const PO_LIVE = ['open', 'partial', 'delivered'];

const DEF = { employer_factor: 1.3, work_days_month: 22, day_hours: 9, quota_warn_pct: 80, quota_gap_pct: 10 };
export const qset = s => ({ ...DEF, ...(s || {}) });

// מקדם עלות מעביד לעובד: של העובד, אחרת של הלקוח (לשכיר) או 1 (ליומי)
const factorOf = (w, s) => w.cost_factor != null && w.cost_factor !== '' ? n(w.cost_factor) : (w.pay_type === 'salary' ? n(s.employer_factor) : 1);

// התאמת רישום ביומן לשורת תמחיר בסעיף
export function matchLine(entry, worker, itemLines) {
  if (entry.cost_line_id) { const l = itemLines.find(x => x.id === entry.cost_line_id); if (l) return l; }
  if (!worker) return null;
  if (worker.pay_type === 'piece') return itemLines.find(l => l.kind === 'piece') || null;
  const labor = itemLines.filter(l => l.kind === 'labor');
  return labor.find(l => l.labor_type === worker.pay_type) || labor.find(l => !l.labor_type) || labor[0] || null;
}

/**
 * עלות לכל רישום ביומן.
 * שכיר: (ברוטו × מקדם) ÷ max(ימי עבודה שנרשמו לו בחודש בכל הפרויקטים, ימי עבודה בחודש) × ימים.
 *   כך 12 יום בפרויקט א' ו-10 בב' מתחלקים 12/22 ו-10/22, וחודש חלקי לא מנפח את העלות.
 * יומי: ימים × תעריף × מקדם. שעות נוספות לפי תעריף שעה נוספת (או 125% משעה רגילה).
 * קבלנות: כמות × מחיר קבלנות (של הרישום, של העובד או של שורת התמחיר).
 * allEntries: כל הרישומים של הלקוח (לחישוב החודש של שכירים).
 */
export function entryCosts({ entries, allEntries = entries, workers, lines = [], settings }) {
  const s = qset(settings);
  const W = Object.fromEntries(workers.map(w => [w.id, w]));
  const linesBy = {};
  for (const l of lines) (linesBy[l.boq_item_id] ||= []).push(l);
  const monthDays = {};
  for (const e of allEntries) {
    const w = W[e.worker_id];
    if (w?.pay_type === 'salary') { const k = e.worker_id + '|' + String(e.log_date).slice(0, 7); monthDays[k] = (monthDays[k] || 0) + n(e.days); }
  }
  const out = {};
  for (const e of entries) {
    const w = W[e.worker_id];
    if (!w) { out[e.id] = { cost: 0, line: null, missingWorker: true }; continue; }
    const f = factorOf(w, s);
    const line = e.boq_item_id ? matchLine(e, w, linesBy[e.boq_item_id] || []) : null;
    let cost = 0, dayCost = 0;
    if (w.pay_type === 'salary') {
      const md = monthDays[e.worker_id + '|' + String(e.log_date).slice(0, 7)] || 0;
      dayCost = n(w.monthly_salary) * f / Math.max(md, n(s.work_days_month) || 22);
      const ot = n(w.ot_rate) || n(w.monthly_salary) * f / ((n(s.work_days_month) || 22) * (n(s.day_hours) || 9)) * 1.25;
      cost = dayCost * n(e.days) + ot * n(e.ot_hours);
    } else if (w.pay_type === 'daily') {
      dayCost = n(w.daily_rate) * f;
      const ot = n(w.ot_rate) || dayCost / (n(s.day_hours) || 9) * 1.25;
      cost = dayCost * n(e.days) + ot * n(e.ot_hours);
    } else {
      const rate = e.piece_rate != null && e.piece_rate !== '' ? n(e.piece_rate) : (n(w.piece_rate) || n(line?.unit_cost));
      cost = n(e.piece_qty) * rate;
    }
    out[e.id] = { cost, line, dayCost };
  }
  return out;
}

// רישומי יומן כהוצאות (לחישוב "בפועל" לפי סעיף, באותה דרך כמו הוצאות)
export function entriesAsCosts(entries, costs) {
  return entries.map(e => ({ amount: costs[e.id]?.cost || 0, boq_item_id: e.boq_item_id || null, variation_id: e.variation_id || null, kind: 'labor', _entry: true }));
}

// התקשרויות פתוחות מהזמנות רכש: ערך ההזמנה פחות מה שכבר חויב בחשבוניות שקושרו אליה
export function openCommitments(pos, poLines, expenses) {
  const byItem = {}; let unassigned = 0;
  for (const po of pos) {
    if (!PO_LIVE.includes(po.status)) continue;
    const ls = poLines.filter(l => l.po_id === po.id);
    const total = ls.reduce((a, l) => a + n(l.qty) * n(l.unit_price), 0);
    const invoiced = expenses.filter(e => e.po_id === po.id).reduce((a, e) => a + n(e.amount), 0);
    const open = Math.max(0, total - invoiced);
    if (!open || !total) continue;
    for (const l of ls) {
      const share = open * (n(l.qty) * n(l.unit_price)) / total;
      if (l.boq_item_id) byItem[l.boq_item_id] = (byItem[l.boq_item_id] || 0) + share; else unassigned += share;
    }
  }
  return { byItem, unassigned };
}

const r1 = x => Math.round(x * 10) / 10;
const fmt = x => r1(x).toLocaleString('en-US');

/**
 * מכסות לכל שורת תמחיר מסוג עבודה עצמית / קבלנות / חומר.
 * מחזיר שורה לכל מכסה עם כמות ועלות מתוכננות מול בפועל, ורמת התראה:
 * over: חרג בכמות או בכסף. warn: ניצול ≥ סף (80%) או ניצול שמקדים את אחוז הביצוע ב-10 נקודות ומעלה.
 * crew: ימים שבהם נרשמו יותר עובדים מהצוות המתוכנן בשורה.
 */
export function quotaRows({ items, lines, entries, costs, workers, pos = [], poLines = [], expenses = [], settings }) {
  const s = qset(settings);
  const W = Object.fromEntries(workers.map(w => [w.id, w]));
  const itemById = Object.fromEntries(items.map(i => [i.id, i]));
  const linesBy = {};
  for (const l of lines) (linesBy[l.boq_item_id] ||= []).push(l);
  const acc = {}; // lineId -> {qty, cost, days:{date:Set(workers)}}
  const A = id => (acc[id] ||= { qty: 0, cost: 0, days: {}, ordered: 0, src: 0 });
  const unmatched = {}; // itemId -> {days, cost, qty}

  for (const e of entries) {
    if (!e.boq_item_id || !itemById[e.boq_item_id]) continue;
    const c = costs[e.id] || {};
    const w = W[e.worker_id];
    const line = c.line;
    if (!line) { const u = (unmatched[e.boq_item_id] ||= { days: 0, cost: 0, qty: 0, piece: 0 }); u.days += w?.pay_type === 'piece' ? 0 : n(e.days); u.piece += w?.pay_type === 'piece' ? n(e.piece_qty) : 0; u.cost += c.cost || 0; continue; }
    const a = A(line.id);
    a.qty += line.kind === 'piece' ? n(e.piece_qty) : n(e.days);
    a.cost += c.cost || 0;
    if (line.kind === 'labor') (a.days[e.log_date] ||= new Set()).add(e.worker_id);
  }
  // חומרים: הזמנות (לא מבוטלות) ורכישות ישירות שקושרו לשורה, או לסעיף עם שורת חומר יחידה
  const matLine = (itemId, lineId) => {
    if (lineId) return lines.find(l => l.id === lineId) || null;
    const ms = (linesBy[itemId] || []).filter(l => l.kind === 'material');
    return ms.length === 1 ? ms[0] : null;
  };
  const liveP = new Set(pos.filter(p => p.status !== 'cancelled').map(p => p.id));
  for (const l of poLines) {
    if (!liveP.has(l.po_id) || !l.boq_item_id) continue;
    const ml = matLine(l.boq_item_id, l.cost_line_id); if (!ml) continue;
    const a = A(ml.id); a.qty += n(l.qty); a.cost += n(l.qty) * n(l.unit_price); a.ordered += n(l.qty);
  }
  for (const e of expenses) {
    if (e.po_id || !e.boq_item_id || !['material'].includes(e.kind)) continue;
    const ml = matLine(e.boq_item_id, e.cost_line_id); if (!ml) continue;
    const a = A(ml.id); a.cost += n(e.amount); if (e.qty != null && e.qty !== '') a.qty += n(e.qty); else a.noQty = true;
  }

  const rows = [];
  for (const l of lines) {
    if (!['labor', 'piece', 'material'].includes(l.kind)) continue;
    const it = itemById[l.boq_item_id]; if (!it) continue;
    const a = acc[l.id] || { qty: 0, cost: 0, days: {} };
    const plannedQty = l.kind === 'material' ? n(l.qty) * (1 + n(l.waste_pct) / 100) : n(l.qty);
    const plannedCost = lineCost(l);
    const qtyPct = plannedQty > 0 ? a.qty / plannedQty * 100 : (a.qty > 0 ? Infinity : 0);
    const costPct = plannedCost > 0 ? a.cost / plannedCost * 100 : (a.cost > 0 ? Infinity : 0);
    const progress = n(it.progress_pct);
    const unit = l.kind === 'labor' ? (l.unit || 'ימי עבודה') : (l.unit || it.unit || '');
    const msgs = [];
    let status = '';
    if (a.qty > plannedQty + 1e-6 && plannedQty > 0) { status = 'over'; msgs.push(`${l.kind === 'material' ? 'הוזמנו/נקנו' : 'נוצלו'} ${fmt(a.qty)} ${unit} מתוך ${fmt(plannedQty)} שתומחרו (${fmt(a.qty - plannedQty)}+)`); }
    if (a.cost > plannedCost + 0.5 && plannedCost > 0) { status = 'over'; msgs.push(`עלות ${Math.round(a.cost).toLocaleString('en-US')} ₪ מול ${Math.round(plannedCost).toLocaleString('en-US')} ₪ בתמחיר`); }
    const crewOver = [];
    if (l.kind === 'labor' && n(l.crew) > 0) {
      for (const [d, set] of Object.entries(a.days)) if (set.size > n(l.crew)) crewOver.push({ date: d, count: set.size });
      crewOver.sort((x, y) => x.date.localeCompare(y.date));
      if (crewOver.length) { status = 'over'; const last = crewOver[crewOver.length - 1]; msgs.push(`תומחרו ${fmt(n(l.crew))} עובדים ביום. ${crewOver.length === 1 ? 'ביום אחד' : `ב-${crewOver.length} ימים`} נרשמו יותר (${last.date.split('-').reverse().join('.')}: ${last.count} עובדים)`); }
    }
    const used = Math.max(isFinite(qtyPct) ? qtyPct : 0, isFinite(costPct) ? costPct : 0);
    if (a.qty > 0 || a.cost > 0) {
      if (!status && used >= n(s.quota_warn_pct)) { status = 'warn'; msgs.push(`נוצל ${Math.round(used)}% מהמכסה`); }
      if (used - progress >= n(s.quota_gap_pct) && used <= 100) { status ||= 'warn'; msgs.push(`ניצול ${Math.round(used)}% כשהסעיף בוצע ${Math.round(progress)}%`); }
    }
    if (a.noQty && a.qty > 0 && l.kind === 'material') msgs.push('חלק מהרכישות בלי כמות ונספרו רק בכסף');
    if (!a.qty && !a.cost && !status) continue;
    const overPct = Math.max(plannedQty > 0 ? (a.qty - plannedQty) / plannedQty * 100 : 0, plannedCost > 0 ? (a.cost - plannedCost) / plannedCost * 100 : 0);
    rows.push({ item: it, line: l, kind: l.kind, unit, plannedQty, usedQty: a.qty, plannedCost, usedCost: a.cost, qtyPct, costPct, used, progress,
      status, overPct, crewOver, crew: n(l.crew) || null, msgs });
  }
  for (const [itemId, u] of Object.entries(unmatched)) {
    const it = itemById[itemId];
    rows.push({ item: it, line: null, kind: 'labor', unit: u.piece ? (it.unit || '') : 'ימי עבודה', plannedQty: 0, usedQty: u.days || u.piece, plannedCost: 0, usedCost: u.cost, qtyPct: Infinity, costPct: Infinity, used: Infinity, progress: n(it.progress_pct),
      status: 'over', overPct: 100, crewOver: [], crew: null, msgs: ['נרשמה עבודה על סעיף בלי שורת עבודה מתאימה בתמחיר'] });
  }
  const rank = { over: 2, warn: 1, '': 0 };
  return rows.sort((a, b) => rank[b.status] - rank[a.status] || b.overPct - a.overPct || b.used - a.used);
}

// סיכום נוכחות לחודש: לכל עובד ולכל פרויקט ימים, שעות נוספות, כמות קבלנות ועלות
export function attendance({ entries, costs, month, piece }) {
  const out = {};
  for (const e of entries) {
    if (month && !String(e.log_date).startsWith(month)) continue;
    const k = e.worker_id + '|' + e.project_id;
    const r = (out[k] ||= { worker_id: e.worker_id, project_id: e.project_id, days: 0, ot: 0, piece: 0, cost: 0, dates: new Set() });
    if (!piece?.(e)) r.days += n(e.days); r.ot += n(e.ot_hours); r.piece += n(e.piece_qty); r.cost += costs[e.id]?.cost || 0; r.dates.add(e.log_date);
  }
  return Object.values(out);
}
