// עזרים משותפים למסכים
import { projectSummary, actualsByItem, overrunLevel, PROFIT_MODES } from '../calc.js';
import { money, pct, esc } from '../util.js';
import { S, settings } from '../app.js';
import { entryCosts, entriesAsCosts, openCommitments, quotaRows } from '../quota.js';
import { computeBills } from '../bills.js';
import { has, fixedLeft } from '../modules.js';

export const STATUS = { tender: 'מכרז / הצעה', active: 'בביצוע', closing: 'לקראת סיום', closed: 'סגור' };
export const CONTRACT = { measure: 'לפי מדידה', milestones: 'פאושלי לפי אבני דרך', percent: 'לפי אחוז ביצוע', mixed: 'משולב' };

export function projData(data, projectId) {
  const f = arr => (arr || []).filter(x => x.project_id === projectId);
  return { project: data.projects.find(p => p.id === projectId), items: f(data.items), lines: f(data.lines), variations: f(data.vos), expenses: f(data.expenses),
    entries: f(data.entries), days: f(data.days), wqty: f(data.wqty), pos: f(data.pos), poLines: f(data.poLines),
    bills: f(data.bills), billLines: f(data.billLines), fines: f(data.fines), payments: f(data.payments),
    workers: data.workers || [], allEntries: data.entries || [], contracts: f(data.contracts), cLines: f(data.cLines),
    cos: f(data.cos), coLines: f(data.coLines), cbills: f(data.cbills), cbLines: f(data.cbLines), income: f(data.income), signoffs: f(data.signoffs), fixedCosts: f(data.fixedCosts), units: f(data.units || []), indexSeries: data.indexSeries || [] };
}

// סיכום פרויקט: הוצאות + עלות עבודה מהיומן + התקשרויות רכש פתוחות, ומכסות
export function summarize(pd, mode = S.mode) {
  const st = settings();
  const costs = entryCosts({ entries: pd.entries || [], allEntries: pd.allEntries || [], workers: pd.workers || [], lines: pd.lines, settings: st });
  const all = pd.expenses.concat(entriesAsCosts(pd.entries || [], costs));
  const act = actualsByItem(pd.items, pd.lines, all, pd.project?.overhead_pct);
  const com = openCommitments(pd.pos || [], pd.poLines || [], pd.expenses);
  // עלויות חודשיות קבועות: מה שנשאר מהחודש הנוכחי נחשב התקשרות פתוחה של הסעיף
  if (has(pd.project, 'fixed')) { const cur = new Date().toISOString().slice(0, 7);
    for (const fc of pd.fixedCosts || []) { const left = fixedLeft(fc, cur); if (!left) continue;
      if (fc.boq_item_id) com.byItem[fc.boq_item_id] = (com.byItem[fc.boq_item_id] || 0) + left; else com.unassigned += left; } }
  const s = projectSummary({ ...pd, actualByItem: act.byItem, commitByItem: com.byItem }, mode);
  s.unallocated = act.unallocated;
  s.costs = costs;
  s.laborCost = Object.values(costs).reduce((a, c) => a + c.cost, 0);
  s.commitOpen = Object.values(com.byItem).reduce((a, x) => a + x, 0) + com.unassigned;
  s.quotas = pd.lines.length ? quotaRows({ items: pd.items, lines: pd.lines, entries: pd.entries || [], costs, workers: pd.workers || [], pos: pd.pos, poLines: pd.poLines, expenses: pd.expenses, settings: st }) : [];
  s.billing = computeBills({ project: pd.project, items: pd.items, variations: pd.variations, bills: pd.bills || [], lines: pd.billLines || [], fines: pd.fines || [], payments: pd.payments || [], vatPct: st.vat_pct });
  return s;
}

export function level(p) { return overrunLevel(p, settings().crit_pct); }
export const levelColor = cls => ({ 'al-y': '#f2c400', 'al-o': '#ff9f43', 'al-r': '#ef5350', 'al-dr': '#b71c1c' }[cls] || '#2fb36b');
export const levelBg = cls => ({ 'al-y': 'var(--y)', 'al-o': 'var(--o)', 'al-r': 'var(--r)', 'al-dr': 'var(--dr)' }[cls] || 'var(--g)');

// שורת טבלה צבועה לפי חריגה, עם התכהות מעל 10%
export function rowAttr(ovr) {
  const l = level(ovr);
  const style = l.cls === 'al-dr' && l.depth ? ` style="--drx:color-mix(in srgb, var(--dr) ${Math.round(100 - l.depth * 45)}%, #6d0d0d)"` : '';
  return { cls: l.cls, style, crit: l.crit };
}

export const modeLine = () => `<span class="mut small">תצוגה: ${esc(PROFIT_MODES[S.mode])}</span>`;
export const ovrText = v => pct(v, { sign: true });
export const legend = () => `<div class="legend"><span><i style="background:var(--y)"></i>עד 3%</span><span><i style="background:var(--o)"></i>3%-5%</span><span><i style="background:var(--r)"></i>5%-10%</span><span><i style="background:var(--dr)"></i>מעל 10% (מתכהה)</span><span>סף קריטי: ${settings().crit_pct}%</span></div>`;
export { money, pct };
