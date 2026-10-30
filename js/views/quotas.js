// מכסות: כמות וכסף שתומחרו לכל שורת עבודה / קבלנות / חומר, מול מה שנרשם ביומן, בהזמנות ובהוצאות
import { h, esc, $, $$, money, num, pct } from '../util.js';
import { COST_KINDS } from '../calc.js';
import { LABOR_TYPES } from '../quota.js';
import { rowAttr } from './common.js';
import { settings } from '../app.js';

const fmtPct = v => isFinite(v) ? pct(v, { d: 0 }) : '<span class="mut">—</span>';

export function quotaCounts(rows) {
  return { over: rows.filter(r => r.status === 'over').length, warn: rows.filter(r => r.status === 'warn').length };
}

export function tabQuota(P) {
  const st = settings();
  const rows = P.summary.quotas || [];
  const c = quotaCounts(rows);
  let only = c.over + c.warn > 0;
  const el = h(`<div>
    <div class="kpis"><div class="kpi"><div class="l">חרגו מהמכסה</div><div class="v ${c.over ? 'neg' : 'pos'}">${c.over}</div><div class="n">בכמות, בכסף או בגודל הצוות</div></div>
      <div class="kpi"><div class="l">מתקרבות למכסה</div><div class="v">${c.warn}</div><div class="n">ניצול ${st.quota_warn_pct}% ומעלה, או מקדים את הביצוע ב-${st.quota_gap_pct}%</div></div>
      <div class="kpi"><div class="l">שורות במעקב</div><div class="v">${rows.length}</div><div class="n">עבודה עצמית, קבלנות וחומרים עם ניצול</div></div></div>
    <div class="actions" style="margin-bottom:10px"><label class="chk"><input type="checkbox" id="only" ${only ? 'checked' : ''}> רק התראות</label></div>
    <div class="tw" id="t"></div>
    <p class="small mut">כמות: ימי עבודה מהיומן (שכירים ויומיים), כמות קבלנות שדווחה, וכמות חומר שהוזמנה או נקנתה (כולל הפחת שבתמחיר). כסף: עלות העבודה מהיומן ועלות ההזמנות והרכישות.
    צוות: כשבשורת התמחיר מוגדר מספר עובדים ביום, כל יום עם יותר עובדים מסומן. ההגדרות בהגדרות הלקוח.</p></div>`);
  const draw = () => {
    const rs = rows.filter(r => !only || r.status);
    $('#t', el).innerHTML = `<table><thead><tr><th>סעיף</th><th>שורת תמחיר</th><th class="n">מכסה</th><th class="n">נוצל</th><th class="n">% ניצול</th><th class="n hide-m">תמחיר ₪</th><th class="n hide-m">בפועל ₪</th><th class="n">% ביצוע</th><th>מה קרה</th></tr></thead><tbody>
      ${rs.map(r => { const a = r.status === 'over' ? rowAttr(Math.max(r.overPct, 0.1)) : { cls: '', style: '' };
        return `<tr class="${a.cls}"${a.style}><td class="wrap"><b>${esc(r.item.code || '')}</b> ${esc(r.item.description)}</td>
        <td class="wrap small">${r.line ? `${COST_KINDS[r.line.kind]}${r.line.labor_type ? ' · ' + LABOR_TYPES[r.line.labor_type] : ''}${r.crew ? ` · צוות ${num(r.crew)}` : ''}<div class="mut">${esc(r.line.description || '')}</div>` : '<span class="chip red">אין שורת עבודה בתמחיר</span>'}</td>
        <td class="n">${r.line ? `${num(r.plannedQty, 1)} <span class="small mut">${esc(r.unit)}</span>` : ''}</td><td class="n">${num(r.usedQty, 1)}</td><td class="n">${fmtPct(r.qtyPct)}</td>
        <td class="n hide-m">${money(r.plannedCost)}</td><td class="n hide-m">${money(r.usedCost)} <span class="small mut">${fmtPct(r.costPct)}</span></td><td class="n">${pct(r.progress, { d: 0 })}</td>
        <td class="wrap small">${r.status === 'over' ? '<span class="chip red">חריגה</span> ' : r.status === 'warn' ? '<span class="chip amber">התראה מוקדמת</span> ' : ''}${r.msgs.map(esc).join('<br>')}</td></tr>`; }).join('')
        || `<tr><td colspan="9" class="empty">${only ? 'אין התראות מכסה' : 'עדיין אין ניצול לשורות התמחיר. הניצול נאסף מיומן העבודה, מהזמנות הרכש ומההוצאות.'}</td></tr>`}</tbody></table>`;
  };
  draw();
  $('#only', el).onchange = e => { only = e.target.checked; draw(); };
  return el;
}
