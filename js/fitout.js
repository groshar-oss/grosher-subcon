// קליטת קובץ פרויקט מתוכנת התמחיר (.fitout.json). פונקציות טהורות.
// החישוב זהה למנוע של תוכנת התמחיר: עלות יחידה, תקורות אתר, מקדם העמסה K, ומחיר הגשה לכל סעיף (או מחיר נעול).
const num = v => { const x = Number(String(v ?? '').replace(/[,₪\s]/g, '')); return isFinite(x) ? x : 0; };
const r2 = v => Math.round(v * 100) / 100;

export const isFitout = d => !!d && typeof d === 'object' && Array.isArray(d.items) && Array.isArray(d.chapters) && d.loading && d.meta;

const breakdownCost = c => num(c.material) * (1 + num(c.waste) / 100) + num(c.labor) + num(c.protection);
function itemCosts(it) {
  const est = it.costMode === 'simple' ? num(it.unitCost) : breakdownCost(it.cost || {});
  const q = (it.quotes || [])[it.selectedQuote];
  const hasQuote = q && num(q.price) > 0;
  const costUnit = hasQuote ? num(q.price) : est;
  const sellBase = hasQuote && (it.sellFromQuote || est === 0) ? costUnit : est;
  return { est, costUnit, sellBase, quote: hasQuote ? q : null };
}
function ohMult(oh, M, direct) {
  const editable = ['months', 'floors', 'area'].includes(oh.basis);
  if (editable && oh.qtyOverride != null && oh.qtyOverride !== '') return num(oh.qtyOverride);
  return { months: num(M.months), floors: num(M.floors), area: num(M.grossArea), percent: direct / 100 }[oh.basis] ?? 1;
}

/** מחשב את הפרויקט כמו תוכנת התמחיר ומחזיר סעיפים עם מחיר מכירה ועלות */
export function fitoutCompute(d) {
  const L = d.loading || {}, M = d.meta || {};
  const ch = Object.fromEntries(d.chapters.map(c => [c.id, c]));
  const rows = d.items.map(it => ({ it, c: itemCosts(it), qty: num(it.qty) }));
  const direct = rows.filter(r => !r.it.isOption).reduce((a, r) => a + r.c.costUnit * r.qty, 0);
  const overheads = (d.overheads || []).map(oh => { const jp = oh.basis !== 'months' || oh.jobPct == null || oh.jobPct === '' ? 100 : num(oh.jobPct);
    return { name: oh.name, total: num(oh.rate) * jp / 100 * ohMult(oh, M, direct) }; });
  const siteOH = overheads.reduce((a, o) => a + o.total, 0);
  const K = (direct > 0 ? 1 + siteOH / direct : 1) * (1 + num(L.officeOverheadPct) / 100) * (1 + num(L.contingencyPct) / 100) * (1 + num(L.profitPct) / 100);
  const items = rows.map(({ it, c, qty }) => {
    const locked = it.sellOverride != null && it.sellOverride !== '';
    const sell = locked ? num(it.sellOverride) : r2(c.sellBase * K);
    const chap = ch[it.chapterId];
    // שורות תמחיר: סעיף מפורט = חומר (עם פחת) + עבודה בקבלנות; סעיף פשוט / הצעת ספק = קבלן משנה או ספק
    const cb = it.cost || {};
    const lines = c.quote || it.costMode === 'simple' || !(num(cb.material) || num(cb.labor) || num(cb.protection))
      ? (c.costUnit ? [{ kind: 'sub', description: c.quote ? `הצעת ${c.quote.supplier || 'ספק'}` : 'עלות לפי תוכנת התמחיר', qty, unit: it.unit || null, unit_cost: r2(c.costUnit), waste_pct: 0 }] : [])
      : [num(cb.material) && { kind: 'material', description: 'חומר', qty, unit: it.unit || null, unit_cost: r2(num(cb.material)), waste_pct: num(cb.waste) },
         (num(cb.labor) + num(cb.protection)) && { kind: 'piece', description: num(cb.protection) ? 'עבודה, הגנה ודבק' : 'עבודה בקבלנות', qty, unit: it.unit || null, unit_cost: r2(num(cb.labor) + num(cb.protection)), waste_pct: 0 }].filter(Boolean);
    return { code: it.code || '', chapter: chap ? `${chap.code} ${chap.name}`.trim() : '', description: String(it.desc || '').trim(), unit: it.unit || '', qty, sell, cost: r2(c.costUnit),
      option: !!it.isOption, optionType: it.optionType, locked, lines, note: it.note || '' };
  });
  const main = items.filter(i => !i.option);
  const sellTotal = main.reduce((a, i) => a + i.sell * i.qty, 0);
  return { meta: M, loading: L, items, main, options: items.filter(i => i.option), direct, siteOH, overheads, K, sellTotal,
    siteOHPct: direct ? siteOH / direct * 100 : 0, name: d.name || M.address || '' };
}

/** הופך את הפרויקט לגיליון "וירטואלי" שהקליטה הרגילה יודעת לקרוא: כותרות, שורת פרק, ושורות סעיפים (בלי חלופות) */
export function fitoutSheet(d) {
  const r = fitoutCompute(d);
  const rows = [['קוד סעיף', 'תיאור', 'יחידה', 'כמות', 'מחיר יחידה', 'סה"כ']];
  let last = null;
  for (const i of r.main) {
    if (i.chapter !== last) { rows.push(['', i.chapter, '', '', '', '']); last = i.chapter; }
    rows.push([i.code, i.description, i.unit, String(i.qty), String(i.sell), String(r2(i.sell * i.qty))]);
  }
  return { name: `תוכנת התמחיר · ${r.name}`, rows, fitout: r };
}
