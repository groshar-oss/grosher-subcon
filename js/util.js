// עזרי תצוגה: פורמט מספרים, DOM, חלונות והודעות
import { n } from './calc.js';

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ₪ עם הפרדת אלפים, בלי אגורות (מחיר יחידה מתחת ל-10 עם 2 ספרות)
export function money(v, { unit = false, sign = false, sym = true } = {}) {
  const x = n(v);
  const dec = unit && Math.abs(x) < 10 && x % 1 !== 0 ? 2 : 0;
  const s = Math.abs(x).toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
  const pre = x < 0 ? '−' : (sign && x > 0 ? '+' : '');
  return `<span class="num${sym ? '' : ' m'}" dir="ltr">${pre}${sym ? '₪' : ''}${s}</span>`;
}
// בשורות סיכום: מוסיפים ₪ לסכומים שהוצגו בלי סימן (מספרים שאינם כסף, כמו ימים או כמויות, לא מסומנים ולא משתנים)
export const totSym = html => String(html ?? '').replace(/(<span class="num m" dir="ltr">)([−+]?)/g, '$1$2₪');
export const num = (v, d = 2) => {
  const x = n(v);
  return `<span class="num" dir="ltr">${x.toLocaleString('en-US', { maximumFractionDigits: d })}</span>`;
};
export const pct = (v, { sign = false, d = 1 } = {}) => {
  const x = n(v);
  const pre = x < 0 ? '−' : (sign && x > 0 ? '+' : '');
  return `<span class="num" dir="ltr">${pre}${Math.abs(x).toFixed(d)}%</span>`;
};
export const plainMoney = v => '₪' + Math.round(n(v)).toLocaleString('en-US');

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function h(html) { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; }

export function toast(msg, kind = 'ok') {
  const el = h(`<div class="toast ${kind}" role="status">${esc(msg)}</div>`);
  document.body.appendChild(el);
  setTimeout(() => el.classList.add('show'), 10);
  setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); }, 3200);
}

// חלון: מחזיר Promise עם ערכי הטופס או null בביטול
export function modal({ title, body, ok = 'שמירה', cancel = 'ביטול', wide = false, onMount, validate, danger = false }) {
  return new Promise(resolve => {
    const el = h(`<div class="ov" role="dialog" aria-modal="true"><div class="dlg ${wide ? 'wide' : ''}">
      <div class="dlg-h"><h3>${esc(title)}</h3><button class="x" aria-label="סגירה" data-x>✕</button></div>
      <form class="dlg-b" novalidate>${body}<div class="err" hidden></div></form>
      <div class="dlg-f">${cancel ? `<button class="btn ghost" data-x>${esc(cancel)}</button>` : ''}${ok ? `<button class="btn ${danger ? 'danger' : ''}" data-ok>${esc(ok)}</button>` : ''}</div></div></div>`);
    document.body.appendChild(el);
    const form = $('form', el);
    const close = v => { el.remove(); document.removeEventListener('keydown', onKey); resolve(v); };
    const onKey = e => { if (e.key === 'Escape') close(null); };
    document.addEventListener('keydown', onKey);
    $$('[data-x]', el).forEach(b => b.onclick = e => { e.preventDefault(); close(null); });
    const submit = async e => {
      e?.preventDefault();
      const data = formData(form);
      const err = validate ? await validate(data, form) : null;
      if (err) { const box = $('.err', el); box.textContent = err; box.hidden = false; box.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); toast(err, 'bad'); return; }
      close(data);
    };
    const okBtn = $('[data-ok]', el); if (okBtn) okBtn.onclick = submit;
    form.onsubmit = submit;
    onMount?.(el, close);
    setTimeout(() => $('input:not([type=hidden]):not([readonly]),select,textarea', form)?.focus(), 30);
  });
}

export const confirmBox = (title, text, ok = 'אישור', danger = false) => modal({ title, body: `<p>${esc(text)}</p>`, ok, danger }).then(v => v !== null);

export function formData(form) {
  const o = {};
  for (const el of form.elements) {
    if (!el.name) continue;
    if (el.type === 'checkbox') o[el.name] = el.checked;
    else if (el.type === 'radio') { if (el.checked) o[el.name] = el.value; }
    else o[el.name] = el.value;
  }
  return o;
}

export const field = (label, name, value = '', { type = 'text', req = false, attrs = '', hint = '' } = {}) =>
  `<label class="fld"><span>${esc(label)}${req ? ' <b class="req">*</b>' : ''}</span>
   <input name="${name}" type="${type}" value="${esc(value ?? '')}" ${type === 'number' ? 'step="any" inputmode="decimal" dir="ltr"' : ''} ${attrs}>${hint ? `<small>${esc(hint)}</small>` : ''}</label>`;
export const select = (label, name, opts, value = '', { attrs = '' } = {}) =>
  `<label class="fld"><span>${esc(label)}</span><select name="${name}" ${attrs}>${Object.entries(opts).map(([k, v]) => `<option value="${esc(k)}" ${String(k) === String(value ?? '') ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></label>`;
export const area = (label, name, value = '') => `<label class="fld"><span>${esc(label)}</span><textarea name="${name}" rows="3">${esc(value ?? '')}</textarea></label>`;

export const fmtDate = d => d ? new Date(d).toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '';
export const nullIfEmpty = v => (v === '' || v === undefined) ? null : v;
export const numOrNull = v => (v === '' || v === null || v === undefined) ? null : n(v);

export function store(key, val) {
  try { if (val === undefined) return JSON.parse(localStorage.getItem(key) || 'null'); localStorage.setItem(key, JSON.stringify(val)); } catch { return null; }
}

// לוגו וואטסאפ (סמל רשמי בירוק) לכפתורי שליחה
export const WA_ICON = '<svg class="wa-ic" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="#25D366" d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z"/></svg>';
export const MAIL_ICON = '<svg class="ml-ic" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><rect x="2.5" y="5" width="19" height="14" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M3.5 6.5l8.5 6.5 8.5-6.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>';
