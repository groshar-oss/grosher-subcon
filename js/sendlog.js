// ארכיון שליחות: כל מייל, הודעת וואטסאפ וסיכום שיצאו מהמערכת נרשמים כאן (מה נשלח, למי, מתי ומי שלח)
import { db } from './db.js';
import { S } from './app.js';

export const CHANNELS = { email: 'מייל', whatsapp: 'וואטסאפ', digest: 'סיכום אוטומטי' };
export const SEND_KINDS = { alert: 'התרעה', digest: 'סיכום התרעות', co_approval: 'הוראת שינוי לאישור היזם', co_contractor: 'הוראת שינוי לקבלן', invite: 'הזמנת משתמש', auto_alert: 'התרעה אוטומטית', report: 'דוח', other: 'אחר' };
const strip = h => String(h || '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|tr|h\d|li)>/gi, '\n').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();

/** רישום שליחה. לא מפיל את השליחה אם הרישום נכשל (למשל לפני הרצת schema.sql של חבילה 21) */
export async function logSend({ project_id = null, channel = 'email', kind = 'other', recipients = '', subject = '', body = '', html = '', attachments = [] } = {}) {
  if (!S.tenantId) return;
  try {
    await db.insert('send_log', { tenant_id: S.tenantId, project_id: project_id || null, channel, kind, recipients: Array.isArray(recipients) ? recipients.join(', ') : String(recipients || ''),
      subject: subject || null, body: [body, strip(html)].filter(Boolean).join('\n\n').slice(0, 20000) || null, attachments: attachments.map(a => a.name || a).join(', ') || null,
      sent_by: S.user?.email || '', sent_at: new Date().toISOString() });
  } catch (e) { console.warn('send log', e); }
}
