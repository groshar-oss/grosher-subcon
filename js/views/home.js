// מסך בית: מה דורש טיפול, לכל הפרויקטים של הלקוח
import { h, esc, money, pct, $, plainMoney, toast } from '../util.js';
import { S, can, loadTenantData, modeSwitch, tenant, render, settings } from '../app.js';
import { portfolio, VO_AT_RISK, VO_STATUS } from '../calc.js';
import { projData, summarize, level, levelColor, levelBg, STATUS, CONTRACT, modeLine } from './common.js';
import { collection } from '../bills.js';
import { cashflow, monthLabel } from '../cashflow.js';
import { maybeSendAlerts, sendAlerts, recipients } from '../alerts.js';
import { gEnabled, gReady, gConnect } from '../google.js';
import { vendorStatus, docStatus, OWN_REQUIRED, DOC_TYPES, GUAR_KINDS, guaranteeState, daysLeft, finalBill } from '../docs.js';

export async function viewHome() {
  if (!S.tenantId) return h(`<div><div class="top"><div><h1>ברוכה הבאה</h1><div class="sub">עדיין אין לקוחות במערכת.</div></div></div>
    <div class="card"><p>השלב הראשון הוא להקים לקוח (קבלן משנה), ואחר כך פרויקט וכתב כמויות.</p><a class="btn" href="#/clients">הקמת לקוח</a></div></div>`);
  const data = await loadTenantData();
  if (!can.prices()) return fieldHome(data);

  const live = data.projects.filter(p => p.status !== 'closed');
  const mcName = id => data.mcs.find(m => m.id === id)?.name || '';
  const sums = live.map(p => ({ p, s: summarize(projData(data, p.id)) }));
  const T = portfolio(sums.map(x => x.s));
  const riskTotal = sums.reduce((a, x) => a + x.s.riskAmount, 0);
  const actions = buildActions(data, sums);

  const el = h(`<div>
    <div class="top"><div><h1>מה דורש טיפול</h1><div class="sub">${esc(tenant()?.name || '')} · ${live.length} פרויקטים פעילים · סכומים לפני מע"מ</div></div>
      <div class="actions" id="modeBox"></div></div>
    <div class="kpis">
      <div class="kpi"><div class="l">היקף מכירה</div><div class="v">${money(T.sale)}</div><div class="n">חוזים ${money(T.contractSale)} · הוראות שינוי ${money(T.voSale)}</div></div>
      <div class="kpi"><div class="l">צפי עלות לסיום</div><div class="v">${money(T.forecast)}</div><div class="n">תמחיר ${money(T.planned)} · חריגה ${pct(T.overrun, { sign: true })}</div></div>
      <div class="kpi"><div class="l">רווח צפוי</div><div class="v ${T.profit >= 0 ? 'pos' : 'neg'}">${money(T.profit)}</div><div class="n">${pct(T.profitPct)} מהמכירה · תוכנן ${pct(T.plannedProfitPct)}</div></div>
      <div class="kpi"><div class="l">עלות בפועל עד היום</div><div class="v">${money(T.actual)}</div><div class="n">${pct(T.planned ? T.actual / T.planned * 100 : 0)} מהתמחיר</div></div>
      <div class="kpi"><div class="l">לגבייה מהקבלנים הראשיים</div><div class="v">${money(sums.reduce((a, x) => a + collection(x.s.billing.byBill).outstanding, 0))}</div><div class="n">${(() => { const o = sums.flatMap(x => collection(x.s.billing.byBill).overdue); return o.length ? `<span class="neg">${o.length} באיחור · ${money(o.reduce((a, r) => a + r.outstanding, 0))}</span>` : 'אין חשבונות באיחור'; })()}</div></div>
      <div class="kpi"><div class="l">הוראות שינוי שטרם אושרו</div><div class="v ${riskTotal ? 'neg' : ''}">${money(riskTotal)}</div><div class="n">${S.mode === 'all' ? 'כלולים בתצוגה' : 'לא כלולים בתצוגה'}</div></div>
    </div>
    <div class="cols"><div class="card"><h2>פרויקטים ${modeLine()}</h2><div id="plist"></div></div>
    <div class="card"><h2>פעולות פתוחות <span class="chip ${actions.length ? 'red' : 'green'}">${actions.length}</span>${can.expense() ? '<button class="btn small ghost" id="mailnow" title="שליחת ההתראות האדומות החדשות במייל">שליחת התראות במייל</button>' : ''}</h2><div id="alist"></div></div></div></div>`);
  $('#modeBox', el).appendChild(modeSwitch());
  const pl = $('#plist', el);
  if (!sums.length) pl.innerHTML = `<div class="empty">אין פרויקטים פעילים. <a href="#/projects">הוספת פרויקט</a></div>`;
  for (const { p, s } of sums) {
    const t = s.total, l = level(t.overrun);
    pl.insertAdjacentHTML('beforeend', `<a class="proj" href="#/project/${p.id}/control" style="border-inline-start-color:${levelColor(l.cls)}">
      <div class="hd"><span>${esc(p.name)}</span><span class="chip" style="background:${levelBg(l.cls)}">חריגה ${pct(t.overrun, { sign: true })}</span></div>
      <div class="meta">${esc(mcName(p.main_contractor_id) || 'ללא קבלן ראשי')} · ${CONTRACT[p.contract_type] || ''} · שוטף+${p.pay_terms_days} · ${STATUS[p.status]}</div>
      <div class="pr"><div>מכירה<b>${money(t.sale)}</b></div><div>צפי עלות<b>${money(t.forecast)}</b></div><div>רווח צפוי<b class="${t.profit >= 0 ? '' : 'neg'}">${money(t.profit)} <small class="mut">${pct(t.profitPct)}</small></b></div>
      <div>בפועל עד היום<b>${money(t.actual)}</b></div><div>ביצוע / הוצאה<b>${pct(t.progress, { d: 0 })} / ${pct(t.spentPct, { d: 0 })}</b></div></div>
      <div class="bar" title="כחול: אחוז ביצוע. רקע: אחוז הוצאה מהתמחיר"><i style="width:${Math.min(100, t.spentPct)}%;background:${levelColor(l.cls)};opacity:.35"></i><i style="width:${Math.min(100, t.progress)}%;background:#2f5bea"></i></div>
      ${s.excludedActual ? `<div class="small neg" style="margin-top:6px">עלות שכבר הוצאה על הוראות שינוי שלא נכללות בתצוגה: ${money(s.excludedActual)}</div>` : ''}</a>`);
  }
  const al = $('#alist', el);
  const drawActs = k => { al.innerHTML = actions.length ? actions.slice(0, k).map(a => `<a class="act" href="${a.href}"><span class="dot" style="background:${a.color}"></span><div><b>${esc(a.title)}</b><small>${esc(a.sub)}</small></div><span class="amt">${a.amt || ''}</span></a>`).join('')
    + (actions.length > k ? `<button class="btn ghost small" id="moreacts" style="margin-top:8px">הצגת כל ${actions.length} הפעולות</button>` : '')
    : '<div class="empty">אין פעולות פתוחות</div>';
    $('#moreacts', al)?.addEventListener('click', () => drawActs(actions.length)); };
  drawActs(12);
  // התראות במייל: נשלחות אוטומטית כשנכנסים למסך, אם Google מחובר וההתראות פעילות
  if (can.expense()) setTimeout(() => maybeSendAlerts(actions).then(r => { if (r?.sent) toast(`נשלחו במייל ${r.sent} התראות חדשות`); }), 300);
  $('#mailnow', el)?.addEventListener('click', async () => {
    if (!recipients().length) return toast('אין נמענים להתראות. מוסיפים אותם בהגדרות הלקוח', 'warn');
    try {
      if (!gEnabled() || !gReady()) await gConnect();
      const r = await sendAlerts(actions, { force: true });
      toast(r.sent ? `נשלחו ${r.sent} התראות ל-${r.to.join(', ')}` : r.skipped === 'google' ? 'צריך להתחבר ל-Google' : 'אין התראות אדומות חדשות. כל מה שאדום כבר נשלח');
    } catch (e) { toast(e.message, 'bad'); }
  });
  return el;
}

export function buildActions(data, sums) {
  const out = [];
  for (const { p, s } of sums) {
    for (const g of s.voGroups) {
      if (g.vo.status === 'executed_unapproved') out.push({ w: 100, color: 'var(--ri)', title: `${g.vo.number} בוצע בלי אישור`, sub: `${p.name} · ${g.vo.title}${g.vo.has_written_order ? '' : ' · אין הוראה בכתב'}`, amt: money(g.requested) + ' בסיכון', href: `#/project/${p.id}/vo` });
      else if (g.vo.status === 'submitted' && g.actual > 0) out.push({ w: 80, color: '#ff9f43', title: `${g.vo.number} בביצוע וממתין לאישור`, sub: `${p.name} · ${g.vo.title}`, amt: money(g.requested), href: `#/project/${p.id}/vo` });
    }
    for (const r of s.rows) {
      const c = r.c, code = r.item.code || '', d = r.item.description;
      if (c.overrun > 0 && !c.noCosting) { const l = level(c.overrun); out.push({ w: 50 + Math.min(c.overrun, 40), color: levelColor(l.cls), sev: ['al-r', 'al-dr'].includes(l.cls) ? 'red' : 'amber', key: `item|${r.item.id}|${l.cls}${l.crit ? '|crit' : ''}`, title: `חריגה בסעיף ${code} ${d}`, sub: `${p.name} · ${Math.round(c.progress)}% ביצוע מול ${Math.round(c.spentPct)}% הוצאה · חריגה צפויה ${c.overrun.toFixed(1)}%`, amt: money(c.forecast - c.planned, { sign: true }), href: `#/project/${p.id}/control` }); }
      else if (c.spendAhead && c.spentPct - c.progress >= 10) out.push({ w: 45, color: '#ff9f43', title: `הוצאה מקדימה את הביצוע: ${code}`, sub: `${p.name} · ${Math.round(c.progress)}% ביצוע מול ${Math.round(c.spentPct)}% הוצאה`, amt: '', href: `#/project/${p.id}/control` });
      if (c.lossPlanned) out.push({ w: 60, color: 'var(--ri)', title: `תמחיר גבוה ממחיר המכירה: ${code}`, sub: `${p.name} · ${d}`, amt: money(c.sale - c.planned), href: `#/project/${p.id}/costing` });
    }
    // גבייה: חשבונות באיחור, ותשלום צפוי בשבועיים הקרובים
    const col = collection(s.billing.byBill);
    for (const r of col.overdue) out.push({ w: 98, color: 'var(--ri)', title: `חשבון ${r.bill.number} באיחור תשלום`, sub: `${p.name} · היה צפוי ב-${r.due.split('-').reverse().join('.')}`, amt: money(r.outstanding), href: `#/project/${p.id}/bill/${r.bill.id}` });
    for (const r of col.dueSoon) out.push({ w: 40, color: '#2f5bea', title: `תשלום צפוי: חשבון ${r.bill.number}`, sub: `${p.name} · ${r.due.split('-').reverse().join('.')}`, amt: money(r.outstanding), href: `#/project/${p.id}/bill/${r.bill.id}` });
    for (const id of s.billing.order) { const r = s.billing.byBill[id];
      if (r.bill.status === 'submitted' && r.bill.submitted_date && (Date.now() - new Date(r.bill.submitted_date)) / 864e5 > 21) out.push({ w: 55, color: '#ff9f43', title: `חשבון ${r.bill.number} ממתין לאישור יותר מ-3 שבועות`, sub: `${p.name} · הוגש ${r.bill.submitted_date.split('-').reverse().join('.')}`, amt: money(r.curSub), href: `#/project/${p.id}/bill/${r.bill.id}` });
      if (r.approvedStage && r.cut > 0 && r.cut / Math.max(1, r.curSub) >= 0.03) out.push({ w: 52, color: '#ff9f43', title: `קיצוץ פיקוח בחשבון ${r.bill.number}`, sub: `${p.name} · אושר ${Math.round((1 - r.cut / r.curSub) * 100)}% מהמוגש. לבדוק אם לערער`, amt: money(-r.cut), href: `#/project/${p.id}/bill/${r.bill.id}` }); }
    // מכסות: חריגה בכמות / כסף / צוות, והתראה מוקדמת
    for (const q of (s.quotas || []).filter(q => q.status === 'over').slice(0, 6))
      out.push({ w: 70 + Math.min(q.overPct, 25), color: 'var(--ri)', title: `מכסה: ${q.item.code || ''} ${q.line ? (q.line.description || '') : q.item.description}`.trim(), sub: `${p.name} · ${q.msgs[0] || ''}`, amt: q.usedCost > q.plannedCost && q.plannedCost ? money(q.usedCost - q.plannedCost, { sign: true }) : '', href: `#/project/${p.id}/quota` });
    const warns = (s.quotas || []).filter(q => q.status === 'warn');
    if (warns.length === 1) out.push({ w: 48, color: '#ff9f43', title: `מתקרב למכסה: ${warns[0].item.code || ''} ${warns[0].line?.description || ''}`.trim(), sub: `${p.name} · ${warns[0].msgs.join(' · ')}`, amt: '', href: `#/project/${p.id}/quota` });
    else if (warns.length) out.push({ w: 48, color: '#ff9f43', title: `${warns.length} שורות תמחיר מתקרבות למכסה`, sub: `${p.name} · ${warns.slice(0, 2).map(q => q.item.code).join(', ')}…`, amt: '', href: `#/project/${p.id}/quota` });
    const noCost = s.contractRows.filter(r => r.c.noCosting);
    if (noCost.length) out.push({ w: 30, color: '#f2c400', title: `${noCost.length} סעיפים בלי תמחיר`, sub: p.name, amt: money(noCost.reduce((a, r) => a + r.c.sale, 0)), href: `#/project/${p.id}/costing` });
    if (!s.rows.length) out.push({ w: 35, color: '#f2c400', title: 'אין כתב כמויות', sub: p.name, amt: '', href: `#/project/${p.id}/boq` });
    const noProg = s.rows.filter(r => r.c.actual > 0 && r.c.progress === 0);
    if (noProg.length) out.push({ w: 28, color: '#f2c400', title: `${noProg.length} סעיפים עם הוצאות בלי אחוז ביצוע`, sub: `${p.name} · עדכני אחוז ביצוע כדי שהצפי יהיה נכון`, amt: '', href: `#/project/${p.id}/control` });
    if (s.unallocated) out.push({ w: 25, color: '#f2c400', title: 'הוצאות שלא שויכו', sub: p.name, amt: money(s.unallocated), href: `#/project/${p.id}/expenses` });
  }
  // שלב 7: מסמכים, ערבויות וסגירה
  const today = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const recent = new Set(data.expenses.filter(e => (Date.now() - new Date(e.doc_date)) / 864e5 < 120).map(e => (e.supplier_name || '').trim()));
  for (const v of (data.vendors || []).filter(v => v.active !== false)) {
    const st = vendorStatus(v, data.documents || [], today);
    const active = recent.has(v.name.trim());
    if (st.expired.length || (st.missing.length && active)) out.push({ w: active ? 66 : 42, color: 'var(--ri)', title: `${v.name}: ${st.expired.length ? 'מסמך שפג תוקפו' : 'חסרים מסמכים'}`, sub: [...st.expired.map(d => DOC_TYPES[d.doc_type] + ' פג ' + d.expiry.split('-').reverse().join('.')), ...st.missing.map(t => 'חסר ' + DOC_TYPES[t])].join(' · ') + (active ? ' · יש הוצאות פעילות' : ''), amt: '', href: '#/vendors' });
    else if (st.soon.length) out.push({ w: 44, color: '#ff9f43', title: `${v.name}: מסמך יפוג בקרוב`, sub: st.soon.map(d => `${DOC_TYPES[d.doc_type]} בעוד ${daysLeft(d.expiry, today)} ימים`).join(' · '), amt: '', href: '#/vendors' });
  }
  const own = docStatus((data.documents || []).filter(d => !d.vendor_id), OWN_REQUIRED, today);
  if (own.expired.length || own.soon.length) out.push({ w: own.expired.length ? 75 : 50, color: own.expired.length ? 'var(--ri)' : '#ff9f43', title: own.expired.length ? 'מסמך שלנו מול הקבלן הראשי פג תוקף' : 'מסמך שלנו מול הקבלן הראשי יפוג בקרוב', sub: [...own.expired, ...own.soon].map(d => `${DOC_TYPES[d.doc_type]} עד ${d.expiry.split('-').reverse().join('.')}`).join(' · '), amt: '', href: '#/vendors/own' });
  for (const g of (data.guarantees || [])) { const s = guaranteeState(g, today); if (s === 'expired' || s === 'soon') out.push({ w: s === 'expired' ? 72 : 56, color: s === 'expired' ? 'var(--ri)' : '#ff9f43', title: `ערבות ${GUAR_KINDS[g.kind]} ${s === 'expired' ? 'פגה' : `פגה בעוד ${daysLeft(g.expiry, today)} ימים`}`, sub: `${data.projects.find(p => p.id === g.project_id)?.name || ''} · ${g.bank || ''} ${g.number || ''} · להאריך או לבקש החזרה`, amt: money(g.amount), href: '#/vendors/guarantees' }); }
  for (const { p, s } of sums) if (p.status === 'closing' || (p.end_date && p.end_date < today)) {
    const fb = finalBill(p, s.billing.retentionTotal);
    if (!data.bills.some(b => b.project_id === p.id && b.is_final)) out.push({ w: 46, color: '#2f5bea', title: fb.ready ? 'אפשר להגיש חשבון סופי' : 'לקראת חשבון סופי', sub: `${p.name} · ${fb.ready ? `עיכבון לשחרור ${plainMoney(fb.toRelease)}` : 'חסר: ' + fb.missing.join(', ')}`, amt: '', href: `#/project/${p.id}/bills` });
  }
  // תזרים: יתרה צפויה מתחת למינימום ב-6 החודשים הקרובים
  if (sums.length) {
    const cf = cashflow(sums.map(({ p, s }) => ({ project: p, summary: s, pd: projData(data, p.id) })), { settings: settings(), back: 0, ahead: 6 });
    const b = cf.belowMonths;
    if (b.length) { const low = b.reduce((a, x) => (x.cum < a.cum ? x : a), b[0]);
      out.push({ w: 99, color: 'var(--ri)', title: `תזרים: היתרה יורדת מתחת למינימום ב${monthLabel(b[0].m)}`, sub: `${b.length} חודשים מתחת ל-${plainMoney(cf.settings.cash_min)} · הנמוך ב${monthLabel(low.m)}`, amt: money(low.cum), href: '#/cashflow' }); }
  }
  return out.sort((a, b) => b.w - a.w);
}

function fieldHome(data) {
  const t = new Date(); const td = new Date(t.getTime() - t.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  return h(`<div><div class="top"><div><h1>הפרויקטים שלי</h1><div class="sub">${esc(tenant()?.name || '')}</div></div></div>
    <div class="card">${data.projects.length ? data.projects.map(p => { const done = data.entries.some(e => e.project_id === p.id && e.log_date === td);
      return `<div class="proj"><div class="hd"><a href="#/project/${p.id}/field">${esc(p.name)}</a>${done ? '<span class="chip green">היום נרשם</span>' : '<span class="chip amber">היום עוד לא נרשם</span>'}</div><div class="meta">${esc(p.address || '')}</div>
        <a class="btn big" href="#/project/${p.id}/day/today" style="margin-top:8px">יומן עבודה להיום</a></div>`; }).join('') : '<div class="empty">עדיין לא שויכו לך פרויקטים</div>'}</div></div>`);
}
