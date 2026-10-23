// תצוגה ומצב: ערכת צבעים, מצב חיבור, ייצוא גיבוי
import { h, esc, $, toast, store } from '../util.js';
import { db, isCloud } from '../db.js';
import { S, can, roleName, tenant } from '../app.js';

export async function viewSettings() {
  const theme = store('subcon-theme') || 'auto';
  const el = h(`<div><div class="top"><div><h1>תצוגה ומצב</h1></div></div>
    <div class="cols even"><div class="card"><h2>ערכת צבעים</h2>
      <div class="seg" id="th">${[['auto', 'לפי המכשיר'], ['light', 'בהיר'], ['dark', 'כהה']].map(([k, v]) => `<button data-t="${k}" class="${theme === k ? 'on' : ''}">${v}</button>`).join('')}</div></div>
    <div class="card"><h2>מצב המערכת</h2>
      <p>חיבור: <b>${isCloud() ? 'ענן (Supabase), עם משתמשים והרשאות' : 'מצב הדגמה, הנתונים נשמרים רק בדפדפן הזה'}</b></p>
      <p>משתמש: <b dir="ltr">${esc(S.user?.email || '')}</b> · ${esc(roleName(S.role))}</p>
      ${can.edit() && S.tenantId ? '<button class="btn ghost" id="bk">גיבוי נתוני הלקוח (JSON)</button>' : ''}</div></div></div>`);
  el.querySelectorAll('[data-t]').forEach(b => b.onclick = () => {
    const t = b.dataset.t; store('subcon-theme', t === 'auto' ? null : t);
    if (t === 'auto') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = t;
    el.querySelectorAll('[data-t]').forEach(x => x.classList.toggle('on', x === b));
  });
  $('#bk', el)?.addEventListener('click', async () => {
    const out = { exported_at: new Date().toISOString(), tenant: tenant() };
    for (const t of ['main_contractors', 'projects', 'variations', 'boq_items', 'cost_lines', 'expenses', 'change_log']) out[t] = await db.select(t, { eq: { tenant_id: S.tenantId } });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(out, null, 1)], { type: 'application/json' }));
    a.download = `גיבוי - ${tenant()?.name || 'לקוח'} - ${new Date().toISOString().slice(0, 10)}.json`; a.click();
    toast('הגיבוי ירד');
  });
  return el;
}
