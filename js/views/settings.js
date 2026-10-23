// תצוגה ומצב: ערכת צבעים, מצב חיבור, ייצוא גיבוי
import { h, esc, $, toast, store } from '../util.js';
import { db, isCloud } from '../db.js';
import { S, can, roleName, tenant, render } from '../app.js';
import { gconf, setGconf, gConnect, gDisconnect, gReady, gEnabled } from '../google.js';

export async function viewSettings() {
  const theme = store('subcon-theme') || 'auto';
  const el = h(`<div><div class="top"><div><h1>תצוגה ומצב</h1></div></div>
    <div class="cols even"><div class="card"><h2>ערכת צבעים</h2>
      <div class="seg" id="th">${[['auto', 'לפי המכשיר'], ['light', 'בהיר'], ['dark', 'כהה']].map(([k, v]) => `<button data-t="${k}" class="${theme === k ? 'on' : ''}">${v}</button>`).join('')}</div></div>
    <div class="card"><h2>מצב המערכת</h2>
      <p>חיבור: <b>${isCloud() ? 'ענן (Supabase), עם משתמשים והרשאות' : 'מצב הדגמה, הנתונים נשמרים רק בדפדפן הזה'}</b></p>
      <p>משתמש: <b dir="ltr">${esc(S.user?.email || '')}</b> · ${esc(roleName(S.role))}</p>
      ${can.edit() && S.tenantId ? '<button class="btn ghost" id="bk">גיבוי נתוני הלקוח (JSON)</button>' : ''}</div></div>
    ${can.expense() ? googleCard() : ''}</div>`);
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
  wireGoogle(el);
  return el;
}

// חיבור ל-Google: עותק של כל קובץ וגיבוי בדרייב, ושליחת התראות מה-Gmail
function googleCard() {
  const g = gconf(), on = gEnabled() && gReady();
  return `<div class="card"><h2>Google Drive ו-Gmail</h2>
    <p class="small mut">כל מסמך שעולה למערכת נשמר גם בדרייב שלך, בתיקייה לכל לקוח ופרויקט, ועם גיבוי נתונים מלא באקסל. התראות על חריגות נשלחות במייל מה-Gmail שלך. ההרשאות מצומצמות: הדרייב רואה רק קבצים שהמערכת יצרה, וב-Gmail רק שליחה.</p>
    <p>מצב: <b class="${on ? 'pos' : ''}">${on ? 'מחובר' : gEnabled() ? 'צריך להתחבר מחדש (החיבור פג אחרי שעה או בסגירת הלשונית)' : 'לא מחובר'}</b>${g.lastSync ? ` · סנכרון אחרון ${new Date(g.lastSync).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' })}` : ''}${g.lastErr ? ` · <span class="neg">${esc(g.lastErr)}</span>` : ''}</p>
    <form id="gf"><div class="grid g2">
      <label class="fld"><span>מזהה OAuth Client ID</span><input name="clientId" dir="ltr" value="${esc(g.clientId)}" placeholder="xxxx.apps.googleusercontent.com"><small>מ-Google Cloud, אותו פרויקט של מערכת התזרים. ההסבר בחוברת ההתקנה</small></label>
      <label class="fld"><span>שם תיקיית הבסיס בדרייב</span><input name="rootName" value="${esc(g.rootName)}"></label></div>
      <div class="actions"><button class="btn ghost" type="submit">שמירה</button>${on ? '<button class="btn ghost" type="button" id="gdis">ניתוק</button>' : '<button class="btn" type="button" id="gcon">התחברות ל-Google</button>'}</div></form></div>`;
}
function wireGoogle(el) {
  const f = $('#gf', el); if (!f) return;
  f.onsubmit = e => { e.preventDefault(); const v = Object.fromEntries(new FormData(f)); const prev = gconf();
    setGconf({ clientId: v.clientId.trim(), rootName: v.rootName.trim() || 'גרושר - קבלני משנה', folders: v.rootName.trim() !== prev.rootName ? {} : prev.folders }); toast('נשמר'); render(); };
  $('#gcon', el)?.addEventListener('click', async () => {
    const v = Object.fromEntries(new FormData(f)); if (v.clientId.trim()) setGconf({ clientId: v.clientId.trim() });
    try { await gConnect(); toast('מחובר ל-Google'); render(); } catch (e) { toast(e.message, 'bad'); }
  });
  $('#gdis', el)?.addEventListener('click', () => { gDisconnect(); toast('נותק'); render(); });
}
