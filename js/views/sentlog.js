// ארכיון שליחות: כל מה שיצא ללקוח, לקבלנים וליזם. לקריאה בלבד
import { h, esc, $, $$, modal, fmtDate } from '../util.js';
import { db } from '../db.js';
import { S } from '../app.js';
import { CHANNELS, SEND_KINDS } from '../sendlog.js';
import { loadXLSX } from '../import.js';

const when = d => { const x = new Date(d); return `${fmtDate(x)} ${x.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}`; };

export async function viewSentLog() {
  const [list, projects] = await Promise.all([db.select('send_log', { eq: { tenant_id: S.tenantId }, order: 'sent_at desc' }).catch(() => null), db.select('projects', { eq: { tenant_id: S.tenantId }, order: 'name' })]);
  const pn = id => projects.find(p => p.id === id)?.name || '';
  const F = { q: '', p: '', c: '' };
  const el = h(`<div><div class="top"><div><h1>ארכיון שליחות</h1><div class="sub">כל מייל, הודעת וואטסאפ וסיכום שיצאו מהמערכת: מה נשלח, למי, מתי ומי שלח</div></div></div>
    ${list === null ? '<div class="note">הארכיון יתחיל לעבוד אחרי הרצת schema.sql של חבילה 21.</div>' : ''}
    <div class="actions" style="margin-bottom:12px;flex-wrap:wrap;gap:8px"><input id="q" type="search" placeholder="חיפוש נמען, נושא, תוכן" style="flex:1 1 220px;max-width:320px">
      <select id="fp" style="width:auto"><option value="">כל הפרויקטים</option><option value="-">כללי (בלי פרויקט)</option>${projects.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select>
      <select id="fc" style="width:auto"><option value="">כל הערוצים</option>${Object.entries(CHANNELS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
      <button class="btn ghost" id="xl">ייצוא לאקסל</button></div>
    <div class="tw"><table><thead><tr><th>מתי</th><th>ערוץ</th><th>סוג</th><th>פרויקט</th><th>אל</th><th>נושא</th><th class="hide-m">שלח</th></tr></thead><tbody id="tb"></tbody></table></div>
    <p class="small mut">בוואטסאפ נרשם הרגע שבו נפתחה ההודעה לשליחה. השליחה עצמה נעשית בוואטסאפ.</p></div>`);
  const rows = () => (list || []).filter(r => (!F.p || (F.p === '-' ? !r.project_id : r.project_id === F.p)) && (!F.c || r.channel === F.c)
    && (!F.q || [r.recipients, r.subject, r.body, r.sent_by].join(' ').toLowerCase().includes(F.q.toLowerCase())));
  const draw = () => {
    const rs = rows();
    $('#tb', el).innerHTML = rs.map(r => `<tr class="click" data-r="${r.id}"><td class="nw">${when(r.sent_at)}</td><td><span class="chip ${r.channel === 'whatsapp' ? 'green' : r.channel === 'digest' ? 'blue' : ''}">${CHANNELS[r.channel] || r.channel}</span></td>
      <td class="small">${esc(SEND_KINDS[r.kind] || r.kind || '')}</td><td class="small">${esc(pn(r.project_id))}</td><td class="wrap small" dir="auto">${esc(r.recipients || '')}</td><td class="wrap">${esc(r.subject || '')}${r.attachments ? ` <span class="small mut">📎 ${esc(r.attachments)}</span>` : ''}</td><td class="small hide-m">${esc(r.sent_by || '')}</td></tr>`).join('')
      || '<tr><td colspan="7" class="empty">אין שליחות</td></tr>';
    $$('[data-r]', el).forEach(tr => tr.onclick = () => { const r = list.find(x => x.id === tr.dataset.r);
      modal({ title: r.subject || CHANNELS[r.channel], ok: null, cancel: 'סגירה', wide: true, body: `<p class="small mut">${when(r.sent_at)} · ${CHANNELS[r.channel] || ''} · ${esc(SEND_KINDS[r.kind] || '')}${r.project_id ? ' · ' + esc(pn(r.project_id)) : ''}<br>אל: <span dir="auto">${esc(r.recipients || '')}</span> · שלח: ${esc(r.sent_by || '')}${r.attachments ? `<br>📎 ${esc(r.attachments)}` : ''}</p>
        <div class="card" style="white-space:pre-wrap;box-shadow:none;max-height:60vh;overflow:auto">${esc(r.body || '')}</div>` }); });
  };
  $('#q', el).oninput = e => { F.q = e.target.value; draw(); };
  $('#fp', el).onchange = e => { F.p = e.target.value; draw(); };
  $('#fc', el).onchange = e => { F.c = e.target.value; draw(); };
  $('#xl', el).onclick = async () => { const XLSX = await loadXLSX();
    const ws = XLSX.utils.aoa_to_sheet([['מתי', 'ערוץ', 'סוג', 'פרויקט', 'אל', 'נושא', 'תוכן', 'קבצים', 'שלח'], ...rows().map(r => [when(r.sent_at), CHANNELS[r.channel] || r.channel, SEND_KINDS[r.kind] || r.kind || '', pn(r.project_id), r.recipients || '', r.subject || '', r.body || '', r.attachments || '', r.sent_by || ''])]);
    const wb = XLSX.utils.book_new(); wb.Workbook = { Views: [{ RTL: true }] }; XLSX.utils.book_append_sheet(wb, ws, 'ארכיון שליחות'); XLSX.writeFile(wb, 'ארכיון שליחות.xlsx'); };
  draw();
  return el;
}
