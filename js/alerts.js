// התראות במייל: כל התראה אדומה חדשה (חריגה, איחור תשלום, מסמך שפג וכו') נשלחת פעם אחת מה-Gmail של המשתמשת המחוברת.
// מה שכבר נשלח נרשם בטבלת alert_log, כדי שלא יישלח שוב. כשחריגה בסעיף מחמירה לדרגה כהה יותר, נשלחת התראה חדשה.
import { db } from './db.js';
import { logSend } from './sendlog.js';
import { S, tenant, settings } from './app.js';
import { gReady, gEnabled, gmailSend } from './google.js';
import { esc } from './util.js';

export const actKey = a => a.key || (a.href + '|' + String(a.title).replace(/\d+ ימים/g, '').replace(/\s+/g, ' ').trim());
export const isRed = a => a.sev ? a.sev === 'red' : a.color === 'var(--ri)';
export const recipients = (st = settings()) => String(st.alert_emails || '').split(/[\s,;]+/).map(s => s.trim()).filter(s => /^\S+@\S+\.\S+$/.test(s));

export async function pendingAlerts(actions) {
  const log = await db.select('alert_log', { eq: { tenant_id: S.tenantId } });
  const sent = new Set(log.map(l => l.key));
  const seen = new Set();
  return actions.filter(isRed).filter(a => { const k = actKey(a); if (sent.has(k) || seen.has(k)) return false; seen.add(k); return true; });
}

// links: קישורים למערכת רק במייל פנימי. ללקוח (ברירת המחדל) המייל יוצא בלי קישור. decisionOf: נוסח "החלטה נדרשת" לכל התרעה
export function alertHtml(list, name, { links = !!settings().alert_links, decisionOf = null } = {}) {
  const base = location.href.split('#')[0];
  const rows = list.map(a => `<tr><td style="padding:8px 10px;border-bottom:1px solid #e5e8ef;width:6px;background:${a.color && a.color.startsWith('#') ? a.color : '#c62828'}"></td>
    <td style="padding:8px 10px;border-bottom:1px solid #e5e8ef">${links ? `<a href="${esc(base + a.href)}" style="color:#13284b;font-weight:bold;text-decoration:none">${esc(a.title)}</a>` : `<b>${esc(a.title)}</b>`}<div style="color:#5b6577;font-size:13px">${esc(a.sub || '')}</div>${decisionOf ? `<div style="font-size:13px;margin-top:3px"><b>החלטה נדרשת:</b> ${esc(decisionOf(a))}</div>` : ''}</td>
    <td style="padding:8px 10px;border-bottom:1px solid #e5e8ef;white-space:nowrap;direction:ltr;text-align:left">${esc(String(a.amt || '').replace(/<[^>]+>/g, ''))}</td></tr>`).join('');
  return `<div dir="rtl" style="font-family:Arial,Helvetica,sans-serif;color:#13284b;max-width:680px">
    <h2 style="margin:0 0 4px">${list.length === 1 ? 'התראה חדשה' : `${list.length} התראות חדשות`} · ${esc(name)}</h2>
    <p style="margin:0 0 12px;color:#5b6577">גרושר פרויקטים · בקרת עלויות ותזרים. סכומים לפני מע"מ.</p>
    <table cellspacing="0" cellpadding="0" style="border-collapse:collapse;width:100%;border:1px solid #e5e8ef">${rows}</table>
    ${links ? `<p style="margin:14px 0 0"><a href="${esc(base)}" style="background:#13284b;color:#fff;padding:9px 16px;border-radius:8px;text-decoration:none">פתיחת המערכת</a></p>` : ''}
    <p style="color:#8a93a3;font-size:12px;margin-top:16px">כל התראה נשלחת פעם אחת. את רשימת הנמענים משנים בהגדרות הלקוח.</p></div>`;
}

// שליחה: רק אם ההתראות במייל פעילות, יש נמענים, ו-Google מחובר בלשונית הזו
export async function sendAlerts(actions, { force = false, decisionOf = null } = {}) {
  const st = settings();
  if (!st.alert_email_on && !force) return { skipped: 'off' };
  const to = recipients(st);
  if (!to.length) return { skipped: 'no_recipients' };
  if (!gEnabled() || !gReady()) return { skipped: 'google' };
  const list = await pendingAlerts(actions);
  if (!list.length) return { sent: 0 };
  const name = tenant()?.name || '';
  const asub = `גרושר · ${list.length === 1 ? list[0].title : list.length + ' התראות חדשות'} · ${name}`, ahtml = alertHtml(list, name, { decisionOf });
  await gmailSend({ to, subject: asub, html: ahtml });
  await logSend({ channel: 'email', kind: 'auto_alert', recipients: to, subject: asub, html: ahtml });
  const now = new Date().toISOString();
  for (const a of list) await db.insert('alert_log', { tenant_id: S.tenantId, key: actKey(a), title: a.title, sent_to: to.join(', '), sent_at: now }).catch(() => {});
  return { sent: list.length, to };
}

let running = false;
export async function maybeSendAlerts(actions, opts = {}) {
  if (running) return null;
  running = true;
  try { return await sendAlerts(actions, opts); } catch (e) { console.warn('alerts', e); return { error: e.message }; } finally { running = false; }
}
