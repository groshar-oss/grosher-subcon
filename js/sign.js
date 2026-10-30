// דף החתימה של היזם: נפתח מהקישור האישי שבמייל, בלי כניסה למערכת. רואה רק את הבקשה הזאת.
import { db } from './db.js';
import { coSheetHtml } from './cosheet.js';

const app = document.getElementById('app');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const token = new URLSearchParams(location.search).get('t') || '';
const fmtDT = d => d ? new Date(d).toLocaleString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
const msg = (t, sub = '') => { app.innerHTML = `<div class="card"><h2>${esc(t)}</h2>${sub ? `<p class="mut">${esc(sub)}</p>` : ''}</div>`; };

async function load() {
  if (!/^[0-9a-f-]{36}$/i.test(token)) return msg('הקישור לא תקין', 'כדאי לפתוח שוב את הקישור מהמייל, או לבקש קישור חדש ממי ששלח אותו.');
  try { await db.init(); } catch { return msg('אין חיבור', 'בודקים את החיבור לאינטרנט ומנסים שוב.'); }
  let r;
  try { r = await db.rpc('co_signoff_get', { t: token }); } catch (e) { return msg('לא הצלחתי לטעון את הבקשה', e.message); }
  if (!r) return msg('הקישור לא נמצא', 'ייתכן שהבקשה בוטלה. אפשר לבקש קישור חדש ממי ששלח אותו.');
  draw(r);
}

function draw(r) {
  const snap = r.snapshot || {};
  const sheet = `<div class="card sheet">${coSheetHtml(snap, r)}</div>`;
  if (r.status === 'approved' || r.status === 'rejected') {
    app.innerHTML = `<div class="card"><div class="done ${r.status === 'approved' ? 'ok2' : 'bad2'}">${r.status === 'approved' ? '✓ הוראת השינוי אושרה' : '✕ הוראת השינוי נדחתה'}</div>
      <p class="mut">${esc(r.signer_name || '')} · ${esc(fmtDT(r.signed_at))}. עותק חתום נשמר אצל מנהל הפרויקט. אין צורך לעשות דבר נוסף.</p></div>${sheet}`;
    return;
  }
  if (r.status === 'expired') return void (app.innerHTML = `<div class="card"><h2>תוקף הקישור פג</h2><p class="mut">צריך לבקש קישור חדש ממי ששלח את הבקשה.</p></div>${sheet}`);
  if (r.status === 'cancelled') return msg('הבקשה בוטלה', 'כנראה נשלחה גרסה מעודכנת של הוראת השינוי. בודקים את המייל האחרון.');
  app.innerHTML = `${sheet}
    <div class="card" id="form"><h2>אישור או דחייה</h2>
      <p class="mut">הסכומים לפני מע"מ. האישור נשמר עם השם, החתימה, התאריך והשעה, יחד עם הסכומים שבמסמך.</p>
      <label for="nm">שם מלא</label><input type="text" id="nm" autocomplete="name" value="${esc(r.sent_name || '')}">
      <label>חתימה</label><div class="pad"><canvas id="cv"></canvas><span id="hint">חותמים כאן באצבע או בעכבר</span></div>
      <div class="row" style="margin-top:6px"><button type="button" class="ghost" id="clr">ניקוי החתימה</button></div>
      <label for="note">הערה (חובה בדחייה)</label><textarea id="note"></textarea>
      <label class="chk"><input type="checkbox" id="agree"> <span>קראתי ואני מאשר/ת את הוראת השינוי בסכומים המפורטים למעלה</span></label>
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
      await db.rpc('co_signoff_submit', { t: token, signer: name, sig: pad.empty() ? null : pad.png(), decision, note: note || null, agent: navigator.userAgent });
      const r2 = await db.rpc('co_signoff_get', { t: token }); draw(r2); scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) { err(e.message || 'השליחה נכשלה'); app.querySelectorAll('#form button').forEach(b => b.disabled = false); }
  };
  document.getElementById('yes').onclick = () => submit('approved');
  document.getElementById('nope').onclick = () => submit('rejected');
}

// לוח חתימה: ציור חלק באצבע או בעכבר, יוצא כ-PNG קטן
function sigPad(cv, onDraw) {
  const ctx = cv.getContext('2d'); let drawing = false, dirty = false, last = null;
  const fit = () => { const r = cv.getBoundingClientRect(), d = Math.min(2, window.devicePixelRatio || 1); const img = dirty ? cv.toDataURL() : null;
    cv.width = r.width * d; cv.height = r.height * d; ctx.scale(d, d); ctx.lineWidth = 2.4; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#13284b';
    if (img) { const i = new Image(); i.onload = () => ctx.drawImage(i, 0, 0, r.width, r.height); i.src = img; } };
  fit(); addEventListener('resize', fit);
  const pt = e => { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  cv.addEventListener('pointerdown', e => { drawing = true; last = pt(e); cv.setPointerCapture(e.pointerId); ctx.beginPath(); ctx.arc(last.x, last.y, 1.1, 0, 7); ctx.fillStyle = '#13284b'; ctx.fill(); dirty = true; onDraw(); });
  cv.addEventListener('pointermove', e => { if (!drawing) return; const p = pt(e); ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(p.x, p.y); ctx.stroke(); last = p; });
  const up = () => { drawing = false; }; cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
  return {
    empty: () => !dirty,
    clear: () => { ctx.clearRect(0, 0, cv.width, cv.height); dirty = false; },
    // מקטינים לרוחב 600 לכל היותר, כדי שהחתימה תישמר קטנה
    png: () => { const w = Math.min(600, cv.width), h = Math.round(cv.height * w / cv.width); const c2 = document.createElement('canvas'); c2.width = w; c2.height = h; c2.getContext('2d').drawImage(cv, 0, 0, w, h); return c2.toDataURL('image/png'); }
  };
}

load();
