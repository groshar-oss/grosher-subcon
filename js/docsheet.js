// מסמכים לחתימה (חבילה 24): חשבון קבלן לאישור היזם, והוראת שינוי לאישור הקבלן הראשי / המזמין.
// בנויים רק מהצילום (snapshot) שנשמר בשליחה. עיצוב בשורה (inline) כדי שייראו אותו דבר במייל, בדף החתימה וב-PDF.
import { ils } from './cosheet.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = v => Number(v) || 0;
const q = v => `<span dir="ltr">${num(v).toLocaleString('en-US', { maximumFractionDigits: 2 })}</span>`;
const fmtD = d => d ? new Date(d).toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '';
const fmtDT = d => d ? new Date(d).toLocaleString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
const ltr = t => `<span dir="ltr" style="unicode-bidi:isolate">${esc(t)}</span>`;
const TH = 'padding:7px 8px;background:#eef1fa;color:#4a5578;font-size:12px;font-weight:700;border-bottom:1px solid #d5dbec;white-space:nowrap';
const TD = 'padding:6px 8px;border-bottom:1px solid #e5e8ef;font-size:13px;vertical-align:top';
const thR = t => `<th style="${TH};text-align:right">${t}</th>`, thN = t => `<th style="${TH};text-align:center">${t}</th>`;
const tdR = (t, x = '') => `<td style="${TD};${x}">${t}</td>`, tdN = (t, x = '') => `<td style="${TD};text-align:center;${x}">${t}</td>`;
const sumRow = (lbl, v, strong) => `<tr><td style="padding:6px 10px;border-bottom:1px solid #e5e8ef;${strong ? 'font-weight:800;background:#eef1fa' : ''}">${lbl}</td><td style="padding:6px 10px;border-bottom:1px solid #e5e8ef;text-align:left;${strong ? 'font-weight:800;background:#eef1fa' : ''}">${v}</td></tr>`;

function head(title, snap, logo) {
  return `<div style="display:flex;justify-content:space-between;align-items:center;border-bottom:3px solid #13284b;padding-bottom:10px;margin-bottom:12px">
    <div><div style="font-size:21px;font-weight:800">${esc(title)}</div><div style="color:#6b7491;font-size:13px">${esc(snap.tenant || '')}${snap.sender ? ` · נשלח ע"י ${esc(snap.sender)}` : ''}</div></div>
    <div style="text-align:left;font-size:12px;color:#6b7491">${logo ? `<img src="${esc(logo)}" alt="" style="height:38px;display:block;margin-inline-start:auto">` : ''}גרושר פרויקטים בע"מ</div></div>`;
}
const info = rows => `<table cellspacing="0" cellpadding="0" style="border-collapse:collapse;width:100%;margin-bottom:12px">${rows.filter(r => r[1]).map(([k, v]) => `<tr><td style="padding:4px 0;width:140px;color:#6b7491;font-size:13px;vertical-align:top">${k}</td><td style="padding:4px 0;font-size:14px"><b>${esc(v)}</b></td></tr>`).join('')}</table>`;

/** תיבת החתימה: ממתין / אושר / נדחה. who = מי צריך לחתום ("היזם", "הקבלן הראשי") */
export function sigBox(so, who, okText = 'אושר בחתימה') {
  const signed = so && ['approved', 'rejected'].includes(so.status);
  if (!signed) return `<div style="border:1px dashed #9aa3b8;border-radius:10px;padding:12px 14px;margin-top:14px;color:#4a5578">ממתין לאישור ${esc(who)}${so?.expires_at ? ` · הקישור בתוקף עד ${esc(fmtD(so.expires_at))}` : ''}</div>`;
  const ok = so.status === 'approved', col = ok ? '#1b7a3a' : '#c62828';
  return `<div style="border:2px solid ${col};border-radius:10px;padding:12px 14px;margin-top:14px">
    <div style="font-size:16px;font-weight:800;color:${col}">${ok ? '✓ ' + esc(okText) : '✕ נדחה'}</div>
    <div style="margin-top:6px">שם החותם: <b>${esc(so.signer_name)}</b> · ${ltr(fmtDT(so.signed_at))}</div>
    ${so.signer_note ? `<div style="margin-top:4px">הערה: ${esc(so.signer_note)}</div>` : ''}
    ${so.signature ? `<div style="margin-top:8px"><img src="${esc(so.signature)}" alt="חתימה" style="height:90px;max-width:320px;border-bottom:1px solid #9aa3b8"></div>` : ''}
    <div style="font-size:11px;color:#6b7491;margin-top:8px">חתימה אלקטרונית באמצעות קישור אישי שנשלח${so.sent_to ? ` אל ${esc(so.sent_to)}` : ''}${so.sent_at ? ` ב-${ltr(fmtDT(so.sent_at))}` : ''}. הסכומים שנחתמו הם הסכומים שבמסמך זה.</div></div>`;
}

/** חשבון קבלן: דף בדיקה והמלצה לתשלום, לאישור היזם */
export function cbillSheetHtml(snap, so = null, { logo = '' } = {}) {
  const b = snap.bill || {}, t = snap.totals || {};
  const rows = (snap.rows || []).map(r => `<tr${r.flags?.length ? ' style="background:#fff8e1"' : ''}>${tdR(`${r.code ? `<b>${esc(r.code)}</b> ` : ''}${esc(r.description)}`, 'min-width:150px')}${tdN(q(r.qty))}${tdN(r.price != null ? ils(r.price, true) : '—')}${tdN(q(r.prev))}${tdN(q(r.cumSub))}${tdN(q(r.cumApp))}${tdN(ils(r.claimedCur))}${tdN(`<b>${ils(r.amtCur)}</b>`)}${tdR(esc((r.flags || []).join(' · ')), 'font-size:12px')}</tr>`).join('');
  const finds = [...(snap.checks || []), ...(snap.gate || [])];
  return `<div dir="rtl" style="font-family:Heebo,Arial,Helvetica,sans-serif;color:#13284b;background:#fff;max-width:1000px">
    ${head('בדיקת חשבון והמלצה לתשלום', snap, logo)}
    ${info([['פרויקט', snap.project + (snap.address ? ` · ${snap.address}` : '')], ['קבלן / ספק', b.vendor], ['התקשרות', [b.contract_no, b.contract].filter(Boolean).join(' ')], ['חשבון מס\'', `${b.number}${b.period_to ? ` · עד ${fmtD(b.period_to)}` : ''}`],
      ['חשבונית', `${b.invoice_no || '—'}${b.invoice_date ? ` · ${fmtD(b.invoice_date)}` : ''} · ${b.invoice_legal ? 'חשבונית כחוק התקבלה' : 'חשבונית כחוק לא התקבלה'}`], ['נבדק ע"י', b.checked_by]])}
    <div style="overflow-x:auto"><table cellspacing="0" cellpadding="0" style="border-collapse:collapse;width:100%;border:1px solid #d5dbec">
      <tr>${thR('תיאור')}${thN('כמות בחוזה')}${thN('מחיר')}${thN('מצטבר קודם')}${thN('מצטבר מוגש')}${thN('מצטבר מאושר')}${thN('נוכחי מוגש')}${thN('נוכחי מאושר')}${thR('הערה')}</tr>
      ${rows}<tr style="font-weight:800">${tdR('סה"כ')}${tdN('')}${tdN('')}${tdN('')}${tdN('')}${tdN('')}${tdN(ils(t.claimed))}${tdN(ils(t.gross))}${tdR('')}</tr></table></div>
    <div style="display:flex;gap:16px;flex-wrap:wrap;margin-top:12px;align-items:flex-start">
      <div style="flex:1 1 300px;font-size:13px"><b>ממצאי הבדיקה</b>${finds.length ? `<ul style="margin:6px 0;padding-inline-start:18px">${finds.map(f => `<li>${esc(f)}</li>`).join('')}</ul>` : '<div style="margin-top:4px">לא נמצאו ליקויים.</div>'}
        ${b.doc_override ? `<div><b>אושר למרות חוסר במסמכים:</b> ${esc(b.doc_override)}</div>` : ''}${b.notes ? `<div style="white-space:pre-wrap;margin-top:4px">${esc(b.notes)}</div>` : ''}</div>
      <table cellspacing="0" cellpadding="0" style="border-collapse:collapse;min-width:300px;border:1px solid #d5dbec;flex:1 1 300px">
        ${sumRow('הוגש בחשבון', ils(t.claimed))}${num(t.cut) > 0.5 ? sumRow('קוצץ בבדיקה', ils(-t.cut)) : ''}${sumRow('נוכחי מאושר', ils(t.gross), true)}
        ${num(t.indexDiff) ? sumRow('הפרשי הצמדה', ils(t.indexDiff)) : ''}${num(t.retention) ? sumRow(`עיכבון ${num(t.retention_pct)}%`, ils(-t.retention)) : ''}${num(t.advance) ? sumRow('קיזוז מקדמה', ils(-t.advance)) : ''}
        ${num(t.other) ? sumRow(`ניכויים${t.other_note ? ': ' + esc(t.other_note) : ''}`, ils(-t.other)) : ''}${sumRow('נטו לפני מע"מ', ils(t.net), true)}${sumRow(`מע"מ ${num(t.vat_pct)}%`, ils(t.vat))}${sumRow('לתשלום כולל מע"מ', ils(t.total), true)}</table></div>
    <div style="font-size:12px;color:#6b7491;margin-top:6px">מצטבר מאושר ${ils(t.grossCum)} מתוך התקשרות ${ils(t.contractTotal)}${num(t.retentionCum) ? ` · עיכבון מצטבר ${ils(t.retentionCum)}` : ''}</div>
    <div style="font-size:16px;margin-top:12px;padding:10px 12px;background:#eef1fa;border-radius:8px">סכום מומלץ לתשלום: <b>${ils(t.total)}</b> כולל מע"מ (${ils(t.net)} לפני מע"מ)${(snap.gate || []).length ? ' · <b style="color:#c62828">בכפוף להשלמת המסמכים</b>' : ''}</div>
    ${sigBox(so, 'היזם', 'החשבון אושר לתשלום בחתימה')}</div>`;
}

/** הוראת שינוי בפרויקט קבלן משנה / ביצוע: לאישור הקבלן הראשי או המזמין */
export function varSheetHtml(snap, so = null, { logo = '' } = {}) {
  const v = snap.vo || {};
  const rows = (snap.items || []).map(i => `<tr>${tdR(`${i.code ? `<b>${esc(i.code)}</b> ` : ''}${esc(i.description)}`)}${tdR(esc(i.unit || ''))}${tdN(q(i.qty))}${tdN(i.price != null ? ils(i.price, true) : '—')}${tdN(`<b>${ils(i.amount)}</b>`)}</tr>`).join('');
  const F = snap.field;
  return `<div dir="rtl" style="font-family:Heebo,Arial,Helvetica,sans-serif;color:#13284b;background:#fff;max-width:1000px">
    ${head('בקשה לאישור הוראת שינוי', snap, logo)}
    ${info([['פרויקט', snap.project + (snap.address ? ` · ${snap.address}` : '')], [snap.party || 'קבלן ראשי', snap.to_org], ['הוראת שינוי', `${v.number ? v.number + ' · ' : ''}${v.title}`], ['תאריך', fmtD(v.date)], ['מקור', v.source], ['פירוט', v.notes]])}
    <table cellspacing="0" cellpadding="0" style="border-collapse:collapse;width:100%;border:1px solid #d5dbec">
      <tr>${thR('סעיף')}${thR('יח\'')}${thN('כמות')}${thN('מחיר')}${thN('סה"כ')}</tr>${rows || `<tr>${tdR('אין סעיפים', 'color:#c62828')}${tdR('')}${tdN('')}${tdN('')}${tdN('')}</tr>`}
      <tr style="font-weight:800;background:#eef1fa">${tdR('סה"כ לאישור (לפני מע"מ)')}${tdR('')}${tdN('')}${tdN('')}${tdN(ils(snap.total))}</tr></table>
    ${F ? `<div style="margin-top:12px;font-size:13px;border:1px solid #e5e8ef;border-radius:8px;padding:8px 10px">נרשם ביומן העבודה ב-${esc(fmtD(F.date))}${F.sup_name ? ` ואושר בשטח ע"י המפקח <b>${esc(F.sup_name)}</b> (${ltr(fmtDT(F.sup_signed_at))})` : ''}.</div>` : ''}
    ${sigBox(so, snap.party_the || 'הקבלן הראשי', 'הוראת השינוי אושרה בחתימה')}</div>`;
}

export const docPdfName = (kind, snap, so) => {
  const st = so && so.status === 'approved' ? 'מאושר בחתימה' : so && so.status === 'rejected' ? 'נדחה' : 'לאישור';
  const base = kind === 'cbill' ? `חשבון ${snap.bill?.number || ''} ${snap.bill?.vendor || ''}` : `הוראת שינוי ${snap.vo?.number || ''} ${snap.vo?.title || ''}`;
  return `${base} - ${st}`.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) + '.pdf';
};
export const docSheetHtml = (kind, snap, so, o) => kind === 'cbill' ? cbillSheetHtml(snap, so, o) : varSheetHtml(snap, so, o);
