// שלב 6: תזרים מזומנים חודשי, לפרויקט אחד או לכל הפרויקטים
import { h, esc, $, $$, modal, money, store } from '../util.js';
import { S, can, settings, loadTenantData } from '../app.js';
import { n } from '../calc.js';
import { cashflow, CF_ROWS, CF_IN, CF_OUT, monthLabel, usedRows, groupPeriods, PERIODS } from '../cashflow.js';
import { projData, summarize } from './common.js';
import { loadXLSX } from '../import.js';
import { devCashBlock } from './devcash.js';
import { partyOfMany } from '../dev.js';

const todayStr = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
const opt = () => ({ ahead: 12, delay: 0, pid: '', per: 'month', ...(store('subcon-cf') || {}) });
const m0 = v => money(v, { sym: false });

// נתוני תזרים לרשימת פרויקטים (סגורים לא נכנסים, אלא אם נבחר פרויקט ספציפי)
export function cfFor(data, ids, o = opt()) {
  const list = ids.map(id => { const pd = projData(data, id); return { project: pd.project, summary: summarize(pd), pd }; });
  return cashflow(list, { settings: settings(), today: todayStr(), back: 3, ahead: o.ahead, delay: o.delay, indexSeries: data.indexSeries || [] });
}

// עמוד תזרים מרוכז (#/cashflow) עם סינון לפרויקט
export async function viewCashflow() {
  const all = await loadTenantData();
  // פרויקטי יזם: תזרים הכנסות מול הוצאות בנפרד (כולל מע"מ)
  const devs = all.projects.filter(p => p.project_type === 'dev' && p.status !== 'closed');
  const data = { ...all, projects: all.projects.filter(p => p.project_type !== 'dev') };
  if (devs.length && !data.projects.length) return h(`<div><div class="top"><div><h1>תזרים מזומנים</h1><div class="sub">פרויקטי יזם (${devs.length}) · הכנסות מול הוצאות, כולל מע"מ</div></div></div></div>`).appendChild(devCashBlock(all, devs.map(p => p.id), 'כל פרויקטי היזם')).parentElement;
  const o = opt();
  const live = data.projects.filter(p => p.status !== 'closed');
  if (o.pid && !data.projects.some(p => p.id === o.pid)) o.pid = '';
  const el = h(`<div><div class="top"><div><h1>תזרים מזומנים</h1><div class="sub">${o.pid ? esc(data.projects.find(p => p.id === o.pid).name) : `כל הפרויקטים הפעילים (${live.length})`} · צפי מול בפועל, מע"מ בנפרד</div></div>
    <div class="actions"><select id="pid" aria-label="פרויקט"><option value="">כל הפרויקטים</option>${data.projects.map(p => `<option value="${p.id}" ${p.id === o.pid ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></div></div>
    <div id="cf"></div></div>`);
  $('#pid', el).onchange = e => { store('subcon-cf', { ...opt(), pid: e.target.value }); viewCashflow().then(v => el.replaceWith(v)); };
  $('#cf', el).appendChild(cashflowBlock(data, o.pid ? [o.pid] : live.map(p => p.id), o.pid ? data.projects.find(p => p.id === o.pid).name : 'כל הפרויקטים'));
  if (devs.length && !o.pid) { el.appendChild(h(`<h2 style="margin:24px 0 0">פרויקטי יזם (${devs.length})</h2>`)); el.appendChild(devCashBlock(all, devs.map(p => p.id), 'פרויקטי יזם')); }
  return el;
}

// לשונית תזרים בפרויקט
export function tabCashflow(P) { return cashflowBlock(P.data, [P.id], P.project.name); }

function cashflowBlock(data, ids, title) {
  const wrap = h('<div></div>');
  const draw = () => {
    const o = opt();
    const st = settings();
    const r = cfFor(data, ids, o);
    const pt = partyOfMany(ids.map(id => data.projects.find(p => p.id === id)).filter(Boolean));
    const L = k => CF_ROWS[k].replace('מהקבלן הראשי', pt.from);
    const cur = r.months.find(m => m.m === r.cur);
    const view = groupPeriods(r.months, o.per, r.cur);
    const fut = r.months.filter(m => !m.past);
    const next3 = fut.slice(0, 3).reduce((a, m) => a + m.net, 0);
    const recv = fut.reduce((a, m) => a + m.rows.in_billed * (1 + n(st.vat_pct) / 100), 0);
    const low = fut.reduce((a, b) => (b.cum < a.cum ? b : a), fut[0]);
    const below = r.belowMonths;
    wrap.innerHTML = '';
    const el = h(`<div>
      <div class="actions" style="margin-bottom:12px;flex-wrap:wrap;gap:8px">
        <span class="mut small">טווח:</span><div class="seg" id="ah">${[3, 6, 12].map(k => `<button type="button" data-k="${k}" class="${o.ahead === k ? 'on' : ''}">${k} חודשים</button>`).join('')}</div>
        <span class="mut small">תרחיש עיכוב בתשלומי ${pt.the}:</span><div class="seg" id="dl">${[0, 30, 60].map(k => `<button type="button" data-k="${k}" class="${o.delay === k ? 'on' : ''}">${k ? `+${k} יום` : 'בזמן'}</button>`).join('')}</div>
        ${perSeg(o.per)}
        <button class="btn ghost small" data-print>הדפסה / PDF</button><button class="btn ghost small" id="xl">ייצוא לאקסל</button></div>
      <div class="kpis">
        <div class="kpi"><div class="l">יתרה בתחילת ${monthLabel(r.cur)}</div><div class="v ${cur.open < 0 ? 'neg' : ''}">${money(cur.open)}</div><div class="n">לפי יתרה בבנק ${money(st.cash_opening || 0)} נכון ל-${monthLabel(r.asof)}${can.edit() ? ` · <a href="#/client/${S.tenantId}">עדכון</a>` : ''}</div></div>
        <div class="kpi"><div class="l">נטו ב-3 החודשים הקרובים</div><div class="v ${next3 < 0 ? 'neg' : 'pos'}">${money(next3)}</div><div class="n">כולל מע"מ</div></div>
        <div class="kpi"><div class="l">היתרה הנמוכה בטווח</div><div class="v ${low && low.cum < n(st.cash_min) ? 'neg' : ''}">${money(low?.cum || 0)}</div><div class="n">${low ? monthLabel(low.m) : ''} · מינימום רצוי ${money(st.cash_min || 0)}</div></div>
        <div class="kpi"><div class="l">חשבונות שהוגשו ועוד לא נגבו</div><div class="v">${money(recv)}</div><div class="n">כולל מע"מ</div></div>
      </div>
      ${below.length ? `<div class="note neg"><b>התראת תזרים:</b> היתרה צפויה לרדת מתחת ל-${money(st.cash_min || 0)} ב${below.length === 1 ? 'חודש' : '-' + below.length + ' חודשים'}: ${below.map(m => monthLabel(m.m)).join(', ')}. ${o.delay ? `(בתרחיש עיכוב של ${o.delay} יום)` : ''}</div>` : ''}
      <div class="card" style="padding:10px 6px">${chart(view, n(st.cash_min))}</div>
      <div class="tw cft"><table><thead><tr><th class="stk">₪ לפני מע"מ</th>${view.map(m => `<th class="n ${m.cur ? 'curm' : ''}">${m.label}${m.past ? '<div class="small mut">בפועל</div>' : m.cur ? `<div class="small">${o.per === 'month' ? 'החודש' : 'כולל החודש'}</div>` : ''}</th>`).join('')}</tr></thead><tbody>
        <tr class="sec"><td class="stk" colspan="1"><b>כניסות</b></td>${view.map(() => '<td></td>').join('')}</tr>
        ${usedRows(CF_IN, view).map(k => row(k, L(k), view)).join('')}
        <tr><td class="stk">מע"מ שנגבה</td>${view.map(m => `<td class="n mut">${m.vatIn ? m0(m.vatIn) : ''}</td>`).join('')}</tr>
        <tr class="tot"><td class="stk">סה"כ כניסות</td>${view.map(m => `<td class="n">${money(m.inTotal)}</td>`).join('')}</tr>
        <tr class="sec"><td class="stk"><b>יציאות</b></td>${view.map(() => '<td></td>').join('')}</tr>
        ${usedRows(CF_OUT, view).map(k => row(k, CF_ROWS[k], view)).join('')}
        <tr><td class="stk">מע"מ ששולם לספקים</td>${view.map(m => `<td class="n mut">${m.vatOut ? m0(m.vatOut) : ''}</td>`).join('')}</tr>
        <tr class="tot"><td class="stk">סה"כ יציאות</td>${view.map(m => `<td class="n">${money(m.outTotal)}</td>`).join('')}</tr>
        <tr><td class="stk">תשלום מע"מ לרשות (− החזר)</td>${view.map(m => `<td class="n">${m.vatPay ? m0(m.vatPay) : ''}</td>`).join('')}</tr>
        <tr class="tot"><td class="stk">נטו ב${PERIODS[o.per] || 'חודש'}</td>${view.map(m => `<td class="n ${m.net < 0 ? 'neg' : 'pos'}">${money(m.net)}</td>`).join('')}</tr>
        <tr class="tot"><td class="stk"><b>יתרה מצטברת</b></td>${view.map(m => `<td class="n ${m.below && !m.past ? 'al-r' : ''}"><b>${money(m.cum)}</b></td>`).join('')}</tr>
        <tr><td class="stk small mut">חשבונות שהגיע מועד תשלומם (כולל מע"מ)</td>${view.map(m => `<td class="n small mut">${m.past && m.schedIn ? m0(m.schedIn) : ''}</td>`).join('')}</tr>
        <tr><td class="stk small mut">התקבל בפועל באותו חודש</td>${view.map(m => `<td class="n small ${m.past && m.actualIn < m.schedIn - 1 ? 'neg' : 'mut'}">${m.past && (m.schedIn || m.actualIn) ? m0(m.actualIn) : ''}</td>`).join('')}</tr>
      </tbody></table></div>
      <p class="small mut">החודשים שעברו מציגים תנועות בפועל (תקבולים, הוצאות ששולמו ושכר). החודש הנוכחי והבאים הם צפי: חשבונות שהוגשו לפי מועד התשלום (באיחור נכנס לחודש הנוכחי), חשבונות עתידיים לפי יתרת המכירה עד סיום הפרויקט (הגשה ב-5 לחודש העוקב, שוטף+X, בניכוי עיכבון, ביטוח והוצאות משותפות), שחרור עיכבון אחרי סיום, חשבוניות ספקים לפי שוטף+${n(st.supplier_terms_days)}, הזמנות רכש פתוחות, שכר מהיומן בחודש שאחרי, ויתרת צפי העלות${view.some(m => m.rows.in_index) ? '. הפרש הצמדה צפוי: לפי המדד האחרון שהוזן מול מדד הבסיס של הפרויקט, בלי ניחוש של מדד עתידי (לא נספר כחריגה)' : ''}${view.some(m => m.rows.out_fixed) ? '. עלויות חודשיות קבועות: מהחודש הנוכחי עד סוף התקופה של כל עלות' : ''}${o.per === 'week' ? '. בתצוגה שבועית הסכום החודשי מתחלק לפי ימים, כי הצפי נבנה לפי חודשים' : ''}. מע"מ: ההפרש בין מה שנגבה למה ששולם משולם לרשות בחודש שאחרי. לחיצה על סכום מציגה את הפירוט.</p>
    </div>`);
    $$('#ah button', el).forEach(b => b.onclick = () => { store('subcon-cf', { ...opt(), ahead: +b.dataset.k }); draw(); });
    $$('#dl button', el).forEach(b => b.onclick = () => { store('subcon-cf', { ...opt(), delay: +b.dataset.k }); draw(); });
    $$('#per button', el).forEach(b => b.onclick = () => { store('subcon-cf', { ...opt(), per: b.dataset.k }); draw(); });
    $$('[data-cell]', el).forEach(td => td.onclick = () => {
      const [mk, key] = td.dataset.cell.split('|');
      const M = view.find(x => x.m === mk);
      const its = M.items.filter(i => i.key === key);
      const pn = id => data.projects.find(p => p.id === id)?.name || '';
      modal({ title: `${L(key)} · ${M.label}`, ok: 'סגירה', cancel: null, body: `<div class="tw" style="box-shadow:none"><table><thead><tr>${ids.length > 1 ? '<th>פרויקט</th>' : ''}<th>פירוט</th><th class="n">לפני מע"מ</th><th class="n">מע"מ</th></tr></thead><tbody>
        ${its.map(i => `<tr>${ids.length > 1 ? `<td>${esc(pn(i.projectId))}</td>` : ''}<td>${esc(i.label)}</td><td class="n">${m0(i.pre)}</td><td class="n mut">${i.v ? m0(i.v) : ''}</td></tr>`).join('')}</tbody></table></div>` });
    });
    $('#xl', el).onclick = () => exportCf(view, title, o, st, L);
    wrap.appendChild(el);
  };
  draw();
  return wrap;
}

// בחירת תקופה לתזרים (שמורה לכל משתמש בדפדפן)
export const perSeg = per => `<span class="mut small">תצוגה לפי:</span><div class="seg" id="per">${Object.entries(PERIODS).map(([k, l]) => `<button type="button" data-k="${k}" class="${(per || 'month') === k ? 'on' : ''}">${l}</button>`).join('')}</div>`;

const row = (k, label, view) => `<tr><td class="stk">${label}</td>${view.map(m => m.rows[k] ? `<td class="n click" data-cell="${m.m}|${k}">${m0(m.rows[k])}</td>` : '<td></td>').join('')}</tr>`;

// גרף: עמודות נטו לחודש וקו יתרה מצטברת, וקו מינימום
export function chart(view, min) {
  const W = 760, H = 190, pad = 34, bw = (W - pad * 2) / view.length;
  const vals = view.flatMap(m => [m.net, m.cum, 0, min]);
  const hi = Math.max(...vals), lo = Math.min(...vals);
  const y = v => 10 + (hi - v) / ((hi - lo) || 1) * (H - 40);
  const x = i => W - pad - (i + 0.5) * bw; // מימין לשמאל
  const bars = view.map((m, i) => { const y0 = y(0), y1 = y(m.net); return `<rect x="${x(i) - bw * 0.3}" y="${Math.min(y0, y1)}" width="${bw * 0.6}" height="${Math.max(1, Math.abs(y1 - y0))}" rx="2" fill="${m.net < 0 ? 'var(--ri)' : 'var(--gi)'}" opacity="${m.past ? 0.45 : 0.8}"><title>${m.label || monthLabel(m.m)}: נטו ${m0(m.net)}</title></rect>`; }).join('');
  const line = view.map((m, i) => `${i ? 'L' : 'M'}${x(i)},${y(m.cum)}`).join(' ');
  const dots = view.map((m, i) => `<circle cx="${x(i)}" cy="${y(m.cum)}" r="3.5" fill="${m.below && !m.past ? 'var(--ri)' : 'var(--acc)'}"><title>${m.label || monthLabel(m.m)}: יתרה ${m0(m.cum)}</title></circle>`).join('');
  const labels = view.map((m, i) => `<text x="${x(i)}" y="${H - 8}" text-anchor="middle" font-size="10" fill="var(--mut)">${view.length > 26 && i % 4 ? '' : m.label || monthLabel(m.m)}</text>`).join('');
  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block" role="img" aria-label="גרף תזרים: עמודות נטו לחודש וקו יתרה מצטברת">
    <line x1="${pad}" x2="${W - pad}" y1="${y(0)}" y2="${y(0)}" stroke="var(--line2)"/>
    ${min ? `<line x1="${pad}" x2="${W - pad}" y1="${y(min)}" y2="${y(min)}" stroke="var(--ri)" stroke-dasharray="4 4" opacity=".7"/><text x="${pad}" y="${y(min) - 4}" font-size="10" fill="var(--ri)">מינימום</text>` : ''}
    ${bars}<path d="${line}" fill="none" stroke="var(--acc)" stroke-width="2"/>${dots}${labels}</svg>
    <div class="legend small"><span><i style="background:var(--gi)"></i>נטו בחודש</span><span><i style="background:var(--acc)"></i>יתרה מצטברת</span><span class="mut">עמודות בהירות = חודשים שעברו</span></div>`;
}

async function exportCf(view, title, o, st, L = k => CF_ROWS[k]) {
  const XLSX = await loadXLSX();
  const r = v => Math.round(n(v));
  const aoa = [[`תזרים מזומנים - ${title}`], [`הופק ${todayStr()} · לפי ${PERIODS[o.per] || 'חודש'} · תרחיש עיכוב ${o.delay} יום · מינימום ${r(st.cash_min)}`], [],
    ['', ...view.map(m => (m.label || monthLabel(m.m)) + (m.past ? ' (בפועל)' : ''))],
    ['כניסות'], ...usedRows(CF_IN, view).map(k => [L(k), ...view.map(m => r(m.rows[k]))]),
    ['מע"מ שנגבה', ...view.map(m => r(m.vatIn))], ['סה"כ כניסות', ...view.map(m => r(m.inTotal))],
    ['יציאות'], ...usedRows(CF_OUT, view).map(k => [CF_ROWS[k], ...view.map(m => r(m.rows[k]))]),
    ['מע"מ ששולם', ...view.map(m => r(m.vatOut))], ['סה"כ יציאות', ...view.map(m => r(m.outTotal))],
    ['תשלום מע"מ לרשות', ...view.map(m => r(m.vatPay))], ['נטו לתקופה', ...view.map(m => r(m.net))], ['יתרה מצטברת', ...view.map(m => r(m.cum))]];
  const ws = XLSX.utils.aoa_to_sheet(aoa); ws['!cols'] = [{ wch: 34 }, ...view.map(() => ({ wch: 12 }))];
  const wb = XLSX.utils.book_new(); wb.Workbook = { Views: [{ RTL: true }] }; XLSX.utils.book_append_sheet(wb, ws, 'תזרים');
  XLSX.writeFile(wb, `תזרים - ${title}.xlsx`);
}
