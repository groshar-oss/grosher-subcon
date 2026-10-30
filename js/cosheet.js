// דף "בקשה לאישור הוראת שינוי": מה שהיזם רואה, חותם עליו ומקבל ב-PDF. בנוי רק מהצילום (snapshot) שנשמר בשליחה.
// עיצוב בשורה (inline) כדי שייראה אותו דבר במייל, בדף החתימה וב-PDF. בלי תלות בשאר המערכת.
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = v => Number(v) || 0;
export const ils = (v, unit = false) => {
  if (v == null || v === '') return '—';
  const x = num(v), dec = unit && x % 1 !== 0 ? 2 : 0;
  return `<span dir="ltr" style="white-space:nowrap">${x < 0 ? '−' : ''}₪${Math.abs(x).toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec })}</span>`;
};
const pctS = v => v == null ? '—' : `<span dir="ltr" style="white-space:nowrap">${v < 0 ? '−' : ''}${Math.abs(v).toFixed(1)}%</span>`;
const fmtD = d => d ? new Date(d).toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '';
const ltr = t => `<span dir="ltr" style="unicode-bidi:isolate">${esc(t)}</span>`;
const fmtDT = d => d ? new Date(d).toLocaleString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
export const INITIATORS = { developer: 'היזם', architect: 'אדריכל / מתכנן', consultant: 'יועץ', contractor: 'קבלן', authority: 'רשות', buyer: 'רוכש / דייר', other: 'אחר' };

const TH = 'padding:7px 8px;background:#eef1fa;color:#4a5578;font-size:12px;font-weight:700;border-bottom:1px solid #d5dbec;white-space:nowrap';
const TD = 'padding:7px 8px;border-bottom:1px solid #e5e8ef;font-size:13px;vertical-align:top';

/** snap: הצילום מ-coSnapshot. so: מצב החתימה { status, signer_name, signed_at, signature, signer_note, sent_name, sent_at, expires_at } */
export function coSheetHtml(snap, so = null, { logo = '' } = {}) {
  const c = snap.co || {}, t = snap.totals || {};
  const info = [['פרויקט', snap.project + (snap.address ? ` · ${snap.address}` : '')], ['הוראת שינוי', `${c.number ? c.number + ' · ' : ''}${c.title}`],
    ['קבלן / ספק', [c.vendor, c.contract].filter(Boolean).join(' · ')], ['יוזם השינוי', [INITIATORS[c.initiator] || '', c.initiator_name].filter(Boolean).join(' · ')],
    ['סיבה', c.reason], ['השפעה על הלו"ז', c.schedule_days ? `${c.schedule_days} ימים` : 'אין'], ['תאריך בקשה', fmtD(c.request_date)]].filter(r => r[1]);
  const rows = (snap.lines || []).map(l => {
    const pr = l.price_contract != null && l.price_requested != null && l.price_contract ? (l.price_contract - l.price_requested) / l.price_contract * 100 : null;
    return `<tr><td style="${TD}">${esc(l.description)}</td><td style="${TD}">${esc(l.unit)}</td><td style="${TD};text-align:left" dir="ltr">${num(l.qty).toLocaleString('en-US', { maximumFractionDigits: 2 })}</td>
      <td style="${TD};text-align:left">${ils(l.price_sale, true)}</td><td style="${TD};text-align:left">${ils(l.price_contract, true)}</td><td style="${TD};text-align:left">${ils(l.price_requested, true)}</td>
      <td style="${TD};text-align:left"><b>${ils(l.price_approved, true)}</b></td><td style="${TD};text-align:left"><b>${ils(l.amount)}</b></td><td style="${TD};text-align:left;color:${pr != null && pr < 0 ? '#c62828' : '#1b7a3a'}">${pctS(pr)}</td></tr>`; }).join('');
  const sum = (lbl, v, strong) => `<tr><td style="padding:6px 10px;border-bottom:1px solid #e5e8ef;${strong ? 'font-weight:800;background:#eef1fa' : ''}">${lbl}</td><td style="padding:6px 10px;border-bottom:1px solid #e5e8ef;text-align:left;${strong ? 'font-weight:800;background:#eef1fa' : ''}">${v}</td></tr>`;
  const signed = so && ['approved', 'rejected'].includes(so.status);
  const sigBox = signed
    ? `<div style="border:2px solid ${so.status === 'approved' ? '#1b7a3a' : '#c62828'};border-radius:10px;padding:12px 14px;margin-top:14px">
        <div style="font-size:16px;font-weight:800;color:${so.status === 'approved' ? '#1b7a3a' : '#c62828'}">${so.status === 'approved' ? '✓ אושר בחתימה' : '✕ נדחה'}</div>
        <div style="margin-top:6px">שם החותם: <b>${esc(so.signer_name)}</b> · ${ltr(fmtDT(so.signed_at))}</div>
        ${so.signer_note ? `<div style="margin-top:4px">הערה: ${esc(so.signer_note)}</div>` : ''}
        ${so.signature ? `<div style="margin-top:8px"><img src="${esc(so.signature)}" alt="חתימה" style="height:90px;max-width:320px;border-bottom:1px solid #9aa3b8"></div>` : ''}
        <div style="font-size:11px;color:#6b7491;margin-top:8px">חתימה אלקטרונית באמצעות קישור אישי שנשלח${so.sent_to ? ` אל ${esc(so.sent_to)}` : ''}${so.sent_at ? ` ב-${ltr(fmtDT(so.sent_at))}` : ''}. הסכומים שנחתמו הם הסכומים שבמסמך זה.</div></div>`
    : `<div style="border:1px dashed #9aa3b8;border-radius:10px;padding:12px 14px;margin-top:14px;color:#4a5578">ממתין לאישור היזם${so?.expires_at ? ` · הקישור בתוקף עד ${esc(fmtD(so.expires_at))}` : ''}</div>`;
  return `<div dir="rtl" style="font-family:Heebo,Arial,Helvetica,sans-serif;color:#13284b;background:#fff;max-width:1000px">
    <div style="display:flex;justify-content:space-between;align-items:center;border-bottom:3px solid #13284b;padding-bottom:10px;margin-bottom:12px">
      <div><div style="font-size:21px;font-weight:800">בקשה לאישור הוראת שינוי</div><div style="color:#6b7491;font-size:13px">${esc(snap.tenant)}${snap.sender ? ` · נשלח ע"י ${esc(snap.sender)}` : ''}</div></div>
      <div style="text-align:left;font-size:12px;color:#6b7491">${logo ? `<img src="${esc(logo)}" alt="" style="height:38px;display:block;margin-inline-start:auto">` : ''}גרושר פרויקטים בע"מ</div></div>
    <table cellspacing="0" cellpadding="0" style="border-collapse:collapse;width:100%;margin-bottom:12px">${info.map(([k, v]) => `<tr><td style="padding:4px 0;width:140px;color:#6b7491;font-size:13px;vertical-align:top">${k}</td><td style="padding:4px 0;font-size:14px"><b>${esc(v)}</b></td></tr>`).join('')}</table>
    <table cellspacing="0" cellpadding="0" style="border-collapse:collapse;width:100%;border:1px solid #d5dbec">
      <tr><th style="${TH};text-align:right">תיאור</th><th style="${TH};text-align:right">יח'</th><th style="${TH};text-align:left">כמות</th><th style="${TH};text-align:left">מחיר בכתב הכמויות</th><th style="${TH};text-align:left">מחיר בחוזה</th><th style="${TH};text-align:left">מחיר מבוקש</th><th style="${TH};text-align:left">מחיר מאושר</th><th style="${TH};text-align:left">סה"כ מאושר</th><th style="${TH};text-align:left">% רווח</th></tr>
      ${rows}</table>
    <div style="display:flex;gap:16px;flex-wrap:wrap;margin-top:12px;align-items:flex-start">
      <table cellspacing="0" cellpadding="0" style="border-collapse:collapse;min-width:320px;border:1px solid #d5dbec;flex:1 1 320px">
        ${sum('מבוקש ע"י הקבלן', ils(t.requested))}${t.contract ? sum('לפי מחירי החוזה', ils(t.contract)) : ''}${t.sale ? sum('לפי מחירי כתב הכמויות', ils(t.sale)) : ''}
        ${t.profit != null ? sum('רווח על השינוי', `${ils(t.profit)} · ${pctS(t.profitPct)}`) : ''}${sum('סה"כ לאישור (לפני מע"מ)', ils(t.approved), true)}</table>
      ${c.price_analysis ? `<div style="flex:1 1 300px;font-size:13px;border:1px solid #e5e8ef;border-radius:8px;padding:8px 10px"><b>ניתוח מחיר</b><div style="white-space:pre-wrap;margin-top:4px">${esc(c.price_analysis)}</div></div>` : ''}</div>
    <div style="font-size:11px;color:#6b7491;margin-top:6px">רווח = ההפרש בין מחיר החוזה למחיר שהקבלן מבקש, באחוזים ממחיר החוזה.</div>
    ${sigBox}</div>`;
}

/** שם קובץ ה-PDF */
export const coPdfName = (snap, so) => `הוראת שינוי ${snap.co?.number || ''} ${snap.co?.title || ''} - ${so && so.status === 'approved' ? 'מאושר בחתימה' : so && so.status === 'rejected' ? 'נדחה' : 'לאישור יזם'}`.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) + '.pdf';
