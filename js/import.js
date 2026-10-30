// קליטת כתב כמויות מאקסל בכל מבנה. פונקציות טהורות (מקבלות מערך שורות של טקסט).
import { n } from './calc.js';

export const COLS = { code: 'קוד סעיף', description: 'תיאור', unit: 'יחידה', qty: 'כמות', unit_price: 'מחיר יחידה', total: 'סה"כ' };

const RX = {
  code: /^(סעיף|מס['׳"]?\s*סעיף|קוד(\s*סעיף)?|מס['׳]?|מספר|מק["״]?ט)$/,
  description: /תיאור|תאור|פירוט|תכולה|תיאור\s*העבודה/,
  unit: /^(יח['׳]?|יחידה|יחידת\s*מידה|יח['׳]?\s*מידה)$/,
  qty: /כמות/,
  unit_price: /מחיר|עלות\s*יח|תעריף/,
  total: /סה["״']?כ|סכום|סך\s*הכל|^מחיר\s*כולל/
};
const clean = s => String(s ?? '').replace(/\s+/g, ' ').trim();
const SUMMARY = /^(סה["״']?כ|ריכוז|סיכום|סך הכל|הנחה|מע["״]?מ|תוספת מע)/;
const ALT = /חלופ/;

export function findHeader(rows) {
  let best = null;
  for (let r = 0; r < Math.min(rows.length, 40); r++) {
    const map = {};
    rows[r].forEach((cell, c) => {
      const v = clean(cell);
      if (!v || v.length > 40) return;
      for (const k of ['total', 'unit_price', 'qty', 'unit', 'description', 'code']) {
        if (map[k] !== undefined) continue;
        if (k === 'unit_price' && RX.total.test(v) && !/יח/.test(v)) continue;
        if (k === 'total' && /יח/.test(v)) continue;
        if (RX[k].test(v) && !Object.values(map).includes(c)) { map[k] = c; break; }
      }
    });
    const score = Object.keys(map).length;
    if (map.description !== undefined && (map.qty !== undefined || map.unit_price !== undefined) && (!best || score > best.score)) best = { row: r, map, score };
  }
  return best;
}

const looksLikeHeaderRow = (row, map) => RX.description.test(clean(row[map.description])) && (map.qty === undefined || RX.qty.test(clean(row[map.qty])));

export function parseBoq(rows, mapOverride) {
  const head = findHeader(rows);
  if (!head && !mapOverride) return { ok: false, error: 'לא נמצאה שורת כותרות עם עמודת תיאור וכמות או מחיר. אפשר לבחור עמודות ידנית.' };
  const map = { ...(head?.map || {}), ...(mapOverride || {}) };
  const start = (mapOverride?.headerRow ?? head?.row ?? -1) + 1;
  const items = []; let chapter = ''; let inAlt = false; let skipped = 0;
  for (let r = start; r < rows.length; r++) {
    const row = rows[r] || [];
    const get = k => map[k] === undefined || map[k] === '' ? '' : clean(row[map[k]]);
    const code = get('code'), desc = get('description'), unit = get('unit');
    const qtyS = get('qty'), priceS = get('unit_price'), totalS = get('total');
    const all = row.map(clean).filter(Boolean);
    if (!all.length) continue;
    if (looksLikeHeaderRow(row, map)) { skipped++; continue; }
    const text = desc || code || all[0];
    if (ALT.test(all.join(' '))) { inAlt = true; skipped++; continue; }
    if (SUMMARY.test(text) || SUMMARY.test(code)) { skipped++; continue; }
    const hasNums = [qtyS, priceS, totalS].some(v => v !== '' && isFinite(n(v)) && n(v) !== 0);
    const isChapter = !unit && !hasNums && (desc || code) && !(desc && code && /\d/.test(code) && code.split(/[.\-]/).length > 2);
    if (isChapter || /^פרק\b/.test(code) || /^פרק\b/.test(desc)) {
      chapter = clean([code, desc].filter(Boolean).join(' '));
      inAlt = false;
      continue;
    }
    if (inAlt) { skipped++; continue; }
    if (!desc && !code) { skipped++; continue; }
    const qty = qtyS === '' ? null : n(qtyS);
    const unit_price = priceS === '' ? null : n(priceS);
    const fileTotal = totalS === '' ? null : n(totalS);
    const missing = [];
    if (!qty) missing.push('כמות');
    if (!unit_price) missing.push('מחיר');
    items.push({ chapter, code, description: desc || code, unit, qty, unit_price, fileTotal, missing, row: r + 1 });
  }
  const calcTotal = items.reduce((s, i) => s + n(i.qty) * n(i.unit_price), 0);
  const fileTotal = items.reduce((s, i) => s + n(i.fileTotal), 0);
  return { ok: true, map, headerRow: start - 1, items, calcTotal, fileTotal, hasFileTotal: items.some(i => i.fileTotal !== null), skipped };
}

// קריאת קובץ אקסל לשורות טקסט (XLSX גלובלי מ-SheetJS)
export async function readWorkbook(file) {
  const XLSX = await loadXLSX();
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array', cellDates: false });
  return wb.SheetNames.map(name => ({ name, rows: XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: false, defval: '', blankrows: false }) }));
}

let xlsxP;
export function loadXLSX() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  return xlsxP ||= new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = new URL('../vendor/xlsx.full.min.js', import.meta.url).href;
    s.onload = () => res(window.XLSX); s.onerror = () => rej(new Error('טעינת רכיב האקסל נכשלה. נסה לרענן את הדף.'));
    document.head.appendChild(s);
  });
}

// בחירת הגיליון המתאים ביותר: זה שיש בו הכי הרבה סעיפים
export function bestSheet(sheets) {
  let best = null;
  for (const s of sheets) {
    const p = parseBoq(s.rows);
    if (p.ok && (!best || p.items.length > best.parsed.items.length)) best = { ...s, parsed: p };
  }
  return best;
}
