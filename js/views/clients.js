// לקוחות (קבלני משנה), הגדרות לקוח, משתמשים וקבלנים ראשיים
import { h, esc, $, $$, modal, field, select, toast, numOrNull, confirmBox } from '../util.js';
import { logSend } from '../sendlog.js';
import { db } from '../db.js';
import { S, can, reloadTenants, render, roleName, logChange } from '../app.js';
import { n } from '../calc.js';
import { store } from '../util.js';
import { has } from '../modules.js';
import { loadTemplates, templatesCard, wireTemplatesCard } from './templates.js';
import { closedThrough, nextToClose, todayStr } from '../monthclose.js';
import { contactPicker, wireContactPickers, loadContacts, cardFields, ensureLinksLocal } from '../contacts.js';
import { composeMail, googleConfigured } from '../mailui.js';
import { waLink, mailLink } from '../alertsui.js';

const tenantForm = (t = {}, contacts = null) => `<div class="grid g2">
  ${field('שם החברה', 'name', t.name, { req: true })}${field('ח"פ', 'company_no', t.company_no)}
  ${field('מקצועות', 'trades', t.trades, { hint: 'למשל: גבס, תקרות, בידוד' })}${contacts ? contactPicker('איש קשר', 'contact_id', contacts.find(c => c.id === t.contact_id)) : field('איש קשר', 'contact_name', t.contact_name)}
  ${contacts ? '' : `${field('טלפון', 'phone', t.phone, { type: 'tel', attrs: 'dir="ltr"' })}${field('אימייל', 'email', t.email, { type: 'email', attrs: 'dir="ltr"' })}`}</div>`;

export async function viewClients() {
  if (!can.admin()) return h('<div class="empty">אין הרשאה</div>');
  const projects = await db.select('projects', {});
  const el = h(`<div><div class="top"><div><h1>לקוחות</h1><div class="sub">כל לקוח הוא חברה נפרדת. הנתונים של לקוח אחד לא נראים ללקוח אחר.</div></div>
    <div class="actions"><button class="btn" id="add">+ לקוח חדש</button></div></div>
    <div class="tw"><table><thead><tr><th>שם</th><th>ח"פ</th><th>מקצועות</th><th>איש קשר</th><th class="n">פרויקטים</th><th></th></tr></thead><tbody>
    ${S.tenants.map(t => `<tr><td><b>${esc(t.name)}</b></td><td>${esc(t.company_no || '')}</td><td>${esc(t.trades || '')}</td><td>${esc(t.contact_name || '')} ${esc(t.phone || '')}</td>
      <td class="n">${projects.filter(p => p.tenant_id === t.id).length}</td><td><button class="btn small ghost" data-open="${t.id}">פתיחה</button> <a class="btn small ghost" href="#/client/${t.id}">הגדרות</a></td></tr>`).join('') || '<tr><td colspan="6" class="empty">אין לקוחות עדיין</td></tr>'}
    </tbody></table></div></div>`);
  $('#add', el).onclick = async () => {
    const v = await modal({ title: 'לקוח חדש', body: tenantForm(), validate: d => !d.name.trim() && 'חסר שם' });
    if (!v) return;
    const [t] = await db.insert('tenants', { ...v, settings: { employer_factor: 1.3, crit_pct: 15, vat_pct: 18, overhead_pct: 0, work_days_month: 22, day_hours: 9, quota_warn_pct: 80, quota_gap_pct: 10 } });
    if (v.phone || v.email) { const [c] = await db.insert('contacts', { tenant_id: t.id, name: v.contact_name?.trim() || v.name.trim(), company: v.name.trim(), phone: v.phone || null, email: v.email || null }); await db.update('tenants', t.id, { contact_id: c.id }); }
    await reloadTenants(); S.tenantId = t.id; store('subcon-tenant', t.id); toast('הלקוח נוסף'); location.hash = '#/client/' + t.id;
  };
  $$('[data-open]', el).forEach(b => b.onclick = () => { S.tenantId = b.dataset.open; store('subcon-tenant', S.tenantId); reloadTenants().then(() => { location.hash = '#/'; render(); }); });
  return el;
}

export async function viewClient(id) {
  const t = S.tenants.find(x => x.id === id);
  if (!t) return h('<div class="empty">הלקוח לא נמצא</div>');
  if (S.tenantId !== id) { S.tenantId = id; store('subcon-tenant', id); await reloadTenants(); }
  if (!can.edit()) return h('<div class="empty">אין הרשאה</div>');
  const st = { employer_factor: 1.3, crit_pct: 15, vat_pct: 18, overhead_pct: 0, work_days_month: 22, day_hours: 9, quota_warn_pct: 80, quota_gap_pct: 10, cash_opening: 0, cash_min: 0, supplier_terms_days: 60, ...(t.settings || {}) };
  const [members, mcs, projects, series] = await Promise.all([db.rpc('tenant_members', { t: id }), db.select('main_contractors', { eq: { tenant_id: id }, order: 'name' }), db.select('projects', { eq: { tenant_id: id }, order: 'name' }),
    db.select('index_series', { eq: { tenant_id: id }, order: 'month' }).catch(() => [])]);
  await ensureLinksLocal();
  const contacts = await loadContacts(true);
  const tpls = await loadTemplates();
  const closes = await db.select('month_closes', { eq: { tenant_id: id }, order: 'month' }).catch(() => null);
  const through = closedThrough(closes || []), nextM = nextToClose(through, todayStr());
  const invites = (await db.select('member_invites', { eq: { tenant_id: id } }).catch(() => [])).filter(i => !i.accepted_at);
  // כרטיס המדד מופיע רק כשיש פרויקט עם מודול הצמדה, או שכבר הוזנו מדדים
  const idxProjects = projects.filter(p => has(p, 'index'));
  const showIdx = idxProjects.length || series.length;
  const ser = [...series].sort((a, b) => b.month.localeCompare(a.month));
  const mLabel = m => `${['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'][+m.slice(5, 7) - 1]} ${m.slice(0, 4)}`;
  const pname = pid => projects.find(p => p.id === pid)?.name || '';
  const el = h(`<div><div class="top"><div><h1>${esc(t.name)}</h1><div class="sub">הגדרות לקוח, משתמשים, קבלנים ראשיים ומזמינים</div></div></div>
  <div class="cols even">
    <div class="card"><h2>פרטי הלקוח</h2><form id="tf">${tenantForm(t, contacts)}<button class="btn">שמירת פרטים</button></form></div>
    <div class="card"><h2>הגדרות חישוב</h2><form id="sf"><div class="grid g2">
      ${field('מקדם עלות מעביד', 'employer_factor', st.employer_factor, { type: 'number', hint: 'שכר ברוטו × מקדם = עלות מעביד. ברירת מחדל 1.30' })}
      ${field('סף חריגה קריטית (%)', 'crit_pct', st.crit_pct, { type: 'number' })}
      ${field('שיעור מע"מ (%)', 'vat_pct', st.vat_pct, { type: 'number' })}
      ${field('תקורה ברירת מחדל לפרויקט חדש (%)', 'overhead_pct', st.overhead_pct, { type: 'number' })}
      ${field('ימי עבודה בחודש (לשכירים)', 'work_days_month', st.work_days_month, { type: 'number', hint: 'עלות חודשית של שכיר מתחלקת לפי ימי העבודה ביומן. ברירת מחדל 22' })}
      ${field('שעות ביום עבודה (ברירת מחדל)', 'day_hours', st.day_hours, { type: 'number', hint: 'ברירת המחדל ביומן לעובד שעתי, וגם לחישוב שעה נוספת כשאין תעריף (125%)' })}
      ${field('התראת מכסה מוקדמת (% ניצול)', 'quota_warn_pct', st.quota_warn_pct, { type: 'number', hint: 'למשל 80: התראה כשנוצלו 8 מתוך 10 ימים' })}
      ${field('ניצול שמקדים את הביצוע (נקודות %)', 'quota_gap_pct', st.quota_gap_pct, { type: 'number', hint: 'התראה כשאחוז הניצול גבוה מאחוז הביצוע בפער הזה' })}
      ${field('יתרה בבנק ₪', 'cash_opening', st.cash_opening, { type: 'number', hint: 'היתרה בתחילת החודש שבשדה הבא. כדאי לעדכן פעם בחודש' })}
      ${field('נכון לתחילת חודש', 'cash_asof', st.cash_asof || new Date().toISOString().slice(0, 7), { type: 'month' })}
      ${field('יתרת מינימום רצויה ₪', 'cash_min', st.cash_min, { type: 'number', hint: 'התראה כשהתזרים צפוי לרדת מתחת לסכום הזה' })}
      ${field('תנאי תשלום לספקים (שוטף + ימים)', 'supplier_terms_days', st.supplier_terms_days, { type: 'number', hint: 'לחשבוניות בלי תאריך תשלום' })}</div>
      <div class="fld" style="margin-top:6px"><span>התראות במייל</span>
        <label class="chk"><input type="checkbox" name="alert_email_on" ${st.alert_email_on ? 'checked' : ''}> לשלוח במייל כל התראה אדומה חדשה (חריגה, איחור תשלום, מסמך שפג)</label>
        <input name="alert_emails" dir="ltr" value="${esc(st.alert_emails || '')}" placeholder="name@example.com, other@example.com">
        <small>נמענים, מופרדים בפסיק. המייל נשלח מה-Gmail של מי שמחובר ל-Google במערכת, כשהוא פותח את המסך הראשי. כל התראה נשלחת פעם אחת.</small></div>
      <div class="grid g2" style="margin-top:6px"><label class="fld"><span>סיכום התרעות ללקוח</span><select name="digest">${[['off', 'כבוי'], ['daily', 'יומי'], ['weekly', 'שבועי']].map(([k, l]) => `<option value="${k}" ${(st.digest || 'off') === k ? 'selected' : ''}>${l}</option>`).join('')}</select><small>כל הנושאים הפתוחים, עם החלטה נדרשת ומצב. נשלח לנמענים שלמעלה.</small></label>
        <label class="chk" style="align-self:center"><input type="checkbox" name="alert_links" ${st.alert_links ? 'checked' : ''}> קישור למערכת במיילים (רק לנמענים פנימיים. ללקוח להשאיר כבוי)</label></div>
      <div class="fld" style="margin-top:6px"><span>מסכים בתפריט</span>
        <div class="grid g2">${[['collection', 'גבייה מקבלנים ראשיים / ממזמינים'], ['workers', 'עובדים ונוכחות']].map(([k, l]) => `<label class="fld"><span>${l}</span><select name="nav_${k}">${[['auto', 'אוטומטי: רק כשיש פרויקט קבלן משנה או ביצוע'], ['show', 'תמיד להציג'], ['hide', 'להסתיר']].map(([v, t]) => `<option value="${v}" ${(st['nav_' + k] || 'auto') === v ? 'selected' : ''}>${t}</option>`).join('')}</select></label>`).join('')}</div>
        <small>ללקוח שיש לו רק פרויקטי יזם המסכים האלה מוסתרים לבד. כאן אפשר להציג אותם בכל זאת.</small></div>
      <p class="small mut">צבעי חריגה: עד 3% צהוב, 3%-5% כתום, 5%-10% אדום, מעל 10% אדום שמתכהה. מעל הסף הקריטי השורה מסומנת "קריטי".</p>
      <button class="btn">שמירת הגדרות</button></form></div>
  </div>
  ${showIdx ? `<div class="card" id="idxcard"><h2>מדד תשומות הבנייה <button class="btn small" id="addix">+ מדד חודשי</button></h2>
    <p class="small mut">מדד אחד לכל חודש, משותף לכל הפרויקטים הצמודים (${idxProjects.map(p => esc(p.name)).join(', ') || 'אין כרגע'}). הלמ"ס מפרסמת את המדד בסביבות ה-15 לחודש שאחרי. המערכת לוקחת את המדד האחרון שהוזן: ממלאת אותו בחשבון חדש ומחשבת לפיו את הפרש ההצמדה בתזרים. הפרש הצמדה לא נספר כחריגה.</p>
    <div class="tw"><table><thead><tr><th>חודש המדד</th><th class="n">ערך</th><th class="n">שינוי מהחודש הקודם</th><th>הערה</th><th></th></tr></thead><tbody>
    ${ser.map((x, i) => { const prev = ser[i + 1]; const ch = prev ? (x.value / prev.value - 1) * 100 : null;
      return `<tr><td>${mLabel(x.month)}${i === 0 ? ' <span class="chip green">אחרון</span>' : ''}</td><td class="n">${Number(x.value).toLocaleString('en-US', { maximumFractionDigits: 2 })}</td>
        <td class="n ${ch > 0 ? 'neg' : ''}">${ch == null ? '' : `<span dir="ltr">${ch >= 0 ? '+' : '−'}${Math.abs(ch).toFixed(2)}%</span>`}</td><td class="wrap">${esc(x.note || '')}</td>
        <td><button class="btn small ghost" data-ix="${x.id}">עריכה</button></td></tr>`; }).join('') || '<tr><td colspan="5" class="empty">עוד לא הוזן מדד. מוסיפים את המדד האחרון שפורסם.</td></tr>'}
    </tbody></table></div></div>` : ''}
  ${closes === null ? '' : `<div class="card" id="mccard"><h2>סגירת חודש</h2>
    <p class="small mut">חודש סגור נעול: הוצאות, תקבולים שהתקבלו ויומן העבודה שלו לא משתנים. תיקון מאוחר נרשם כשורה חדשה בחודש פתוח, עם סימון "תיקון לחודש".</p>
    <p>${through ? `סגור עד <b>${mLabel(through)}</b> (כולל)` : 'עוד לא נסגר אף חודש'}</p>
    <div class="actions" style="flex-wrap:wrap;gap:8px">${nextM && can.expense() ? `<button class="btn" id="closem">סגירת ${mLabel(nextM)}</button>` : ''}${through && ['admin', 'owner'].includes(S.role) ? `<button class="btn ghost" id="reopen">פתיחה מחדש של ${mLabel(through)}</button>` : ''}</div>
    ${closes.length ? `<div class="small mut" style="margin-top:8px">${[...closes].reverse().slice(0, 6).map(c => `${mLabel(c.month)}: נסגר ${new Date(c.closed_at).toLocaleDateString('he-IL')}${c.closed_by ? ' ע"י ' + esc(c.closed_by) : ''}`).join(' · ')}</div>` : ''}</div>`}
  ${templatesCard(tpls)}
  <div class="card"><h2>משתמשים <button class="btn small" id="addm">+ הזמנת משתמש</button></h2>
    <p class="small mut">כותבים אימייל ובוחרים תפקיד. מי שעוד לא רשום מקבל מייל עם קישור להרשמה, ואחרי שנרשם הוא מצטרף לבד עם התפקיד שנבחר. מנהל עבודה רואה רק את הפרויקטים שמסומנים לו, ובלי מחירים, רווח ושכר.</p>
    <div class="tw"><table><thead><tr><th>אימייל</th><th>תפקיד</th><th>פרויקטים (למנהל עבודה)</th><th></th></tr></thead><tbody>
    ${members.map(m => `<tr><td dir="ltr" style="text-align:right">${esc(m.email)}</td><td>${roleName(m.role)}</td><td class="wrap">${m.role === 'foreman' ? esc((m.project_ids || []).map(pname).join(', ') || 'אין') : '<span class="mut">כולם</span>'}</td>
      <td class="nw"><button class="btn small ghost" data-link="${esc(m.email)}" data-role="${m.role}">קישור</button> <button class="btn small ghost" data-em="${esc(m.email)}" data-role="${m.role}" data-pids="${(m.project_ids || []).join(',')}">עריכה</button> <button class="btn small ghost" data-rm="${m.id}" data-rme="${esc(m.email)}">הסרה</button></td></tr>`).join('')}
    ${invites.map(i => `<tr class="mut"><td dir="ltr" style="text-align:right">${esc(i.email)}</td><td>${roleName(i.role)} <span class="chip blue">הוזמן, ממתין להרשמה</span></td><td class="wrap">${i.role === 'foreman' ? esc((i.project_ids || []).map(pname).join(', ') || 'אין') : '<span class="mut">כולם</span>'}</td>
      <td class="nw"><button class="btn small ghost" data-resend="${i.id}">שליחה שוב</button> <button class="btn small ghost" data-uninv="${i.id}">ביטול</button></td></tr>`).join('')}
    ${!members.length && !invites.length ? '<tr><td colspan="4" class="empty">אין משתמשים מלבד מנהל השירות</td></tr>' : ''}
    </tbody></table></div></div>
  <div class="card"><h2>קבלנים ראשיים ומזמינים <button class="btn small" id="addmc">+ קבלן ראשי / מזמין</button></h2>
    <p class="small mut">בפרויקט קבלן משנה זה הקבלן הראשי. בפרויקט ביצוע זה המזמין.</p>
    <div class="tw"><table><thead><tr><th>שם</th><th>ח"פ</th><th>איש קשר</th><th>טלפון</th><th class="n">תנאי תשלום</th><th></th></tr></thead><tbody>
    ${mcs.map(m => `<tr><td><b>${esc(m.name)}</b></td><td>${esc(m.company_no || '')}</td><td>${esc(m.contact_name || '')}</td><td dir="ltr" style="text-align:right">${esc(m.phone || '')}</td><td class="n">שוטף+${m.pay_terms_days}</td>
      <td><button class="btn small ghost" data-mc="${m.id}">עריכה</button></td></tr>`).join('') || '<tr><td colspan="6" class="empty">אין קבלנים ראשיים או מזמינים</td></tr>'}
    </tbody></table></div></div>
  ${can.admin() ? `<div class="card"><h2>מחיקת לקוח</h2><p class="small mut">מוחקת את הלקוח וכל הפרויקטים והנתונים שלו. אי אפשר לשחזר.</p><button class="btn danger" id="del">מחיקת הלקוח</button></div>` : ''}</div>`);

  $('#tf', el).onsubmit = async e => {
    e.preventDefault(); const v = Object.fromEntries(new FormData(e.target));
    if (!v.name.trim()) return toast('חסר שם', 'bad');
    const c = (await loadContacts()).find(x => x.id === v.contact_id);
    await db.update('tenants', id, { ...v, contact_id: c?.id || null, ...cardFields(c) });
    await reloadTenants(); toast('נשמר'); render();
  };
  $('#sf', el).onsubmit = async e => {
    e.preventDefault(); const v = Object.fromEntries(new FormData(e.target));
    const ns = { ...st, employer_factor: n(v.employer_factor) || 1.3, crit_pct: n(v.crit_pct) || 15, vat_pct: n(v.vat_pct), overhead_pct: n(v.overhead_pct),
      work_days_month: n(v.work_days_month) || 22, day_hours: n(v.day_hours) || 9, quota_warn_pct: n(v.quota_warn_pct) || 80, quota_gap_pct: n(v.quota_gap_pct) || 10,
      cash_opening: n(v.cash_opening), cash_asof: v.cash_asof || '', cash_min: n(v.cash_min), alert_email_on: !!v.alert_email_on, alert_emails: String(v.alert_emails || '').trim(), digest: v.digest || 'off', alert_links: !!v.alert_links, supplier_terms_days: v.supplier_terms_days === '' ? 60 : Math.round(n(v.supplier_terms_days)), nav_collection: v.nav_collection || 'auto', nav_workers: v.nav_workers || 'auto' };
    await db.update('tenants', id, { settings: ns });
    for (const k of Object.keys(ns)) if (String(ns[k]) !== String(st[k])) await logChange({ entity: 'tenant', entity_id: id, label: 'הגדרות לקוח', field: k, old_value: st[k], new_value: ns[k] });
    await reloadTenants(); toast('ההגדרות נשמרו'); render();
  };
  const ixDlg = async (x = {}) => {
    const last = ser[0];
    const nextM = last ? (() => { const [y, m] = last.month.split('-').map(Number); return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`; })() : new Date(Date.now() - 45 * 864e5).toISOString().slice(0, 7);
    const v = await modal({ title: x.id ? 'עריכת מדד' : 'מדד חודשי חדש', ok: 'שמירה', danger: false,
      body: `<div class="grid g2">${field('חודש המדד', 'month', x.month || nextM, { type: 'month', req: true })}${field('ערך המדד', 'value', x.value ?? '', { type: 'number', req: true, attrs: 'step="0.01" inputmode="decimal"' })}</div>
        ${field('הערה', 'note', x.note || '', { hint: 'למשל: מדד ידוע, או מקור' })}${x.id ? '<label class="chk"><input type="checkbox" name="del"> מחיקת המדד הזה</label>' : ''}`,
      validate: d => (!/^\d{4}-\d{2}$/.test(d.month) && 'חסר חודש') || (!d.del && !(n(d.value) > 0) && 'ערך המדד חייב להיות גדול מ-0') || (!x.id && series.some(s => s.month === d.month) && 'למדד של החודש הזה כבר יש ערך. עורכים את השורה הקיימת') });
    if (!v) return;
    if (v.del) { await db.remove('index_series', x.id); await logChange({ entity: 'tenant', entity_id: id, label: 'מדד תשומות הבנייה', field: x.month, old_value: x.value, new_value: 'נמחק' }); }
    else if (x.id) { await db.update('index_series', x.id, { month: v.month, value: n(v.value), note: v.note || null }); if (n(v.value) !== Number(x.value)) await logChange({ entity: 'tenant', entity_id: id, label: 'מדד תשומות הבנייה', field: v.month, old_value: x.value, new_value: n(v.value) }); }
    else await db.insert('index_series', { tenant_id: id, month: v.month, value: n(v.value), note: v.note || null });
    toast('המדד נשמר'); render();
  };
  $('#addix', el)?.addEventListener('click', () => ixDlg());
  $$('[data-ix]', el).forEach(b => b.onclick = () => ixDlg(series.find(x => x.id === b.dataset.ix)));
  const memberDlg = async (m = {}) => {
    const pids = (m.pids || '').split(',').filter(Boolean);
    const v = await modal({ title: m.email ? 'עריכת משתמש' : 'הזמנת משתמש', body: `
      ${field('אימייל', 'email', m.email || '', { type: 'email', req: true, attrs: `dir="ltr" ${m.email ? 'readonly' : ''}` })}
      ${select('תפקיד', 'role', { owner: 'בעלים', foreman: 'מנהל עבודה', accountant: 'הנהלת חשבונות', viewer: 'צפייה בלבד' }, m.role || 'owner')}
      <div class="fld"><span>פרויקטים למנהל עבודה</span>${projects.map(p => `<label class="chk"><input type="checkbox" name="p_${p.id}" ${pids.includes(p.id) ? 'checked' : ''}> ${esc(p.name)}</label>`).join('') || '<span class="mut small">אין פרויקטים</span>'}</div>`,
      validate: d => !/^\S+@\S+\.\S+$/.test(d.email) && 'אימייל לא תקין' });
    if (!v) return;
    if (isMe(v.email) && v.role !== m.role && !(await confirmBox('שינוי התפקיד שלך', `זה המשתמש שלך. אחרי השמירה תהיה ${roleName(v.role)} בלקוח הזה, ויכול להיות שלא תוכל לשנות את זה בחזרה. להמשיך?`, 'כן, לשנות', true))) return;
    const chosen = projects.filter(p => v['p_' + p.id]).map(p => p.id);
    const r = await db.rpc('add_member', { t: id, member_email: v.email.trim(), member_role: v.role, member_projects: v.role === 'foreman' ? chosen : [] });
    if (r === 'not_registered') return toast('המשתמש עוד לא נרשם. צריך להריץ את schema.sql של חבילה 20 כדי לשלוח הזמנה.', 'bad');
    if (r === 'invited') { await sendInvite(v.email.trim(), v.role); return render(); }
    toast('המשתמש נשמר');
    if (!m.email) await sendInvite(v.email.trim(), v.role, true);
    render();
  };
  const isMe = e => !!S.user?.email && String(e || '').trim().toLowerCase() === S.user.email.toLowerCase();
  // מייל הזמנה מה-Gmail של מי שמחובר, עם קישור שממלא את האימייל במסך הכניסה
  const sendInvite = async (email, role, existing = false) => {
    const link = `${location.origin}${location.pathname}?invite=${encodeURIComponent(email)}`;
    const text = existing ? `שלום,\n\nקיבלת גישה למערכת "גרושר · בקרת עלויות ותזרים" של ${t.name}, בתפקיד ${roleName(role)}.\n\nלכניסה: ${link}\nנכנסים עם האימייל והסיסמה שלך. בטלפון אפשר לשמור את הקישור במסך הבית ולפתוח אותו כמו אפליקציה.\n\nבברכה,\n${S.user?.email || ''}\nגרושר פרויקטים בע"מ` : `שלום,\n\nהוזמנת למערכת "גרושר · בקרת עלויות ותזרים" של ${t.name}, בתפקיד ${roleName(role)}.\n\nלהצטרפות:\n1. לפתוח את הקישור: ${link}\n2. לבחור סיסמה וללחוץ "הרשמה".\n3. לאשר את המייל שיגיע לתיבה שלך.\n4. להיכנס עם האימייל והסיסמה. הגישה ללקוח נפתחת לבד.\n\nבברכה,\n${S.user?.email || ''}\nגרושר פרויקטים בע"מ`;
    window.__LAST_INVITE__ = { email, link, text }; // לבדיקות
    const subject = existing ? `קישור למערכת גרושר · ${t.name}` : `הזמנה למערכת גרושר · ${t.name}`;
    // חלון אחד עם כמה דרכים לשלוח: Gmail ישיר (אם מחובר), וואטסאפ, תוכנת המייל, או העתקת הקישור
    let how = null;
    await modal({ title: existing ? 'שליחת קישור למערכת' : 'שליחת הזמנה', ok: null, cancel: 'סגירה', body: `<p class="small">${existing ? `ל-<b dir="ltr">${esc(email)}</b> יש גישה ללקוח, בתפקיד ${esc(roleName(role))}. הוא נכנס עם האימייל והסיסמה שלו.` : `ההזמנה ל-<b dir="ltr">${esc(email)}</b> נשמרה. ברגע שיירשם עם האימייל הזה הוא ייכנס לבד ללקוח, בתפקיד ${esc(roleName(role))}.`}</p>
      <p class="small mut">נשאר לשלוח לו את הקישור. בוחרים איך:</p>
      <div class="actions" style="flex-wrap:wrap;gap:8px">
        ${googleConfigured() ? '<button type="button" class="btn" data-how="gmail">✉ שליחה מה-Gmail</button>' : ''}
        <a class="btn ghost" id="invwa" target="_blank" rel="noopener" href="${esc(waLink('', text))}">וואטסאפ</a>
        <a class="btn ghost" id="invml" href="${esc(mailLink([email], subject, text))}">תוכנת המייל</a>
        <button type="button" class="btn ghost" data-how="copy">העתקת הקישור</button></div>
      <label class="fld" style="margin-top:10px"><span>הקישור</span><input readonly dir="ltr" value="${esc(link)}" id="invlink"></label>`,
      onMount: (d, close) => {
        d.querySelectorAll('[data-how]').forEach(b => b.onclick = async () => {
          if (b.dataset.how === 'copy') { try { await navigator.clipboard.writeText(link); } catch { d.querySelector('#invlink').select(); } toast('הקישור הועתק'); how = 'copy'; return; }
          how = 'gmail'; close(null);
        });
        ['#invwa', '#invml'].forEach(s => d.querySelector(s)?.addEventListener('click', () => { how = 'link'; logSend({ channel: s === '#invwa' ? 'whatsapp' : 'email', kind: 'invite', recipients: email, subject, body: text }); }));
      } });
    if (how === 'gmail') { const ok = await composeMail({ log: { kind: 'invite' }, title: 'שליחת הזמנה', to: [email], subject, text }); toast(ok ? 'ההזמנה נשלחה' : 'ההזמנה נשמרה בלי מייל'); }
  };
  $$('[data-resend]', el).forEach(b => b.onclick = () => { const i = invites.find(x => x.id === b.dataset.resend); sendInvite(i.email, i.role); });
  $$('[data-uninv]', el).forEach(b => b.onclick = async () => { const i = invites.find(x => x.id === b.dataset.uninv);
    if (await confirmBox('ביטול הזמנה', `${i.email} לא יצטרף ללקוח גם אם יירשם.`, 'ביטול ההזמנה', true)) { await db.remove('member_invites', i.id); toast('ההזמנה בוטלה'); render(); } });
  wireTemplatesCard(el, tpls, render);
  wireContactPickers($('#tf', el));
  $('#closem', el)?.addEventListener('click', async () => {
    const [ex, inc] = await Promise.all([db.select('expenses', { eq: { tenant_id: id } }), db.select('dev_income', { eq: { tenant_id: id } }).catch(() => [])]);
    const end = nextM, inM = d => d && String(d).slice(0, 7) === end, upto = d => d && String(d).slice(0, 7) <= end;
    const open = ex.filter(e => inM(e.doc_date) && e.status === 'invoice').length;
    if (!(await confirmBox(`סגירת ${mLabel(end)}`, `אחרי הסגירה ההוצאות, התקבולים ויומן העבודה של ${mLabel(end)} ושל החודשים שלפניו נעולים. תיקונים יירשמו כשורות תיקון בחודש פתוח.${open ? ` שים לב: ${open} חשבוניות מהחודש עוד לא אושרו (אפשר לאשר ולשלם גם אחרי הסגירה).` : ''}`, 'סגירת החודש'))) return;
    const snapshot = Object.fromEntries(projects.map(p => [p.id, { name: p.name, month_cost: ex.filter(e => e.project_id === p.id && inM(e.doc_date)).reduce((a, e) => a + n(e.amount), 0),
      cost_to_date: ex.filter(e => e.project_id === p.id && upto(e.doc_date)).reduce((a, e) => a + n(e.amount), 0),
      income_to_date: inc.filter(i => i.project_id === p.id && i.status === 'received' && upto(i.received_date)).reduce((a, i) => a + n(i.received_amount ?? i.amount), 0) }]));
    await db.insert('month_closes', { tenant_id: id, month: end, snapshot, closed_by: S.user?.email || '', closed_at: new Date().toISOString() });
    await logChange({ entity: 'tenant', entity_id: id, label: 'סגירת חודש', field: end, new_value: 'נסגר' });
    toast(`${mLabel(end)} נסגר`); render();
  });
  $('#reopen', el)?.addEventListener('click', async () => {
    const c = closes.find(x => x.month === through);
    if (!(await confirmBox(`פתיחה מחדש של ${mLabel(through)}`, 'החודש ייפתח לעריכה. הפתיחה נרשמת ביומן השינויים. כדאי לסגור אותו שוב אחרי התיקון.', 'פתיחה מחדש', true))) return;
    await db.remove('month_closes', c.id);
    await logChange({ entity: 'tenant', entity_id: id, label: 'סגירת חודש', field: through, old_value: 'נסגר', new_value: 'נפתח מחדש' });
    toast('החודש נפתח'); render();
  });
  $('#addm', el).onclick = () => memberDlg();
  $$('[data-em]', el).forEach(b => b.onclick = () => memberDlg({ email: b.dataset.em, role: b.dataset.role, pids: b.dataset.pids }));
  $$('[data-link]', el).forEach(b => b.onclick = () => sendInvite(b.dataset.link, b.dataset.role, true));
  $$('[data-rm]', el).forEach(b => b.onclick = async () => { if (await confirmBox('הסרת משתמש', isMe(b.dataset.rme) ? 'זה המשתמש שלך. אחרי ההסרה לא תוכל להיכנס יותר ללקוח הזה. להסיר?' : 'המשתמש לא יוכל לראות יותר את נתוני הלקוח.', 'הסרה', true)) { await db.rpc('remove_member', { id: b.dataset.rm }); render(); } });
  const mcDlg = async (m = {}) => {
    const row = await mcModal(m);
    if (!row) return;
    if (m.id) await db.update('main_contractors', m.id, row); else await db.insert('main_contractors', { tenant_id: id, ...row });
    toast('נשמר'); render();
  };
  $('#addmc', el).onclick = () => mcDlg();
  $$('[data-mc]', el).forEach(b => b.onclick = () => mcDlg(mcs.find(m => m.id === b.dataset.mc)));
  $('#del', el)?.addEventListener('click', async () => {
    const v = await modal({ title: 'מחיקת לקוח', body: `<p>כדי לאשר, כתוב את שם הלקוח: <b>${esc(t.name)}</b></p>${field('שם הלקוח', 'confirm', '')}`, ok: 'מחיקה לצמיתות', danger: true, validate: d => d.confirm.trim() !== t.name.trim() && 'השם לא תואם' });
    if (!v) return;
    await db.remove('tenants', id); await reloadTenants(); toast('הלקוח נמחק'); location.hash = '#/clients';
  });
  return el;
}

export const mcForm = (m = {}, contacts = []) => `<div class="grid g2">${field('שם', 'name', m.name, { req: true })}${field('ח"פ', 'company_no', m.company_no)}
  ${contactPicker('איש קשר', 'contact_id', contacts.find(c => c.id === m.contact_id))}${field('תנאי תשלום (שוטף + ימים)', 'pay_terms_days', m.pay_terms_days ?? 60, { type: 'number' })}</div>`;
/** חלון קבלן ראשי / מזמין: מחזיר שורה לשמירה (עם העתק פרטי איש הקשר) או null */
export async function mcModal(m = {}, title = null) {
  const contacts = await loadContacts();
  const v = await modal({ title: title || (m.id ? 'עריכת קבלן ראשי / מזמין' : 'קבלן ראשי / מזמין חדש'), body: mcForm(m, contacts), onMount: el => wireContactPickers(el), validate: d => !d.name.trim() && 'חסר שם' });
  if (!v) return null;
  const c = (await loadContacts()).find(x => x.id === v.contact_id);
  return { name: v.name.trim(), company_no: v.company_no || null, pay_terms_days: Math.round(n(v.pay_terms_days)), contact_id: c?.id || null, ...cardFields(c) };
}
