// חשבונות חלקיים: רשימה, מסך חשבון (מצטבר קודם / נוכחי / מצטבר, מוגש מול מאושר), ניכויים, קנסות, תקבולים וגבייה
import { h, esc, $, $$, modal, field, select, toast, money, num, pct, fmtDate, nullIfEmpty, numOrNull, confirmBox } from '../util.js';
import { db } from '../db.js';
import { S, can, render, logChange, settings, loadTenantData } from '../app.js';
import { n, itemSale, VO_APPROVED } from '../calc.js';
import { BILL_STATUS, BILL_APPROVED, FINE_STATUS, fineStatus, CUT_REASONS, isMeasure, cumAmount, dueDate, collection, progressFromBills, computeBills } from '../bills.js';
import { projData, summarize } from './common.js';
import { loadXLSX } from '../import.js';
import { finalBill, GUAR_KINDS, guaranteeState } from '../docs.js';
import { guarDialog } from './vendors.js';
import { groupBy } from './project.js';
import { attachBtn, wireAttach } from '../files.js';

const fineChip = f => { const s = fineStatus(f); return `<span class="chip ${s === 'appeal' ? 'amber' : s === 'cancelled' ? '' : 'red'}">${FINE_STATUS[s]}${s === 'cancelled' ? ' · לא מנוכה' : ''}</span>`; };
const todayStr = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
const statusChip = (r, today = todayStr()) => {
  const b = r.bill;
  if (b.status !== 'draft' && r.outstanding <= 1 && r.paid > 0) return '<span class="chip green">שולם</span>';
  if (b.status !== 'draft' && r.due && r.due < today && r.outstanding > 1) return `<span class="chip red">באיחור ${Math.round((new Date(today) - new Date(r.due)) / 864e5)} ימים</span>`;
  return `<span class="chip ${b.status === 'draft' ? '' : b.status === 'submitted' ? 'blue' : 'violet'}">${BILL_STATUS[b.status]}</span>`;
};

// פריטים שנכנסים לחשבון: סעיפי חוזה + סעיפי הוראות שינוי מאושרות
const billableItems = P => { const vo = Object.fromEntries(P.pd.variations.map(v => [v.id, v])); return P.pd.items.filter(i => !i.variation_id || VO_APPROVED.includes(vo[i.variation_id]?.status)); };

// ===== לשונית חשבונות בפרויקט =====
export function tabBills(P) {
  const B = P.summary.billing;
  const edit = can.expense();
  const res = B.order.map(id => B.byBill[id]);
  const c = collection(B.byBill);
  const s = P.summary;
  const saleInView = s.contract.sale + s.approved.sale;
  const hasFinal = P.pd.bills.some(b => b.is_final);
  const fb = finalBill(P.project, B.retentionTotal);
  const today = todayStr();
  const gs = (P.data.guarantees || []).filter(g => g.project_id === P.id);
  const last = res.filter(r => r.bill.status !== 'draft').pop();
  const cum = last ? last.cumEffTotal : 0;
  const el = h(`<div>
    <div class="kpis">
      <div class="kpi"><div class="l">מצטבר בחשבונות</div><div class="v">${money(cum)}</div><div class="n">${pct(saleInView ? cum / saleInView * 100 : 0, { d: 0 })} מחוזה + הוראות שינוי מאושרות (${money(saleInView)})</div></div>
      <div class="kpi"><div class="l">קיצוצי פיקוח (מצטבר)</div><div class="v ${res.some(r => r.cut > 0) ? 'neg' : ''}">${money(res.reduce((a, r) => a + (r.approvedStage ? r.cut : 0), 0))}</div><div class="n">הוגש ולא אושר</div></div>
      <div class="kpi"><div class="l">עיכבון שנצבר</div><div class="v">${money(B.retentionTotal)}</div><div class="n">${P.project.retention_pct}%${n(P.project.retention_cap) ? ` · תקרה ${money(P.project.retention_cap)}` : ''}</div></div>
      <div class="kpi"><div class="l">לגבייה (כולל מע"מ)</div><div class="v">${money(c.outstanding)}</div><div class="n ${c.overdue.length ? 'neg' : ''}">${c.overdue.length ? `${c.overdue.length} באיחור` : 'אין חשבונות באיחור'}</div></div>
    </div>
    <div class="actions" style="margin-bottom:12px">${edit && !hasFinal ? '<button class="btn" id="add">+ חשבון חלקי</button>' : ''}${hasFinal ? '<span class="chip violet">הוגש חשבון סופי</span>' : ''}<span class="mut small">תנאי תשלום: שוטף+${P.project.pay_terms_days} · ניכויים: עיכבון ${P.project.retention_pct}%, ביטוח ${P.project.insurance_pct}%, הוצאות משותפות ${P.project.shared_pct}%${n(P.project.tax_pct) ? `, ניכוי מס ${P.project.tax_pct}%` : ''}${P.project.indexation ? ` · צמוד למדד (בסיס ${num(P.project.base_index)})` : ''}</span></div>
    <div class="tw"><table><thead><tr><th>מס'</th><th class="hide-m">עד תאריך</th><th>הוגש</th><th class="n">נוכחי מוגש</th><th class="n">נוכחי מאושר</th><th class="n hide-m">קיצוץ</th><th class="n hide-m">ניכויים וקנסות</th><th class="n">נטו לפני מע"מ</th><th class="hide-m">מועד תשלום</th><th class="n">יתרה לגבייה</th><th>סטטוס</th></tr></thead><tbody>
    ${res.map(r => `<tr class="click" data-b="${r.bill.id}"><td><b>${r.bill.number}</b></td><td class="hide-m">${fmtDate(r.bill.period_to)}</td><td>${fmtDate(r.bill.submitted_date)}</td>
      <td class="n">${money(r.curSub)}</td><td class="n">${r.curApp != null ? money(r.curApp) : '<span class="mut">—</span>'}</td><td class="n hide-m ${r.cut > 0 ? 'neg' : ''}">${r.cut ? money(r.cut) : ''}</td>
      <td class="n hide-m">${money(r.retention + r.insurance + r.shared + r.finesTotal + r.offsets)}</td><td class="n"><b>${money(r.net)}</b></td><td class="hide-m">${r.bill.status === 'draft' ? '' : fmtDate(r.due)}</td>
      <td class="n">${r.bill.status === 'draft' ? '' : money(r.outstanding)}</td><td style="white-space:nowrap">${statusChip(r)}${edit ? ' ' + attachBtn(P.data.files, 'bills', r.bill.id, { projectId: P.id, docType: 'approved_bill', label: `חשבון ${r.bill.number}` }) : ''}</td></tr>`).join('')
      || `<tr><td colspan="11" class="empty">אין חשבונות עדיין. חשבון חלקי מצטבר: כל חשבון ממשיך מהמצטבר המאושר של הקודם.</td></tr>`}</tbody></table></div></div>`);
  wireAttach(el, P.data.files || [], render);
  $$('[data-b]', el).forEach(tr => tr.onclick = e => { if (!e.target.closest('[data-att]')) location.hash = `#/project/${P.id}/bill/${tr.dataset.b}`; });
  // סגירת פרויקט וחשבון סופי
  const pr = P.project;
  const close = h(`<div class="cols even" style="margin-top:14px"><div class="card"><h2>סגירה וחשבון סופי</h2>
    <form id="cf"><label class="chk"><input type="checkbox" name="as_made_ok" ${pr.as_made_ok ? 'checked' : ''}> תוכניות As-Made הוגשו ואושרו</label>
    <label class="chk"><input type="checkbox" name="rejects_ok" ${pr.rejects_ok ? 'checked' : ''}> כל הליקויים (רג'קטים) נסגרו</label>
    <div class="grid g3">${field('תאריך מסירה / תעודת השלמה', 'completion_date', pr.completion_date, { type: 'date' })}${field('תקופת בדק (חודשים)', 'warranty_months', pr.warranty_months ?? 12, { type: 'number' })}${field('עיכבון ששוחרר ₪', 'retention_released', pr.retention_released ?? 0, { type: 'number' })}</div>
    ${edit ? '<button class="btn small ghost">שמירת מצב סגירה</button>' : ''}</form>
    <table class="sumt" style="margin-top:10px"><tr><td>עיכבון שנצבר</td><td class="n">${money(B.retentionTotal)}</td></tr><tr><td>שוחרר</td><td class="n">${money(n(pr.retention_released))}</td></tr><tr class="tot"><td>עיכבון לשחרור</td><td class="n">${money(fb.toRelease)}</td></tr>
      <tr><td>סוף תקופת הבדק</td><td class="n">${fb.warrantyEnd ? fmtDate(fb.warrantyEnd) : '<span class="mut">אחרי תאריך מסירה</span>'}</td></tr></table>
    ${hasFinal ? '' : fb.ready ? (edit ? '<button class="btn" id="addfinal" style="margin-top:10px">+ חשבון סופי</button>' : '') : `<p class="small neg">לפני חשבון סופי חסר: ${fb.missing.join(' · ')}</p>`}</div>
    <div class="card"><h2>ערבויות בפרויקט ${edit ? '<button class="btn small" id="addg" type="button">+ ערבות</button>' : ''}</h2>
      ${gs.map(g => { const st = guaranteeState(g, today); return `<div class="act"><div><b>${GUAR_KINDS[g.kind]}</b> · ${esc(g.bank || '')} ${esc(g.number || '')}<small>${st === 'returned' ? 'הוחזרה' : `בתוקף עד ${fmtDate(g.expiry)}${st === 'expired' ? ' · פג תוקף' : st === 'soon' ? ' · פג בקרוב' : ''}`}</small></div><span class="amt ${['expired', 'soon'].includes(st) ? 'neg' : ''}">${money(g.amount)}</span></div>`; }).join('') || '<div class="small mut">אין ערבויות בפרויקט</div>'}
      <p class="small mut">ערבות ביצוע מוחלפת בדרך כלל בערבות בדק בחשבון הסופי.</p></div></div>`);
  el.appendChild(close);
  if (!edit) $$('input', close).forEach(x => x.disabled = true);
  $('#cf', close).onsubmit = async e => {
    e.preventDefault(); const f = e.target;
    const row = { as_made_ok: f.as_made_ok.checked, rejects_ok: f.rejects_ok.checked, completion_date: f.completion_date.value || null, warranty_months: Math.round(n(f.warranty_months.value)) || 12, retention_released: n(f.retention_released.value) };
    await db.update('projects', P.id, row);
    for (const [k, l] of [['as_made_ok', 'As-Made'], ['rejects_ok', 'ליקויים נסגרו'], ['retention_released', 'עיכבון ששוחרר']]) if (String(pr[k] ?? '') !== String(row[k] ?? '')) await logChange({ project_id: P.id, entity: 'project', entity_id: P.id, label: pr.name, field: l, old_value: pr[k], new_value: row[k] });
    toast('מצב הסגירה נשמר'); render();
  };
  $('#addg', close)?.addEventListener('click', () => guarDialog(P.data, null, { project_id: P.id, main_contractor_id: pr.main_contractor_id }));
  $('#addfinal', close)?.addEventListener('click', () => newBill(P, true));
  $('#add', el)?.addEventListener('click', () => newBill(P));
  return el;
}

async function newBill(P, final = false) {
  const B = P.summary.billing;
  if (P.pd.bills.some(b => b.is_final)) return toast('כבר יש חשבון סופי בפרויקט', 'bad');
  if (P.pd.bills.some(b => b.status === 'draft')) return toast('יש כבר חשבון בטיוטה. משלימים או מוחקים אותו לפני חשבון חדש.', 'bad');
  const number = Math.max(0, ...P.pd.bills.map(b => n(b.number))) + 1;
  const end = new Date(); end.setDate(0);
  const [b] = await db.insert('bills', { tenant_id: S.tenantId, project_id: P.id, number, status: 'draft', bill_date: todayStr(), period_to: final ? (P.project.completion_date || todayStr()) : end.toISOString().slice(0, 10), offsets: 0, is_final: final });
  // שורה לכל סעיף שאפשר לחייב, מתחילה מהמצטבר הקודם (נוכחי 0)
  await db.insert('bill_lines', billableItems(P).map(it => ({ tenant_id: S.tenantId, project_id: P.id, bill_id: b.id, boq_item_id: it.id, cum_qty_sub: B.cumByItem[it.id] ?? 0, cum_qty_app: null })));
  await logChange({ project_id: P.id, entity: 'bill', entity_id: b.id, label: `${final ? 'חשבון סופי' : 'חשבון חלקי'} ${number}`, field: 'חשבון חדש', new_value: 'טיוטה' });
  location.hash = `#/project/${P.id}/bill/${b.id}`;
}

// ===== מסך חשבון =====
export function billView(P, billId) {
  const B = P.summary.billing;
  const r0 = B.byBill[billId];
  if (!r0) return h('<div class="card empty">החשבון לא נמצא</div>');
  const bill = r0.bill;
  const edit = can.expense();
  const items = billableItems(P);
  const prevOf = {};
  for (const r of r0.rows) prevOf[r.item.id] = r.prev;
  const lineOf = Object.fromEntries(P.pd.billLines.filter(l => l.bill_id === billId).map(l => [l.boq_item_id, l]));
  // מצב עריכה מקומי
  const st = { head: { ...bill }, lines: {}, fines: P.pd.fines.filter(f => f.bill_id === billId).map(f => ({ ...f })) };
  for (const it of items) { const l = lineOf[it.id]; st.lines[it.id] = { cum_qty_sub: l?.cum_qty_sub ?? prevOf[it.id] ?? 0, cum_qty_app: l?.cum_qty_app ?? null, cut_reason: l?.cut_reason || '' }; }
  const vo = Object.fromEntries(P.pd.variations.map(v => [v.id, v]));
  const isLast = n(bill.number) === Math.max(...P.pd.bills.map(b => n(b.number)));
  const prevBill = P.pd.bills.filter(b => n(b.number) < n(bill.number)).sort((a, b) => n(b.number) - n(a.number))[0];
  const showApp = () => st.head.status !== 'draft';

  const el = h(`<div class="billv">
    <div class="top"><div><h1>${bill.is_final ? 'חשבון סופי' : 'חשבון חלקי'} ${bill.number}</h1><div class="sub">${esc(P.project.name)} · ${P.data.mcs.find(m => m.id === P.project.main_contractor_id)?.name ? esc(P.data.mcs.find(m => m.id === P.project.main_contractor_id).name) : ''}</div></div>
      <div class="actions"><button class="btn ghost small" id="xl">ייצוא לאקסל</button><button class="btn ghost small" id="pr">הדפסה</button><a class="btn ghost small" href="#/project/${P.id}/bills">כל החשבונות</a></div></div>
    ${bill.is_final ? (() => { const fb = finalBill(P.project, P.summary.billing.retentionTotal); return `<div class="note ${fb.ready ? '' : 'neg'}"><b>חשבון סופי.</b> ${fb.ready ? `עיכבון לשחרור: <b>${money(fb.toRelease)}</b> · סוף תקופת הבדק: <b>${fmtDate(fb.warrantyEnd)}</b>. כדאי לצרף ערבות בדק במקום העיכבון.` : `אי אפשר להגיש עד שיושלם: ${fb.missing.join(' · ')} (בלשונית החשבונות, "סגירה וחשבון סופי").`}</div>`; })() : ''}
    <div class="card"><div class="grid g4">
      ${field('עד תאריך (תקופה)', 'period_to', bill.period_to, { type: 'date' })}${field('תאריך החשבון', 'bill_date', bill.bill_date, { type: 'date' })}
      ${select('סטטוס', 'status', BILL_STATUS, bill.status)}${field('תאריך הגשה', 'submitted_date', bill.submitted_date, { type: 'date' })}
      ${field('תאריך אישור', 'approved_date', bill.approved_date, { type: 'date' })}${field('מועד תשלום (ריק = שוטף+' + P.project.pay_terms_days + ')', 'due_date', bill.due_date, { type: 'date' })}
      ${P.project.indexation ? field(`מדד החשבון (בסיס ${num(P.project.base_index)})`, 'index_value', bill.index_value, { type: 'number' }) : ''}
      ${field('קיזוזים נוספים ₪', 'offsets', bill.offsets, { type: 'number' })}${field('סיבת הקיזוז', 'offsets_note', bill.offsets_note)}</div></div>
    ${edit ? `<div class="actions" style="margin-bottom:10px">
      <button class="btn ghost small" id="fromlog" title="מצטבר קודם + כמויות שדווחו ביומן העבודה עד תאריך החשבון">מילוי מוגש לפי כמויות מהיומן</button>
      <button class="btn ghost small" id="fromprog" title="כמות חוזית × אחוז הביצוע בבקרה">מילוי מוגש לפי אחוז הביצוע</button>
      <button class="btn ghost small" id="appall">מאושר = מוגש</button></div>` : ''}
    <div class="tw" id="lt"></div>
    <div class="cols even"><div class="card"><h2>קנסות ${edit ? '<button class="btn small" id="addf" type="button">+ קנס</button>' : ''}</h2><div id="fl"></div><p class="small mut" id="ft"></p></div>
      <div class="card"><h2>סיכום החשבון</h2><div id="sum"></div></div></div>
    <div class="card"><h2>תקבולים ${edit && bill.status !== 'draft' ? '<button class="btn small" id="addp" type="button">+ תקבול</button>' : ''}</h2><div id="pl"></div></div>
    ${edit ? `<div class="savebar"><span id="sb"></span><span class="sp"></span>${bill.status === 'draft' || isLast ? '<button class="btn ghost danger-t" id="del" type="button">מחיקת החשבון</button>' : ''}<button class="btn ghost" id="prog" type="button">עדכון אחוזי ביצוע לפי החשבון</button><button class="btn" id="save" type="button">שמירה</button></div>` : ''}</div>`);
  if (!edit) $$('input,select', el).forEach(x => x.disabled = true);

  const calcNow = () => {
    const head = { ...bill, ...st.head };
    const lines = items.map(it => ({ bill_id: billId, boq_item_id: it.id, ...st.lines[it.id] }));
    const others = P.pd.billLines.filter(l => l.bill_id !== billId);
    const bills = P.pd.bills.map(b => b.id === billId ? head : b);
    const fines = P.pd.fines.filter(f => f.bill_id !== billId).concat(st.fines.map(f => ({ ...f, bill_id: billId })));
    return summarizeBill(P, bills, others.concat(lines), billId, fines);
  };
  const lt = $('#lt', el);
  const draw = () => {
    const r = calcNow();
    const rowBy = Object.fromEntries(r.rows.map(x => [x.item.id, x]));
    const groups = groupBy(items, i => i.variation_id ? `הוראת שינוי ${vo[i.variation_id]?.number || ''} · ${vo[i.variation_id]?.title || ''}` : (i.chapter || 'ללא פרק'));
    const app = showApp();
    let html = `<table><thead><tr><th>קוד</th><th>תיאור</th><th class="hide-m">יח'</th><th class="n hide-m">כמות חוזה</th><th class="n hide-m">מחיר</th><th class="n">מצטבר קודם</th><th class="n">מצטבר מוגש</th><th class="n">נוכחי</th>${app ? '<th class="n">מצטבר מאושר</th><th class="n">קיצוץ</th>' : ''}<th class="n">סכום נוכחי</th></tr></thead><tbody>`;
    for (const [g, its] of groups) {
      html += `<tr class="sec"><td colspan="${app ? 11 : 9}">${esc(g)}</td></tr>`;
      for (const it of its) {
        const x = rowBy[it.id] || {}, L = st.lines[it.id];
        const unitLbl = isMeasure(it) ? esc(it.unit || '') : '%';
        const inp = (k, v) => edit ? `<input class="cell-in" type="number" step="any" inputmode="decimal" dir="ltr" data-i="${it.id}" data-k="${k}" value="${v ?? ''}" ${k === 'cum_qty_app' && v == null ? `placeholder="${L.cum_qty_sub ?? ''}"` : ''}>` : num(v);
        html += `<tr class="${x.over ? 'al-r' : ''}"><td>${esc(it.code || '')}</td><td class="wrap">${esc(it.description)}${isMeasure(it) ? '' : ' <span class="chip">באחוזים</span>'}${x.over ? ' <span class="chip red">מעל כמות החוזה</span>' : ''}</td>
          <td class="hide-m">${unitLbl}</td><td class="n hide-m">${isMeasure(it) ? num(it.qty) : '100%'}</td><td class="n hide-m">${money(isMeasure(it) ? it.unit_price : itemSale(it), { unit: true })}</td>
          <td class="n">${num(x.prev ?? 0)}</td><td class="n">${inp('cum_qty_sub', L.cum_qty_sub)}</td><td class="n">${num(x.curSub ?? 0)}</td>
          ${app ? `<td class="n">${inp('cum_qty_app', L.cum_qty_app)}</td><td class="n ${x.cut > 0 ? 'neg' : ''}">${x.cut ? num(x.cut) : ''}${x.cut > 0 ? (edit ? `<input class="cell-in cutr" list="cutr" data-i="${it.id}" data-r="1" value="${esc(L.cut_reason || '')}" placeholder="סיבת הקיצוץ">` : (L.cut_reason ? `<div class="small">${esc(L.cut_reason)}</div>` : '')) : ''}</td>` : ''}
          <td class="n">${money(app && x.curAppAmt != null ? x.curAppAmt : x.curSubAmt)}</td></tr>`;
      }
    }
    html += `<tr class="tot"><td></td><td>סה"כ נוכחי</td><td class="hide-m"></td><td class="hide-m"></td><td class="hide-m"></td><td class="n">${money(r.prevTotal)}</td><td class="n">${money(r.cumSubTotal)}</td><td class="n">${money(r.curSub)}</td>${app ? `<td></td><td class="n neg">${r.cut ? money(r.cut) : ''}</td>` : ''}<td class="n">${money(r.base)}</td></tr></tbody></table>`;
    lt.innerHTML = html + `<datalist id="cutr">${CUT_REASONS.map(c => `<option value="${esc(c)}">`).join('')}</datalist>`;
    $$('[data-k]', lt).forEach(inp => inp.onchange = () => { st.lines[inp.dataset.i][inp.dataset.k] = inp.value === '' ? null : n(inp.value); draw(); });
    $$('[data-r]', lt).forEach(inp => inp.onchange = () => { st.lines[inp.dataset.i].cut_reason = inp.value.trim(); });
    drawSum(r);
  };
  const drawSum = r => {
    const line = (l, v, cls = '') => `<tr class="${cls}"><td>${l}</td><td class="n">${money(v)}</td></tr>`;
    $('#sum', el).innerHTML = `<table class="sumt">${line(r.approvedStage && r.curApp != null ? 'נוכחי מאושר' : 'נוכחי מוגש', r.base)}
      ${r.indexDiff ? line('הפרשי הצמדה', r.indexDiff) : ''}${line('סה"כ ברוטו', r.gross, 'tot')}
      ${line(`עיכבון ${P.project.retention_pct}%`, -r.retention)}${n(P.project.insurance_pct) ? line(`ביטוח ${P.project.insurance_pct}%`, -r.insurance) : ''}${n(P.project.shared_pct) ? line(`הוצאות משותפות ${P.project.shared_pct}%`, -r.shared) : ''}
      ${r.finesTotal ? line('קנסות', -r.finesTotal) : ''}${r.finesAppeal ? `<tr><td class="small mut">מתוכם בערעור (אם יבוטלו יוחזרו)</td><td class="n small mut">${money(r.finesAppeal)}</td></tr>` : ''}${r.offsets ? line('קיזוזים', -r.offsets) : ''}
      ${line('נטו לפני מע"מ', r.net, 'tot')}${line(`מע"מ ${settings().vat_pct}%`, r.vat)}${line('סה"כ כולל מע"מ', r.totalWithVat, 'tot')}
      ${r.tax ? `<tr><td class="small mut">ניכוי מס במקור ${P.project.tax_pct}% (מוצג בנפרד)</td><td class="n small mut">${money(-r.tax)}</td></tr>` : ''}</table>
      ${r.cut > 0 && r.approvedStage ? `<p class="small neg">הפיקוח קיצץ ${money(r.cut)} מהמוגש בחשבון הזה.</p>` : ''}
      <p class="small mut">מועד תשלום: ${fmtDate(st.head.due_date || dueDate(st.head.submitted_date || st.head.bill_date, P.project.pay_terms_days))} · עיכבון מצטבר עד החשבון: ${money(r.retentionCum)}</p>`;
    if ($('#sb', el)) $('#sb', el).innerHTML = `נוכחי ${money(r.base)} · נטו ${money(r.net)}`;
  };
  const drawFines = () => {
    $('#fl', el).innerHTML = st.fines.map((f, k) => `<div class="qrow" data-f="${k}">${edit ? `<input data-k="description" value="${esc(f.description || '')}" placeholder="סיבת הקנס" style="flex:1 1 180px">
      <input data-k="amount" type="number" step="any" dir="ltr" value="${f.amount ?? ''}" placeholder="₪" style="width:100px"><select data-k="status" aria-label="סטטוס הקנס">${Object.entries(FINE_STATUS).map(([k, l]) => `<option value="${k}" ${fineStatus(f) === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <button type="button" class="btn small ghost" data-rm aria-label="הסרה">✕</button>` : `${esc(f.description)} · ${money(f.amount)} ${fineChip(f)}`}</div>`).join('') || '<div class="small mut">אין קנסות בחשבון הזה</div>';
    $$('[data-f]', $('#fl', el)).forEach(row => { const f = st.fines[+row.dataset.f];
      $$('[data-k]', row).forEach(inp => inp.onchange = () => { f[inp.dataset.k] = inp.dataset.k === 'amount' ? n(inp.value) : inp.value; draw(); drawFineTotals(); });
      $('[data-rm]', row)?.addEventListener('click', () => { st.fines.splice(+row.dataset.f, 1); drawFines(); draw(); drawFineTotals(); }); });
  };
  const drawFineTotals = () => { const a = st.fines.filter(f => fineStatus(f) !== 'cancelled').reduce((x, f) => x + n(f.amount), 0), ap = st.fines.filter(f => fineStatus(f) === 'appeal').reduce((x, f) => x + n(f.amount), 0);
    $('#ft', el).innerHTML = st.fines.length ? `מנוכה: <b>${money(a)}</b>${ap ? ` · בערעור ${money(ap)}` : ''}` : ''; };
  const drawPays = () => {
    const ps = P.pd.payments.filter(p => p.bill_id === billId);
    const r = calcNow();
    $('#pl', el).innerHTML = `${ps.map(p => `<div class="act"><div><b>${fmtDate(p.pay_date)}</b> · ${esc(p.method || '')}<small>${esc(p.note || '')}</small></div><span class="amt">${money(p.amount)}</span>${edit ? `<button class="btn small ghost" data-rp="${p.id}" aria-label="מחיקה">✕</button>` : ''}</div>`).join('') || '<div class="small mut">לא התקבלו תשלומים</div>'}
      ${bill.status !== 'draft' ? `<p class="small">שולם ${money(r.paid)} מתוך ${money(r.totalWithVat)} (כולל מע"מ) · יתרה <b>${money(r.outstanding)}</b></p>` : '<p class="small mut">תקבולים נרשמים אחרי שהחשבון מוגש.</p>'}`;
    $$('[data-rp]', el).forEach(b => b.onclick = async () => { if (!(await confirmBox('מחיקת תקבול', 'למחוק את התקבול?', 'מחיקה', true))) return; await db.remove('bill_payments', b.dataset.rp); toast('נמחק'); render(); });
  };
  draw(); drawFines(); drawFineTotals(); drawPays();

  $$('.card input[name], .card select[name]', el).forEach(inp => inp.onchange = () => { st.head[inp.name] = inp.type === 'number' ? (inp.value === '' ? null : n(inp.value)) : (inp.value || null); if (inp.name === 'status') { if (!['draft', 'submitted'].includes(inp.value) && !st.head.approved_date) { st.head.approved_date = todayStr(); $('[name=approved_date]', el).value = st.head.approved_date; } if (inp.value !== 'draft' && !st.head.submitted_date) { st.head.submitted_date = todayStr(); $('[name=submitted_date]', el).value = st.head.submitted_date; } } draw(); });
  $('#addf', el)?.addEventListener('click', () => { st.fines.push({ description: '', amount: '', status: 'imposed' }); drawFines(); });
  $('#appall', el)?.addEventListener('click', () => { for (const it of items) st.lines[it.id].cum_qty_app = st.lines[it.id].cum_qty_sub; if (st.head.status === 'draft' || st.head.status === 'submitted') { st.head.status = 'approved'; $('[name=status]', el).value = 'approved'; if (!st.head.approved_date) { st.head.approved_date = todayStr(); $('[name=approved_date]', el).value = st.head.approved_date; } } draw(); });
  $('#fromlog', el)?.addEventListener('click', () => {
    const from = prevBill?.period_to || '0000-00-00', to = st.head.period_to || todayStr();
    let k = 0;
    for (const it of items) { const q = P.pd.wqty.filter(x => x.boq_item_id === it.id && x.log_date > from && x.log_date <= to).reduce((a, x) => a + n(x.qty), 0);
      if (q && isMeasure(it)) { st.lines[it.id].cum_qty_sub = Math.round(((prevOf[it.id] || 0) + q) * 100) / 100; k++; } }
    draw(); toast(k ? `עודכנו ${k} סעיפים לפי היומן (${fmtDate(from === '0000-00-00' ? null : from) || 'מההתחלה'} עד ${fmtDate(to)})` : 'אין כמויות ביומן העבודה לתקופה הזו', k ? 'ok' : 'bad');
  });
  $('#fromprog', el)?.addEventListener('click', () => {
    for (const it of items) { const q = isMeasure(it) ? n(it.qty) * n(it.progress_pct) / 100 : n(it.progress_pct); if (q > (prevOf[it.id] || 0)) st.lines[it.id].cum_qty_sub = Math.round(q * 100) / 100; }
    draw(); toast('המוגש עודכן לפי אחוז הביצוע (רק סעיפים שהתקדמו)');
  });
  $('#save', el)?.addEventListener('click', async () => {
    const r = calcNow();
    if (bill.is_final && st.head.status !== 'draft' && !finalBill(P.project, P.summary.billing.retentionTotal).ready) return toast('חשבון סופי: צריך קודם As-Made, סגירת ליקויים ותאריך מסירה', 'bad');
    if (r.overItems.length && !(await confirmBox('כמות מעל החוזה', `ב-${r.overItems.length} סעיפים המצטבר גבוה מכמות החוזה. לשמור בכל זאת? (אולי צריך הוראת שינוי)`, 'שמירה'))) return;
    const head = { period_to: nullIfEmpty(st.head.period_to), bill_date: nullIfEmpty(st.head.bill_date), status: st.head.status, submitted_date: nullIfEmpty(st.head.submitted_date), approved_date: nullIfEmpty(st.head.approved_date),
      due_date: nullIfEmpty(st.head.due_date), index_value: numOrNull(st.head.index_value), offsets: n(st.head.offsets), offsets_note: st.head.offsets_note || null };
    await db.update('bills', billId, head);
    for (const it of items) {
      const L = st.lines[it.id], ex = lineOf[it.id];
      const row = { cum_qty_sub: numOrNull(L.cum_qty_sub), cum_qty_app: numOrNull(L.cum_qty_app), cut_reason: L.cut_reason || null };
      if (ex) { if (String(ex.cum_qty_sub ?? '') !== String(row.cum_qty_sub ?? '') || String(ex.cum_qty_app ?? '') !== String(row.cum_qty_app ?? '') || String(ex.cut_reason || '') !== String(row.cut_reason || '')) await db.update('bill_lines', ex.id, row); }
      else await db.insert('bill_lines', { tenant_id: S.tenantId, project_id: P.id, bill_id: billId, boq_item_id: it.id, ...row });
    }
    await db.removeWhere('bill_fines', { eq: { bill_id: billId } });
    const fines = st.fines.filter(f => String(f.description || '').trim() || n(f.amount));
    if (fines.length) await db.insert('bill_fines', fines.map(f => ({ tenant_id: S.tenantId, project_id: P.id, bill_id: billId, description: String(f.description || 'קנס').trim(), amount: n(f.amount), status: fineStatus(f), disputed: fineStatus(f) === 'appeal', note: f.note || null })));
    const r0n = Math.round(r0.net), rn = Math.round(r.net);
    if (bill.status !== head.status || r0n !== rn) await logChange({ project_id: P.id, entity: 'bill', entity_id: billId, label: `חשבון חלקי ${bill.number}`, field: bill.status !== head.status ? 'סטטוס' : 'נטו',
      old_value: bill.status !== head.status ? BILL_STATUS[bill.status] : r0n, new_value: bill.status !== head.status ? BILL_STATUS[head.status] : rn });
    toast('החשבון נשמר'); render();
  });
  $('#prog', el)?.addEventListener('click', async () => {
    const r = calcNow();
    const cum = {}; for (const x of r.rows) cum[x.item.id] = x.cumEff;
    const pr = progressFromBills(items, cum);
    const changes = items.filter(it => pr[it.id] != null && Math.abs(pr[it.id] - n(it.progress_pct)) >= 0.5);
    if (!changes.length) return toast('אחוזי הביצוע כבר תואמים לחשבון');
    if (!(await confirmBox('עדכון אחוזי ביצוע', `לעדכן ${changes.length} סעיפים לפי המצטבר ${r.approvedStage ? 'המאושר' : 'המוגש'} בחשבון? (למשל ${changes[0].code || ''}: ${Math.round(n(changes[0].progress_pct))}% ← ${pr[changes[0].id]}%)`, 'עדכון'))) return;
    for (const it of changes) { await db.update('boq_items', it.id, { progress_pct: pr[it.id] }); await logChange({ project_id: P.id, entity: 'boq_item', entity_id: it.id, label: `${it.code || ''} ${it.description}`, field: 'אחוז ביצוע', old_value: it.progress_pct, new_value: pr[it.id], reason: `לפי חשבון ${bill.number}` }); }
    toast(`עודכנו ${changes.length} סעיפים`); render();
  });
  $('#addp', el)?.addEventListener('click', async () => {
    const r = calcNow();
    const d = await modal({ title: `תקבול לחשבון ${bill.number}`, body: `<div class="grid g2">${field('תאריך', 'pay_date', todayStr(), { type: 'date', req: true })}${field('סכום ₪ (כולל מע"מ)', 'amount', Math.round(r.outstanding) || '', { type: 'number', req: true })}
      ${select('אמצעי', 'method', { 'העברה בנקאית': 'העברה בנקאית', 'שיק': 'שיק', 'קיזוז': 'קיזוז', 'אחר': 'אחר' }, 'העברה בנקאית')}${field('הערה', 'note', '')}</div>`, validate: x => (!n(x.amount) ? 'חסר סכום' : null) });
    if (!d) return;
    await db.insert('bill_payments', { tenant_id: S.tenantId, project_id: P.id, bill_id: billId, pay_date: d.pay_date, amount: n(d.amount), method: d.method, note: d.note || null });
    if (n(d.amount) >= r.outstanding - 1 && bill.status !== 'paid') await db.update('bills', billId, { status: 'paid' });
    await logChange({ project_id: P.id, entity: 'bill', entity_id: billId, label: `חשבון חלקי ${bill.number}`, field: 'תקבול', new_value: n(d.amount) });
    toast('התקבול נרשם'); render();
  });
  $('#del', el)?.addEventListener('click', async () => {
    if (!(await confirmBox('מחיקת חשבון', `למחוק את חשבון ${bill.number} עם השורות, הקנסות והתקבולים שלו?`, 'מחיקה', true))) return;
    await db.remove('bills', billId); await logChange({ project_id: P.id, entity: 'bill', entity_id: billId, label: `חשבון חלקי ${bill.number}`, field: 'מחיקה', old_value: Math.round(r0.net) });
    toast('החשבון נמחק'); location.hash = `#/project/${P.id}/bills`;
  });
  $('#pr', el).onclick = () => window.print();
  $('#xl', el).onclick = () => exportBill(P, calcNow(), items);
  return el;
}

function summarizeBill(P, bills, lines, billId, fines = P.pd.fines) {
  return computeBills({ project: P.project, items: P.pd.items, variations: P.pd.variations, bills, lines, fines, payments: P.pd.payments, vatPct: settings().vat_pct }).byBill[billId];
}

async function exportBill(P, r, items) {
  const XLSX = await loadXLSX();
  const mc = P.data.mcs.find(m => m.id === P.project.main_contractor_id)?.name || '';
  const app = r.approvedStage;
  const aoa = [[`חשבון חלקי מס' ${r.bill.number}`], [`פרויקט: ${P.project.name}`], [`לכבוד: ${mc}`], [`עד תאריך: ${r.bill.period_to || ''}`], [],
    ['קוד', 'תיאור', "יח'", 'כמות חוזה', 'מחיר', 'מצטבר קודם', 'מצטבר מוגש', 'נוכחי מוגש', ...(app ? ['מצטבר מאושר', 'קיצוץ', 'סיבת קיצוץ'] : []), 'סכום מצטבר', 'סכום קודם', 'סכום נוכחי']];
  for (const x of r.rows) { const it = x.item;
    aoa.push([it.code || '', it.description, isMeasure(it) ? it.unit || '' : '%', isMeasure(it) ? n(it.qty) : 100, isMeasure(it) ? n(it.unit_price) : itemSale(it), x.prev, x.cumSub, x.curSub, ...(app ? [x.cumApp ?? x.cumSub, x.cut, x.cut > 0 ? (x.line?.cut_reason || '') : ''] : []),
      Math.round(cumAmount(it, x.cumEff)), Math.round(x.prevAmt), Math.round(app && x.curAppAmt != null ? x.curAppAmt : x.curSubAmt)]); }
  aoa.push([], ['נוכחי', '', '', '', '', '', '', '', ...(app ? ['', '', ''] : []), '', '', Math.round(r.base)]);
  const sum = [['הפרשי הצמדה', r.indexDiff], ['עיכבון', -r.retention], ['ביטוח', -r.insurance], ['הוצאות משותפות', -r.shared], ['קנסות', -r.finesTotal], ['קיזוזים', -r.offsets], ['נטו לפני מע"מ', r.net], ['מע"מ', r.vat], ['סה"כ לתשלום', r.totalWithVat]];
  for (const [l, v] of sum) if (v || l.startsWith('נטו') || l.startsWith('סה"כ')) aoa.push([l, '', '', '', '', '', '', '', ...(app ? ['', '', ''] : []), '', '', Math.round(v)]);
  const ws = XLSX.utils.aoa_to_sheet(aoa); ws['!cols'] = [{ wch: 10 }, { wch: 40 }, { wch: 7 }, { wch: 10 }, { wch: 10 }, { wch: 11 }, { wch: 11 }, { wch: 11 }, { wch: 12 }, { wch: 10 }, { wch: 13 }, { wch: 13 }, { wch: 13 }];
  const wb = XLSX.utils.book_new(); wb.Workbook = { Views: [{ RTL: true }] }; XLSX.utils.book_append_sheet(wb, ws, `חשבון ${r.bill.number}`);
  XLSX.writeFile(wb, `חשבון ${r.bill.number} - ${P.project.name}.xlsx`);
}

// ===== גבייה לכל הפרויקטים =====
export async function viewCollection() {
  const data = await loadTenantData();
  const today = todayStr();
  const all = [];
  for (const p of data.projects) {
    const pd = projData(data, p.id);
    if (!pd.bills.length) continue;
    const s = summarize(pd);
    for (const id of s.billing.order) all.push({ p, r: s.billing.byBill[id] });
  }
  const open = all.filter(x => x.r.bill.status !== 'draft' && x.r.outstanding > 1).sort((a, b) => String(a.r.due).localeCompare(String(b.r.due)));
  const overdue = open.filter(x => x.r.due < today);
  const soon = open.filter(x => x.r.due >= today && (new Date(x.r.due) - new Date(today)) / 864e5 <= 30);
  const sum = xs => xs.reduce((a, x) => a + x.r.outstanding, 0);
  const notSubmitted = all.filter(x => x.r.bill.status === 'draft');
  const el = h(`<div><div class="top"><div><h1>חשבונות וגבייה</h1><div class="sub">כל החשבונות החלקיים שהוגשו לקבלנים הראשיים · סכומים כולל מע"מ</div><div class="small mut" style="margin-top:4px">חשבון חדש פותחים בתוך הפרויקט: פרויקטים > הפרויקט > לשונית "חשבונות" > "+ חשבון חלקי"</div></div></div>
    <div class="kpis"><div class="kpi"><div class="l">יתרה לגבייה</div><div class="v">${money(sum(open))}</div><div class="n">${open.length} חשבונות</div></div>
      <div class="kpi"><div class="l">באיחור</div><div class="v ${overdue.length ? 'neg' : 'pos'}">${money(sum(overdue))}</div><div class="n">${overdue.length} חשבונות</div></div>
      <div class="kpi"><div class="l">צפוי ב-30 יום</div><div class="v">${money(sum(soon))}</div><div class="n">${soon.length} חשבונות</div></div>
      <div class="kpi"><div class="l">טיוטות שלא הוגשו</div><div class="v">${notSubmitted.length}</div></div></div>
    <div class="tw"><table><thead><tr><th>פרויקט</th><th>חשבון</th><th class="hide-m">הוגש</th><th>מועד תשלום</th><th class="n">נטו + מע"מ</th><th class="n">שולם</th><th class="n">יתרה</th><th>מצב</th></tr></thead><tbody>
    ${open.map(({ p, r }) => `<tr class="click ${r.due < today ? 'al-r' : ''}" data-h="#/project/${p.id}/bill/${r.bill.id}"><td>${esc(p.name)}</td><td><b>${r.bill.number}</b> · ${BILL_STATUS[r.bill.status]}</td><td class="hide-m">${fmtDate(r.bill.submitted_date)}</td><td>${fmtDate(r.due)}</td>
      <td class="n">${money(r.totalWithVat)}</td><td class="n">${money(r.paid)}</td><td class="n"><b>${money(r.outstanding)}</b></td><td>${statusChip(r, today)}</td></tr>`).join('') || '<tr><td colspan="8" class="empty">אין חשבונות פתוחים לגבייה</td></tr>'}
    </tbody></table></div><p class="small mut">מועד תשלום מחושב משוטף+X של הפרויקט (סוף חודש ההגשה + X ימים), אלא אם הוזן מועד אחר בחשבון.</p></div>`);
  $$('[data-h]', el).forEach(tr => tr.onclick = () => location.hash = tr.dataset.h);
  return el;
}
