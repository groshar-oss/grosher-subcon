// התרעות ללקוח: החלטה נדרשת, מצב (פתוח / בטיפול / טופל), שליחה מיידית בוואטסאפ ובמייל, וסיכום תקופתי.
// כל מה שיוצא ללקוח יוצא בלי קישור למערכת: הלקוח מקבל את התוצר, לא את המערכת.
import { db } from './db.js';
import { S, tenant, settings, logChange } from './app.js';
import { esc, modal, field, area, select, toast, WA_ICON, MAIL_ICON } from './util.js';
import { composeMail } from './mailui.js';
import { actKey, recipients } from './alerts.js';
import { gReady, gEnabled, gmailSend } from './google.js';

export const ALERT_STATUS = { open: 'פתוח', in_progress: 'בטיפול', handled: 'טופל' };
const DECISIONS = {
  commit_over_budget: 'לאשר את החריגה בהתקשרות, או לחפש חיסכון בסעיף אחר',
  forecast_over_budget: 'לאשר תוספת תקציב, או לצמצם היקף / להחליף פתרון',
  over_baseline: 'לאשר עדכון של בסיס התקציב, או להחזיר את הסעיף לסכום המאושר',
  outside_budget: 'לשייך את העבודה לסעיף תקציב, או לאשר תוספת תקציב',
  invoiced_over_contract: 'לעצור תשלום מעבר להתקשרות עד אישור הוראת שינוי',
  expense_no_item: 'לשייך את ההוצאות לסעיפי התקציב',
  vendor_no_contract: 'להסדיר התקשרות חתומה עם הספק לפני תשלום נוסף',
  total_over_baseline: 'לאשר את הצפי המעודכן, או להחליט על צעדי חיסכון',
  co_exec_unapproved: 'לאשר בכתב את השינוי ואת מחירו, או לדחות אותו ולא לשלם עליו',
  co_not_billed: 'לברר עם הקבלן מתי יגיש, ולשריין את הסכום בתזרים',
  co_over_billed: 'לעצור את החיוב העודף בחשבון הקבלן',
  co_needs_analysis: 'לאשר את ניתוח המחיר, או לבקש הצעות נוספות',
  co_no_doc: 'להשיג אישור חתום ולצרף אותו',
  co_signoff_wait: 'לשלוח ליזם תזכורת לחתום על הוראת השינוי',
  co_signoff_expired: 'לשלוח ליזם קישור חדש לאישור',
  co_signoff_rejected: 'לסגור את הוראת השינוי כנדחתה, או לתקן ולשלוח שוב לאישור',
  co_changed_after_signoff: 'לשלוח את הוראת השינוי המעודכנת לאישור היזם מחדש',
  cbill_open: 'לבדוק את החשבון מול החוזה והמדידה ולהמליץ על סכום',
  cbill_recommended: 'לאשר את התשלום המומלץ',
  cash_out_over_in: 'להקדים גבייה מרוכשים או משיכה מהבנק, או לדחות תשלומים',
  cash_below_min: 'להחליט על מקור מימון: משיכה מהבנק, הון עצמי או דחיית תשלומים',
  income_overdue: 'לפנות לרוכש ולגבות את התשלום',
  baseline_missing: 'לאשר את התקציב ולנעול אותו כבסיס'
};
export const defaultDecision = a => a.decision || DECISIONS[a.dtype] || 'לבדוק ולהחליט על המשך הטיפול';
export const projectIdOf = a => a.pid || (/#\/project\/([^/]+)/.exec(a.href || '')?.[1] ?? null);
export const stateMap = list => new Map((list || []).map(s => [s.key, s]));
const clean = s => String(s || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

// טקסט ללקוח (וואטסאפ / מייל): בלי קישור למערכת
// שם הפרויקט של כל התרעה (ללקוח עם כמה פרויקטים במקביל). המסך הראשי שומר את הרשימה
let PN = {};
export const rememberProjects = list => { for (const p of list || []) PN[p.id] = p.name; };
export const projectNameOf = a => PN[projectIdOf(a)] || a.projectName || '';
// התרעה בלי פרויקט אחד (תזרים מרוכז, מסמכים כלליים): כתוב שזה על כל הפרויקטים
const scopeOf = a => projectNameOf(a) || (Object.keys(PN).length > 1 ? 'כל הפרויקטים (מרוכז)' : Object.values(PN)[0] || '');

export function alertText(a, st) {
  const amt = clean(a.amt), pn = scopeOf(a);
  return [`*${clean(a.title)}*`, pn ? `פרויקט: ${pn}` : '', clean(a.sub), amt ? `סכום: ${amt}` : '', `החלטה נדרשת: ${st?.decision || defaultDecision(a)}`, st && st.status !== 'open' ? `מצב: ${ALERT_STATUS[st.status]}` : '', '', 'גרושר פרויקטים בע"מ']
    .filter((x, i) => x || i === 6).join('\n');
}
export const phoneIntl = p => { const d = String(p || '').replace(/\D/g, ''); return !d ? '' : d.startsWith('972') ? d : d.startsWith('0') ? '972' + d.slice(1) : d; };
export const waLink = (phone, text) => `https://wa.me/${phoneIntl(phone)}?text=${encodeURIComponent(String(text).replace(/&#34;|&quot;/g, '"').replace(/(\p{L})"(\p{L})/gu, '$1״$2'))}`;
export const emailsOf = s => String(s || '').split(/[\s,;]+/).map(x => x.trim()).filter(x => /^\S+@\S+\.\S+$/.test(x));
export const mailLink = (to, subject, body) => `mailto:${to.map(encodeURIComponent).join(',')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body.replace(/\*/g, ''))}`;

// נמענים: של הפרויקט, ואם אין, של הלקוח
export function targetsFor(a, projects) {
  const p = (projects || []).find(x => x.id === projectIdOf(a));
  const emails = emailsOf(p?.notify_emails);
  return { project: p || null, phone: p?.notify_phone || '', name: p?.notify_name || '', emails: emails.length ? emails : recipients() };
}

// שורת התרעה עם מצב, החלטה וכפתורים
export function actionRow(a, st, i, { canEdit = true } = {}) {
  const s = st?.status || 'open';
  return `<div class="act actx ${s === 'handled' ? 'dim' : ''}" data-ai="${i}"><span class="dot" style="background:${a.color}"></span>
    <a href="${a.href}" class="atxt"><b>${esc(a.title)}</b><small>${esc(a.sub)}</small><small class="dec">החלטה נדרשת: ${esc(st?.decision || defaultDecision(a))}</small></a>
    <div class="aside"><span class="amt">${a.amt || ''}</span><div class="abtn">${s !== 'open' ? `<span class="chip ${s === 'handled' ? 'green' : 'blue'}">${ALERT_STATUS[s]}</span>` : ''}
      <button type="button" class="btn small ghost" data-wa="${i}" title="שליחה בוואטסאפ" aria-label="שליחה בוואטסאפ">${WA_ICON}</button><button type="button" class="btn small ghost" data-ml="${i}" title="שליחה במייל" aria-label="שליחה במייל">${MAIL_ICON}</button>${canEdit ? `<button type="button" class="btn small ghost" data-ed="${i}" title="החלטה ומצב" aria-label="החלטה ומצב">✎</button>` : ''}</div></div></div>`;
}

export async function saveState(a, patch, states) {
  const key = actKey(a), ex = states.get(key);
  const row = { ...patch, title: clean(a.title), updated_by: S.user?.email || '', updated_at: new Date().toISOString() };
  const saved = ex ? await db.update('alert_state', ex.id, row) : (await db.insert('alert_state', { tenant_id: S.tenantId, project_id: projectIdOf(a), key, status: 'open', ...row }))[0];
  states.set(key, saved);
  return saved;
}

export async function editAlert(a, states) {
  const st = states.get(actKey(a));
  const v = await modal({ title: 'החלטה ומצב', body: `<p><b>${esc(a.title)}</b><br><span class="small mut">${esc(a.sub)}</span></p>
    ${area('החלטה נדרשת (הנוסח שיישלח ללקוח)', 'decision', st?.decision || defaultDecision(a))}
    <div class="grid g2">${select('מצב', 'status', ALERT_STATUS, st?.status || 'open')}${field('הערה פנימית', 'note', st?.note || '')}</div>
    <p class="small mut">"טופל" מסתיר את ההתרעה מהרשימה. אם המצב משתנה (למשל חריגה גדלה), ההתרעה חוזרת כחדשה.</p>`, ok: 'שמירה' });
  if (!v) return null;
  const saved = await saveState(a, { decision: v.decision.trim() || null, status: v.status, note: v.note || null }, states);
  if (!st || st.status !== v.status) await logChange({ project_id: projectIdOf(a), entity: 'alert', label: clean(a.title), field: 'מצב התרעה', old_value: ALERT_STATUS[st?.status || 'open'], new_value: ALERT_STATUS[v.status], reason: v.note || null });
  return saved;
}

// שליחה מיידית: וואטסאפ נפתח עם הנוסח; מייל נשלח ישירות מה-Gmail המחובר (חלון עם נמענים ונוסח לעריכה). מסמן "בטיפול" אם היה פתוח
export async function sendOne(a, how, states, projects) {
  const st = states.get(actKey(a)), tg = targetsFor(a, projects);
  rememberProjects(projects);
  const text = alertText(a, st);
  const subject = `${clean(a.title)} · ${tg.project?.name || tenant()?.name || ''}`;
  if (how === 'wa') {
    const url = waLink(tg.phone, text);
    window.__LAST_SEND__ = { how, url, text }; // לבדיקות
    window.open(url, '_blank', 'noopener');
  } else {
    window.__LAST_SEND__ = { how, to: tg.emails, subject, text };
    const r = await composeMail({ title: 'שליחת התרעה במייל', to: tg.emails, subject, text, note: tg.emails.length ? '' : 'אין נמענים שמורים לפרויקט. מוסיפים בהגדרות הפרויקט או הלקוח, או כותבים כאן.' });
    if (!r) return false;
    tg.emails = r.to;
  }
  if (!st || st.status === 'open') await saveState(a, { status: 'in_progress', decision: st?.decision || defaultDecision(a) }, states).catch(() => {});
  await logChange({ project_id: projectIdOf(a), entity: 'alert', label: clean(a.title), field: how === 'wa' ? 'נשלח בוואטסאפ' : 'נשלח במייל', new_value: how === 'wa' ? (tg.name || tg.phone || 'בחירת איש קשר') : tg.emails.join(', ') }).catch(() => {});
  return true;
}

// ===== סיכום תקופתי =====
export const digestKey = (freq, d = new Date()) => {
  if (freq === 'daily') return 'digest|' + d.toISOString().slice(0, 10);
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); const day = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - day);
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1)); return `digest|${t.getUTCFullYear()}-W${String(Math.ceil(((t - y0) / 864e5 + 1) / 7)).padStart(2, '0')}`;
};
export function digestList(actions, states) {
  return actions.map(a => ({ a, st: states.get(actKey(a)) })).filter(x => x.st?.status !== 'handled');
}
export function digestHtml(list, name, freq) {
  const red = list.filter(x => x.a.sev === 'red' || x.a.color === 'var(--ri)').length;
  const rows = list.map(({ a, st }) => `<tr><td style="padding:8px 10px;border-bottom:1px solid #e5e8ef;width:6px;background:${a.color && a.color.startsWith('#') ? a.color : '#c62828'}"></td>
    <td style="padding:8px 10px;border-bottom:1px solid #e5e8ef"><b>${esc(clean(a.title))}</b>${scopeOf(a) ? `<div style="font-size:13px"><b>פרויקט:</b> ${esc(scopeOf(a))}</div>` : ''}<div style="color:#5b6577;font-size:13px">${esc(clean(a.sub))}</div>
    <div style="font-size:13px;margin-top:3px"><b>החלטה נדרשת:</b> ${esc(st?.decision || defaultDecision(a))}</div></td>
    <td style="padding:8px 10px;border-bottom:1px solid #e5e8ef;white-space:nowrap">${ALERT_STATUS[st?.status || 'open']}</td>
    <td style="padding:8px 10px;border-bottom:1px solid #e5e8ef;white-space:nowrap;direction:ltr;text-align:left">${esc(clean(a.amt))}</td></tr>`).join('');
  return `<div dir="rtl" style="font-family:Arial,Helvetica,sans-serif;color:#13284b;max-width:720px">
    <h2 style="margin:0 0 4px">סיכום ${freq === 'daily' ? 'יומי' : 'שבועי'} · ${esc(name)}</h2>
    <p style="margin:0 0 12px;color:#5b6577">${list.length} נושאים פתוחים${red ? `, מהם ${red} דחופים` : ''}. סכומים לפני מע"מ, אלא אם צוין אחרת.</p>
    <table cellspacing="0" cellpadding="0" style="border-collapse:collapse;width:100%;border:1px solid #e5e8ef"><tr style="background:#f3f5fa"><th></th><th style="padding:6px 10px;text-align:right">נושא</th><th style="padding:6px 10px;text-align:right">מצב</th><th style="padding:6px 10px;text-align:left">סכום</th></tr>${rows}</table>
    <p style="color:#8a93a3;font-size:12px;margin-top:16px">גרושר פרויקטים בע"מ · בקרת עלויות ותזרים</p></div>`;
}
export const digestText = (list, name, freq) => [`*סיכום ${freq === 'daily' ? 'יומי' : 'שבועי'} · ${name}*`, `${list.length} נושאים פתוחים`, '',
  ...list.map(({ a, st }, i) => `${i + 1}. ${clean(a.title)}${clean(a.amt) ? ' · ' + clean(a.amt) : ''}${scopeOf(a) ? `\n   פרויקט: ${scopeOf(a)}` : ''}\n   ${clean(a.sub)}\n   החלטה נדרשת: ${st?.decision || defaultDecision(a)}${st && st.status !== 'open' ? ` (${ALERT_STATUS[st.status]})` : ''}`), '', 'גרושר פרויקטים בע"מ'].join('\n');

// שליחה אוטומטית של הסיכום פעם ביום / בשבוע (מה-Gmail המחובר), נרשם ב-alert_log כדי לא לשלוח פעמיים
export async function maybeSendDigest(actions, states, { force = false } = {}) {
  const st = settings(), freq = st.digest || 'off';
  if (freq === 'off' && !force) return { skipped: 'off' };
  const to = recipients(st); if (!to.length) return { skipped: 'no_recipients' };
  if (!gEnabled() || !gReady()) return { skipped: 'google' };
  const key = digestKey(freq === 'off' ? 'weekly' : freq);
  if (!force) { const log = await db.select('alert_log', { eq: { tenant_id: S.tenantId, key } }); if (log.length) return { skipped: 'sent' }; }
  const list = digestList(actions, states); if (!list.length) return { sent: 0 };
  const name = tenant()?.name || '';
  await gmailSend({ to, subject: `גרושר · סיכום ${freq === 'daily' ? 'יומי' : 'שבועי'} · ${name}`, html: digestHtml(list, name, freq === 'daily' ? 'daily' : 'weekly') });
  await db.insert('alert_log', { tenant_id: S.tenantId, key: key + (force ? '|' + Date.now() : ''), title: 'סיכום התרעות', sent_to: to.join(', '), sent_at: new Date().toISOString() }).catch(() => {});
  return { sent: list.length, to };
}
