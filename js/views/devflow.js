// פרויקט יזם: הוראות שינוי (6 שלבים, 4 מחירים לכל שורה) וחשבונות קבלנים (בדיקה, המלצה לתשלום, אישור ותשלום)
import { h, esc, $, $$, modal, field, select, area, toast, money, pct, num, fmtDate, confirmBox, numOrNull, nullIfEmpty } from '../util.js';
import { db } from '../db.js';
import { S, can, render, logChange, settings, tenant } from '../app.js';
import { n } from '../calc.js';
import { CONTRACT_STATUS, COMMITTED } from '../dev.js';
import { devFlow, flowAlerts, coTotals, coPrice, needsAnalysis, contractBills, dupInvoice, docGate, FLAG_TEXT,
  CO_STEPS, CO_STAGES, CO_MANUAL, CO_INITIATORS, CBILL_STATUS, CBILL_STEPS, CBILL_APPROVED } from '../devflow.js';
import { vendorStatus, findVendor, DOC_TYPES } from '../docs.js';
import { attachBtn, wireAttach, filesFor } from '../files.js';

const todayStr = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
const has = v => v !== null && v !== undefined && v !== '';
export const flowOf = P => devFlow({ contracts: P.pd.contracts || [], cLines: P.pd.cLines || [], cos: P.pd.cos || [], coLines: P.pd.coLines || [], cbills: P.pd.cbills || [], cbLines: P.pd.cbLines || [], vatPct: settings().vat_pct });
const stageChip = st => `<span class="chip ${st === 'rejected' ? '' : st === 'paid' ? 'green' : ['approved', 'executed', 'billed'].includes(st) ? 'blue' : 'amber'}">${CO_STAGES[st] || st}</span>`;
// פס שלבים: 6 שלבים של הוראת שינוי או 5 של חשבון
const stepper = (steps, labels, cur, { warn = null } = {}) => {
  const k = steps.indexOf(cur);
  return `<ol class="stepper">${steps.map((s, i) => `<li class="${i < k ? 'ok' : i === k ? 'cur' : ''}${warn === s ? ' warn' : ''}"><span>${i + 1}</span>${esc(labels[s])}</li>`).join('')}</ol>`;
};
const vendorOf = (P, c) => (c?.vendor_id && (P.data.vendors || []).find(v => v.id === c.vendor_id)) || findVendor(P.data.vendors || [], c?.vendor_name);

// ===== הוראות שינוי =====
export function devCos(P) {
  const F = flowOf(P);
  const alerts = flowAlerts(F, { today: todayStr(), filesFor: id => filesFor(P.data.files, id) }).filter(a => a.co);
  const live = F.cos.filter(x => x.stage !== 'rejected');
  const appr = live.filter(x => x.isApproved), pend = live.filter(x => !x.isApproved);
  const sum = (xs, f) => xs.reduce((a, x) => a + x[f], 0);
  const cById = Object.fromEntries((P.pd.contracts || []).map(c => [c.id, c]));
  const el = h(`<div>
    <div class="kpis">
      <div class="kpi"><div class="l">שינויים מאושרים</div><div class="v">${money(sum(appr, 'approved'))}</div><div class="n">${appr.length} הוראות · מבוקש ${money(sum(appr, 'requested'))}</div></div>
      <div class="kpi"><div class="l">בתהליך (טרם אושרו)</div><div class="v">${money(sum(pend, 'requested'))}</div><div class="n">${pend.length} הוראות</div></div>
      <div class="kpi"><div class="l">השפעה על הלו"ז</div><div class="v">${appr.reduce((a, x) => a + n(x.co.schedule_days), 0)} ימים</div><div class="n">בשינויים מאושרים · ${pend.reduce((a, x) => a + n(x.co.schedule_days), 0)} בתהליך</div></div>
      <div class="kpi"><div class="l">נכלל בחשבונות</div><div class="v">${money(live.reduce((a, x) => a + x.billing.billedAmt, 0))}</div><div class="n">שולם ${money(live.reduce((a, x) => a + x.billing.paidAmt, 0))}</div></div>
    </div>
    ${can.edit() ? '<div class="actions" style="margin-bottom:12px"><button class="btn" id="add">+ הוראת שינוי</button></div>' : ''}
    ${alerts.length ? `<div class="card"><h2>דורש תשומת לב (${alerts.length})</h2><ul class="small" id="al">${alerts.map(a => `<li class="${a.crit ? 'neg' : ''}"><b>${esc(a.title)}</b> · ${esc(a.detail)}</li>`).join('')}</ul></div>` : ''}
    <div class="note small">המסלול: בקשה ← בדיקה ותמחור ← אישור בכתב ← ביצוע ומדידה ← נכלל בחשבון ← שולם. שני השלבים האחרונים מתעדכנים לבד לפי חשבונות הקבלן. בכל שורה ארבעה מחירים: בכתב הכמויות (מכירה), בחוזה עם הקבלן, מבוקש ומאושר. כולם ניתנים לשינוי.</div>
    <div class="tw"><table><thead><tr><th>מס'</th><th>שינוי</th><th class="hide-m">קבלן</th><th>שלב</th><th class="n">מבוקש</th><th class="n">מאושר</th><th class="n hide-m">לפי מכירה</th><th class="n hide-m">לו"ז</th><th class="hide-m">חשבון</th><th></th></tr></thead><tbody id="tb">
    ${F.cos.map(x => { const co = x.co, warn = alerts.find(a => a.co?.id === co.id);
      return `<tr class="click ${x.stage === 'rejected' ? 'dim' : warn?.crit ? 'al-r' : warn ? 'al-y' : ''}" data-co="${co.id}"><td>${esc(co.number || '')}</td>
        <td class="wrap"><b>${esc(co.title)}</b><div class="small mut">${esc(CO_INITIATORS[co.initiator] || '')}${co.initiator_name ? ' · ' + esc(co.initiator_name) : ''}${co.reason ? ' · ' + esc(co.reason) : ''}</div></td>
        <td class="hide-m">${esc(co.vendor_name || cById[co.contract_id]?.vendor_name || '')}</td><td>${stageChip(x.stage)}${x.analysis && !co.price_analysis ? ' <span class="chip amber">ניתוח מחיר</span>' : ''}</td>
        <td class="n">${money(x.requested)}</td><td class="n">${x.isApproved ? money(x.approved) : '<span class="mut">—</span>'}</td>
        <td class="n hide-m">${x.gapSale != null ? money(x.sale) : ''}</td><td class="n hide-m">${n(co.schedule_days) ? n(co.schedule_days) + ' ימים' : ''}</td>
        <td class="hide-m small">${x.billing.firstBill ? 'חשבון ' + x.billing.firstBill.number : x.billing.anyBill ? `הוגש בחשבון ${x.billing.anyBill.number}` : ''}</td>
        <td style="white-space:nowrap">${can.edit() ? attachBtn(P.data.files, 'change_orders', co.id, { projectId: P.id, docType: 'vo', label: `${co.number || ''} ${co.title}`.trim() }) : ''}</td></tr>`; }).join('')
      || '<tr><td colspan="10" class="empty">אין הוראות שינוי עדיין</td></tr>'}</tbody></table></div></div>`);
  wireAttach(el, P.data.files || [], render);
  $$('[data-co]', el).forEach(tr => tr.onclick = e => { if (e.target.closest('button,a')) return; coDialog(P, P.pd.cos.find(c => c.id === tr.dataset.co)); });
  $('#add', el)?.addEventListener('click', () => coDialog(P));
  return el;
}

export async function coDialog(P, co = null) {
  const ro = !can.edit();
  const contracts = (P.pd.contracts || []).filter(c => c.status !== 'cancelled' || c.id === co?.contract_id);
  const items = P.pd.items.filter(i => !i.variation_id);
  const itemBy = Object.fromEntries(items.map(i => [i.id, i]));
  const F = flowOf(P);
  const x = co ? F.cos.find(r => r.co.id === co.id) : null;
  let lines = co ? (P.pd.coLines || []).filter(l => l.co_id === co.id).map(l => ({ ...l })) : [];
  const nextNo = () => { const nums = (P.pd.cos || []).map(c => +(String(c.number || '').match(/(\d+)\s*$/)?.[1] || 0)); return 'CO-' + String(Math.max(0, ...nums) + 1).padStart(2, '0'); };
  const stageNow = x?.stage || co?.stage || 'request';
  const body = `${co ? stepper(CO_STEPS, CO_STAGES, stageNow === 'rejected' ? null : stageNow, { warn: x && !x.isApproved && ['executed', 'billed'].includes(co.stage) ? 'approved' : null }) : ''}
    <div class="grid g4">${field('מספר', 'number', co?.number || nextNo())}<div style="grid-column:span 3">${field('השינוי', 'title', co?.title || '', { req: true })}</div></div>
    <div class="grid g4">${select('התקשרות (קבלן / ספק)', 'contract_id', { '': '— בלי התקשרות —', ...Object.fromEntries(contracts.map(c => [c.id, `${c.vendor_name || ''} · ${c.title}`])) }, co?.contract_id || '')}
      ${select('סעיף תקציב', 'boq_item_id', { '': '— בלי סעיף —', ...Object.fromEntries(items.map(i => [i.id, `${i.code || ''} ${i.description}`.trim().slice(0, 60)])) }, co?.boq_item_id || '')}
      ${select('יוזם', 'initiator', CO_INITIATORS, co?.initiator || 'developer')}${field('שם היוזם', 'initiator_name', co?.initiator_name || '')}</div>
    <div class="grid g2">${area('סיבה', 'reason', co?.reason || '')}${area('החלטה נדרשת / החלטה שהתקבלה', 'decision_note', co?.decision_note || '')}</div>
    <div class="grid g4">${select('שלב', 'stage', Object.fromEntries(CO_MANUAL.map(k => [k, CO_STAGES[k]])), co?.stage && CO_MANUAL.includes(co.stage) ? co.stage : co?.stage ? 'executed' : 'request')}
      ${field('ימי השפעה על הלו"ז', 'schedule_days', co?.schedule_days ?? 0, { type: 'number' })}${field('תאריך בקשה', 'request_date', co?.request_date || todayStr(), { type: 'date' })}${field('תאריך ביצוע', 'executed_date', co?.executed_date || '', { type: 'date' })}</div>
    <fieldset class="card" style="margin:8px 0;padding:10px"><legend class="small"><b>אישור בכתב</b></legend><div class="grid g3">${field('תאריך אישור', 'approved_date', co?.approved_date || '', { type: 'date' })}${field('אושר ע"י', 'approved_by', co?.approved_by || '')}${field('אסמכתא (מכתב, פרוטוקול)', 'approval_ref', co?.approval_ref || '')}</div>
      <p class="small mut" style="margin:4px 0 0">את האישור החתום מצרפים בכפתור 📎 בשורת ההוראה ברשימה.</p></fieldset>
    <h3 style="margin:12px 0 6px">שורות ותמחור</h3>
    <p class="small mut">מחיר בכתב הכמויות = המחיר שמכרת (אם הסעיף מופיע). מחיר בחוזה = המחיר שסגרת עם הקבלן. מבוקש = מה שהקבלן מבקש. מאושר = מה שנקבע (ריק = מחיר החוזה). אם אין מחיר בחוזה ואין בכתב הכמויות, נדרש ניתוח מחיר.</p>
    ${ro ? '' : `<div class="actions" style="margin-bottom:8px"><select id="pickcl" style="width:auto;max-width:320px"><option value="">הוספת שורה מהחוזה…</option></select><button class="btn small ghost" type="button" id="addfree">+ שורה חדשה (לא בחוזה)</button></div>`}
    <div class="tw" style="max-height:360px;overflow:auto"><table><thead><tr><th>תיאור</th><th>יח'</th><th class="n">כמות</th><th class="n">מחיר בכתב הכמויות</th><th class="n">מחיר בחוזה</th><th class="n">מחיר מבוקש</th><th class="n">מחיר מאושר</th><th class="n">סה"כ מאושר</th><th></th></tr></thead><tbody id="ll"></tbody></table></div>
    <div id="ltot" class="small" style="margin-top:6px"></div>
    ${area('ניתוח מחיר (כשאין מחיר בחוזה: הצעות, מחירון, חישוב)', 'price_analysis', co?.price_analysis || '')}${area('הערות', 'notes', co?.notes || '')}`;
  let host, drawing = false;
  const curContract = () => $('[name=contract_id]', host)?.value || '';
  const fillPick = () => {
    const sel = $('#pickcl', host); if (!sel) return;
    const cls = (P.pd.cLines || []).filter(l => l.contract_id === curContract());
    sel.innerHTML = `<option value="">${cls.length ? 'הוספת שורה מהחוזה…' : 'בוחרים התקשרות כדי להוסיף שורות מהחוזה'}</option>` + cls.map(l => `<option value="${l.id}">${esc(`${l.code || ''} ${l.description}`.trim().slice(0, 70))} · ${money(l.unit_price, { unit: true })}</option>`).join('');
  };
  const inp = (k, f, v, w = 96) => `<input data-k="${k}" data-f="${f}" ${['description', 'unit'].includes(f) ? '' : 'type="number" step="any" dir="ltr"'} value="${esc(v ?? '')}" style="width:${w}px" ${ro ? 'readonly' : ''}>`;
  const draw = () => {
    const tb = $('#ll', host); drawing = true;
    tb.innerHTML = lines.map((l, k) => {
      const dReq = has(l.price_contract) && n(l.price_contract) && has(l.price_requested) ? (n(l.price_requested) - n(l.price_contract)) / n(l.price_contract) * 100 : null;
      const dSale = has(l.price_sale) && n(l.price_sale) && coPrice(l) != null ? (coPrice(l) - n(l.price_sale)) / n(l.price_sale) * 100 : null;
      return `<tr class="${needsAnalysis(l) ? 'al-y' : ''}"><td><input data-k="${k}" data-f="description" value="${esc(l.description || '')}" ${ro ? 'readonly' : ''}>${l.contract_line_id ? '<div class="small mut">מהחוזה</div>' : needsAnalysis(l) ? '<div class="small">נדרש ניתוח מחיר</div>' : ''}</td>
        <td>${inp(k, 'unit', l.unit, 60)}</td><td>${inp(k, 'qty', l.qty, 80)}</td><td>${inp(k, 'price_sale', l.price_sale)}</td><td>${inp(k, 'price_contract', l.price_contract)}</td>
        <td>${inp(k, 'price_requested', l.price_requested)}${dReq != null && Math.abs(dReq) > 0.05 ? `<div class="small ${dReq > 0 ? 'neg' : 'pos'}">${pct(dReq, { sign: true })} מהחוזה</div>` : ''}</td>
        <td><input data-k="${k}" data-f="price_approved" type="number" step="any" dir="ltr" value="${esc(l.price_approved ?? '')}" placeholder="${has(l.price_contract) ? l.price_contract : ''}" style="width:96px" ${ro ? 'readonly' : ''}>${dSale != null && Math.abs(dSale) > 0.05 ? `<div class="small ${dSale > 0 ? 'neg' : 'pos'}">${pct(dSale, { sign: true })} ממכירה</div>` : ''}</td>
        <td class="n">${coPrice(l) != null ? money(n(l.qty) * coPrice(l)) : '<span class="mut">—</span>'}</td><td>${ro ? '' : `<button type="button" class="btn small ghost" data-rm="${k}" aria-label="הסרה">✕</button>`}</td></tr>`; }).join('') || '<tr><td colspan="9" class="empty">אין שורות. מוסיפים שורה מהחוזה או שורה חדשה.</td></tr>';
    drawing = false;
    const err = host.querySelector('.err'); if (err && lines.length) err.hidden = true;
    const t = coTotals({ id: 'x' }, lines.map(l => ({ ...l, co_id: 'x' })));
    $('#ltot', host).innerHTML = `מבוקש <b>${money(t.requested)}</b> · מאושר <b>${money(t.approved)}</b>${t.contract ? ` · לפי מחירי החוזה ${money(t.contract)}` : ''}${t.gapSale != null ? ` · <span class="${t.gapSale < 0 ? 'neg' : 'pos'}">פער מול מחיר המכירה ${money(t.gapSale, { sign: true })}</span>` : ''}${t.analysis ? ' · <span class="neg">יש שורות שדורשות ניתוח מחיר</span>' : ''}`;
    $$('[data-f]', tb).forEach(i => i.onchange = () => { const l = lines[+i.dataset.k], f = i.dataset.f; l[f] = ['description', 'unit'].includes(f) ? i.value || null : (i.value === '' ? null : n(i.value)); if (!drawing) draw(); });
    $$('[data-rm]', tb).forEach(b => b.onclick = () => { lines.splice(+b.dataset.rm, 1); draw(); });
  };
  const v = await modal({ title: co ? `הוראת שינוי ${co.number || ''}` : 'הוראת שינוי חדשה', body, wide: true, ok: ro ? null : 'שמירה', cancel: ro ? 'סגירה' : 'ביטול', onMount: el => {
    host = el; fillPick(); draw();
    $('[name=contract_id]', el)?.addEventListener('change', fillPick);
    $('#pickcl', el)?.addEventListener('change', e => { const l = (P.pd.cLines || []).find(x => x.id === e.target.value); if (!l) return; const it = itemBy[l.boq_item_id];
      lines.push({ contract_line_id: l.id, description: l.description, unit: l.unit, qty: null, price_sale: it ? n(it.unit_price) : null, price_contract: n(l.unit_price), price_requested: null, price_approved: null });
      if (!$('[name=boq_item_id]', el).value && l.boq_item_id) $('[name=boq_item_id]', el).value = l.boq_item_id;
      e.target.value = ''; draw(); });
    $('#addfree', el)?.addEventListener('click', () => { const it = itemBy[$('[name=boq_item_id]', el).value]; lines.push({ contract_line_id: null, description: '', unit: it?.unit || '', qty: null, price_sale: null, price_contract: null, price_requested: null, price_approved: null }); draw(); });
    $('[name=stage]', el)?.addEventListener('change', e => { if (e.target.value === 'approved' && !$('[name=approved_date]', el).value) $('[name=approved_date]', el).value = todayStr(); if (e.target.value === 'executed' && !$('[name=executed_date]', el).value) $('[name=executed_date]', el).value = todayStr(); });
  }, validate: d => {
    if (!d.title.trim()) return 'חסר תיאור השינוי';
    if (!lines.length) return 'אין שורות בהוראת השינוי';
    if (lines.some(l => !String(l.description || '').trim())) return 'יש שורה בלי תיאור';
    if (lines.some(l => !n(l.qty))) return 'יש שורה בלי כמות';
    if (d.stage === 'approved' && !d.approved_date) return 'באישור צריך תאריך אישור בכתב';
    if (d.approved_date && d.stage !== 'rejected' && lines.some(l => coPrice(l) == null)) return 'יש שורה בלי מחיר מאושר ובלי מחיר בחוזה';
    if (d.approved_date && lines.some(needsAnalysis) && !d.price_analysis.trim()) return 'יש שורה בלי מחיר בחוזה ובלי מחיר בכתב הכמויות: צריך לכתוב ניתוח מחיר לפני אישור';
    return null;
  } });
  if (!v || ro) return;
  const c = contracts.find(x => x.id === v.contract_id);
  const row = { number: v.number.trim() || null, title: v.title.trim(), contract_id: v.contract_id || null, vendor_name: c?.vendor_name || null, boq_item_id: v.boq_item_id || null, initiator: v.initiator, initiator_name: v.initiator_name || null,
    reason: v.reason || null, decision_note: v.decision_note || null, stage: v.stage, schedule_days: Math.round(n(v.schedule_days)), request_date: nullIfEmpty(v.request_date), executed_date: nullIfEmpty(v.executed_date),
    approved_date: nullIfEmpty(v.approved_date), approved_by: v.approved_by || null, approval_ref: v.approval_ref || null, price_analysis: v.price_analysis || null, notes: v.notes || null };
  const newT = coTotals({ id: 'x' }, lines.map(l => ({ ...l, co_id: 'x' })));
  const lbl = `${row.number || ''} ${row.title}`.trim();
  let id = co?.id;
  if (co) {
    await db.update('change_orders', co.id, row);
    if (co.stage !== row.stage) await logChange({ project_id: P.id, entity: 'change_order', entity_id: co.id, label: lbl, field: 'שלב הוראת שינוי', old_value: CO_STAGES[co.stage], new_value: CO_STAGES[row.stage], reason: row.decision_note });
    if (x && Math.abs(x.approved - newT.approved) > 0.5 && row.approved_date) await logChange({ project_id: P.id, entity: 'change_order', entity_id: co.id, label: lbl, field: 'סכום מאושר', old_value: Math.round(x.approved), new_value: Math.round(newT.approved) });
    const keep = new Set(lines.filter(l => l.id).map(l => l.id));
    for (const old of (P.pd.coLines || []).filter(l => l.co_id === co.id && !keep.has(l.id))) await db.remove('co_lines', old.id);
  } else {
    [{ id }] = await db.insert('change_orders', { tenant_id: S.tenantId, project_id: P.id, ...row });
    await logChange({ project_id: P.id, entity: 'change_order', entity_id: id, label: lbl, field: 'הוראת שינוי חדשה', new_value: Math.round(newT.requested), reason: row.reason });
  }
  let sort = 0;
  for (const l of lines) {
    const lr = { contract_line_id: l.contract_line_id || null, description: String(l.description).trim(), unit: l.unit || null, qty: n(l.qty), price_sale: numOrNull(l.price_sale), price_contract: numOrNull(l.price_contract),
      price_requested: numOrNull(l.price_requested), price_approved: numOrNull(l.price_approved), sort: sort++ };
    if (l.id) await db.update('co_lines', l.id, lr); else await db.insert('co_lines', { tenant_id: S.tenantId, project_id: P.id, co_id: id, ...lr });
  }
  toast('הוראת השינוי נשמרה'); render();
}

// ===== חשבונות קבלנים =====
export function devCbills(P) {
  const F = flowOf(P);
  const today = todayStr();
  const cById = Object.fromEntries((P.pd.contracts || []).map(c => [c.id, c]));
  const res = [...F.results].sort((a, b) => String(b.bill.received_date || '').localeCompare(String(a.bill.received_date || '')) || n(b.bill.number) - n(a.bill.number));
  const open = res.filter(r => ['received', 'checked'].includes(r.bill.status)), rec = res.filter(r => r.bill.status === 'recommended'), app = res.filter(r => r.bill.status === 'approved'), paid = res.filter(r => r.bill.status === 'paid');
  const sum = (xs, f) => xs.reduce((a, x) => a + x[f], 0);
  const el = h(`<div>
    <div class="kpis">
      <div class="kpi"><div class="l">ממתינים לבדיקה</div><div class="v">${open.length}</div><div class="n">הוגש ${money(sum(open, 'claimed'))}</div></div>
      <div class="kpi"><div class="l">הומלצו, ממתינים לאישור היזם</div><div class="v">${money(sum(rec, 'total'))}</div><div class="n">${rec.length} חשבונות · כולל מע"מ</div></div>
      <div class="kpi"><div class="l">אושרו, לתשלום</div><div class="v">${money(sum(app, 'total'))}</div><div class="n">${app.length} חשבונות · כולל מע"מ</div></div>
      <div class="kpi"><div class="l">קוצץ בבדיקה (מצטבר)</div><div class="v ${sum(res, 'cut') > 0.5 ? 'neg' : ''}">${money(sum(res, 'cut'))}</div><div class="n">שולם עד היום ${money(sum(paid, 'total'))}</div></div>
    </div>
    ${can.edit() ? '<div class="actions" style="margin-bottom:12px"><button class="btn" id="add">+ חשבון קבלן</button></div>' : ''}
    <div class="note small">חשבון מצטבר שקבלן או ספק מגיש: ממלאים כמות מצטברת מוגשת לכל שורה בחוזה ובהוראות השינוי, ואת מה שאושר בבדיקה. המערכת בודקת כמות מעל החוזה, מחיר שונה, שינוי לא מאושר, חשבונית כפולה ומסמכים חסרים, ומפיקה דף "בדיקת חשבון והמלצה לתשלום".</div>
    <div class="tw"><table><thead><tr><th>קבלן / ספק</th><th>חשבון</th><th class="hide-m">התקבל</th><th>סטטוס</th><th class="n">הוגש</th><th class="n">אושר בבדיקה</th><th class="n hide-m">נטו</th><th class="n">לתשלום כולל מע"מ</th><th>ממצאים</th><th></th></tr></thead><tbody>
    ${res.map(r => { const b = r.bill, c = r.contract; const fl = r.flags.length + (b.invoice_legal ? 0 : 1);
      return `<tr class="click" data-b="${b.id}"><td><b>${esc(c.vendor_name || '')}</b><div class="small mut">${esc(c.number || '')} ${esc(c.title)}</div></td><td><b>${b.number}</b></td><td class="hide-m">${fmtDate(b.received_date)}</td>
        <td><span class="chip ${b.status === 'paid' ? 'green' : b.status === 'approved' ? 'blue' : b.status === 'recommended' ? 'violet' : 'amber'}">${CBILL_STATUS[b.status]}</span></td>
        <td class="n">${money(r.claimed)}</td><td class="n">${money(r.gross)}${r.cut > 0.5 ? `<div class="small neg">קוצץ ${money(r.cut)}</div>` : ''}</td><td class="n hide-m">${money(r.net)}</td><td class="n"><b>${money(r.total)}</b></td>
        <td>${fl ? `<span class="chip ${r.flags.length ? 'red' : 'amber'}">${fl}</span>` : '<span class="chip green">תקין</span>'}</td>
        <td style="white-space:nowrap">${can.edit() ? attachBtn(P.data.files, 'cbills', b.id, { projectId: P.id, docType: 'invoice', label: `${c.vendor_name || ''} חשבון ${b.number}` }) : ''}</td></tr>`; }).join('')
      || '<tr><td colspan="10" class="empty">אין חשבונות קבלנים עדיין</td></tr>'}</tbody></table></div></div>`);
  wireAttach(el, P.data.files || [], render);
  $$('[data-b]', el).forEach(tr => tr.onclick = e => { if (e.target.closest('button,a')) return; location.hash = `#/project/${P.id}/cbill/${tr.dataset.b}`; });
  $('#add', el)?.addEventListener('click', () => newCbill(P, cById));
  return el;
}

async function newCbill(P) {
  const cs = (P.pd.contracts || []).filter(c => COMMITTED.includes(c.status));
  if (!cs.length) return toast('אין התקשרות חתומה. קודם מוסיפים התקשרות בלשונית "התקשרויות"', 'bad');
  const v = await modal({ title: 'חשבון קבלן חדש', body: `${select('התקשרות', 'contract_id', Object.fromEntries(cs.map(c => [c.id, `${c.vendor_name || ''} · ${c.title} (${CONTRACT_STATUS[c.status]})`])), cs[0].id)}
    <div class="grid g3">${field('תאריך קבלה', 'received_date', todayStr(), { type: 'date' })}${field('עד תאריך (תקופה)', 'period_to', '', { type: 'date' })}${field('מספר חשבון עסקה / חשבונית', 'invoice_no', '')}</div>`, ok: 'פתיחה' });
  if (!v) return;
  const prev = (P.pd.cbills || []).filter(b => b.contract_id === v.contract_id);
  if (prev.some(b => !CBILL_APPROVED.includes(b.status)) && !(await confirmBox('יש חשבון פתוח', 'להתקשרות הזו יש חשבון שעוד לא אושר. חשבון חדש ממשיך מהמצטבר של הקודם. לפתוח בכל זאת?', 'פתיחה'))) return;
  const number = Math.max(0, ...prev.map(b => n(b.number))) + 1;
  const [b] = await db.insert('cbills', { tenant_id: S.tenantId, project_id: P.id, contract_id: v.contract_id, number, received_date: nullIfEmpty(v.received_date), period_to: nullIfEmpty(v.period_to), invoice_no: v.invoice_no.trim() || null, status: 'received', other_deductions: 0, invoice_legal: false });
  const c = cs.find(x => x.id === v.contract_id);
  await logChange({ project_id: P.id, entity: 'cbill', entity_id: b.id, label: `${c.vendor_name || ''} חשבון ${number}`, field: 'חשבון קבלן התקבל', new_value: v.invoice_no || null });
  location.hash = `#/project/${P.id}/cbill/${b.id}`;
}

// בדיקות על חשבון אחד: ממצאי השורות + חשבונית כפולה + מסמכים
function billChecks(P, R, head) {
  const c = R.contract, out = R.flags.map(f => ({ ...f }));
  const dup = dupInvoice(head, c, P.pd.cbills || [], P.pd.contracts || [], P.pd.expenses || []);
  if (dup) out.push({ type: 'dup_invoice', text: dup });
  const vendor = vendorOf(P, c);
  const vstat = vendor ? vendorStatus(vendor, P.data.documents || [], todayStr()) : null;
  const gate = docGate(head, vstat);
  return { list: out, gate, vendor, vstat };
}
const checkText = f => {
  const r = f.row;
  if (f.type === 'over_qty') return `${FLAG_TEXT.over_qty}: ${esc(r.description)} · מוגש ${num(r.cumSub)} מתוך ${num(r.qty)} ${esc(r.unit || '')}`;
  if (f.type === 'co_over') return `${FLAG_TEXT.co_over}: ${esc(r.code || '')} ${esc(r.description)} · מוגש ${num(r.cumSub)} מתוך ${num(r.qty)}`;
  if (f.type === 'price_diff') return `${FLAG_TEXT.price_diff}: ${esc(r.description)} · ${money(r.priceSub, { unit: true })} במקום ${money(r.price, { unit: true })} (אושר לפי החוזה)`;
  if (f.type === 'unapproved_co') return `${FLAG_TEXT.unapproved_co}: ${esc(r.code || '')} ${esc(r.description)} · לא נכלל בסכום המאושר`;
  if (f.type === 'over_contract') return `${FLAG_TEXT.over_contract} · ב-${money(f.amount)}`;
  if (f.type === 'dup_invoice') return `${FLAG_TEXT.dup_invoice} (${esc(f.text)})`;
  return esc(FLAG_TEXT[f.type] || f.type);
};
const gateText = g => g.type === 'legal_invoice' ? FLAG_TEXT.legal_invoice : `${g.expired ? 'פג תוקף' : 'חסר'}: ${DOC_TYPES[g.doc] || g.doc}`;

export async function cbillView(P, billId) {
  const bill = (P.pd.cbills || []).find(b => b.id === billId);
  if (!bill) return h('<div class="card empty">החשבון לא נמצא</div>');
  const contract = (P.pd.contracts || []).find(c => c.id === bill.contract_id);
  if (!contract) return h('<div class="card empty">ההתקשרות של החשבון לא נמצאה</div>');
  const edit = can.edit();
  const sameContract = (P.pd.cbills || []).filter(b => b.contract_id === contract.id);
  const isLast = Math.max(...sameContract.map(b => n(b.number))) === n(bill.number);
  const st = { head: { ...bill }, lines: {} };
  for (const l of (P.pd.cbLines || []).filter(l => l.cbill_id === billId)) st.lines[l.contract_line_id ? 'c:' + l.contract_line_id : 'o:' + l.co_line_id] = { ...l };
  const calcNow = () => {
    const bLines = (P.pd.cbLines || []).filter(l => l.cbill_id !== billId).concat(Object.entries(st.lines).map(([k, l]) => ({ ...l, cbill_id: billId, contract_line_id: k.startsWith('c:') ? k.slice(2) : null, co_line_id: k.startsWith('o:') ? k.slice(2) : null })));
    const bills = (P.pd.cbills || []).map(b => b.id === billId ? { ...b, ...st.head } : b);
    return contractBills({ contract, cLines: P.pd.cLines || [], cos: P.pd.cos || [], coLines: P.pd.coLines || [], bills, bLines, vatPct: settings().vat_pct }).byId[billId];
  };
  const C = contract;
  const el = h(`<div class="billv">
    <div class="top"><div><h1>חשבון ${bill.number} · ${esc(C.vendor_name || '')}</h1><div class="sub">${esc(P.project.name)} · ${esc(C.number || '')} ${esc(C.title)} · שוטף+${C.pay_terms_days ?? 30}${n(C.retention_pct) ? ` · עיכבון ${num(C.retention_pct)}%` : ''}${n(C.advance_amount) ? ` · מקדמה ${money(C.advance_amount)} (קיזוז ${num(C.advance_offset_pct)}%)` : ''}${C.indexation ? ` · צמוד (בסיס ${num(C.base_index)})` : ''}</div></div>
      <div class="actions"><a class="btn small" href="#/project/${P.id}/cbillpdf/${billId}">דף בדיקה והמלצה לתשלום</a><a class="btn ghost small" href="#/project/${P.id}/cbills">כל החשבונות</a></div></div>
    <div id="stp"></div>
    <div class="card"><div class="grid g4">
      ${select('סטטוס', 'status', CBILL_STATUS, bill.status)}${field('תאריך קבלה', 'received_date', bill.received_date, { type: 'date' })}${field('עד תאריך (תקופה)', 'period_to', bill.period_to, { type: 'date' })}${field('נבדק ע"י', 'checked_by', bill.checked_by || '')}
      ${field('מספר חשבונית / חשבון עסקה', 'invoice_no', bill.invoice_no || '')}${field('תאריך חשבונית', 'invoice_date', bill.invoice_date, { type: 'date' })}
      ${C.indexation ? field(`מדד החשבון (בסיס ${num(C.base_index)})`, 'index_value', bill.index_value, { type: 'number' }) : ''}
      ${field('ניכויים נוספים ₪', 'other_deductions', bill.other_deductions, { type: 'number' })}${field('סיבת הניכוי', 'other_note', bill.other_note || '')}</div>
      <label class="chk"><input type="checkbox" name="invoice_legal" ${bill.invoice_legal ? 'checked' : ''}> התקבלה חשבונית כחוק (חשבונית מס תקינה, עם מספר עוסק ופירוט)</label></div>
    ${edit ? `<div class="actions" style="margin-bottom:10px"><button class="btn ghost small" id="appall" type="button">מאושר = מוגש</button><span class="small mut">מאושר ריק = כמו המוגש. מחיר מוגש ריק = מחיר החוזה. המחיר המאושר תמיד לפי החוזה.</span></div>` : ''}
    <div class="tw" id="lt"></div>
    <div class="cols even"><div class="card"><h2>ממצאי הבדיקה</h2><div id="chk"></div></div><div class="card"><h2>סיכום והמלצה לתשלום</h2><div id="sum"></div></div></div>
    ${area('הערות לבדיקה', 'notes', bill.notes || '').replace('<label class="fld">', '<label class="fld card">')}
    ${edit ? `<div class="savebar"><span id="sb"></span><span class="sp"></span>${isLast ? '<button class="btn ghost danger-t" id="del" type="button">מחיקה</button>' : ''}<button class="btn" id="save" type="button">שמירה</button></div>` : ''}</div>`);
  if (!edit) $$('input,select,textarea', el).forEach(x => x.disabled = true);
  const lt = $('#lt', el);
  const draw = () => {
    const R = calcNow();
    $('#stp', el).innerHTML = stepper(CBILL_STEPS, CBILL_STATUS, st.head.status);
    const groups = []; let g = null;
    for (const r of R.rows) { const k = r.kind === 'c' ? 'חוזה' : `הוראת שינוי ${r.co.number || ''} · ${r.co.title}${r.approved ? '' : ' (לא אושרה בכתב)'}`; if (!g || g.k !== k) groups.push(g = { k, rows: [], pend: r.kind === 'o' && !r.approved }); g.rows.push(r); }
    let html = `<table><thead><tr><th>קוד</th><th>תיאור</th><th class="hide-m">יח'</th><th class="n hide-m">כמות בחוזה</th><th class="n">מחיר בחוזה</th><th class="n">מצטבר קודם</th><th class="n">מצטבר מוגש</th><th class="n">מחיר מוגש</th><th class="n">מצטבר מאושר</th><th class="n">נוכחי מאושר</th><th class="n">סכום נוכחי</th></tr></thead><tbody>`;
    for (const G of groups) {
      html += `<tr class="sec${G.pend ? ' pend' : ''}"><td colspan="11">${esc(G.k)}</td></tr>`;
      for (const r of G.rows) {
        const L = st.lines[r.key] || {};
        const i = (k, v, ph) => edit ? `<input class="cell-in" type="number" step="any" inputmode="decimal" dir="ltr" data-key="${r.key}" data-k="${k}" value="${v ?? ''}" placeholder="${ph ?? ''}">` : num(v ?? ph);
        const chips = r.flags.filter(f => f !== 'cut').map(f => `<span class="chip ${f === 'price_diff' ? 'amber' : 'red'}">${{ over_qty: 'מעל החוזה', co_over: 'מעל המאושר', price_diff: 'מחיר שונה', unapproved_co: 'לא אושר' }[f]}</span>`).join(' ');
        html += `<tr class="${r.flags.some(f => ['over_qty', 'co_over', 'unapproved_co'].includes(f)) ? 'al-r' : r.flags.includes('price_diff') ? 'al-y' : ''}"><td>${esc(r.kind === 'c' ? r.code || '' : '')}</td><td class="wrap">${esc(r.description)} ${chips}</td><td class="hide-m">${esc(r.unit || '')}</td>
          <td class="n hide-m">${num(r.qty)}</td><td class="n">${r.price != null ? money(r.price, { unit: true }) : '<span class="mut">—</span>'}</td><td class="n">${num(r.prev)}</td>
          <td class="n">${i('cum_qty_sub', L.cum_qty_sub, r.prev)}</td><td class="n">${i('price_sub', L.price_sub, r.price ?? '')}</td>
          <td class="n">${r.blocked ? `<span class="mut small">${num(r.prev)}</span>` : i('cum_qty_app', L.cum_qty_app, L.cum_qty_sub ?? r.prev)}${r.cumApp < r.cumSub - 1e-6 && !r.blocked ? `<div class="small neg">קוצץ ${num(r.cumSub - r.cumApp)}</div>` : ''}</td>
          <td class="n">${num(r.curApp)}</td><td class="n">${money(r.amtCur)}</td></tr>`;
      }
    }
    html += `<tr class="tot"><td></td><td>סה"כ</td><td class="hide-m"></td><td class="hide-m"></td><td></td><td></td><td></td><td></td><td></td><td class="n small">הוגש ${money(R.claimed)}</td><td class="n">${money(R.gross)}</td></tr></tbody></table>`;
    lt.innerHTML = html;
    $$('[data-k]', lt).forEach(inp => inp.onchange = () => { (st.lines[inp.dataset.key] ||= {})[inp.dataset.k] = inp.value === '' ? null : n(inp.value); draw(); });
    drawSide(R);
  };
  const drawSide = R => {
    const ck = billChecks(P, R, st.head);
    $('#chk', el).innerHTML = `${ck.list.length ? `<ul class="small">${ck.list.map(f => `<li class="${f.type === 'price_diff' ? '' : 'neg'}">${checkText(f)}</li>`).join('')}</ul>` : '<p class="small pos">אין ממצאים בשורות החשבון.</p>'}
      <h3 style="margin:10px 0 4px">מסמכים לפני תשלום</h3>${ck.gate.length ? `<ul class="small">${ck.gate.map(g => `<li class="neg">${gateText(g)}</li>`).join('')}</ul>` : '<p class="small pos">כל המסמכים בתוקף והתקבלה חשבונית כחוק.</p>'}
      ${!ck.vendor ? '<p class="small mut">לקבלן אין כרטיס ספק עם מסמכים.</p>' : `<p class="small"><a href="#/vendors">מסמכי ${esc(ck.vendor.name)} ←</a></p>`}
      ${st.head.doc_override ? `<p class="small"><b>אושר למרות חוסר במסמכים:</b> ${esc(st.head.doc_override)}</p>` : ''}`;
    const line = (l, v, cls = '') => `<tr class="${cls}"><td>${l}</td><td class="n">${money(v)}</td></tr>`;
    const leftAdv = Math.max(0, n(C.advance_amount) - R.advanceCum);
    $('#sum', el).innerHTML = `<table class="sumt">${line('הוגש בחשבון הזה', R.claimed)}${R.cut > 0.5 ? line('קוצץ בבדיקה', -R.cut) : ''}${line('נוכחי מאושר', R.gross, 'tot')}
      ${R.indexDiff ? line('הפרשי הצמדה', R.indexDiff) : ''}${R.retention ? line(`עיכבון ${num(C.retention_pct)}%`, -R.retention) : ''}${R.advance ? line(`קיזוז מקדמה ${num(C.advance_offset_pct)}%`, -R.advance) : ''}${R.other ? line('ניכויים נוספים', -R.other) : ''}
      ${line('נטו לפני מע"מ', R.net, 'tot')}${line(`מע"מ ${settings().vat_pct}%`, R.vat)}${line('מומלץ לתשלום כולל מע"מ', R.total, 'tot')}</table>
      <p class="small mut">מצטבר מאושר ${money(R.grossCum)} מתוך התקשרות ${money(R.contractAmt + R.coAmt)}${R.coAmt ? ` (כולל שינויים מאושרים ${money(R.coAmt)})` : ''} · ${pct(R.contractAmt + R.coAmt ? R.grossCum / (R.contractAmt + R.coAmt) * 100 : 0, { d: 0 })}
      ${n(C.retention_pct) ? ` · עיכבון מצטבר ${money(R.retentionCum)}` : ''}${n(C.advance_amount) ? ` · יתרת מקדמה לקיזוז ${money(leftAdv)}` : ''}</p>`;
    if ($('#sb', el)) $('#sb', el).innerHTML = `מאושר ${money(R.gross)} · לתשלום ${money(R.total)}`;
  };
  draw();
  $$('.card input[name], .card select[name], textarea[name]', el).forEach(inp => inp.onchange = () => {
    st.head[inp.name] = inp.type === 'checkbox' ? inp.checked : inp.type === 'number' ? (inp.value === '' ? null : n(inp.value)) : (inp.value || null);
    draw();
  });
  $('#appall', el)?.addEventListener('click', () => { for (const k of Object.keys(st.lines)) st.lines[k].cum_qty_app = null; draw(); toast('המאושר = המוגש בכל השורות'); });
  $('#save', el)?.addEventListener('click', async () => {
    const R = calcNow(), head = st.head;
    const was = bill.status, now = head.status;
    const k0 = CBILL_STEPS.indexOf(was), k1 = CBILL_STEPS.indexOf(now);
    // אישור או תשלום כשחסרים מסמכים: רק עם סיבה מפורשת שנרשמת ביומן
    if (CBILL_APPROVED.includes(now) && k1 > k0) {
      const gate = billChecks(P, R, head).gate;
      if (gate.length && !head.doc_override) {
        const v = await modal({ title: 'חסרים מסמכים', body: `<p>לפני ${now === 'paid' ? 'תשלום' : 'אישור'} החשבון חסר:</p><ul>${gate.map(g => `<li>${gateText(g)}</li>`).join('')}</ul>${field('למה מאשרים בכל זאת (נרשם ביומן השינויים)', 'why', '', { req: true })}`,
          ok: 'אישור בכל זאת', danger: true, validate: d => !d.why.trim() && 'צריך לכתוב סיבה' });
        if (!v) return;
        head.doc_override = v.why.trim();
        await logChange({ project_id: P.id, entity: 'cbill', entity_id: billId, label: `${C.vendor_name || ''} חשבון ${bill.number}`, field: 'אישור למרות חוסר במסמכים', new_value: gate.map(gateText).join(', '), reason: head.doc_override });
      }
    }
    const today = todayStr();
    if (k1 >= 2 && !head.recommended_date) head.recommended_date = today;
    if (k1 >= 3 && !head.approved_date) head.approved_date = today;
    if (k1 >= 4 && !head.paid_date) head.paid_date = today;
    const row = { status: now, received_date: nullIfEmpty(head.received_date), period_to: nullIfEmpty(head.period_to), checked_by: head.checked_by || null, invoice_no: head.invoice_no || null, invoice_date: nullIfEmpty(head.invoice_date), invoice_legal: !!head.invoice_legal,
      index_value: numOrNull(head.index_value), other_deductions: n(head.other_deductions), other_note: head.other_note || null, notes: head.notes || null, recommended_date: head.recommended_date || null, approved_date: head.approved_date || null, paid_date: head.paid_date || null, doc_override: head.doc_override || null };
    await db.update('cbills', billId, row);
    const exist = Object.fromEntries((P.pd.cbLines || []).filter(l => l.cbill_id === billId).map(l => [l.contract_line_id ? 'c:' + l.contract_line_id : 'o:' + l.co_line_id, l]));
    for (const [key, L] of Object.entries(st.lines)) {
      const lr = { cum_qty_sub: numOrNull(L.cum_qty_sub), price_sub: numOrNull(L.price_sub), cum_qty_app: numOrNull(L.cum_qty_app), note: L.note || null };
      const ex = exist[key];
      if (ex) { if (['cum_qty_sub', 'price_sub', 'cum_qty_app'].some(f => String(ex[f] ?? '') !== String(lr[f] ?? ''))) await db.update('cbill_lines', ex.id, lr); }
      else if (lr.cum_qty_sub != null || lr.cum_qty_app != null || lr.price_sub != null) await db.insert('cbill_lines', { tenant_id: S.tenantId, project_id: P.id, cbill_id: billId, contract_line_id: key.startsWith('c:') ? key.slice(2) : null, co_line_id: key.startsWith('o:') ? key.slice(2) : null, ...lr });
    }
    // רישום התשלום כהוצאה: נוצר באישור, מתעדכן בתשלום, נמחק אם החשבון חזר לבדיקה
    const exp = (P.pd.expenses || []).find(e => e.cbill_id === billId);
    if (CBILL_APPROVED.includes(now)) {
      const er = { contract_id: C.id, supplier_name: C.vendor_name, kind: 'sub', doc_no: row.invoice_no, doc_date: row.invoice_date || row.approved_date, description: `חשבון ${bill.number} · ${C.title}`, amount: Math.round(R.net * 100) / 100,
        vat_pct: settings().vat_pct, status: now === 'paid' ? 'paid' : 'approved', pay_date: now === 'paid' ? row.paid_date : null, boq_item_id: null };
      if (exp) await db.update('expenses', exp.id, er); else await db.insert('expenses', { tenant_id: S.tenantId, project_id: P.id, cbill_id: billId, notes: null, ...er });
    } else if (exp) await db.remove('expenses', exp.id);
    const lbl = `${C.vendor_name || ''} חשבון ${bill.number}`;
    if (was !== now) await logChange({ project_id: P.id, entity: 'cbill', entity_id: billId, label: lbl, field: 'סטטוס חשבון קבלן', old_value: CBILL_STATUS[was], new_value: CBILL_STATUS[now], reason: now === 'recommended' ? `מומלץ ${Math.round(R.total)} ₪` : null });
    toast('החשבון נשמר'); render();
  });
  $('#del', el)?.addEventListener('click', async () => {
    if (!(await confirmBox('מחיקת חשבון', `למחוק את חשבון ${bill.number} של ${C.vendor_name || ''}?${CBILL_APPROVED.includes(bill.status) ? ' גם רישום התשלום שלו יימחק.' : ''}`, 'מחיקה', true))) return;
    const exp = (P.pd.expenses || []).find(e => e.cbill_id === billId); if (exp) await db.remove('expenses', exp.id);
    await db.remove('cbills', billId);
    await logChange({ project_id: P.id, entity: 'cbill', entity_id: billId, label: `${C.vendor_name || ''} חשבון ${bill.number}`, field: 'מחיקה' });
    toast('החשבון נמחק'); location.hash = `#/project/${P.id}/cbills`;
  });
  return el;
}

// ===== דף "בדיקת חשבון והמלצה לתשלום" להדפסה / PDF =====
export function cbillSheet(P, billId) {
  const F = flowOf(P), R = F.byBill[billId];
  if (!R) return h('<div class="card empty">החשבון לא נמצא</div>');
  const b = R.bill, C = R.contract, ck = billChecks(P, R, b);
  const rows = R.rows.filter(r => r.cumSub > 0 || r.prev > 0);
  const el = h(`<div>
    <div class="top no-print"><div><h1>בדיקת חשבון והמלצה לתשלום</h1><div class="sub">הדפסה ← שמירה כ-PDF</div></div>
      <div class="actions"><button class="btn small" id="print">הדפסה / PDF</button><button class="btn ghost small" id="gdrive">שמירה לדרייב</button><a class="btn ghost small" href="#/project/${P.id}/cbill/${billId}">חזרה לחשבון</a></div></div>
    <div class="rpage">
      <div class="rephead"><img src="icons/icon-192.png" alt=""><div><b>בדיקת חשבון והמלצה לתשלום</b><span>${esc(tenant()?.name || '')} · ${esc(P.project.name)} · הופק ${fmtDate(todayStr())}</span></div></div>
      <table class="sumt"><tr><td>קבלן / ספק</td><td><b>${esc(C.vendor_name || '')}</b></td><td>התקשרות</td><td>${esc(C.number || '')} ${esc(C.title)}</td></tr>
        <tr><td>חשבון מס'</td><td><b>${b.number}</b>${b.period_to ? ` · עד ${fmtDate(b.period_to)}` : ''}</td><td>התקבל</td><td>${fmtDate(b.received_date)}</td></tr>
        <tr><td>חשבונית</td><td>${esc(b.invoice_no || '—')}${b.invoice_date ? ` · ${fmtDate(b.invoice_date)}` : ''} · ${b.invoice_legal ? 'חשבונית כחוק התקבלה' : '<b class="neg">חשבונית כחוק לא התקבלה</b>'}</td><td>סטטוס</td><td>${CBILL_STATUS[b.status]}</td></tr></table>
      <h3>פירוט</h3>
      <div class="tw"><table><thead><tr><th>תיאור</th><th class="n">כמות בחוזה</th><th class="n">מחיר בחוזה</th><th class="n">מצטבר קודם</th><th class="n">מצטבר מוגש</th><th class="n">מצטבר מאושר</th><th class="n">נוכחי מוגש ₪</th><th class="n">נוכחי מאושר ₪</th><th>הערה</th></tr></thead><tbody>
        ${rows.map(r => `<tr class="${r.flags.some(f => f !== 'cut') ? 'al-y' : ''}"><td class="wrap">${r.kind === 'o' ? `<b>${esc(r.co.number || '')}</b> ` : esc(r.code ? r.code + ' ' : '')}${esc(r.description)}</td><td class="n">${num(r.qty)}</td><td class="n">${r.price != null ? money(r.price, { unit: true }) : '—'}</td>
          <td class="n">${num(r.prev)}</td><td class="n">${num(r.cumSub)}</td><td class="n">${num(r.cumApp)}</td><td class="n">${money(r.claimedCur)}</td><td class="n">${money(r.amtCur)}</td>
          <td class="small">${[...r.flags.filter(f => f !== 'cut').map(f => f === 'price_diff' ? `מחיר מוגש ${money(r.priceSub, { unit: true })}` : esc({ over_qty: 'מעל החוזה', co_over: 'מעל המאושר', unapproved_co: 'שינוי לא אושר' }[f])), r.line?.note ? esc(r.line.note) : ''].filter(Boolean).join(' · ')}</td></tr>`).join('')}
        <tr class="tot"><td>סה"כ</td><td></td><td></td><td></td><td></td><td></td><td class="n">${money(R.claimed)}</td><td class="n">${money(R.gross)}</td><td></td></tr></tbody></table></div>
      <div class="cols even"><div><h3>ממצאי הבדיקה</h3>${ck.list.length || ck.gate.length ? `<ul class="small">${ck.list.map(f => `<li>${checkText(f)}</li>`).join('')}${ck.gate.map(g => `<li>${gateText(g)}</li>`).join('')}</ul>` : '<p class="small">לא נמצאו ליקויים.</p>'}
        ${b.doc_override ? `<p class="small"><b>אושר למרות חוסר במסמכים:</b> ${esc(b.doc_override)}</p>` : ''}${b.notes ? `<p class="small">${esc(b.notes)}</p>` : ''}</div>
        <div><h3>חישוב</h3><table class="sumt"><tr><td>הוגש</td><td class="n">${money(R.claimed)}</td></tr>${R.cut > 0.5 ? `<tr><td>קיצוץ בבדיקה</td><td class="n">${money(-R.cut)}</td></tr>` : ''}<tr class="tot"><td>נוכחי מאושר</td><td class="n">${money(R.gross)}</td></tr>
          ${R.indexDiff ? `<tr><td>הפרשי הצמדה</td><td class="n">${money(R.indexDiff)}</td></tr>` : ''}${R.retention ? `<tr><td>עיכבון ${num(C.retention_pct)}%</td><td class="n">${money(-R.retention)}</td></tr>` : ''}${R.advance ? `<tr><td>קיזוז מקדמה</td><td class="n">${money(-R.advance)}</td></tr>` : ''}${R.other ? `<tr><td>ניכויים: ${esc(b.other_note || '')}</td><td class="n">${money(-R.other)}</td></tr>` : ''}
          <tr class="tot"><td>נטו לפני מע"מ</td><td class="n">${money(R.net)}</td></tr><tr><td>מע"מ ${settings().vat_pct}%</td><td class="n">${money(R.vat)}</td></tr></table></div></div>
      <div class="note" style="font-size:16px;margin-top:12px">סכום מומלץ לתשלום: <b>${money(R.total)}</b> כולל מע"מ (${money(R.net)} לפני מע"מ)${ck.gate.length && !b.doc_override ? ' · <b class="neg">בכפוף להשלמת המסמכים</b>' : ''}</div>
      <p class="small">מצטבר מאושר ${money(R.grossCum)} מתוך התקשרות ${money(R.contractAmt + R.coAmt)} (${pct(R.contractAmt + R.coAmt ? R.grossCum / (R.contractAmt + R.coAmt) * 100 : 0, { d: 0 })})${n(C.retention_pct) ? ` · עיכבון מצטבר ${money(R.retentionCum)}` : ''}${n(C.advance_amount) ? ` · יתרת מקדמה ${money(Math.max(0, n(C.advance_amount) - R.advanceCum))}` : ''}</p>
      <table class="sumt sig" style="margin-top:24px"><tr><td>נבדק ע"י: ${esc(b.checked_by || '______________')}</td><td>תאריך: ______________</td><td>חתימה: ______________</td></tr><tr><td>אושר לתשלום ע"י היזם: ______________</td><td>תאריך: ______________</td><td>חתימה: ______________</td></tr></table>
    </div></div>`);
  $('#print', el).onclick = () => window.print();
  $('#gdrive', el).onclick = () => import('./reports.js').then(m => m.pdfToDrive($('.rpage', el), `בדיקת חשבון ${b.number} - ${C.vendor_name || ''}`, P.project));
  return el;
}
