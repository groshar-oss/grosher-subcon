// תצוגה ומצב: ערכת צבעים, מצב חיבור, ייצוא גיבוי
import { h, esc, $, toast, store, modal } from '../util.js';
import { db, isCloud, uuid } from '../db.js';
import { loadDemoClients, removeDemoClients } from '../demo-clients.js';
import { S, can, roleName, tenant, render, reloadTenants } from '../app.js';
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
    ${can.expense() ? googleCard() : ''}${can.admin() ? demoCard() : ''}</div>`);
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
  wireDemo(el);
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

// לקוחות דמו: שלושה קבלנים לדוגמה (גבס, צבע, ריצוף), למנהלת השירות בלבד
const TBL = { tenants: 'לקוחות', main_contractors: 'קבלנים ראשיים', projects: 'פרויקטים', variations: 'הוראות שינוי', boq_items: 'כתבי כמויות', cost_lines: 'תמחור', workers: 'עובדים',
  purchase_orders: 'הזמנות רכש', po_lines: 'הזמנות רכש', expenses: 'הוצאות', work_days: 'יומן עבודה', work_entries: 'יומן עבודה', work_qty: 'יומן עבודה', bills: 'חשבונות', bill_lines: 'חשבונות',
  bill_fines: 'קנסות', bill_payments: 'תקבולים', vendors: 'ספקים', documents: 'מסמכים', guarantees: 'ערבויות', contacts: 'אנשי קשר' };
function demoCard() {
  const n = S.tenants.filter(t => t.is_demo).length;
  return `<div class="card" id="democ"><h2>לקוחות דמו</h2>
    <p class="small mut">שלושה קבלני משנה לדוגמה, כדי לראות את המערכת מלאה ולהציג אותה: קבלן גבס (4 פרויקטים), קבלן צבע (3) וקבלן ריצוף (5), בשלבים שונים מהצעת מחיר ועד חשבון סופי. כל השמות והמספרים מומצאים, וכל לקוח מסומן "(דמו)". הלקוחות האמיתיים לא מושפעים.</p>
    <p>מצב: <b>${n ? `${n} לקוחות דמו במערכת` : 'אין לקוחות דמו'}</b></p>
    <p class="small" id="dmsg" hidden></p>
    <div class="actions"><button class="btn" type="button" id="dload">${n ? 'טעינה מחדש' : 'טעינת לקוחות דמו'}</button>${n ? '<button class="btn ghost danger" type="button" id="ddel">מחיקת נתוני הדמו</button>' : ''}</div></div>`;
}
function wireDemo(el) {
  const msg = t => { const m = $('#dmsg', el); if (m) { m.hidden = !t; m.textContent = t || ''; } };
  const busy = on => el.querySelectorAll('#dload, #ddel').forEach(b => b.disabled = on);
  $('#dload', el)?.addEventListener('click', async () => {
    const had = S.tenants.some(t => t.is_demo);
    if (!(await modal({ title: 'טעינת לקוחות דמו', ok: 'טעינה', body: `<p>ייווצרו 3 לקוחות דמו עם 12 פרויקטים.${had ? ' <b>לקוחות הדמו הקיימים יימחקו קודם</b>, כולל שינויים שעשית בהם.' : ''}</p><p class="small mut">לקוחות אמיתיים לא נמחקים ולא משתנים. הטעינה לוקחת כחצי דקה.</p>` }))) return;
    busy(true);
    try {
      const T = await loadDemoClients(db, uuid, k => msg('טוען: ' + (TBL[k] || k) + '…'));
      await reloadTenants();
      if (!tenant()?.is_demo || !S.tenantId) { S.tenantId = T.tenants[0].id; store('subcon-tenant', S.tenantId); await reloadTenants(); }
      toast('נטענו 3 לקוחות דמו. בוחרים ביניהם בתיבת "לקוח" בתפריט'); render();
    } catch (e) { msg(''); busy(false); toast('הטעינה נכשלה: ' + e.message + '. אפשר ללחוץ על מחיקה ולנסות שוב', 'bad'); await reloadTenants(); render(); }
  });
  $('#ddel', el)?.addEventListener('click', async () => {
    if (!(await modal({ title: 'מחיקת נתוני הדמו', ok: 'מחיקה', danger: true, body: '<p>כל לקוחות הדמו וכל הנתונים שלהם יימחקו. לקוחות אמיתיים לא נמחקים.</p>' }))) return;
    busy(true); msg('מוחק…');
    try { const k = await removeDemoClients(db); await reloadTenants(); toast(`נמחקו ${k} לקוחות דמו`); render(); }
    catch (e) { busy(false); msg(''); toast(e.message, 'bad'); }
  });
}
