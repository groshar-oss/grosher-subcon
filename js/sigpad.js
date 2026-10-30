// לוח חתימה: ציור חלק באצבע או בעכבר, יוצא כ-PNG קטן
export function sigPad(cv, onDraw) {
  const ctx = cv.getContext('2d'); let drawing = false, dirty = false, last = null;
  const fit = () => { if (!cv.isConnected && cv.width) return; const r = cv.getBoundingClientRect(), d = Math.min(2, window.devicePixelRatio || 1); const img = dirty ? cv.toDataURL() : null;
    cv.width = r.width * d; cv.height = r.height * d; ctx.scale(d, d); ctx.lineWidth = 2.4; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#13284b';
    if (img) { const i = new Image(); i.onload = () => ctx.drawImage(i, 0, 0, r.width, r.height); i.src = img; } };
  fit(); const onR = () => { if (!cv.isConnected) return removeEventListener('resize', onR); fit(); }; addEventListener('resize', onR);
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

