// חיבור ל-Google מהדפדפן: שמירת עותק של כל קובץ וגיבוי נתונים ב-Drive, ושליחת מיילים מה-Gmail של המשתמשת.
// הרשאות מצומצמות: drive.file (רק קבצים שהמערכת יצרה) ו-gmail.send (שליחה בלבד, בלי קריאת דואר).
// הטוקן נשמר רק בלשונית הזו (sessionStorage) ופג אחרי שעה. אין שרת ואין מפתח סודי.
import { CONFIG } from './config.js';
import { store } from './util.js';

const K = 'subcon-google';
const SCOPE = 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/gmail.send';
const DAPI = 'https://www.googleapis.com/drive/v3/', DUP = 'https://www.googleapis.com/upload/drive/v3/', FOLDER = 'application/vnd.google-apps.folder';

// מזהה שהוגדר בקובץ ההגדרות של האתר גובר על מה שנשמר בדפדפן, כדי שיעבוד אותו דבר בכל טלפון ומחשב
export const gconf = () => { const s = store(K) || {}; return { rootName: 'גרושר - בקרת עלויות ותזרים', enabled: false, folders: {}, lastSync: 0, lastErr: '', ...s, clientId: CONFIG.googleClientId || s.clientId || '' }; };
const save = c => store(K, c);
export function setGconf(patch) { const c = { ...gconf(), ...patch }; save(c); return c; }

let tok = null;
try { tok = JSON.parse(sessionStorage.getItem(K + '-t') || 'null'); } catch { tok = null; }
const mock = () => window.__GOOGLE_MOCK__;
export const gReady = () => !!(mock() || (tok && tok.exp > Date.now()));
export const gEnabled = () => !!(mock() || gconf().enabled);

function loadScript(src) {
  return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('לא הצלחנו לטעון את רכיב ההתחברות של Google')); document.head.appendChild(s); });
}

// התחברות (חייבת לקרות מלחיצה של המשתמשת, כי Google פותח חלון)
export async function gConnect() {
  if (mock()) return true;
  const c = gconf();
  if (!c.clientId) throw new Error('חסר מזהה OAuth Client ID של Google. מזינים אותו במסך "תצוגה ומצב"');
  if (location.protocol === 'file:') throw new Error('ההתחברות ל-Google עובדת רק מכתובת אינטרנט (https)');
  if (!(window.google && google.accounts && google.accounts.oauth2)) await loadScript('https://accounts.google.com/gsi/client');
  await new Promise((res, rej) => {
    const tc = google.accounts.oauth2.initTokenClient({ client_id: c.clientId, scope: SCOPE,
      callback: r => { if (r.error) return rej(new Error(r.error_description || r.error));
        if (!google.accounts.oauth2.hasGrantedAllScopes(r, ...SCOPE.split(' '))) return rej(new Error('צריך לאשר גם את Drive וגם את שליחת המיילים'));
        tok = { t: r.access_token, exp: Date.now() + ((Number(r.expires_in) || 3600) - 60) * 1000 }; sessionStorage.setItem(K + '-t', JSON.stringify(tok)); res(); },
      error_callback: e => rej(new Error(e?.type === 'popup_closed' ? 'חלון ההתחברות נסגר' : e?.message || 'ההתחברות נכשלה')) });
    tc.requestAccessToken({ prompt: c.enabled ? '' : 'consent' });
  });
  setGconf({ enabled: true, lastErr: '' });
  return true;
}
export function gDisconnect() { tok = null; sessionStorage.removeItem(K + '-t'); setGconf({ enabled: false }); }

async function gfetch(url, opt = {}) {
  if (mock()) return mock().fetch(url, opt);
  if (!gReady()) throw Object.assign(new Error('צריך להתחבר ל-Google'), { auth: true });
  const r = await fetch(url, { ...opt, headers: { ...(opt.headers || {}), Authorization: 'Bearer ' + tok.t } });
  if (r.status === 401) { tok = null; sessionStorage.removeItem(K + '-t'); throw Object.assign(new Error('החיבור ל-Google פג. צריך להתחבר שוב'), { auth: true }); }
  if (!r.ok) { let m = ''; try { m = (await r.json()).error?.message || ''; } catch { /* */ } throw new Error(`Google ${r.status}${m ? ': ' + m : ''}`); }
  return r.status === 204 ? null : r.json();
}

const qesc = s => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
const clean = s => String(s || '').replace(/[\\/:*?"<>|]+/g, '-').trim().slice(0, 120) || 'ללא שם';

// תיקייה לפי נתיב שמות (נוצרת אם חסרה), עם מטמון מזהים
export async function folderPath(names) {
  const c = gconf(); const cache = c.folders || {};
  let parent = 'root', key = '';
  for (const raw of [c.rootName, ...names]) {
    const name = clean(raw); key += '/' + name;
    if (cache[key]) { parent = cache[key]; continue; }
    const q = `name='${qesc(name)}' and mimeType='${FOLDER}' and '${parent}' in parents and trashed=false`;
    const found = await gfetch(DAPI + 'files?fields=files(id)&q=' + encodeURIComponent(q));
    const id = found?.files?.[0]?.id || (await gfetch(DAPI + 'files?fields=id', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, mimeType: FOLDER, parents: [parent] }) })).id;
    cache[key] = id; parent = id;
  }
  setGconf({ folders: cache });
  return parent;
}

// העלאה (או החלפה כשיש fileId)
export async function driveUpload(blob, { name, folder, fileId, description } = {}) {
  const meta = fileId ? { name: clean(name) } : { name: clean(name), parents: [folder], description };
  const fd = new FormData();
  fd.append('metadata', new Blob([JSON.stringify(meta)], { type: 'application/json' }));
  fd.append('file', blob, clean(name));
  const url = DUP + 'files' + (fileId ? '/' + fileId : '') + '?uploadType=multipart&fields=id,webViewLink';
  return gfetch(url, { method: fileId ? 'PATCH' : 'POST', body: fd });
}

// מייל HTML מה-Gmail של המשתמשת המחוברת
const b64 = s => btoa(unescape(encodeURIComponent(s)));
const wrap76 = s => s.replace(/.{76}/g, '$&\r\n');
export async function gmailSend({ to, cc = [], subject, html, attachments = [] }) {
  const head = [`To: ${[].concat(to).join(', ')}`, ...([].concat(cc).length ? [`Cc: ${[].concat(cc).join(', ')}`] : []), `Subject: =?UTF-8?B?${b64(subject)}?=`, 'MIME-Version: 1.0'];
  let mime;
  if (!attachments.length) mime = [...head, 'Content-Type: text/html; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', wrap76(b64(html))].join('\r\n');
  else {
    // קבצים מצורפים (למשל PDF של הוראת שינוי): multipart/mixed
    const bnd = 'grosher' + Math.random().toString(36).slice(2);
    const parts = [`--${bnd}`, 'Content-Type: text/html; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', wrap76(b64(html))];
    for (const a of attachments) {
      const data = await blobB64(a.blob);
      parts.push(`--${bnd}`, `Content-Type: ${a.type || a.blob.type || 'application/octet-stream'}; name="=?UTF-8?B?${b64(a.name)}?="`, 'Content-Transfer-Encoding: base64',
        `Content-Disposition: attachment; filename="=?UTF-8?B?${b64(a.name)}?="`, '', wrap76(data));
    }
    parts.push(`--${bnd}--`);
    mime = [...head, `Content-Type: multipart/mixed; boundary="${bnd}"`, '', ...parts].join('\r\n');
  }
  const raw = b64(mime).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  window.__LAST_GMAIL__ = { to: [].concat(to), cc: [].concat(cc), subject, html, attachments: attachments.map(a => ({ name: a.name, size: a.blob.size })) }; // לבדיקות
  return gfetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ raw }) });
}
const blobB64 = blob => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1] || ''); r.onerror = () => rej(r.error); r.readAsDataURL(blob); });
