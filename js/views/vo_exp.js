// הוראות שינוי (תוספות ושינויים) והוצאות בפועל
import { h, esc, $, $$, modal, field, select, area, toast, money, pct, fmtDate, confirmBox, numOrNull, nullIfEmpty } from '../util.js';
import { db } from '../db.js';
import { S, can, render, logChange, settings, modeSwitch } from '../app.js';
import { n, VO_STATUS, VO_APPROVED, VO_AT_RISK, EXPENSE_KINDS, EXPENSE_STATUS, itemSale } from '../calc.js';
import { tabBoq } from './boq.js';
import { findVendor, vendorStatus, DOC_TYPES } from '../docs.js';
import { attachBtn, wireAttach } from '../files.js';

const SOURCES = { change_order: 'הוראת שינוי', supervisor: 'הוראת מפקח', main_request: 'בקשת הקבלן הראשי', daywork: 'עבודת רג\'י' };
const statusChip = s => `<span class="chip ${VO_APPROVED.includes(s) ? 'green' : VO_AT_RISK.includes(s) ? 'red' : s === 'rejected' ? '' : 'blue'}">${VO_STATUS[s]}</span>`;

// ===== הוראות שינוי =====
export function tabVo(P) {
  const groups = P.summary.voGroups;
  const sum = (arr, f) => arr.reduce((a, g) => a + f(g), 0);
  const appr = groups.filter(g => VO_APPROVED.includes(g.vo.status)), risk = groups.filter(g => VO_AT_RISK.includes(g.vo.status));
  const el = h(`<div>
    <div class="note">הוראות שינוי מנוהלות בנפרד מהחוזה: לכל הוראה סעיפים, תמחיר והוצאות משלה, והרווחיות שלהן מוצגת בנפרד. הוצאה שמשויכת להוראת שינוי לא נספרת בעלות סעיפי החוזה.</div>
    <div class="kpis" style="grid-template-columns:repeat(4,1fr)">
      <div class="kpi"><div class="l">הוראות שינוי מאושרות</div><div class="v pos">${money(sum(appr, g => g.approvedSale))}</div><div class="n">${appr.length} הוראות · רווח צפוי ${money(sum(appr, g => g.approvedSale - g.forecast))}</div></div>
      <div class="kpi"><div class="l">ממתינים לאישור / בוצעו בלי אישור</div><div class="v ${risk.length ? 'neg' : ''}">${money(sum(risk, g => g.requested))}</div><div class="n">${risk.length} הוראות · כבר הוצא ${money(sum(risk, g => g.actual))}</div></div>
      <div class="kpi"><div class="l">עלות בפועל על הוראות שינוי</div><div class="v">${money(sum(groups, g => g.actual))}</div></div>
      <div class="kpi"><div class="l">נדחו</div><div class="v">${money(sum(groups.filter(g => g.vo.status === 'rejected'), g => g.requested))}</div><div class="n">עלות שהוצאה: ${money(sum(groups.filter(g => g.vo.status === 'rejected'), g => g.actual))}</div></div>
    </div>
    ${can.edit() ? '<div class="actions" style="margin-bottom:12px"><button class="btn" id="add">+ הוראת שינוי חדשה</button></div>' : ''}
    <div id="list"></div></div>`);
  const list = $('#list', el);
  if (!groups.length) list.innerHTML = '<div class="card empty">אין הוראות שינוי בפרויקט</div>';
  for (const g of groups) {
    const v = g.vo, sale = VO_APPROVED.includes(v.status) ? g.approvedSale : g.requested;
    const d = h(`<details class="card" ${v.status === 'executed_unapproved' ? 'open' : ''}><summary style="cursor:pointer;list-style:none">
      <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center"><div><b>${esc(v.number)}</b> ${esc(v.title)} ${statusChip(v.status)}
        <div class="small mut">${SOURCES[v.source]} · ${v.has_written_order ? 'יש הוראה בכתב' : '<span class="neg">אין הוראה בכתב</span>'}${v.vo_date ? ' · ' + fmtDate(v.vo_date) : ''}</div></div>
        <div class="pr" style="grid-template-columns:repeat(5,auto);gap:16px"><div>מבוקש<b>${money(g.requested)}</b></div><div>מאושר<b>${VO_APPROVED.includes(v.status) ? money(g.approvedSale) : '—'}</b></div><div>תמחיר<b>${money(g.planned)}</b></div><div>בפועל<b>${money(g.actual)}</b></div><div>רווח צפוי<b class="${sale - g.forecast < 0 ? 'neg' : ''}">${money(sale - g.forecast)}</b></div></div></div></summary>
      ${v.notes ? `<p class="small">${esc(v.notes)}</p>` : ''}
      ${v.status === 'executed_unapproved' ? `<div class="note neg">הוראת השינוי בוצעה ועדיין לא אושרה. ${money(g.requested)} בסיכון. כדאי לצרף תמונות לפני ואחרי ויומני עבודה ולהגיש הוראת שינוי.</div>` : ''}
      ${can.edit() ? `<div class="actions" style="margin:8px 0"><button class="btn small ghost" data-ed="${v.id}">עריכת הוראה וסטטוס</button><a class="btn small ghost" href="#/project/${P.id}/costing">תמחיר ההוראה</a><button class="btn small ghost" data-del="${v.id}">מחיקה</button>${can.expense() ? attachBtn(P.data.files, 'variations', v.id, { projectId: P.id, docType: 'vo', label: `${v.number} ${v.title}` }) : ''}</div>` : ''}
      <div data-items></div></details>`);
    $('[data-items]', d).appendChild(tabBoq(P, v.id));
    list.appendChild(d);
  }
  wireAttach(el, P.data.files || [], render);
  $('#add', el)?.addEventListener('click', () => voDialog(P));
  $$('[data-ed]', el).forEach(b => b.onclick = () => voDialog(P, P.pd.variations.find(v => v.id === b.dataset.ed)));
  $$('[data-del]', el).forEach(b => b.onclick = async () => {
    const v = P.pd.variations.find(x => x.id === b.dataset.del);
    if (!(await confirmBox('מחיקת הוראת שינוי', `למחוק את ${v.number}? הסעיפים והתמחיר שלה יימחקו. הוצאות שמשויכות אליה יעברו ל"כללי לפרויקט".`, 'מחיקה', true))) return;
    await db.remove('variations', v.id);
    await logChange({ project_id: P.id, entity: 'variation', entity_id: v.id, label: `${v.number} ${v.title}`, field: 'מחיקת הוראת שינוי' });
    toast('הוראת השינוי נמחקה'); render();
  });
  return el;
}

async function voDialog(P, v) {
  const next = 'VO-' + String(P.pd.variations.length + 1).padStart(2, '0');
  const body = `<div class="grid g2">${field('מספר', 'number', v?.number || next, { req: true })}${field('תאריך', 'vo_date', v?.vo_date || new Date().toISOString().slice(0, 10), { type: 'date' })}</div>
    ${field('תיאור הוראת השינוי', 'title', v?.title, { req: true })}
    <div class="grid g2">${select('מקור', 'source', SOURCES, v?.source || 'change_order')}${select('סטטוס', 'status', VO_STATUS, v?.status || 'draft')}</div>
    <label class="chk"><input type="checkbox" name="has_written_order" ${v?.has_written_order ? 'checked' : ''}> יש הוראת שינוי / הוראה בכתב</label>
    ${field('סכום מאושר ₪ (לאישור חלקי)', 'approved_amount', v?.approved_amount, { type: 'number', hint: 'ריק = כל הסכום המבוקש' })}
    ${area('הערות', 'notes', v?.notes)}
    ${v ? field('סיבת השינוי (לשינוי סטטוס או סכום)', 'reason', '') : ''}
    ${v ? '' : '<p class="small mut">אחרי השמירה מוסיפים להוראה סעיפים (כמות × מחיר), ואז תמחיר.</p>'}`;
  const d = await modal({ title: v ? `עריכת ${v.number}` : 'הוראת שינוי חדשה', body, validate: x => {
    if (!x.number.trim() || !x.title.trim()) return 'חסר מספר או תיאור';
    if (x.status === 'partial' && !n(x.approved_amount)) return 'באישור חלקי צריך סכום מאושר';
    return null;
  } });
  if (!d) return;
  const row = { number: d.number.trim(), title: d.title.trim(), vo_date: nullIfEmpty(d.vo_date), source: d.source, status: d.status, has_written_order: !!d.has_written_order, approved_amount: numOrNull(d.approved_amount), notes: d.notes };
  if (v) {
    await db.update('variations', v.id, row);
    for (const k of ['status', 'approved_amount']) if (String(v[k] ?? '') !== String(row[k] ?? ''))
      await logChange({ project_id: P.id, entity: 'variation', entity_id: v.id, label: `${row.number} ${row.title}`, field: k === 'status' ? 'סטטוס' : 'סכום מאושר', old_value: k === 'status' ? VO_STATUS[v[k]] : v[k], new_value: k === 'status' ? VO_STATUS[row[k]] : row[k], reason: d.reason });
  } else {
    const [nv] = await db.insert('variations', { tenant_id: S.tenantId, project_id: P.id, ...row });
    await logChange({ project_id: P.id, entity: 'variation', entity_id: nv.id, label: `${row.number} ${row.title}`, field: 'הוראת שינוי חדשה', new_value: VO_STATUS[row.status] });
  }
  toast('נשמר'); render();
}

// ===== הוצאות =====
export function tabExpenses(P) {
  const vos = Object.fromEntries(P.pd.variations.map(v => [v.id, v]));
  const items = Object.fromEntries(P.pd.items.map(i => [i.id, i]));
  const vat = settings().vat_pct;
  const linkText = e => e.boq_item_id && items[e.boq_item_id] ? `${items[e.boq_item_id].variation_id ? (vos[items[e.boq_item_id].variation_id]?.number || '') + ' · ' : ''}${items[e.boq_item_id].code || ''} ${items[e.boq_item_id].description}`
    : e.variation_id && vos[e.variation_id] ? `${vos[e.variation_id].number} (כל ההוראה)` : 'כללי לפרויקט';
  const F = { q: '', kind: '', status: '' };
  const el = h(`<div>
    <div class="actions" style="margin-bottom:12px">${can.expense() ? '<button class="btn" id="add">+ הוצאה</button>' : ''}
      <input id="q" placeholder="חיפוש ספק, מסמך או תיאור" style="width:220px">
      <select id="fk" style="width:auto"><option value="">כל הסוגים</option>${Object.entries(EXPENSE_KINDS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
      <select id="fs" style="width:auto"><option value="">כל הסטטוסים</option>${Object.entries(EXPENSE_STATUS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>
    ${P.project.project_type === 'dev' ? '<div class="note small">כל הוצאה משייכים לסעיף תקציב ולהתקשרות, כדי שהבקרה תראה כמה חויב ושולם מול כל חוזה.</div>' : '<div class="note small">עלות עובדים נרשמת ביומן העבודה ולא כאן, כדי שלא תיספר פעמיים. חשבונית של ספק מקשרים להזמנת הרכש שלה (לשונית רכש).</div>'}
    <div class="tw"><table><thead><tr><th>תאריך</th><th>ספק</th><th class="hide-m">מסמך</th><th>שיוך</th><th>סוג</th><th class="n">לפני מע"מ</th><th class="n hide-m">כולל מע"מ</th><th>סטטוס</th>${can.expense() ? '<th></th>' : ''}</tr></thead><tbody id="tb"></tbody></table></div></div>`);
  const draw = () => {
    const q = F.q.trim();
    const rows = P.pd.expenses.filter(e => (!F.kind || e.kind === F.kind) && (!F.status || e.status === F.status) && (!q || [e.supplier_name, e.doc_no, e.description, linkText(e)].join(' ').includes(q)));
    const tot = rows.reduce((a, e) => a + n(e.amount), 0), totV = rows.reduce((a, e) => a + n(e.amount) * (1 + n(e.vat_pct ?? vat) / 100), 0);
    $('#tb', el).innerHTML = rows.map(e => `<tr><td>${fmtDate(e.doc_date)}</td><td>${esc(e.supplier_name || '')}<div class="small mut">${esc(e.description || '')}</div></td><td class="hide-m">${esc(e.doc_no || '')}</td>
      <td class="wrap small">${esc(linkText(e))}</td><td>${EXPENSE_KINDS[e.kind]}</td><td class="n">${money(e.amount)}</td><td class="n hide-m">${money(n(e.amount) * (1 + n(e.vat_pct ?? vat) / 100))}</td><td>${EXPENSE_STATUS[e.status]}</td>
      ${can.expense() ? `<td style="white-space:nowrap">${attachBtn(P.data.files, 'expenses', e.id, { projectId: P.id, docType: 'invoice', label: `${e.supplier_name || ''} ${e.doc_no || ''}`.trim() })} <button class="btn small ghost" data-ed="${e.id}">עריכה</button> <button class="btn small ghost" data-del="${e.id}" aria-label="מחיקה">✕</button></td>` : ''}</tr>`).join('')
      + (rows.length ? `<tr class="tot"><td></td><td>סה"כ (${rows.length})</td><td class="hide-m"></td><td></td><td></td><td class="n">${money(tot)}</td><td class="n hide-m">${money(totV)}</td><td></td>${can.expense() ? '<td></td>' : ''}</tr>` : `<tr><td colspan="9" class="empty">אין הוצאות</td></tr>`);
    wireAttach(el, P.data.files || [], render);
    $$('[data-ed]', el).forEach(b => b.onclick = () => expenseDialog(P, P.pd.expenses.find(x => x.id === b.dataset.ed)));
    $$('[data-del]', el).forEach(b => b.onclick = async () => {
      const x = P.pd.expenses.find(y => y.id === b.dataset.del);
      if (!(await confirmBox('מחיקת הוצאה', `למחוק הוצאה של ${x.supplier_name || ''} בסך ${Math.round(n(x.amount)).toLocaleString('en-US')} ₪?`, 'מחיקה', true))) return;
      await db.remove('expenses', x.id);
      await logChange({ project_id: P.id, entity: 'expense', entity_id: x.id, label: `${x.supplier_name || ''} ${x.doc_no || ''}`, field: 'מחיקת הוצאה', old_value: x.amount });
      toast('נמחק'); render();
    });
  };
  draw();
  $('#q', el).oninput = e => { F.q = e.target.value; draw(); };
  $('#fk', el).onchange = e => { F.kind = e.target.value; draw(); };
  $('#fs', el).onchange = e => { F.status = e.target.value; draw(); };
  $('#add', el)?.addEventListener('click', () => expenseDialog(P));
  return el;
}

export async function expenseDialog(P, e, preset = {}) {
  const vat = settings().vat_pct;
  const suppliers = [...new Set(P.data.expenses.map(x => x.supplier_name).concat((P.data.pos || []).map(x => x.supplier_name), (P.data.vendors || []).map(x => x.name)).filter(Boolean))];
  e = e || null;
  const v0 = { ...preset, ...(e || {}) };
  const cur = v0.boq_item_id ? 'i:' + v0.boq_item_id : v0.variation_id ? 'v:' + v0.variation_id : 'g';
  const contract = P.pd.items.filter(i => !i.variation_id);
  const dev = P.project.project_type === 'dev';
  const opts = `<option value="g">${dev ? 'בלי סעיף תקציב' : 'כללי לפרויקט (מתחלק לפי משקל התמחיר)'}</option>
    <optgroup label="${dev ? 'סעיפי תקציב' : 'סעיפי חוזה'}">${contract.map(i => `<option value="i:${i.id}" ${cur === 'i:' + i.id ? 'selected' : ''}>${esc(`${i.code || ''} ${i.description}`.slice(0, 70))}</option>`).join('')}</optgroup>
    ${P.pd.variations.map(v => `<optgroup label="${esc(v.number + ' ' + v.title)}"><option value="v:${v.id}" ${cur === 'v:' + v.id ? 'selected' : ''}>${esc(v.number)}: כל ההוראה</option>${P.pd.items.filter(i => i.variation_id === v.id).map(i => `<option value="i:${i.id}" ${cur === 'i:' + i.id ? 'selected' : ''}>${esc(`${i.code || ''} ${i.description}`.slice(0, 70))}</option>`).join('')}</optgroup>`).join('')}`;
  const pos = (P.pd.pos || []).filter(p => p.status !== 'cancelled' || p.id === v0.po_id);
  const body = `<datalist id="sup">${suppliers.map(s => `<option value="${esc(s)}">`).join('')}</datalist>
    <div class="grid g2">${field('תאריך מסמך', 'doc_date', v0.doc_date || new Date().toISOString().slice(0, 10), { type: 'date', req: true })}${field('ספק / נותן שירות', 'supplier_name', v0.supplier_name, { attrs: 'list="sup"' })}
    ${field('מספר מסמך', 'doc_no', v0.doc_no)}${select('סוג', 'kind', EXPENSE_KINDS, v0.kind || 'material')}</div>
    ${pos.length ? `<label class="fld"><span>הזמנת רכש (התאמה)</span><select name="po_id"><option value="">בלי הזמנה</option>${pos.map(p => `<option value="${p.id}" ${p.id === v0.po_id ? 'selected' : ''}>${esc(`${p.number || ''} · ${p.supplier_name}`)}</option>`).join('')}</select></label>` : ''}
    ${(P.pd.contracts || []).length ? `<label class="fld"><span>התקשרות</span><select name="contract_id" id="ctr"><option value="">בלי התקשרות</option>${P.pd.contracts.filter(c => c.status !== 'cancelled' || c.id === v0.contract_id).map(c => `<option value="${c.id}" ${c.id === v0.contract_id ? 'selected' : ''}>${esc(`${c.number ? c.number + ' · ' : ''}${c.vendor_name || ''} · ${c.title}`.slice(0, 80))}</option>`).join('')}</select></label>` : ''}
    <label class="fld"><span>שיוך לסעיף</span><select name="link" id="lnk">${opts}</select></label>
    <div class="grid g3" id="matq"><label class="fld"><span>שורת חומר בתמחיר</span><select name="cost_line_id" id="cl"></select></label>${field('כמות (למכסת חומר)', 'qty', v0.qty ?? '', { type: 'number' })}${field('יחידה', 'unit', v0.unit || '')}</div>
    ${field('תיאור', 'description', v0.description)}
    <div class="grid g3">${field('סכום לפני מע"מ ₪', 'amount', v0.amount, { type: 'number', req: true })}${field('מע"מ %', 'vat_pct', v0.vat_pct ?? vat, { type: 'number' })}${select('סטטוס', 'status', EXPENSE_STATUS, v0.status || 'invoice')}</div>
    ${field('תאריך תשלום', 'pay_date', v0.pay_date, { type: 'date' })}${area('הערות', 'notes', v0.notes)}<div id="vdoc" class="note neg" hidden></div>`;
  const d = await modal({ title: e ? 'עריכת הוצאה' : 'הוצאה חדשה', body, onMount: el => {
    // אזהרת מסמכים לפי כרטיס הספק
    const vchk = () => { const v = findVendor(P.data.vendors || [], $('[name=supplier_name]', el).value); const box = $('#vdoc', el);
      const st = v && vendorStatus(v, P.data.documents || [], new Date().toISOString().slice(0, 10));
      box.hidden = !st || st.ok; if (st && !st.ok) box.innerHTML = `<b>${esc(v.name)}:</b> ${[...st.expired.map(x => DOC_TYPES[x.doc_type] + ' פג תוקף'), ...st.missing.map(t => 'חסר ' + DOC_TYPES[t])].join(' · ')}. לפני תשלום כדאי לקבל מסמכים מעודכנים (בלי אישור ניכוי במקור בתוקף מנכים מס מלא).`; };
    $('[name=supplier_name]', el).addEventListener('change', vchk); vchk();
    const sync = () => {
      const [t, id] = $('#lnk', el).value.split(':');
      const kind = $('[name=kind]', el).value;
      const ml = t === 'i' ? P.pd.lines.filter(l => l.boq_item_id === id && l.kind === 'material') : [];
      $('#matq', el).hidden = kind !== 'material' || t !== 'i';
      $('#cl', el).innerHTML = `<option value="">${ml.length === 1 ? 'אוטומטי (שורה יחידה)' : ml.length ? 'בחירה' : 'אין שורת חומר'}</option>` + ml.map(m => `<option value="${m.id}" ${m.id === v0.cost_line_id ? 'selected' : ''}>${esc((m.description || 'חומר').slice(0, 40))}</option>`).join('');
      if (ml.length && !$('[name=unit]', el).value) $('[name=unit]', el).value = ml[0].unit || '';
    };
    $('#lnk', el).onchange = sync; $('[name=kind]', el).onchange = sync; sync();
    $('#ctr', el)?.addEventListener('change', () => { const c = P.pd.contracts.find(x => x.id === $('#ctr', el).value); const sn = $('[name=supplier_name]', el);
      if (c && !sn.value.trim()) { sn.value = c.vendor_name || ''; vchk(); }
      const ls = c ? (P.pd.cLines || []).filter(l => l.contract_id === c.id && l.boq_item_id) : [];
      if (ls.length && $('#lnk', el).value === 'g') { $('#lnk', el).value = 'i:' + ls[0].boq_item_id; sync(); } });
  }, validate: x => (!n(x.amount) ? 'חסר סכום' : !x.doc_date ? 'חסר תאריך' : null) });
  if (!d) return;
  const [t, lid] = d.link.split(':');
  const isMat = d.kind === 'material' && t === 'i';
  const row = { doc_date: d.doc_date, supplier_name: d.supplier_name.trim(), doc_no: d.doc_no.trim(), kind: d.kind, description: d.description, amount: n(d.amount), vat_pct: n(d.vat_pct), status: d.status, pay_date: nullIfEmpty(d.pay_date), notes: d.notes,
    boq_item_id: t === 'i' ? lid : null, variation_id: t === 'v' ? lid : (t === 'i' ? P.pd.items.find(i => i.id === lid)?.variation_id || null : null),
    po_id: d.po_id || null, contract_id: d.contract_id || null, cost_line_id: isMat ? (d.cost_line_id || null) : null, qty: isMat ? numOrNull(d.qty) : null, unit: isMat ? (d.unit || null) : null };
  if (row.kind === 'general') { row.boq_item_id = null; }
  if (e) {
    await db.update('expenses', e.id, row);
    if (n(e.amount) !== row.amount) await logChange({ project_id: P.id, entity: 'expense', entity_id: e.id, label: `${row.supplier_name} ${row.doc_no}`, field: 'סכום', old_value: e.amount, new_value: row.amount });
  } else await db.insert('expenses', { tenant_id: S.tenantId, project_id: P.id, ...row });
  toast('ההוצאה נשמרה'); render();
}
