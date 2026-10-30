// דף החתימה של היזם: נפתח מהקישור האישי שבמייל, בלי כניסה למערכת. רואה רק את הבקשה הזאת.
import { db } from './db.js';
import { coSheetHtml } from './cosheet.js';
import { docSheetHtml } from './docsheet.js';
import { sigPad } from './sigpad.js';

const app = document.getElementById('app');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const qs = new URLSearchParams(location.search), token = qs.get('t') || '';
// k=d: חתימה על מסמך כללי (חשבון קבלן / הוראת שינוי מול קבלן ראשי). בלי k: הוראת שינוי ליזם (חבילה 17)
const DOC = qs.get('k') === 'd';
const RPC = DOC ? { get: 'doc_signoff_get', submit: 'doc_signoff_submit' } : { get: 'co_signoff_get', submit: 'co_signoff_submit' };
const KIND = {
  co: { sub: 'אישור הוראת שינוי', what: 'הוראת השינוי', ok: '✓ הוראת השינוי אושרה', no: '✕ הוראת השינוי נדחתה', agree: 'קראתי ואני מאשר/ת את הוראת השינוי בסכומים המפורטים למעלה' },
  cbill: { sub: 'אישור חשבון לתשלום', what: 'החשבון', ok: '✓ החשבון אושר לתשלום', no: '✕ החשבון נדחה', agree: 'בדקתי ואני מאשר/ת את תשלום החשבון בסכום המומלץ למעלה' },
  variation: { sub: 'אישור הוראת שינוי', what: 'הוראת השינוי', ok: '✓ הוראת השינוי אושרה', no: '✕ הוראת השינוי נדחתה', agree: 'קראתי ואני מאשר/ת את הוראת השינוי בכמויות ובסכומים המפורטים למעלה' } };
let K = KIND.co;
const fmtDT = d => d ? new Date(d).toLocaleString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
const msg = (t, sub = '') => { app.innerHTML = `<div class="card"><h2>${esc(t)}</h2>${sub ? `<p class="mut">${esc(sub)}</p>` : ''}</div>`; };

async function load() {
  if (!/^[0-9a-f-]{36}$/i.test(token)) return msg('הקישור לא תקין', 'כדאי לפתוח שוב את הקישור מהמייל, או לבקש קישור חדש ממי ששלח אותו.');
  try { await db.init(); } catch { return msg('אין חיבור', 'בודקים את החיבור לאינטרנט ומנסים שוב.'); }
  let r;
  try { r = await db.rpc(RPC.get, { t: token }); } catch (e) { return msg('לא הצלחתי לטעון את הבקשה', e.message); }
  if (!r) return msg('הקישור לא נמצא', 'ייתכן שהבקשה בוטלה. אפשר לבקש קישור חדש ממי ששלח אותו.');
  draw(r);
}

function draw(r) {
  const snap = r.snapshot || {};
  if (DOC && KIND[r.kind]) K = KIND[r.kind];
  const sub = document.querySelector('header small'); if (sub) sub.textContent = K.sub;
  document.title = `${K.sub} · גרושר`;
  const sheet = `<div class="card sheet">${DOC ? docSheetHtml(r.kind, snap, r) : coSheetHtml(snap, r)}</div>`;
  if (r.status === 'approved' || r.status === 'rejected') {
    app.innerHTML = `<div class="card"><div class="done ${r.status === 'approved' ? 'ok2' : 'bad2'}">${r.status === 'approved' ? K.ok : K.no}</div>
      <p class="mut">${esc(r.signer_name || '')} · ${esc(fmtDT(r.signed_at))}. עותק חתום נשמר אצל מנהל הפרויקט. אין צורך לעשות דבר נוסף.</p></div>${sheet}`;
    return;
  }
  if (r.status === 'expired') return void (app.innerHTML = `<div class="card"><h2>תוקף הקישור פג</h2><p class="mut">צריך לבקש קישור חדש ממי ששלח את הבקשה.</p></div>${sheet}`);
  if (r.status === 'cancelled') return msg('הבקשה בוטלה', `כנראה נשלחה גרסה מעודכנת של ${K.what}. בודקים את המייל האחרון.`);
  app.innerHTML = `${sheet}
    <div class="card" id="form"><h2>אישור או דחייה</h2>
      <p class="mut">הסכומים לפני מע"מ. האישור נשמר עם השם, החתימה, התאריך והשעה, יחד עם הסכומים שבמסמך.</p>
      <label for="nm">שם מלא</label><input type="text" id="nm" autocomplete="name" value="${esc(r.sent_name || '')}">
      <label>חתימה</label><div class="pad"><canvas id="cv"></canvas><span id="hint">חותמים כאן באצבע או בעכבר</span></div>
      <div class="row" style="margin-top:6px"><button type="button" class="ghost" id="clr">ניקוי החתימה</button></div>
      <label for="note">הערה (חובה בדחייה)</label><textarea id="note"></textarea>
      <label class="chk"><input type="checkbox" id="agree"> <span>${K.agree}</span></label>
      <div class="row"><button type="button" class="ok" id="yes">אישור וחתימה</button><button type="button" class="no" id="nope">דחייה</button></div>
      <div class="err" id="err" hidden></div>
      <p class="mut" style="margin-top:12px">הקישור אישי ובתוקף עד ${esc(new Date(r.expires_at).toLocaleDateString('he-IL'))}.</p></div>`;
  const pad = sigPad(document.getElementById('cv'), () => { document.getElementById('hint').hidden = true; });
  document.getElementById('clr').onclick = () => { pad.clear(); document.getElementById('hint').hidden = false; };
  const err = t => { const e = document.getElementById('err'); e.textContent = t; e.hidden = !t; };
  const submit = async decision => {
    const name = document.getElementById('nm').value.trim(), note = document.getElementById('note').value.trim();
    if (!name) return err('חסר שם מלא');
    if (decision === 'approved' && pad.empty()) return err('חסרה חתימה');
    if (decision === 'approved' && !document.getElementById('agree').checked) return err('מסמנים את תיבת האישור');
    if (decision === 'rejected' && !note) return err('בדחייה כותבים הערה: מה צריך לתקן');
    err(''); app.querySelectorAll('#form button').forEach(b => b.disabled = true);
    try {
      await db.rpc(RPC.submit, { t: token, signer: name, sig: pad.empty() ? null : pad.png(), decision, note: note || null, agent: navigator.userAgent });
      const r2 = await db.rpc(RPC.get, { t: token }); draw(r2); scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) { err(e.message || 'השליחה נכשלה'); app.querySelectorAll('#form button').forEach(b => b.disabled = false); }
  };
  document.getElementById('yes').onclick = () => submit('approved');
  document.getElementById('nope').onclick = () => submit('rejected');
}

load();
