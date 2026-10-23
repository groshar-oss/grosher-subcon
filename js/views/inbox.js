// תיבת מסמכים: העלאה, קריאה חכמה, מסך בדיקה ותיקון, קליטה למערכת, ותיק מסמכים לפרויקט
import { h, esc, $, $$, toast, money, fmtDate, confirmBox, store } from '../util.js';
import { db, isCloud } from '../db.js';
import { S, can, loadTenantData, render, logChange, tenant } from '../app.js';
import { n, EXPENSE_KINDS, VO_STATUS } from '../calc.js';
import { DOC_TYPES, GUAR_KINDS } from '../docs.js';
import { PAY_TYPES } from '../quota.js';
import { INTAKE_TYPES, buildContext, buildPrompt, extractJson, normalize, fillMatches, checks, fileKind } from '../intake.js';
import { uploadFile, openFile, fileBlob, FILE_STATUS, syncDrive } from '../files.js';
import { gconf, gReady, gEnabled, gConnect } from '../google.js';
import { loadXLSX, bestSheet } from '../import.js';

const ACCEPT = '.pdf,.jpg,.jpeg,.png,.webp,.xlsx,.xls,.csv,.docx,.txt,image/*,application/pdf';
const opt = (o, v) => Object.entries(o).map(([k, l]) => `<option value="${esc(k)}" ${String(k) === String(v ?? '') ? 'selected' : ''}>${esc(l)}</option>`).join('');
const SRC = { change_order: 'הוראת שינוי', supervisor: 'הנחיית מפקח', main_request: 'בקשת הקבלן הראשי', daywork: 'עבודות יומיות' };

// ===== מסך התיבה (כללי או לפרויקט) =====
export async function viewInbox(projectId = null, P = null) {
  if (!can.expense()) return h('<div class="card empty">אין הרשאה</div>');
  const data = P?.data || await loadTenantData();
  const all = await db.select('files', { eq: { tenant_id: S.tenantId }, order: 'created_at desc' });
  const files = projectId ? all.filter(f => f.project_id === projectId) : all;
  const F = { tab: store('subcon-inbox-tab') || 'open', type: '', q: '' };
  const pname = id => data.projects.find(p => p.id === id)?.name || '';
  const g = gconf();
  const el = h(`<div>${projectId ? '' : `<div class="top"><div><h1>תיבת מסמכים</h1><div class="sub">זורקים לכאן חוזים, כתבי כמויות, הזמנות, תעודות משלוח, חשבוניות ואישורים. המערכת קוראת, משייכת ומציעה מה להזין. שום דבר לא נכנס בלי אישור.</div></div></div>`}
    <div class="drop" id="drop" tabindex="0" role="button" aria-label="העלאת מסמכים">
      <b>גוררים קבצים לכאן או לוחצים לבחירה</b><span class="small mut">PDF, תמונה מהטלפון, אקסל או Word · אפשר כמה קבצים יחד</span>
      <input type="file" id="fi" multiple accept="${ACCEPT}" hidden></div>
    <div class="actions" style="margin:10px 0 14px">
      ${projectId ? '' : `<label class="small">פרויקט <select id="up_p" style="width:auto"><option value="">המערכת תזהה</option>${data.projects.filter(p => p.status !== 'closed').map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select></label>`}
      <label class="small">סוג <select id="up_t" style="width:auto"><option value="">המערכת תזהה</option>${opt(Object.fromEntries(Object.entries(INTAKE_TYPES).map(([k, v]) => [k, v.label])))}</select></label>
      <span class="sp"></span>
      <span class="gstat small ${gEnabled() && gReady() ? 'pos' : 'mut'}" id="gst">${gEnabled() ? (gReady() ? `מחובר ל-Google Drive${g.lastSync ? ' · סונכרן ' + new Date(g.lastSync).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' }) : ''}` : 'Google Drive: צריך להתחבר מחדש') : 'Google Drive לא מחובר'}</span>
      <button class="btn small ghost" id="gsync">${gEnabled() && gReady() ? 'סנכרון לדרייב עכשיו' : 'חיבור ל-Google Drive'}</button>
    </div>
    <nav class="tabs" id="ft">${[['open', 'ממתינים'], ['done', 'נקלטו'], ['all', 'כל הקבצים']].map(([k, l]) => `<a href="javascript:void 0" data-t="${k}" class="${F.tab === k ? 'on' : ''}">${l} <span class="badge ${k === 'open' ? 'amber' : ''}">${files.filter(f => k === 'all' || (k === 'open' ? ['new', 'review', 'error'].includes(f.status) : ['done', 'stored'].includes(f.status))).length}</span></a>`).join('')}
      <span class="sp"></span><input id="fq" placeholder="חיפוש" style="width:160px"><select id="ftp" style="width:auto"><option value="">כל הסוגים</option>${opt(Object.fromEntries(Object.entries(INTAKE_TYPES).map(([k, v]) => [k, v.label])))}</select></nav>
    <div class="tw"><table><thead><tr><th>קובץ</th><th>סוג</th>${projectId ? '' : '<th class="hide-m">פרויקט</th>'}<th class="hide-m">פרטים</th><th>מצב</th><th class="hide-m">הועלה</th><th></th></tr></thead><tbody id="fl"></tbody></table></div></div>`);

  const draw = () => {
    const rows = files.filter(f => (F.tab === 'all' || (F.tab === 'open' ? ['new', 'review', 'error'].includes(f.status) : ['done', 'stored'].includes(f.status)))
      && (!F.type || f.doc_type === F.type) && (!F.q || `${f.name} ${f.extracted?.vendor_name || ''} ${f.extracted?.doc_no || ''} ${f.note || ''}`.includes(F.q)));
    $('#fl', el).innerHTML = rows.map(f => { const x = f.extracted || {};
      const det = [x.vendor_name || x.main_contractor_name, x.doc_no ? 'מס\' ' + x.doc_no : '', x.amount_net ? '₪' + Math.round(x.amount_net).toLocaleString('en-US') : ''].filter(Boolean).join(' · ');
      return `<tr data-f="${f.id}" class="click"><td><b>${esc(f.name)}</b>${f.drive_id ? ' <span class="small mut" title="יש עותק בגוגל דרייב">☁</span>' : ''}${(f.links || []).length ? `<div class="small mut">${f.links.filter(l => l.label).map(l => esc(l.label)).slice(0, 3).join(' · ')}</div>` : ''}</td>
        <td>${esc(INTAKE_TYPES[f.doc_type]?.label || '')}</td>${projectId ? '' : `<td class="hide-m">${esc(pname(f.project_id))}</td>`}<td class="hide-m small">${esc(det)}</td>
        <td><span class="chip ${{ new: 'amber', review: 'blue', done: 'green', stored: '', error: 'red' }[f.status]}">${FILE_STATUS[f.status]}</span>${f.error ? `<div class="small neg">${esc(f.error)}</div>` : ''}</td>
        <td class="hide-m small">${fmtDate(f.created_at)}${f.uploaded_email && f.uploaded_email !== S.user?.email ? `<div class="mut">${esc(f.uploaded_email)}</div>` : ''}</td>
        <td><div class="actions" style="flex-wrap:nowrap">${['new', 'review', 'error'].includes(f.status) ? `<button class="btn small" data-rv="${f.id}">בדיקה וקליטה</button>` : ''}<button class="btn small ghost" data-op="${f.id}" title="פתיחת הקובץ">פתיחה</button></div></td></tr>`; }).join('')
      || `<tr><td colspan="7" class="empty">${F.tab === 'open' ? 'אין מסמכים שממתינים לבדיקה' : 'אין קבצים'}</td></tr>`;
    $$('[data-op]', el).forEach(b => b.onclick = e => { e.stopPropagation(); openFile(files.find(f => f.id === b.dataset.op)).catch(x => toast(x.message, 'bad')); });
    $$('[data-f]', el).forEach(tr => tr.onclick = () => reviewFile(files.find(f => f.id === tr.dataset.f), data).then(ch => ch && render()));
  };
  $$('[data-t]', el).forEach(a => a.onclick = () => { F.tab = a.dataset.t; store('subcon-inbox-tab', F.tab); $$('[data-t]', el).forEach(x => x.classList.toggle('on', x === a)); draw(); });
  $('#fq', el).oninput = e => { F.q = e.target.value.trim(); draw(); };
  $('#ftp', el).onchange = e => { F.type = e.target.value; draw(); };
  draw();

  // העלאה
  const fi = $('#fi', el), drop = $('#drop', el);
  drop.onclick = () => fi.click();
  drop.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fi.click(); } };
  drop.ondragover = e => { e.preventDefault(); drop.classList.add('on'); };
  drop.ondragleave = () => drop.classList.remove('on');
  drop.ondrop = e => { e.preventDefault(); drop.classList.remove('on'); handle([...e.dataTransfer.files]); };
  fi.onchange = () => { handle([...fi.files]); fi.value = ''; };
  async function handle(list) {
    if (!list.length) return;
    const pid = projectId || $('#up_p', el)?.value || null, hint = $('#up_t', el).value || null;
    drop.classList.add('busy'); drop.querySelector('b').textContent = `מעלה ${list.length} קבצים...`;
    let k = 0;
    for (const f of list) {
      try {
        const row = await uploadFile(f, { projectId: pid, docType: hint, status: hint === 'other' ? 'stored' : 'new' });
        files.unshift(row); k++;
        if (hint !== 'other') { drop.querySelector('b').textContent = `קורא את ${f.name}...`; await readFile(row, data, hint); }
      } catch (e) { toast(`${f.name}: ${e.message}`, 'bad'); }
    }
    toast(k === 1 ? 'הקובץ הועלה' : `${k} קבצים הועלו`);
    render();
  }

  // קבצים שהעלה מנהל עבודה ועוד לא נקראו: קוראים עכשיו
  setTimeout(async () => {
    const pend = files.filter(f => f.status === 'new' && f.doc_type !== 'other');
    if (!pend.length || !isCloud() && !window.__INTAKE_MOCK__) return;
    for (const f of pend.slice(0, 5)) await readFile(f, data, f.doc_type).catch(() => {});
    if (el.isConnected) draw();
  }, 50);

  $('#gsync', el).onclick = async () => {
    try {
      if (!gReady()) await gConnect();
      $('#gst', el).textContent = 'מסנכרן...';
      const r = await syncDrive(data);
      toast(`הדרייב עודכן: ${r.n} קבצים חדשים וגיבוי נתונים${r.fail ? ` · ${r.fail} נכשלו` : ''}`, r.fail ? 'warn' : 'ok'); render();
    } catch (e) { toast(e.message, 'bad'); render(); }
  };
  return el;
}

// ===== קריאת מסמך =====
async function sheetText(blob, name) {
  const XLSX = await loadXLSX();
  const wb = XLSX.read(await blob.arrayBuffer(), { type: 'array' });
  return wb.SheetNames.map(s => `--- גיליון ${s} ---\n` + XLSX.utils.sheet_to_csv(wb.Sheets[s], { blankrows: false })).join('\n').slice(0, 180000);
}
async function docxText(blob) {
  const XLSX = await loadXLSX();
  const zip = XLSX.CFB.read(new Uint8Array(await blob.arrayBuffer()), { type: 'array' });
  const e = XLSX.CFB.find(zip, 'word/document.xml');
  if (!e) throw new Error('לא הצלחנו לקרוא את קובץ ה-Word');
  const xml = new TextDecoder().decode(e.content);
  return xml.replace(/<\/w:p>/g, '\n').replace(/<w:tab\/>/g, '\t').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
}

// כתב כמויות באקסל: קודם מנסים לקרוא מקומית (בחינם, מדויק), ורק אם לא הצליח שולחים ל-Claude
async function localBoq(blob, row) {
  const XLSX = await loadXLSX();
  const wb = XLSX.read(await blob.arrayBuffer(), { type: 'array' });
  const best = bestSheet(wb.SheetNames.map(name => ({ name, rows: XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: '' }) })));
  if (!best || best.parsed.items.length < 3) return null;
  return { doc_type: 'boq', confidence: 0.95, summary: `כתב כמויות מגיליון "${best.name}" (${best.parsed.items.length} סעיפים)`, project_id: row.project_id, lines: best.parsed.items.map(i => ({ description: i.description, qty: i.qty, unit: i.unit, unit_price: i.unit_price, total: n(i.qty) * n(i.unit_price), code: i.code, chapter: i.chapter, item_id: null, po_line_id: null })), warnings: [] };
}

export async function readFile(row, data, hint = null) {
  const kind = fileKind(row.name, row.mime);
  try {
    let doc;
    const blob = await fileBlob(row);
    if (kind === 'sheet' && (hint === 'boq' || !hint)) doc = await localBoq(blob, row).catch(() => null);
    if (!doc) {
      if (kind === 'other') throw new Error('סוג קובץ שהמערכת לא קוראת. אפשר לבחור סוג ולמלא ידנית');
      const ctx = buildContext(data, { projectId: row.project_id });
      const pr = buildPrompt(ctx, { hint, fileName: row.name });
      const text = kind === 'sheet' ? await sheetText(blob, row.name) : kind === 'docx' ? await docxText(blob) : kind === 'text' ? await blob.text() : null;
      const res = await db.intake({ ...pr, path: row.path, text, media_type: row.mime });
      doc = normalize(extractJson(res.text), ctx.map);
      doc._model = res.model;
      if (!doc.project_id && row.project_id) doc.project_id = row.project_id;
    }
    if (hint && INTAKE_TYPES[hint] && doc.doc_type !== hint) { doc.warnings = [...(doc.warnings || []), `סומן כ"${INTAKE_TYPES[hint].label}" אבל נקרא כ"${INTAKE_TYPES[doc.doc_type].label}"`]; }
    doc = fillMatches(doc, data);
    const patch = { extracted: doc, doc_type: doc.doc_type, project_id: doc.project_id || row.project_id || null, status: 'review', error: null };
    await db.update('files', row.id, patch); Object.assign(row, patch);
    return doc;
  } catch (e) {
    const patch = { status: 'error', error: e.message, doc_type: row.doc_type || hint || null };
    await db.update('files', row.id, patch).catch(() => {}); Object.assign(row, patch);
    if (!e.demo) toast(`${row.name}: ${e.message}`, 'warn');
    return null;
  }
}

// ===== מסך בדיקה וקליטה =====
const blank = (type, row) => ({ doc_type: type, project_id: row.project_id, vendor_name: '', doc_no: '', doc_date: new Date().toISOString().slice(0, 10), amount_net: null, vat_pct: 18, lines: [], warnings: [] });

export function reviewFile(row, data) {
  return new Promise(resolve => {
    let doc = row.extracted ? structuredClone(row.extracted) : blank(row.doc_type || 'invoice', row);
    doc.lines ||= [];
    const done = ['done', 'stored'].includes(row.status);
    const ov = h(`<div class="ov" role="dialog" aria-modal="true"><div class="dlg wide rv"><div class="dlg-h"><h3>${esc(row.name)}</h3><button class="x" aria-label="סגירה" data-x>✕</button></div>
      <div class="rv-b"><div class="rv-prev" id="pv"><div class="empty">טוען תצוגה...</div></div><div class="rv-form" id="fm"></div></div>
      <div class="dlg-f" id="ft"></div></div></div>`);
    document.body.appendChild(ov);
    const close = v => { ov.remove(); document.removeEventListener('keydown', onKey); if (url) URL.revokeObjectURL(url); resolve(v); };
    const onKey = e => { if (e.key === 'Escape') close(false); };
    document.addEventListener('keydown', onKey);
    $$('[data-x]', ov).forEach(b => b.onclick = () => close(false));
    let url = null;
    fileBlob(row).then(b => { url = URL.createObjectURL(b.type ? b : new Blob([b], { type: row.mime || '' }));
      const k = fileKind(row.name, row.mime);
      $('#pv', ov).innerHTML = k === 'pdf' ? `<iframe src="${url}" title="תצוגת המסמך"></iframe>` : k === 'image' ? `<img src="${url}" alt="המסמך">` : `<div class="empty">אין תצוגה מקדימה לקובץ הזה. <a href="${url}" download="${esc(row.name)}">הורדה</a></div>`;
    }).catch(e => { $('#pv', ov).innerHTML = `<div class="empty neg">${esc(e.message)}</div>`; });

    const fm = $('#fm', ov), ft = $('#ft', ov);
    const projOpts = `<option value="">בחירת פרויקט</option>${data.projects.map(p => `<option value="${p.id}" ${p.id === doc.project_id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}`;
    const pd = () => ({ items: data.items.filter(i => i.project_id === doc.project_id), pos: data.pos.filter(p => p.project_id === doc.project_id && p.status !== 'cancelled'), bills: data.bills.filter(b => b.project_id === doc.project_id), vos: data.vos.filter(v => v.project_id === doc.project_id) });
    const itemSel = (v, k) => `<select data-l="${k}" data-k="item_id" aria-label="סעיף"><option value="">ללא סעיף</option>${pd().items.map(i => `<option value="${i.id}" ${i.id === v ? 'selected' : ''}>${esc(`${i.code || ''} ${i.description}`.trim().slice(0, 48))}</option>`).join('')}</select>`;
    const inp = (k, v, { type = 'text', ph = '', w = '' } = {}) => `<input data-d="${k}" type="${type}" value="${esc(v ?? '')}" ${type === 'number' ? 'step="any" inputmode="decimal" dir="ltr"' : ''} placeholder="${esc(ph)}" ${w ? `style="width:${w}"` : ''}>`;
    const fld = (label, html, hint = '') => `<label class="fld"><span>${esc(label)}</span>${html}${hint ? `<small>${esc(hint)}</small>` : ''}</label>`;
    const sub = (o, k, v, { type = 'text' } = {}) => `<input data-s="${o}.${k}" type="${type}" value="${esc(v ?? '')}" ${type === 'number' ? 'step="any" inputmode="decimal" dir="ltr"' : ''}>`;
    const vendList = `<datalist id="vlist">${[...new Set([...data.vendors.map(v => v.name), ...data.expenses.map(e => e.supplier_name), ...data.pos.map(p => p.supplier_name)].filter(Boolean))].map(v => `<option value="${esc(v)}">`).join('')}</datalist>`;

    const linesTable = ({ po = false, price = true } = {}) => {
      const poLs = po && doc.po_id ? data.poLines.filter(l => l.po_id === doc.po_id) : [];
      return `<div class="tw" style="box-shadow:none"><table class="rv-lines"><thead><tr><th>תיאור</th><th class="n">כמות</th><th>יח'</th>${price ? '<th class="n">מחיר</th><th class="n">סה"כ</th>' : ''}<th>${po ? 'שורה בהזמנה' : 'סעיף'}</th><th></th></tr></thead><tbody>
        ${doc.lines.map((l, k) => `<tr><td><input data-l="${k}" data-k="description" value="${esc(l.description)}"></td><td><input data-l="${k}" data-k="qty" type="number" step="any" dir="ltr" value="${esc(l.qty ?? '')}" style="width:80px"></td>
          <td><input data-l="${k}" data-k="unit" value="${esc(l.unit)}" style="width:56px"></td>${price ? `<td><input data-l="${k}" data-k="unit_price" type="number" step="any" dir="ltr" value="${esc(l.unit_price ?? '')}" style="width:90px"></td><td class="n">${money(l.total)}</td>` : ''}
          <td>${po ? `<select data-l="${k}" data-k="po_line_id"><option value="">לא משויך</option>${poLs.map(p => `<option value="${p.id}" ${p.id === l.po_line_id ? 'selected' : ''}>${esc((p.description || '').slice(0, 40))} (${n(p.qty)} ${esc(p.unit || '')})</option>`).join('')}</select>` : itemSel(l.item_id, k)}</td>
          <td><button type="button" class="btn small ghost" data-rm="${k}" aria-label="מחיקת שורה">✕</button></td></tr>`).join('') || `<tr><td colspan="7" class="small mut">אין שורות</td></tr>`}
        </tbody></table></div><button type="button" class="btn small ghost" id="addl">+ שורה</button>`;
    };

    const typeForm = () => {
      const t = doc.doc_type, x = doc;
      const proj = fld('פרויקט', `<select data-d="project_id">${projOpts}</select>`);
      if (t === 'invoice') return `<div class="grid g2">${proj}${fld('ספק / קבלן ביצוע', `<input data-d="vendor_name" list="vlist" value="${esc(x.vendor_name)}">`)}${fld('מספר חשבונית', inp('doc_no', x.doc_no))}${fld('תאריך', inp('doc_date', x.doc_date, { type: 'date' }))}
          ${fld('סכום לפני מע"מ', inp('amount_net', x.amount_net, { type: 'number' }))}${fld('מע"מ %', inp('vat_pct', x.vat_pct, { type: 'number' }))}
          ${fld('סוג הוצאה', `<select data-d="kind">${opt(EXPENSE_KINDS, x.kind || 'material')}</select>`)}${fld('הזמנה קשורה', `<select data-d="po_id"><option value="">ללא</option>${pd().pos.map(p => `<option value="${p.id}" ${p.id === x.po_id ? 'selected' : ''}>${esc(`${p.number || ''} · ${p.supplier_name}`)}</option>`).join('')}</select>`)}
          ${fld('סטטוס', `<select data-d="status">${opt({ invoice: 'התקבלה חשבונית', approved: 'אושר לתשלום', paid: 'שולם' }, x.status || 'invoice')}</select>`)}</div>
          <h4>שורות החשבונית</h4><p class="small mut">כל סעיף בכתב הכמויות נרשם כהוצאה נפרדת. שורות בלי סעיף נרשמות יחד.</p>${linesTable()}`;
      if (t === 'delivery') return `<div class="grid g2">${proj}${fld('ספק', `<input data-d="vendor_name" list="vlist" value="${esc(x.vendor_name)}">`)}${fld('מספר תעודה', inp('doc_no', x.doc_no))}${fld('תאריך אספקה', inp('doc_date', x.doc_date, { type: 'date' }))}
          ${fld('הזמנה', `<select data-d="po_id"><option value="">בחירת הזמנה</option>${pd().pos.map(p => `<option value="${p.id}" ${p.id === x.po_id ? 'selected' : ''}>${esc(`${p.number || ''} · ${p.supplier_name}`)}</option>`).join('')}</select>`, 'הכמויות שסופקו נוספות לשורות ההזמנה')}</div>
          <h4>מה סופק</h4>${linesTable({ po: true, price: false })}`;
      if (t === 'po') return `<div class="grid g2">${proj}${fld('ספק', `<input data-d="vendor_name" list="vlist" value="${esc(x.vendor_name)}">`)}${fld('מספר הזמנה', inp('doc_no', x.doc_no || x.po_number))}${fld('תאריך הזמנה', inp('doc_date', x.doc_date, { type: 'date' }))}${fld('אספקה צפויה', inp('due_date', x.due_date, { type: 'date' }))}</div>
          <h4>שורות ההזמנה</h4>${linesTable()}`;
      if (t === 'contract') { const c = x.contract ||= {};
        return `<div class="grid g2">${fld('פרויקט קיים (או חדש)', `<select data-d="project_id"><option value="">פרויקט חדש</option>${data.projects.map(p => `<option value="${p.id}" ${p.id === x.project_id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>`)}
          ${fld('קבלן ראשי', `<input data-d="main_contractor_name" list="mclist" value="${esc(x.main_contractor_name || data.mcs.find(m => m.id === x.main_contractor_id)?.name || '')}"><datalist id="mclist">${data.mcs.map(m => `<option value="${esc(m.name)}">`).join('')}</datalist>`)}
          ${fld('שם הפרויקט', sub('contract', 'project_name', c.project_name))}${fld('כתובת', sub('contract', 'address', c.address))}${fld('מזמין / יזם', sub('contract', 'owner_name', c.owner_name))}
          ${fld('שיטת חשבון', `<select data-s="contract.contract_type">${opt({ measure: 'מדידה', milestones: 'אבני דרך', percent: 'אחוז ביצוע', mixed: 'משולב' }, c.contract_type)}</select>`)}
          ${fld('היקף החוזה ₪', sub('contract', 'contract_total', c.contract_total, { type: 'number' }))}${fld('תנאי תשלום (שוטף +)', sub('contract', 'pay_terms_days', c.pay_terms_days, { type: 'number' }))}
          ${fld('עיכבון %', sub('contract', 'retention_pct', c.retention_pct, { type: 'number' }))}${fld('תקרת עיכבון ₪', sub('contract', 'retention_cap', c.retention_cap, { type: 'number' }))}${fld('ביטוח %', sub('contract', 'insurance_pct', c.insurance_pct, { type: 'number' }))}${fld('הוצאות משותפות %', sub('contract', 'shared_pct', c.shared_pct, { type: 'number' }))}
          ${fld('תחילה', sub('contract', 'start_date', c.start_date, { type: 'date' }))}${fld('סיום', sub('contract', 'end_date', c.end_date, { type: 'date' }))}${fld('מדד בסיס (אם צמוד)', sub('contract', 'base_index', c.base_index, { type: 'number' }))}</div>
          <label class="chk"><input type="checkbox" data-s="contract.indexation" ${c.indexation ? 'checked' : ''}> החוזה צמוד למדד</label>
          ${(c.guarantees || []).length ? `<p class="small">ערבויות שנדרשות בחוזה: ${c.guarantees.map(g => `${GUAR_KINDS[g.kind] || g.kind} ${g.pct ? g.pct + '%' : ''}${g.amount ? ' ₪' + Math.round(g.amount).toLocaleString('en-US') : ''}`).join(' · ')}. ייפתחו כרשומות ערבות להשלמה.</p>` : ''}
          ${doc.lines.length ? `<label class="chk"><input type="checkbox" id="withboq" checked> לקלוט גם את כתב הכמויות שבחוזה (${doc.lines.length} סעיפים)</label>` : ''}`; }
      if (t === 'boq') return `<div class="grid g2">${proj}</div>${pd().items.length ? `<p class="note">בפרויקט כבר יש ${pd().items.length} סעיפים. הסעיפים מהקובץ יתווספו אליהם (קוד שכבר קיים יעודכן).</p>` : ''}<h4>סעיפים (${doc.lines.length})</h4>${linesTable({ price: true }).replace(/<th>סעיף<\/th>/, '<th>קוד</th>')}`;
      if (t === 'vo') { const v = x.vo ||= { source: 'change_order', has_written_order: true };
        return `<div class="grid g2">${proj}${fld('הוראה קיימת לעדכון', `<select data-s="vo.vo_id"><option value="">הוראה חדשה</option>${pd().vos.map(c => `<option value="${c.id}" ${c.id === v.vo_id ? 'selected' : ''}>${esc(`${c.number} ${c.title}`)}</option>`).join('')}</select>`)}
          ${fld('מספר', sub('vo', 'number', v.number))}${fld('נושא', sub('vo', 'title', v.title))}${fld('מקור', `<select data-s="vo.source">${opt(SRC, v.source)}</select>`)}${fld('תאריך', inp('doc_date', x.doc_date, { type: 'date' }))}
          ${fld('סכום ₪', sub('vo', 'amount', v.amount, { type: 'number' }))}${fld('סטטוס', `<select data-s="vo.status">${opt(VO_STATUS, v.status || (v.signed ? 'approved' : 'submitted'))}</select>`)}</div>
          <label class="chk"><input type="checkbox" data-s="vo.has_written_order" ${v.has_written_order !== false ? 'checked' : ''}> יש הוראה בכתב</label>
          ${doc.lines.length ? `<h4>סעיפים בהוראה</h4>${linesTable()}` : ''}`; }
      if (t === 'approved_bill') { const b = x.bill ||= { lines: [], fines: [] };
        const bill = b.bill_id ? data.bills.find(z => z.id === b.bill_id) : null;
        return `<div class="grid g2">${proj}${fld('החשבון שלנו', `<select data-s="bill.bill_id"><option value="">בחירת חשבון</option>${pd().bills.map(z => `<option value="${z.id}" ${z.id === b.bill_id ? 'selected' : ''}>חשבון ${z.number}${z.period_to ? ' · עד ' + fmtDate(z.period_to) : ''}</option>`).join('')}</select>`, 'הכמויות המאושרות נרשמות בחשבון הזה')}${fld('תאריך אישור', inp('doc_date', x.doc_date, { type: 'date' }))}</div>
          <h4>כמויות מצטברות שאושרו</h4><div class="tw" style="box-shadow:none"><table><thead><tr><th>סעיף</th><th class="n">אושר מצטבר</th><th>סיבת קיצוץ</th></tr></thead><tbody>
          ${(b.lines || []).map((l, k) => `<tr><td><select data-bl="${k}" data-k="item_id"><option value="">לא משויך</option>${pd().items.map(i => `<option value="${i.id}" ${i.id === l.item_id ? 'selected' : ''}>${esc(`${i.code || ''} ${i.description}`.trim().slice(0, 50))}</option>`).join('')}</select></td>
            <td><input data-bl="${k}" data-k="cum_qty_app" type="number" step="any" dir="ltr" value="${esc(l.cum_qty_app ?? '')}" style="width:90px"></td><td><input data-bl="${k}" data-k="cut_reason" value="${esc(l.cut_reason)}"></td></tr>`).join('') || '<tr><td colspan="3" class="small mut">לא נמצאו שורות</td></tr>'}</tbody></table></div>
          ${(b.fines || []).length ? `<p class="small">קנסות וקיזוזים: ${b.fines.map(f => `${esc(f.description)} ₪${Math.round(f.amount).toLocaleString('en-US')}`).join(' · ')}</p>` : ''}${!bill && pd().bills.length === 0 ? '<p class="note">אין חשבונות בפרויקט. קודם צריך שהחשבון שהוגש יהיה במערכת.</p>' : ''}`; }
      if (t === 'payment') { const p = x.payment ||= {};
        return `<div class="grid g2">${proj}${fld('על חשבון', `<select data-s="payment.bill_id"><option value="">בחירת חשבון</option>${pd().bills.map(z => `<option value="${z.id}" ${z.id === p.bill_id ? 'selected' : ''}>חשבון ${z.number}</option>`).join('')}</select>`)}
          ${fld('סכום ₪', sub('payment', 'amount', p.amount, { type: 'number' }))}${fld('תאריך', sub('payment', 'date', p.date || x.doc_date, { type: 'date' }))}${fld('אמצעי תשלום', sub('payment', 'method', p.method))}</div>`; }
      if (t === 'vendor_doc') { const d = x.vendor_doc ||= { owner: 'vendor', doc_type: 'insurance' };
        return `<div class="grid g2">${fld('של מי', `<select data-s="vendor_doc.owner">${opt({ vendor: 'של ספק / קבלן ביצוע', own: 'שלנו (מול הקבלן הראשי)' }, d.owner)}</select>`)}${d.owner === 'own' ? '' : fld('ספק', `<input data-d="vendor_name" list="vlist" value="${esc(x.vendor_name)}">`)}
          ${fld('סוג אישור', `<select data-s="vendor_doc.doc_type">${opt(DOC_TYPES, d.doc_type)}</select>`)}${fld('מספר', sub('vendor_doc', 'number', d.number))}${fld('תאריך הוצאה', sub('vendor_doc', 'issue_date', d.issue_date, { type: 'date' }))}${fld('בתוקף עד', sub('vendor_doc', 'expiry', d.expiry, { type: 'date' }))}</div>`; }
      if (t === 'guarantee') { const g = x.guarantee ||= { kind: 'performance' };
        return `<div class="grid g2">${proj}${fld('סוג', `<select data-s="guarantee.kind">${opt(GUAR_KINDS, g.kind)}</select>`)}${fld('בנק', sub('guarantee', 'bank', g.bank))}${fld('מספר ערבות', sub('guarantee', 'number', g.number))}
          ${fld('סכום ₪', sub('guarantee', 'amount', g.amount, { type: 'number' }))}${fld('תאריך הוצאה', sub('guarantee', 'issue_date', g.issue_date, { type: 'date' }))}${fld('בתוקף עד', sub('guarantee', 'expiry', g.expiry, { type: 'date' }))}</div>`; }
      if (t === 'worker') { const w = x.worker ||= { pay_type: 'daily' };
        return `<div class="grid g2">${fld('שם', sub('worker', 'name', w.name))}${fld('ת"ז / דרכון', sub('worker', 'id_no', w.id_no))}${fld('טלפון', sub('worker', 'phone', w.phone))}${fld('מקצוע', sub('worker', 'trade', w.trade))}
          ${fld('סוג העסקה', `<select data-s="worker.pay_type">${opt(PAY_TYPES, w.pay_type)}</select>`)}${fld({ salary: 'שכר חודשי ₪', daily: 'תעריף יומי ₪', hourly: 'תעריף לשעה ₪', piece: 'מחיר קבלנות ₪' }[w.pay_type] || 'תעריף', sub('worker', 'rate', w.rate, { type: 'number' }))}</div>
          <label class="chk"><input type="checkbox" data-s="worker.is_foreign" ${w.is_foreign ? 'checked' : ''}> עובד זר</label>`; }
      return `<div class="grid g2">${fld('פרויקט (לתיוק)', `<select data-d="project_id">${projOpts}</select>`)}</div><p class="small mut">המסמך יישמר בתיק בלי להזין נתונים.</p>`;
    };

    const paint = () => {
      for (const l of doc.lines) l.total = l.qty !== null && l.qty !== '' && l.unit_price !== null && l.unit_price !== '' ? Math.round(n(l.qty) * n(l.unit_price) * 100) / 100 : (l.total ?? null);
      const warn = checks(doc, data);
      const conf = doc.confidence != null && row.extracted ? Math.round(doc.confidence * 100) : null;
      fm.innerHTML = `${vendList}${row.status === 'error' ? `<p class="note neg">${esc(row.error || '')}</p>` : ''}
        ${doc.summary ? `<p class="rv-sum"><b>${esc(doc.summary)}</b>${conf !== null ? ` <span class="chip ${conf >= 80 ? 'green' : conf >= 50 ? 'amber' : 'red'}">ודאות ${conf}%</span>` : ''}</p>` : ''}
        ${fld('סוג המסמך', `<select id="dt" ${done ? 'disabled' : ''}>${opt(Object.fromEntries(Object.entries(INTAKE_TYPES).map(([k, v]) => [k, v.label])), doc.doc_type)}</select>`)}
        ${warn.length ? `<div class="rv-warn"><b>לבדוק לפני קליטה</b><ul>${warn.map(w => `<li>${esc(w)}</li>`).join('')}</ul></div>` : ''}
        ${typeForm()}
        ${done ? `<p class="note">המסמך נקלט ${row.done_at ? 'ב-' + fmtDate(row.done_at) : ''}: ${(row.links || []).filter(l => l.label).map(l => esc(l.label)).join(' · ')}</p>` : ''}`;
      if (done) $$('input,select,textarea', fm).forEach(x => x.disabled = true);
      $('#dt', fm).onchange = e => { doc.doc_type = e.target.value; paint(); };
      $$('[data-d]', fm).forEach(i => i.onchange = () => { const k = i.dataset.d; doc[k] = i.type === 'number' ? (i.value === '' ? null : n(i.value)) : i.value || null; if (['project_id', 'po_id'].includes(k) || k === 'vendor_name') paint(); });
      $$('[data-s]', fm).forEach(i => i.onchange = () => { const [o, k] = i.dataset.s.split('.'); doc[o] ||= {}; doc[o][k] = i.type === 'checkbox' ? i.checked : i.type === 'number' ? (i.value === '' ? null : n(i.value)) : i.value || null; if (['owner', 'pay_type', 'bill_id', 'vo_id'].includes(k)) paint(); });
      $$('[data-l]', fm).forEach(i => i.onchange = () => { const l = doc.lines[+i.dataset.l]; l[i.dataset.k] = i.type === 'number' ? (i.value === '' ? null : n(i.value)) : i.value || null; paint(); });
      $$('[data-bl]', fm).forEach(i => i.onchange = () => { const l = doc.bill.lines[+i.dataset.bl]; l[i.dataset.k] = i.type === 'number' ? (i.value === '' ? null : n(i.value)) : i.value || ''; });
      $$('[data-rm]', fm).forEach(b => b.onclick = () => { doc.lines.splice(+b.dataset.rm, 1); paint(); });
      $('#addl', fm)?.addEventListener('click', () => { doc.lines.push({ description: '', qty: null, unit: '', unit_price: null, total: null, item_id: null, po_line_id: null }); paint(); });
    };
    paint();

    ft.innerHTML = done ? `<button class="btn ghost" data-x2>סגירה</button>${(row.undo || row.links?.length) && row.status === 'done' ? '<button class="btn ghost danger-t" id="undo">ביטול הקליטה</button>' : ''}<button class="btn ghost" id="open">פתיחת הקובץ</button>`
      : `<button class="btn" id="apply">אישור וקליטה</button><button class="btn ghost" id="later">שמירה לבדיקה מאוחרת</button><button class="btn ghost" id="store">שמירת קובץ בלבד</button>
         ${row.status !== 'new' ? `<button class="btn ghost" id="reread" title="קריאה חוזרת של המסמך">קריאה מחדש</button>` : ''}<span class="sp"></span><button class="btn ghost danger-t" id="del">מחיקה</button>`;
    $('[data-x2]', ov)?.addEventListener('click', () => close(false));
    $('#open', ov)?.addEventListener('click', () => openFile(row).catch(e => toast(e.message, 'bad')));
    $('#later', ov)?.addEventListener('click', async () => { await db.update('files', row.id, { extracted: doc, doc_type: doc.doc_type, project_id: doc.project_id || null, status: 'review' }); toast('נשמר. אפשר להמשיך אחר כך'); close(true); });
    $('#store', ov)?.addEventListener('click', async () => { await db.update('files', row.id, { doc_type: doc.doc_type === 'other' ? 'other' : doc.doc_type, project_id: doc.project_id || null, status: 'stored', done_at: new Date().toISOString() }); toast('הקובץ נשמר בתיק'); close(true); });
    $('#reread', ov)?.addEventListener('click', async () => { $('#fm', ov).innerHTML = '<div class="empty">קורא את המסמך...</div>'; const d = await readFile(row, data, doc.doc_type); if (d) { doc = structuredClone(d); doc.lines ||= []; } paint(); });
    $('#del', ov)?.addEventListener('click', async () => {
      if (!(await confirmBox('מחיקת קובץ', `למחוק את ${row.name}? הקובץ יימחק מהמערכת (העותק בגוגל דרייב נשאר).`, 'מחיקה', true))) return;
      await db.removeFile(row.path).catch(() => {}); await db.remove('files', row.id); toast('הקובץ נמחק'); close(true);
    });
    $('#undo', ov)?.addEventListener('click', async () => {
      if (!(await confirmBox('ביטול קליטה', 'כל הרשומות שנוצרו מהמסמך יימחקו, ועדכונים שנעשו יחזרו לקדמותם. המסמך יחזור לרשימת הממתינים.', 'ביטול הקליטה', true))) return;
      try { await undoApply(row); toast('הקליטה בוטלה'); close(true); } catch (e) { toast(e.message, 'bad'); }
    });
    $('#apply', ov)?.addEventListener('click', async () => {
      const err = validate(doc, data);
      if (err) return toast(err, 'bad');
      const btn = $('#apply', ov); btn.disabled = true; btn.textContent = 'קולט...';
      try { const r = await applyDoc(doc, row, data); toast(`נקלט: ${r.links.filter(l => l.label).map(l => l.label).join(' · ')}`); close(true); }
      catch (e) { btn.disabled = false; btn.textContent = 'אישור וקליטה'; toast(e.message, 'bad'); }
    });
  });
}

function validate(d, data) {
  const t = d.doc_type;
  if (['invoice', 'delivery', 'po', 'boq', 'vo', 'approved_bill', 'payment', 'guarantee'].includes(t) && !d.project_id) return 'צריך לבחור פרויקט';
  if (['invoice', 'po', 'delivery'].includes(t) && !String(d.vendor_name || '').trim()) return 'חסר שם ספק';
  if (t === 'invoice' && !n(d.amount_net) && !d.lines.some(l => n(l.total))) return 'חסר סכום';
  if (t === 'delivery' && !d.po_id) return 'צריך לבחור הזמנה (או "שמירת קובץ בלבד")';
  if (t === 'delivery' && !d.lines.some(l => l.po_line_id && n(l.qty))) return 'אף שורה לא שויכה לשורה בהזמנה';
  if (t === 'po' && !d.lines.length) return 'אין שורות בהזמנה';
  if (t === 'boq' && !d.lines.length) return 'אין סעיפים';
  if (t === 'contract' && !d.project_id && !d.contract?.project_name) return 'חסר שם פרויקט';
  if (t === 'vo' && !d.vo?.vo_id && !d.vo?.title) return 'חסר נושא להוראת השינוי';
  if (t === 'approved_bill' && !d.bill?.bill_id) return 'צריך לבחור את החשבון שאושר';
  if (t === 'payment' && (!d.payment?.bill_id || !n(d.payment?.amount))) return 'חסר חשבון או סכום';
  if (t === 'vendor_doc' && d.vendor_doc?.owner !== 'own' && !String(d.vendor_name || '').trim()) return 'חסר שם ספק';
  if (t === 'worker' && !d.worker?.name) return 'חסר שם עובד';
  return null;
}

// ===== קליטה: כתיבה למערכת, עם רישום מה נוצר ומה עודכן (לביטול) =====
async function applyDoc(d, row, data) {
  const T = S.tenantId, pid = d.project_id || null;
  const links = [], undo = [];
  const created = (table, rec, label) => { links.push({ table, id: rec.id, label: label || null, created: true }); return rec; };
  const track = (table, rows) => rows.forEach(r => created(table, r, null));
  const ins = async (table, r, label) => created(table, (await db.insert(table, { tenant_id: T, ...r }))[0], label);
  const upd = async (table, id, patch, before, label) => { undo.push({ table, id, patch: Object.fromEntries(Object.keys(patch).map(k => [k, before?.[k] ?? null])) }); await db.update(table, id, patch); if (label) links.push({ table, id, label }); };
  const sup = String(d.vendor_name || '').trim();
  const t = d.doc_type;

  if (t === 'invoice') {
    const groups = new Map();
    for (const l of d.lines.filter(l => n(l.total))) { const k = l.item_id || ''; const g = groups.get(k) || { item_id: l.item_id, amount: 0, qty: 0, unit: l.unit, desc: [] }; g.amount += n(l.total); g.qty += n(l.qty); g.desc.push(l.description); groups.set(k, g); }
    if (!groups.size) groups.set('', { item_id: null, amount: n(d.amount_net), qty: null, unit: null, desc: [d.summary || 'חשבונית'] });
    const poLine = d.po_id ? data.poLines.find(l => l.po_id === d.po_id) : null;
    for (const g of groups.values()) {
      const item = g.item_id ? data.items.find(i => i.id === g.item_id) : null;
      await ins('expenses', { project_id: pid, boq_item_id: g.item_id || (groups.size === 1 && poLine?.boq_item_id) || null, variation_id: item?.variation_id || null, kind: d.kind || 'material', supplier_name: sup, doc_no: d.doc_no || null, doc_date: d.doc_date || null,
        description: g.desc.filter(Boolean).join(', ').slice(0, 200) || null, amount: Math.round(g.amount * 100) / 100, vat_pct: n(d.vat_pct ?? 18), status: d.status || 'invoice', po_id: d.po_id || null, qty: g.qty || null, unit: g.unit || null, notes: 'נקלט ממסמך: ' + row.name },
        `הוצאה ${sup} ${d.doc_no || ''} ${item ? '· ' + (item.code || '') : ''}`.trim());
    }
  } else if (t === 'delivery') {
    const po = data.pos.find(p => p.id === d.po_id);
    for (const l of d.lines.filter(l => l.po_line_id && n(l.qty))) {
      const pl = data.poLines.find(x => x.id === l.po_line_id);
      await upd('po_lines', pl.id, { delivered_qty: n(pl.delivered_qty) + n(l.qty) }, pl);
      pl.delivered_qty = n(pl.delivered_qty) + n(l.qty);
    }
    const ls = data.poLines.filter(l => l.po_id === po.id);
    const full = ls.every(l => n(l.delivered_qty) >= n(l.qty) - 1e-6);
    const notes = [po.delivery_notes, d.doc_no].filter(Boolean).join(', ');
    await upd('purchase_orders', po.id, { delivery_notes: notes, status: po.status === 'closed' ? 'closed' : full ? 'delivered' : 'partial' }, po, `תעודת משלוח ${d.doc_no || ''} להזמנה ${po.number || ''}`.trim());
  } else if (t === 'po') {
    const po = await ins('purchase_orders', { project_id: pid, number: d.doc_no || d.po_number || null, supplier_name: sup, order_date: d.doc_date || null, expected_date: d.due_date || null, status: 'open', notes: 'נקלט ממסמך: ' + row.name }, `הזמנה ${d.doc_no || ''} ${sup}`.trim());
    await db.insert('po_lines', d.lines.map((l, k) => { const it = data.items.find(i => i.id === l.item_id); return { tenant_id: T, project_id: pid, po_id: po.id, boq_item_id: l.item_id || null, variation_id: it?.variation_id || null, description: l.description, qty: n(l.qty), unit: l.unit || null, unit_price: n(l.unit_price), delivered_qty: 0, sort: k }; }));
  } else if (t === 'contract') {
    const c = d.contract || {};
    let mcId = d.main_contractor_id || data.mcs.find(m => m.name.trim() === String(d.main_contractor_name || '').trim())?.id || null;
    if (!mcId && d.main_contractor_name) mcId = (await ins('main_contractors', { name: d.main_contractor_name.trim(), pay_terms_days: n(c.pay_terms_days) || 60 }, `קבלן ראשי ${d.main_contractor_name}`)).id;
    const f = { main_contractor_id: mcId, contract_type: c.contract_type || 'measure', pay_terms_days: n(c.pay_terms_days) || 60, retention_pct: c.retention_pct ?? 5, retention_cap: c.retention_cap || null, insurance_pct: c.insurance_pct ?? 0, shared_pct: c.shared_pct ?? 0,
      indexation: !!c.indexation, base_index: c.base_index || null, start_date: c.start_date || null, end_date: c.end_date || null, owner_name: c.owner_name || null, address: c.address || null };
    let projId = pid;
    if (pid) { const p = data.projects.find(x => x.id === pid); const patch = Object.fromEntries(Object.entries(f).filter(([, v]) => v !== null && v !== '')); await upd('projects', pid, patch, p, `עדכון פרויקט ${p.name} מהחוזה`); }
    else projId = (await ins('projects', { name: c.project_name || 'פרויקט חדש', status: 'active', ...f }, `פרויקט חדש ${c.project_name || ''}`)).id;
    for (const g of c.guarantees || []) await ins('guarantees', { project_id: projId, main_contractor_id: mcId, kind: ['performance', 'advance', 'warranty', 'tender'].includes(g.kind) ? g.kind : 'other', amount: n(g.amount) || Math.round(n(g.pct) * n(c.contract_total) / 100), status: 'active', notes: 'נדרשת לפי החוזה. להשלים בנק, מספר ותוקף' }, `ערבות ${GUAR_KINDS[g.kind] || ''}`);
    if (d.lines.length && document.getElementById('withboq')?.checked !== false) await insertBoq(d.lines, projId, data, track, upd);
    d.project_id = projId;
  } else if (t === 'boq') {
    await insertBoq(d.lines, pid, data, track, upd);
  } else if (t === 'vo') {
    const v = d.vo || {};
    if (v.vo_id) { const cur = data.vos.find(x => x.id === v.vo_id);
      await upd('variations', v.vo_id, { status: v.status || cur.status, has_written_order: v.has_written_order !== false, approved_amount: v.status === 'partial' && v.amount ? n(v.amount) : cur.approved_amount }, cur, `הוראת שינוי ${cur.number} עודכנה`); }
    else {
      const num = v.number || 'VO-' + String(data.vos.filter(x => x.project_id === pid).length + 1).padStart(2, '0');
      const vo = await ins('variations', { project_id: pid, number: num, title: v.title, source: v.source || 'change_order', has_written_order: v.has_written_order !== false, vo_date: d.doc_date || null, status: v.status || (v.signed ? 'approved' : 'submitted'), notes: 'נקלט ממסמך: ' + row.name }, `הוראת שינוי ${num}`);
      const ls = d.lines.length ? d.lines : [{ description: v.title, qty: 1, unit: "קומפ'", unit_price: n(v.amount) }];
      const base = data.items.filter(i => i.project_id === pid).length;
      await db.insert('boq_items', ls.map((l, k) => ({ tenant_id: T, project_id: pid, variation_id: vo.id, chapter: 'הוראות שינוי', code: `${num}.${k + 1}`, description: l.description || v.title, unit: l.unit || "קומפ'", qty: n(l.qty) || 1, unit_price: n(l.unit_price), billing_method: 'measure', progress_pct: 0, sort: base + k })));
    }
  } else if (t === 'approved_bill') {
    const b = d.bill; const bill = data.bills.find(x => x.id === b.bill_id);
    for (const l of (b.lines || []).filter(l => l.item_id && l.cum_qty_app !== null && l.cum_qty_app !== '')) {
      const cur = data.billLines.find(x => x.bill_id === bill.id && x.boq_item_id === l.item_id);
      if (cur) await upd('bill_lines', cur.id, { cum_qty_app: n(l.cum_qty_app), cut_reason: l.cut_reason || cur.cut_reason || null }, cur);
      else await ins('bill_lines', { project_id: bill.project_id, bill_id: bill.id, boq_item_id: l.item_id, cum_qty_app: n(l.cum_qty_app), cut_reason: l.cut_reason || null }, null);
    }
    for (const f of b.fines || []) await ins('bill_fines', { project_id: bill.project_id, bill_id: bill.id, description: f.description || 'קיזוז', amount: n(f.amount), status: 'imposed' }, `קנס ${f.description || ''}`);
    await upd('bills', bill.id, { status: ['paid'].includes(bill.status) ? bill.status : 'approved', approved_date: d.doc_date || new Date().toISOString().slice(0, 10) }, bill, `חשבון ${bill.number} אושר`);
  } else if (t === 'payment') {
    const p = d.payment; const bill = data.bills.find(x => x.id === p.bill_id);
    await ins('bill_payments', { project_id: bill.project_id, bill_id: bill.id, pay_date: p.date || d.doc_date || new Date().toISOString().slice(0, 10), amount: n(p.amount), method: p.method || null, note: 'נקלט ממסמך: ' + row.name }, `תשלום על חשבון ${bill.number}`);
  } else if (t === 'vendor_doc') {
    const x = d.vendor_doc; let vendorId = null;
    if (x.owner !== 'own') { vendorId = d.vendor_id || data.vendors.find(v => v.name.trim() === sup)?.id;
      if (!vendorId) vendorId = (await ins('vendors', { name: sup, kind: 'supplier', company_no: d.vendor_company_no || null, active: true }, `ספק חדש ${sup}`)).id; }
    await ins('documents', { vendor_id: vendorId, doc_type: x.doc_type, number: x.number || null, issue_date: x.issue_date || null, expiry: x.expiry || null, link: 'file:' + row.id, notes: 'נקלט ממסמך: ' + row.name }, `${DOC_TYPES[x.doc_type]} ${x.owner === 'own' ? 'שלנו' : sup}`);
  } else if (t === 'guarantee') {
    const g = d.guarantee; const proj = data.projects.find(p => p.id === pid);
    await ins('guarantees', { project_id: pid, main_contractor_id: proj?.main_contractor_id || null, kind: g.kind, bank: g.bank || null, number: g.number || null, amount: n(g.amount), issue_date: g.issue_date || null, expiry: g.expiry || null, status: 'active', notes: 'נקלט ממסמך: ' + row.name }, `ערבות ${GUAR_KINDS[g.kind]} ${g.number || ''}`.trim());
  } else if (t === 'worker') {
    const w = d.worker; const rate = n(w.rate) || null;
    await ins('workers', { name: w.name, id_no: w.id_no || null, phone: w.phone || null, trade: w.trade || null, pay_type: w.pay_type, monthly_salary: w.pay_type === 'salary' ? rate : null, daily_rate: w.pay_type === 'daily' ? rate : null, hourly_rate: w.pay_type === 'hourly' ? rate : null, piece_rate: w.pay_type === 'piece' ? rate : null, is_foreign: !!w.is_foreign, active: true }, `עובד ${w.name}`);
  }

  const patch = { extracted: d, doc_type: t, project_id: d.project_id || pid, status: t === 'other' ? 'stored' : 'done', links, done_at: new Date().toISOString(), note: undo.length ? JSON.stringify({ undo }) : row.note };
  await db.update('files', row.id, patch); Object.assign(row, patch);
  await logChange({ project_id: d.project_id || null, entity: 'file', entity_id: row.id, label: `קליטת מסמך: ${row.name}`, field: 'קליטה', old_value: null, new_value: links.filter(l => l.label).map(l => l.label).join(' · ') });
  return { links };
}

async function insertBoq(lines, pid, data, track, upd) {
  const exist = data.items.filter(i => i.project_id === pid && !i.variation_id);
  const add = []; let sort = exist.length;
  for (const l of lines) {
    const cur = l.code ? exist.find(i => String(i.code).trim() === String(l.code).trim()) : null;
    if (cur) await upd('boq_items', cur.id, { description: l.description || cur.description, unit: l.unit || cur.unit, qty: l.qty ?? cur.qty, unit_price: l.unit_price ?? cur.unit_price }, cur, null);
    else add.push({ tenant_id: S.tenantId, project_id: pid, variation_id: null, chapter: l.chapter || (l.code ? String(l.code).split('.')[0] : '') || null, code: l.code || null, description: l.description, unit: l.unit || null, qty: n(l.qty), unit_price: n(l.unit_price), billing_method: 'measure', progress_pct: 0, sort: sort++ });
  }
  if (add.length) { const rows = await db.insert('boq_items', add); track('boq_items', rows); return rows.length; }
  return 0;
}

async function undoApply(row) {
  const links = row.links || [];
  let undo = [];
  try { undo = JSON.parse(row.note || '{}').undo || []; } catch { undo = []; }
  for (const l of [...links].reverse().filter(l => l.created)) await db.remove(l.table, l.id).catch(() => {});
  for (const u of [...undo].reverse()) await db.update(u.table, u.id, u.patch).catch(() => {});
  await db.update('files', row.id, { status: 'review', links: [], done_at: null, note: null });
  await logChange({ entity: 'file', entity_id: row.id, label: `ביטול קליטה: ${row.name}`, field: 'קליטה', old_value: links.filter(l => l.label).map(l => l.label).join(' · '), new_value: 'בוטל' });
}
