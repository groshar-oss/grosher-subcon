// רכש: הזמנות לספקים, אספקה (תעודות משלוח) והתאמה לחשבוניות. הזמנה פתוחה נכנסת לצפי העלות כהתקשרות.
import { h, esc, $, $$, modal, field, select, area, toast, money, num, pct, fmtDate, nullIfEmpty, confirmBox } from '../util.js';
import { db } from '../db.js';
import { S, can, render, logChange } from '../app.js';
import { n } from '../calc.js';
import { PO_STATUS, PO_LIVE } from '../quota.js';
import { expenseDialog } from './vo_exp.js';
import { attachBtn, wireAttach } from '../files.js';

export function poStats(po, lines, expenses) {
  const ls = lines.filter(l => l.po_id === po.id);
  const ordered = ls.reduce((a, l) => a + n(l.qty) * n(l.unit_price), 0);
  const delivered = ls.reduce((a, l) => a + Math.min(n(l.delivered_qty), Infinity) * n(l.unit_price), 0);
  const inv = expenses.filter(e => e.po_id === po.id);
  const invoiced = inv.reduce((a, e) => a + n(e.amount), 0);
  const open = PO_LIVE.includes(po.status) ? Math.max(0, ordered - invoiced) : 0;
  const flags = [];
  if (invoiced > delivered + 1 && delivered > 0) flags.push(`חויב ${Math.round(invoiced - delivered).toLocaleString('en-US')} ₪ יותר ממה שסופק`);
  if (invoiced > ordered + 1) flags.push('החשבוניות גבוהות מההזמנה');
  if (ls.some(l => n(l.delivered_qty) > n(l.qty) + 1e-6)) flags.push('סופק יותר מהכמות שהוזמנה');
  if (po.status === 'delivered' && ls.some(l => n(l.delivered_qty) < n(l.qty) - 1e-6)) flags.push('מסומנת "סופקה" אבל חסרה כמות');
  return { ls, ordered, delivered, invoiced, open, flags, inv, deliveredPct: ordered ? delivered / ordered * 100 : 0 };
}

export function tabPurchase(P) {
  const edit = can.expense();
  const pos = P.pd.pos;
  const st = pos.map(po => ({ po, s: poStats(po, P.pd.poLines, P.pd.expenses) }));
  const T = st.reduce((a, x) => ({ ordered: a.ordered + (x.po.status === 'cancelled' ? 0 : x.s.ordered), invoiced: a.invoiced + x.s.invoiced, open: a.open + x.s.open }), { ordered: 0, invoiced: 0, open: 0 });
  const el = h(`<div>
    <div class="kpis"><div class="kpi"><div class="l">הוזמן</div><div class="v">${money(T.ordered)}</div><div class="n">${pos.filter(p => p.status !== 'cancelled').length} הזמנות</div></div>
      <div class="kpi"><div class="l">חויב בחשבוניות</div><div class="v">${money(T.invoiced)}</div></div>
      <div class="kpi"><div class="l">התקשרויות פתוחות</div><div class="v">${money(T.open)}</div><div class="n">נכנסות לצפי העלות לפני שהגיעה חשבונית</div></div>
      <div class="kpi"><div class="l">פערים להתאמה</div><div class="v ${st.some(x => x.s.flags.length) ? 'neg' : 'pos'}">${st.filter(x => x.s.flags.length).length}</div><div class="n">הזמנה, אספקה וחשבונית</div></div></div>
    <div class="actions" style="margin-bottom:12px">${edit ? '<button class="btn" id="add">+ הזמנת רכש</button>' : ''}</div>
    <div class="tw"><table><thead><tr><th>מס'</th><th>ספק</th><th class="hide-m">תאריך</th><th>סטטוס</th><th class="n">הוזמן</th><th class="n hide-m">סופק</th><th class="n">חויב</th><th class="n">פתוח</th><th>התאמה</th>${edit ? '<th></th>' : ''}</tr></thead><tbody>
    ${st.map(({ po, s }) => `<tr class="click ${po.status === 'cancelled' ? 'dim' : ''}" data-po="${po.id}"><td>${esc(po.number || '')}</td><td><b>${esc(po.supplier_name)}</b><div class="small mut">${s.ls.length} שורות</div></td><td class="hide-m">${fmtDate(po.order_date)}</td>
      <td>${PO_STATUS[po.status]}</td><td class="n">${money(s.ordered)}</td><td class="n hide-m">${pct(s.deliveredPct, { d: 0 })}</td><td class="n">${money(s.invoiced)}</td><td class="n">${money(s.open)}</td>
      <td class="wrap small">${s.flags.length ? s.flags.map(f => `<span class="chip red">${esc(f)}</span>`).join(' ') : '<span class="chip green">תקין</span>'}</td>
      ${edit ? `<td style="white-space:nowrap">${attachBtn(P.data.files, 'purchase_orders', po.id, { projectId: P.id, docType: 'po', label: `הזמנה ${po.number || ''} ${po.supplier_name}` })} <button class="btn small ghost" data-inv="${po.id}">+ חשבונית</button></td>` : ''}</tr>`).join('') || `<tr><td colspan="10" class="empty">אין הזמנות רכש. הזמנה פתוחה נספרת כהתקשרות ונכנסת לצפי העלות.</td></tr>`}
    </tbody></table></div></div>`);
  wireAttach(el, P.data.files || [], render);
  $('#add', el)?.addEventListener('click', () => poDialog(P));
  $$('[data-po]', el).forEach(tr => tr.onclick = e => { if (e.target.closest('[data-inv],[data-att]')) return; poDialog(P, pos.find(p => p.id === tr.dataset.po)); });
  $$('[data-inv]', el).forEach(b => b.onclick = () => { const po = pos.find(p => p.id === b.dataset.inv); const s = poStats(po, P.pd.poLines, P.pd.expenses);
    const first = s.ls[0];
    expenseDialog(P, null, { po_id: po.id, supplier_name: po.supplier_name, kind: 'material', amount: Math.max(0, Math.round(s.delivered - s.invoiced)) || '', boq_item_id: s.ls.every(l => l.boq_item_id === first?.boq_item_id) ? first?.boq_item_id : null }); });
  return el;
}

async function poDialog(P, po) {
  const edit = can.expense();
  const items = P.pd.items;
  const itemLab = i => `${i.code || ''} ${i.description}`.trim().slice(0, 50);
  let lines = po ? P.pd.poLines.filter(l => l.po_id === po.id).sort((a, b) => n(a.sort) - n(b.sort)).map(l => ({ ...l })) : [{ description: '', qty: '', unit: '', unit_price: '', delivered_qty: 0, boq_item_id: '' }];
  const removed = [];
  const s = po ? poStats(po, P.pd.poLines, P.pd.expenses) : null;
  const matLines = itemId => P.pd.lines.filter(l => l.boq_item_id === itemId && l.kind === 'material');
  const body = `<div class="grid g3">${field('מספר הזמנה', 'number', po?.number ?? String(100 + P.pd.pos.length + 1))}${field('ספק', 'supplier_name', po?.supplier_name, { req: true })}${select('סטטוס', 'status', PO_STATUS, po?.status || 'open')}
    ${field('תאריך הזמנה', 'order_date', po?.order_date || new Date().toISOString().slice(0, 10), { type: 'date' })}${field('אספקה צפויה', 'expected_date', po?.expected_date, { type: 'date' })}${field('תעודות משלוח', 'delivery_notes', po?.delivery_notes, { attrs: 'placeholder="מספרי ת.מ."' })}</div>
    <div class="tw" style="box-shadow:none"><table><thead><tr><th>סעיף</th><th>שורת חומר בתמחיר</th><th>תיאור</th><th class="n">כמות</th><th>יח'</th><th class="n">מחיר</th><th class="n">סופק</th><th class="n">סה"כ</th>${edit ? '<th></th>' : ''}</tr></thead><tbody id="pl"></tbody></table></div>
    ${edit ? '<button type="button" class="btn small ghost" id="addl">+ שורה</button>' : ''}<div id="ps" style="margin-top:8px"></div>
    ${s && s.inv.length ? `<h3 style="margin:12px 0 6px">חשבוניות מקושרות</h3>${s.inv.map(e => `<div class="small">${fmtDate(e.doc_date)} · ${esc(e.doc_no || '')} · ${money(e.amount)}</div>`).join('')}` : ''}
    ${area('הערות', 'notes', po?.notes)}${po && edit ? '<p><button type="button" class="btn small danger" id="delpo">מחיקת ההזמנה</button></p>' : ''}`;
  const d = await modal({ title: po ? `הזמנה ${po.number || ''} · ${po.supplier_name}` : 'הזמנת רכש חדשה', body, wide: true, ok: edit ? 'שמירה' : null, cancel: edit ? 'ביטול' : 'סגירה',
    onMount: (el, close) => {
      const pl = $('#pl', el);
      const draw = () => {
        pl.innerHTML = lines.map((l, k) => { const ml = l.boq_item_id ? matLines(l.boq_item_id) : [];
          return `<tr data-k="${k}"><td><select data-f="boq_item_id" style="min-width:150px" ${edit ? '' : 'disabled'}><option value="">כללי לפרויקט</option>${items.map(i => `<option value="${i.id}" ${i.id === l.boq_item_id ? 'selected' : ''}>${esc(itemLab(i))}</option>`).join('')}</select></td>
          <td><select data-f="cost_line_id" style="min-width:120px" ${edit && ml.length ? '' : 'disabled'}><option value="">${ml.length === 1 ? 'אוטומטי (שורה יחידה)' : ml.length ? 'בחירה' : '—'}</option>${ml.map(m => `<option value="${m.id}" ${m.id === l.cost_line_id ? 'selected' : ''}>${esc((m.description || 'חומר').slice(0, 30))}</option>`).join('')}</select></td>
          <td><input data-f="description" value="${esc(l.description || '')}" style="min-width:130px" ${edit ? '' : 'readonly'}></td>
          <td><input data-f="qty" type="number" step="any" dir="ltr" value="${esc(l.qty ?? '')}" style="width:80px" ${edit ? '' : 'readonly'}></td>
          <td><input data-f="unit" value="${esc(l.unit || '')}" style="width:56px" ${edit ? '' : 'readonly'}></td>
          <td><input data-f="unit_price" type="number" step="any" dir="ltr" value="${esc(l.unit_price ?? '')}" style="width:80px" ${edit ? '' : 'readonly'}></td>
          <td><input data-f="delivered_qty" type="number" step="any" dir="ltr" value="${esc(l.delivered_qty ?? 0)}" style="width:72px" ${edit ? '' : 'readonly'}></td>
          <td class="n" data-t>${money(n(l.qty) * n(l.unit_price))}</td>${edit ? '<td><button type="button" class="btn small ghost" data-rm aria-label="מחיקת שורה">✕</button></td>' : ''}</tr>`; }).join('');
        $$('[data-k]', pl).forEach(tr => { const k = +tr.dataset.k;
          $$('[data-f]', tr).forEach(inp => inp.oninput = inp.onchange = () => {
            lines[k][inp.dataset.f] = inp.value;
            if (inp.dataset.f === 'boq_item_id') { lines[k].cost_line_id = ''; const it = items.find(i => i.id === inp.value); if (it && !lines[k].unit) lines[k].unit = matLines(it.id)[0]?.unit || it.unit || ''; draw(); return; }
            $('[data-t]', tr).innerHTML = money(n(lines[k].qty) * n(lines[k].unit_price)); sum(); });
          $('[data-rm]', tr)?.addEventListener('click', () => { const [x] = lines.splice(k, 1); if (x.id) removed.push(x.id); draw(); });
        });
        sum();
      };
      const sum = () => { const o = lines.reduce((a, l) => a + n(l.qty) * n(l.unit_price), 0), dl = lines.reduce((a, l) => a + n(l.delivered_qty) * n(l.unit_price), 0);
        $('#ps', el).innerHTML = `סה"כ הזמנה <b>${money(o)}</b> · סופק <b>${money(dl)}</b>${s ? ` · חויב <b>${money(s.invoiced)}</b>` : ''}`; };
      draw();
      $('#addl', el)?.addEventListener('click', () => { lines.push({ description: '', qty: '', unit: '', unit_price: '', delivered_qty: 0, boq_item_id: lines[lines.length - 1]?.boq_item_id || '' }); draw(); });
      $('#delpo', el)?.addEventListener('click', async () => {
        if (!(await confirmBox('מחיקת הזמנה', 'למחוק את ההזמנה? חשבוניות שקושרו אליה יישארו בלי קישור.', 'מחיקה', true))) return;
        await db.remove('purchase_orders', po.id); await logChange({ project_id: P.id, entity: 'po', entity_id: po.id, label: `הזמנה ${po.number || ''} ${po.supplier_name}`, field: 'מחיקה', old_value: Math.round(s.ordered) });
        close(null); toast('ההזמנה נמחקה'); render();
      });
    },
    validate: x => (!x.supplier_name.trim() ? 'חסר ספק' : lines.some(l => !n(l.qty) && !String(l.description).trim()) ? 'יש שורה ריקה' : null) });
  if (!d || !edit) return;
  const head = { number: d.number || null, supplier_name: d.supplier_name.trim(), status: d.status, order_date: nullIfEmpty(d.order_date), expected_date: nullIfEmpty(d.expected_date), delivery_notes: d.delivery_notes || null, notes: d.notes || null };
  let id = po?.id;
  if (po) await db.update('purchase_orders', po.id, head);
  else id = (await db.insert('purchase_orders', { tenant_id: S.tenantId, project_id: P.id, ...head }))[0].id;
  const rowOf = (l, k) => { const it = items.find(i => i.id === l.boq_item_id);
    return { boq_item_id: l.boq_item_id || null, variation_id: it?.variation_id || null, cost_line_id: l.cost_line_id || null, description: l.description || null, qty: n(l.qty), unit: l.unit || null, unit_price: n(l.unit_price), delivered_qty: n(l.delivered_qty), sort: k }; };
  for (const rid of removed) await db.remove('po_lines', rid);
  for (const [k, l] of lines.entries()) if (l.id) await db.update('po_lines', l.id, rowOf(l, k));
  const fresh = lines.map((l, k) => [l, k]).filter(([l]) => !l.id);
  if (fresh.length) await db.insert('po_lines', fresh.map(([l, k]) => ({ tenant_id: S.tenantId, project_id: P.id, po_id: id, ...rowOf(l, k) })));
  const total = lines.reduce((a, l) => a + n(l.qty) * n(l.unit_price), 0);
  if (!po || Math.round(total) !== Math.round(s.ordered) || po.status !== head.status)
    await logChange({ project_id: P.id, entity: 'po', entity_id: id, label: `הזמנה ${head.number || ''} ${head.supplier_name}`, field: po ? 'עדכון הזמנה' : 'הזמנה חדשה', old_value: po ? `${Math.round(s.ordered)} · ${PO_STATUS[po.status]}` : null, new_value: `${Math.round(total)} · ${PO_STATUS[head.status]}` });
  toast('ההזמנה נשמרה'); render();
}
