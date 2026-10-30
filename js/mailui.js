// שליחת מייל ישירה מהמערכת (מה-Gmail המחובר), בלי לפתוח תוכנת דואר. חלון אחד: נמענים, נושא, הודעה, קבצים מצורפים.
import { esc, modal, field, toast } from './util.js';
import { gconf, gConnect, gReady, gEnabled, gmailSend } from './google.js';
import { logSend } from './sendlog.js';

const EMAIL = /^\S+@\S+\.\S+$/;
export const splitEmails = s => String(s || '').split(/[\s,;]+/).map(x => x.trim()).filter(Boolean);
export const textHtml = t => `<div dir="rtl" style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.55;color:#13284b">${esc(t).replace(/\*([^*\n]+)\*/g, '<b>$1</b>').replace(/\n/g, '<br>')}</div>`;
export const googleConfigured = () => !!(gconf().clientId || window.__GOOGLE_MOCK__);

/**
 * חלון שליחה. to/cc: מערכים. text: נוסח שאפשר לערוך. html: תוכן נוסף שמצורף מתחת לנוסח (למשל טבלה).
 * attachments: [{ name, blob }]. מחזיר { to } אחרי שליחה, או null.
 */
export async function composeMail({ title = 'שליחה במייל', to = [], cc = [], subject = '', text = '', html = '', attachments = [], note = '', log = {} } = {}) {
  if (!googleConfigured()) {
    await modal({ title, ok: null, cancel: 'סגירה', body: `<p>שליחה ישירה מהמערכת עובדת דרך חשבון ה-Google שלך (Gmail). החיבור עוד לא הוגדר.</p>
      <p class="small mut">מגדירים פעם אחת במסך <a href="#/settings">תצוגה ומצב</a> ← Google Drive ו-Gmail.</p>` });
    return null;
  }
  let sent = null;
  await modal({ title, wide: true, ok: 'שליחה', body: `${note ? `<p class="small mut">${note}</p>` : ''}
    ${field('אל (אפשר כמה, מופרדים בפסיק)', 'to', to.join(', '), { req: true, attrs: 'dir="ltr" inputmode="email"' })}
    ${field('עותק (לא חובה)', 'cc', cc.join(', '), { attrs: 'dir="ltr" inputmode="email"' })}
    ${field('נושא', 'subject', subject, { req: true })}
    <label class="fld"><span>הודעה</span><textarea name="text" rows="8">${esc(text)}</textarea></label>
    ${attachments.length ? `<p class="small">📎 מצורף: ${attachments.map(a => `<b>${esc(a.name)}</b>`).join(', ')}</p>` : ''}
    ${html ? `<details class="small"><summary>מה עוד נכלל במייל</summary><div class="mailpv">${html}</div></details>` : ''}
    <p class="small mut">נשלח מה-Gmail שלך${gReady() ? '' : ' (יתבקש חיבור ל-Google)'}. עותק נשמר אצלך בדואר היוצא.</p>`,
  validate: async d => {
    const T = splitEmails(d.to), C = splitEmails(d.cc);
    if (!T.length) return 'חסרה כתובת מייל';
    const bad = [...T, ...C].find(x => !EMAIL.test(x)); if (bad) return `כתובת לא תקינה: ${bad}`;
    if (!d.subject.trim()) return 'חסר נושא';
    try {
      if (!gEnabled() || !gReady()) await gConnect();
      await gmailSend({ to: T, cc: C, subject: d.subject.trim(), html: textHtml(d.text) + (html ? `<div style="margin-top:14px">${html}</div>` : ''), attachments });
    } catch (e) { return e.message || 'השליחה נכשלה'; }
    sent = { to: T, cc: C, subject: d.subject.trim(), text: d.text };
    if (log) await logSend({ ...log, channel: 'email', recipients: [...T, ...C], subject: sent.subject, body: d.text, html, attachments });
    return null;
  } });
  if (sent) toast(`המייל נשלח ל-${sent.to.join(', ')}`);
  return sent;
}
