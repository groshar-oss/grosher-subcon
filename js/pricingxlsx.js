// קליטת קובץ אקסל שיוצא מתוכנת התמחיר (גיליונות "ריכוז", "ניתוח עלויות", "תקורות", "הכנה להגשה").
// מחזיר אותו מבנה כמו קובץ ‎.fitout.json‏ (fitoutCompute), כך שהקליטה הרגילה יודעת לקלוט ממנו מכירה, עלות ותקורות. פונקציות טהורות.
const num = v => { const x = Number(String(v ?? '').replace(/[,₪\s%]/g, '')); return isFinite(x) ? x : 0; };
const r2 = v => Math.round(v * 100) / 100;
const txt = v => String(v ?? '').trim();
const norm = s => txt(s).replace(/["'״׳`]/g, '').replace(/\s+/g, ' ');

const findSheet = (sheets, ...names) => sheets.find(s => names.some(nm => norm(s.name) === norm(nm)));
export const isPricingXlsx = sheets => !!(findSheet(sheets, 'ניתוח עלויות') && findSheet(sheets, 'הכנה להגשה'));

// מיקום עמודה לפי כותרת (התאמה רופפת: בלי גרשיים ורווחים כפולים)
function cols(row, spec) {
  const h = row.map(norm), out = {};
  for (const [k, names] of Object.entries(spec)) { const i = h.findIndex(x => names.some(nm => x === norm(nm))); if (i >= 0) out[k] = i; }
  return out;
}
const headerRow = (rows, must) => rows.findIndex(r => must.every(m => r.map(norm).includes(norm(m))));

// יחידה לתקורה לפי הבסיס שלה
const ohUnit = basis => /חודש/.test(basis) ? 'חודש' : /שטח|מ"ר|מר/.test(basis) ? 'מ"ר' : /קומ/.test(basis) ? 'קומה' : "קומפ'";

export function pricingFromSheets(sheets) {
  const an = findSheet(sheets, 'ניתוח עלויות'), sub = findSheet(sheets, 'הכנה להגשה'), oh = findSheet(sheets, 'תקורות'), sum = findSheet(sheets, 'ריכוז');
  // ניתוח עלויות: עלות לכל סעיף ופירוק חומר / פחת / עבודה / הגנה
  const ah = headerRow(an.rows, ['סעיף', 'תיאור']);
  const ac = cols(an.rows[ah] || [], { code: ['סעיף'], cost: ["עלות יח' בפועל", "עלות יח'", "עלות יח' (אומדן)"], material: ['חומר'], waste: ['פחת %', 'פחת'], labor: ['עבודה'], prot: ['הגנה/דבק', 'הגנה'], sell: ["מחיר מועמס יח'"], unit: ["יח'", 'יחידה'], qty: ['כמות'], desc: ['תיאור'] });
  const costBy = {};
  for (const r of an.rows.slice(ah + 1)) { const code = txt(r[ac.code]); if (code) costBy[code] = r; }
  // הכנה להגשה: כתב הכמויות למזמין, פרקים, וחלופות (אחרי השורה "חלופות")
  const sh = headerRow(sub.rows, ['סעיף', 'תיאור']);
  const scol = cols(sub.rows[sh] || [], { code: ['סעיף'], desc: ['תיאור'], unit: ["יח'", 'יחידה'], qty: ['כמות'], price: ['מחיר יחידה'], total: ['סה"כ'] });
  const items = []; let chapter = '', option = false, fileSell = null;
  for (const r of sub.rows.slice(sh + 1)) {
    const code = txt(r[scol.code]), desc = txt(r[scol.desc]), qtyS = txt(r[scol.qty]);
    if (/^חלופות/.test(desc)) { option = true; continue; }
    if (!code && /סה"?כ לפני מע"?מ/.test(desc)) { fileSell = num(r[scol.total]); continue; }
    if (!code) continue; // שורות סיכום
    if (!qtyS && /פרק/.test(desc)) { // "חדרים חדשים · פרק א.1 — בנייה – גבס"
      const m = desc.match(/^(.*?)\s*·?\s*פרק\s+(\S+)\s*[—–-]\s*(.+)$/);
      chapter = m ? `${m[2]} ${m[1] ? m[1].replace(/\s*·\s*$/, '') + ' · ' : ''}${m[3]}`.trim() : `${code} ${desc}`;
      continue;
    }
    const qty = num(qtyS), sell = num(r[scol.price]);
    if (!qty && !sell) continue; // שורה ריקה
    const a = costBy[code] || [];
    const cost = num(a[ac.cost]), mat = num(a[ac.material]), lab = num(a[ac.labor]), prot = num(a[ac.prot]), unit = txt(r[scol.unit]) || txt(a[ac.unit]);
    const lines = (mat || lab || prot)
      ? [mat && { kind: 'material', description: 'חומר', qty, unit: unit || null, unit_cost: r2(mat), waste_pct: num(a[ac.waste]) },
         (lab + prot) && { kind: 'piece', description: prot ? 'עבודה, הגנה ודבק' : 'עבודה בקבלנות', qty, unit: unit || null, unit_cost: r2(lab + prot), waste_pct: 0 }].filter(Boolean)
      : cost ? [{ kind: 'sub', description: 'עלות לפי תוכנת התמחיר', qty, unit: unit || null, unit_cost: r2(cost), waste_pct: 0 }] : [];
    items.push({ code, chapter, description: desc.replace(/^\[[^\]]*\]\s*/, ''), unit, qty, sell, cost, option, lines });
  }
  // תקורות אתר: כל שורה עם סכום, עם הפירוק (תעריף × אחוז משרה × משך)
  const overheads = [];
  if (oh) {
    const oh0 = headerRow(oh.rows, ['תיאור', 'בסיס']);
    const oc = cols(oh.rows[oh0] || [], { name: ['תיאור'], basis: ['בסיס'], rate: ['תעריף'], pct: ['אחוז משרה'], dur: ['משך / כמות', 'משך', 'כמות'], total: ['סה"כ'] });
    for (const r of oh.rows.slice(oh0 + 1)) {
      const name = txt(r[oc.name]), total = num(r[oc.total]); if (!name || /^סה"?כ/.test(name) || !total) continue;
      const basis = txt(r[oc.basis]), rate = num(r[oc.rate]), pct = txt(r[oc.pct]) === '' ? 100 : num(r[oc.pct]), dur = num(r[oc.dur]);
      let line = { kind: 'other', description: name, qty: 1, unit: "קומפ'", unit_cost: r2(total), waste_pct: 0 };
      if (!/%/.test(basis) && rate && dur && Math.abs(rate * pct / 100 * dur - total) < 1) {
        const u = ohUnit(basis);
        line = { kind: 'other', description: `${name}${pct !== 100 ? ` (${pct}% משרה)` : ''}`, qty: r2(dur * pct / 100), unit: u, unit_cost: r2(rate), waste_pct: 0 };
      } else if (/%/.test(basis) && rate) line.description = `${name} (${rate}% מהעלות הישירה)`;
      overheads.push({ name, total: r2(total), unit: line.unit, lines: [line] });
    }
  }
  // ריכוז: סכומי הבדיקה
  const S = {}; let client = '', pname = '';
  for (const r of sum?.rows || []) {
    const k = norm(r[1] || r[0]), k0 = norm(r[0]), v = num(r[2]);
    if (k0 === 'לקוח') client = txt(r[1]); if (k0 === 'ריכוז פרויקט') pname = txt(r[1]);
    const map = { 'סה"כ עלות ישירה': 'direct', 'תקורות אתר': 'siteOH', 'תקורות משרד': 'office', 'בלת"מ': 'reserve', 'רווח מבוקש': 'profit', 'מחיר לפי נוסחה': 'formula', 'מחיר הגשה בפועל': 'final' };
    for (const [lbl, key] of Object.entries(map)) if (k === norm(lbl) && r[2] !== '' && r[2] != null) S[key] = v;
  }
  const main = items.filter(i => !i.option);
  const direct = main.reduce((a, i) => a + i.cost * i.qty, 0), sellTotal = main.reduce((a, i) => a + i.sell * i.qty, 0);
  const siteOH = overheads.reduce((a, o) => a + o.total, 0);
  return { source: 'xlsx', meta: { client }, items, main, options: items.filter(i => i.option), direct, siteOH, overheads, K: direct ? sellTotal / direct : 1, sellTotal,
    siteOHPct: direct ? siteOH / direct * 100 : 0, office: n0(S.office), reserve: n0(S.reserve), profit: S.profit ?? null, fileSell, summary: S, name: pname };
}
const n0 = v => v ? r2(v) : 0;

/** גיליון "וירטואלי" לקליטה הרגילה, כמו fitoutSheet */
export function pricingSheet(sheets) {
  const r = pricingFromSheets(sheets);
  const rows = [['קוד סעיף', 'תיאור', 'יחידה', 'כמות', 'מחיר יחידה', 'סה"כ']];
  let last = null;
  for (const i of r.main) {
    if (i.chapter !== last) { rows.push(['', i.chapter, '', '', '', '']); last = i.chapter; }
    rows.push([i.code, i.description, i.unit, String(i.qty), String(i.sell), String(r2(i.sell * i.qty))]);
  }
  return { name: `קובץ תמחור · ${r.name || 'אקסל'}`, rows, fitout: r };
}
