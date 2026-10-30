// אישור יזם להוראת שינוי: שליחה במייל עם PDF וקישור אישי לחתימה, תזכורת, שמירת המסמך החתום, ושליחה לקבלן לביצוע.
import { esc, toast, WA_ICON, MAIL_ICON, fmtDate } from '../util.js';
import { db, uuid } from '../db.js';
import { S, can, logChange, loadTenantData, tenant } from '../app.js';
import { coSnapshot, coPrice, SIGNOFF_STATUS } from '../devflow.js';
import { coSheetHtml, coPdfName } from '../cosheet.js';
import { projData } from './common.js';
import { composeMail } from '../mailui.js';
import { htmlPdfBlob } from '../drivesync.js';
import { uploadFile, fileBlob } from '../files.js';
import { findVendor } from '../docs.js';
import { waLink } from '../alertsui.js';

const VALID_DAYS = 14;
const PDF_OPT = { width: 720, orientation: 'portrait' }; // מסמך לאישור: A4 לאורך
export const signUrl = token => new URL('sign.html?t=' + encodeURIComponent(token), location.href.split('#')[0]).href;
const fmtLong = d => new Date(d).toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric' });

// טוען מחדש את הפרויקט ומחזיר את השורה של הוראת השינוי (אחרי שמירה)
async function fresh(pid, coId) {
  const data = await loadTenantData();
  const pd = projData(data, pid);
  const { flowOf } = await import('./devflow.js');
  const P = { data, pd, project: pd.project, id: pid };
  return { P, x: flowOf(P).cos.find(r => r.co.id === coId) };
}
const vendorFor = (P, co) => { const c = (P.pd.contracts || []).find(k => k.id === co.contract_id); return { contract: c || null, vendor: (c?.vendor_id && (P.data.vendors || []).find(v => v.id === c.vendor_id)) || findVendor(P.data.vendors || [], c?.vendor_name || co.vendor_name) || null }; };

/** מה מוצג בתוך חלון הוראת השינוי: מצב האישור וכפתורים */
export function signBlock(x) {
  if (!x) return `<p class="small mut">אחרי השמירה אפשר לשלוח את הוראת השינוי לאישור היזם במייל, עם קישור לחתימה.</p>
    ${can.edit() ? '<div class="actions"><button type="button" class="btn small" data-sact="send">שמירה ושליחה לאישור יזם</button></div>' : ''}`;
  const so = x.signoff, ed = can.edit();
  const st = so ? so.status : null;
  let html = '';
  if (!so) html = '<p class="small">עוד לא נשלח לאישור היזם.</p>';
  else {
    const L = so.last;
    html = `<p class="small"><span class="chip ${st === 'approved' ? 'green' : st === 'rejected' ? 'red' : 'amber'}">${SIGNOFF_STATUS[st]}</span>
      נשלח ${fmtDate(L.sent_at)} ל-${esc(L.sent_to || '')}${st === 'pending' ? ` · ממתין ${so.waited} ימים · בתוקף עד ${fmtDate(L.expires_at)}` : ''}
      ${['approved', 'rejected'].includes(st) ? ` · ${st === 'approved' ? 'אישר' : 'דחה'}: <b>${esc(L.signer_name || '')}</b> ${L.signed_at ? new Date(L.signed_at).toLocaleString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''}` : ''}
      ${L.signer_note ? `<br>הערת היזם: ${esc(L.signer_note)}` : ''}</p>
      ${L.signature ? `<img src="${esc(L.signature)}" alt="חתימת היזם" class="sigimg">` : ''}
      ${so.changed ? '<p class="small neg"><b>הוראת השינוי שונתה אחרי שהיזם חתם.</b> הסכומים או השורות שונים ממה שאושר. צריך לשלוח לאישור מחדש.</p>' : ''}`;
  }
  const btns = [];
  if (ed) {
    if (!so || ['rejected', 'expired', 'cancelled'].includes(st) || so.changed) btns.push(`<button type="button" class="btn small" data-sact="send">${so ? 'שמירה ושליחה מחדש לאישור' : 'שמירה ושליחה לאישור יזם'}</button>`);
    if (st === 'pending') btns.push('<button type="button" class="btn small" data-sact="remind">תזכורת ליזם</button>', `<a class="btn small ghost" href="${esc(signUrl(so.last.token))}" target="_blank" rel="noopener">דף החתימה</a>`, '<button type="button" class="btn small ghost" data-sact="cancel">ביטול הבקשה</button>');
    if (st === 'approved' && !so.changed) btns.push(`<button type="button" class="btn small" data-sact="tomail">${MAIL_ICON} שליחה לקבלן לביצוע</button>`, `<button type="button" class="btn small ghost" data-sact="towa">${WA_ICON} וואטסאפ לקבלן</button>`);
    if (so && ['approved', 'rejected'].includes(st)) btns.push('<button type="button" class="btn small ghost" data-sact="pdf">PDF חתום</button>');
  }
  return html + (btns.length ? `<div class="actions">${btns.join('')}</div>` : '');
}

/** תווית קטנה בשורת הרשימה */
export function signChip(x) {
  const so = x.signoff; if (!so) return '';
  if (so.changed && x.isApproved) return ' <span class="chip red" title="שונתה אחרי אישור היזם">שונתה אחרי אישור</span>';
  if (so.status === 'pending') return ` <span class="chip amber" title="נשלח ${fmtDate(so.last.sent_at)}">✍ ממתין ${so.waited} ימים</span>`;
  if (so.status === 'approved') return ' <span class="chip green" title="אושר בחתימת היזם">✍ נחתם</span>';
  if (so.status === 'rejected') return ' <span class="chip red">היזם דחה</span>';
  if (so.status === 'expired') return ' <span class="chip">הקישור פג</span>';
  return '';
}

/** פעולה מתוך החלון, אחרי שהוראת השינוי נשמרה */
export async function signAction(act, pid, coId) {
  const { P, x } = await fresh(pid, coId);
  if (!x) return toast('הוראת השינוי לא נמצאה', 'bad');
  if (act === 'send') return sendForApproval(P, x);
  if (act === 'remind') return sendForApproval(P, x, { reminder: true });
  if (act === 'cancel') { await db.update('co_signoffs', x.signoff.last.id, { status: 'cancelled' }); if (x.co.stage === 'dev_approval') await db.update('change_orders', x.co.id, { stage: 'pricing' }); await logChange({ project_id: pid, entity: 'change_order', entity_id: coId, label: lbl(x.co), field: 'אישור יזם', old_value: 'ממתין לחתימה', new_value: 'הבקשה בוטלה' }); toast('הבקשה בוטלה. הקישור כבר לא פעיל'); return; }
  if (act === 'pdf') { const f = await signedFile(P, x); if (f) { const u = URL.createObjectURL(await fileBlob(f)); window.open(u, '_blank'); setTimeout(() => URL.revokeObjectURL(u), 60000); } return; }
  if (act === 'tomail' || act === 'towa') return sendToContractor(P, x, act === 'towa' ? 'wa' : 'mail');
}
const lbl = co => `${co.number || ''} ${co.title}`.trim();

/** בקשה לאישור (או תזכורת על אותו קישור): PDF מצורף, קישור לחתימה, נשלח מה-Gmail */
export async function sendForApproval(P, x, { reminder = false } = {}) {
  const co = x.co, project = P.project;
  if (!x.lines.length) return toast('אין שורות בהוראת השינוי', 'bad');
  if (x.lines.some(l => coPrice(l) == null)) return toast('יש שורה בלי מחיר מאושר. ממלאים "מחיר מאושר" לפני השליחה ליזם', 'bad');
  const { contract } = vendorFor(P, co);
  let so = reminder ? x.signoff?.last : null, created = false;
  if (!so) {
    const snap = coSnapshot({ co, totals: x, project, tenantName: tenant()?.name || '', sender: S.user?.email || '', contract });
    so = { id: uuid(), tenant_id: S.tenantId, project_id: P.id, co_id: co.id, token: uuid(), sent_to: project.approver_email || '', sent_name: project.approver_name || '', sent_by: S.user?.email || '',
      sent_at: new Date().toISOString(), expires_at: new Date(Date.now() + VALID_DAYS * 864e5).toISOString(), snapshot: snap, status: 'pending' };
    [so] = await db.insert('co_signoffs', so); created = true;
  }
  const snap = so.snapshot, link = signUrl(so.token), name = project.approver_name || '';
  let pdf;
  try { pdf = await htmlPdfBlob(coSheetHtml(snap, so), PDF_OPT); } catch (e) { console.warn('pdf', e); }
  const text = `${name ? `שלום ${name},` : 'שלום,'}\n\n${reminder ? 'תזכורת: ' : ''}מצורפת הוראת שינוי ${snap.co.number} "${snap.co.title}" בפרויקט ${snap.project} לאישורך.\n` +
    `קבלן: ${snap.co.vendor || '—'}\nסה"כ לאישור: ₪${Math.round(snap.totals.approved).toLocaleString('en-US')} לפני מע"מ${snap.totals.profit != null ? ` · רווח על השינוי ${snap.totals.profitPct?.toFixed(1)}%` : ''}\n\n` +
    `לאישור או לדחייה בחתימה, לוחצים על הכפתור "לאישור וחתימה" למטה.\nהקישור אישי ובתוקף עד ${fmtLong(so.expires_at)}.\n\nבברכה,\n${S.user?.email || ''}\nגרושר פרויקטים בע"מ`;
  const button = `<div dir="rtl" style="margin:16px 0"><a href="${esc(link)}" style="display:inline-block;background:#2f5bea;color:#fff;text-decoration:none;font-weight:700;font-size:16px;padding:12px 26px;border-radius:10px;font-family:Arial,sans-serif">לאישור וחתימה</a>
    <div style="font-size:12px;color:#6b7491;margin-top:6px;font-family:Arial,sans-serif" dir="ltr">${esc(link)}</div></div>`;
  window.__LAST_SIGN_LINK__ = link; // לבדיקות
  const r = await composeMail({ title: reminder ? 'תזכורת ליזם לאישור הוראת השינוי' : 'שליחת הוראת השינוי לאישור היזם', to: [project.approver_email].filter(Boolean),
    subject: `${reminder ? 'תזכורת: ' : ''}בקשה לאישור הוראת שינוי ${snap.co.number} · ${snap.project}`, text, html: button + coSheetHtml(snap, so),
    attachments: pdf ? [{ name: coPdfName(snap, null), blob: pdf }] : [],
    note: project.approver_email ? 'הנוסח ניתן לעריכה. הקישור לחתימה והטבלה המלאה נכללים במייל, וה-PDF מצורף.' : 'אין מייל מאשר בהגדרות הפרויקט. כותבים כאן, והוא יישמר לפרויקט.' });
  if (!r) { if (created) await db.remove('co_signoffs', so.id); return; }
  if (created) {
    await db.update('co_signoffs', so.id, { sent_to: r.to.join(', ') });
    for (const o of (P.pd.signoffs || []).filter(s => s.co_id === co.id && s.status === 'pending' && s.id !== so.id)) await db.update('co_signoffs', o.id, { status: 'cancelled' });
    if (['request', 'pricing'].includes(co.stage)) await db.update('change_orders', co.id, { stage: 'dev_approval' });
    if (!project.approver_email) await db.update('projects', project.id, { approver_email: r.to[0] });
  } else await db.update('co_signoffs', so.id, { reminded_at: new Date().toISOString() });
  await logChange({ project_id: P.id, entity: 'change_order', entity_id: co.id, label: lbl(co), field: 'אישור יזם', old_value: null, new_value: `${reminder ? 'תזכורת נשלחה' : 'נשלח לאישור'} ל-${r.to.join(', ')}`, reason: `סה"כ לאישור ${Math.round(snap.totals.approved)}` });
}

/** המסמך החתום: נשמר פעם אחת במסמכי הפרויקט (ובדרייב, תחת מסמכים / הוראות שינוי) */
export async function signedFile(P, x) {
  const L = x.signoff?.last; if (!L || !['approved', 'rejected'].includes(L.status)) return null;
  const ex = L.filed_file_id && (P.data.files || []).find(f => f.id === L.filed_file_id);
  if (ex) return ex;
  const blob = await htmlPdfBlob(coSheetHtml(L.snapshot, L), PDF_OPT);
  const file = new File([blob], coPdfName(L.snapshot, L), { type: 'application/pdf' });
  const row = await uploadFile(file, { projectId: P.id, docType: 'vo', status: 'stored', links: [{ table: 'change_orders', id: x.co.id, label: lbl(x.co) }], note: `אישור יזם בחתימה אלקטרונית · ${L.signer_name || ''}` });
  await db.update('co_signoffs', L.id, { filed_file_id: row.id });
  L.filed_file_id = row.id;
  return row;
}
/** בכניסה ללשונית הוראות השינוי: כל חתימה חדשה נשמרת כמסמך */
export async function fileNewSignatures(P, rows) {
  if (!can.edit()) return 0;
  let k = 0;
  for (const x of rows) {
    const L = x.signoff?.last;
    if (L && ['approved', 'rejected'].includes(L.status) && !L.filed_file_id) { try { await signedFile(P, x); k++; } catch (e) { console.warn('signed pdf', e); } }
  }
  if (k) toast(`${k === 1 ? 'אישור יזם חתום נשמר' : k + ' אישורי יזם חתומים נשמרו'} במסמכי הפרויקט`);
  return k;
}

/** אחרי האישור: שליחה לקבלן לביצוע, במייל עם המסמך החתום או בוואטסאפ */
export async function sendToContractor(P, x, how) {
  const { vendor } = vendorFor(P, x.co), L = x.signoff?.signed;
  const text = `שלום${vendor?.contact_name ? ' ' + vendor.contact_name : ''},\n\nהוראת שינוי ${x.co.number || ''} "${x.co.title}" בפרויקט ${P.project.name} אושרה ע"י היזם${L?.signer_name ? ` (${L.signer_name}, ${fmtDate(L.signed_at)})` : ''}.\n` +
    `סה"כ מאושר: ₪${Math.round(x.approved).toLocaleString('en-US')} לפני מע"מ${n0(x.co.schedule_days) ? ` · תוספת ללו"ז: ${x.co.schedule_days} ימים` : ''}.\nאפשר להתחיל בביצוע. החיוב לפי המחירים המאושרים בלבד, בחשבון הבא.\n\nבברכה,\n${S.user?.email || ''}\nגרושר פרויקטים בע"מ`;
  if (how === 'wa') {
    const url = waLink(vendor?.phone || '', text.replace(/"/g, '״'));
    window.__LAST_SEND__ = { how, url, text }; window.open(url, '_blank', 'noopener');
  } else {
    const f = await signedFile(P, x).catch(() => null);
    const att = f ? [{ name: f.name, blob: await fileBlob(f) }] : [];
    const r = await composeMail({ title: 'שליחת הוראת השינוי לקבלן לביצוע', to: [vendor?.email].filter(Boolean), subject: `הוראת שינוי ${x.co.number || ''} מאושרת לביצוע · ${P.project.name}`, text, attachments: att,
      note: vendor?.email ? '' : 'אין מייל לקבלן בכרטיס הספק. כותבים כאן (וכדאי להוסיף בכרטיס הספק).' });
    if (!r) return;
  }
  await logChange({ project_id: P.id, entity: 'change_order', entity_id: x.co.id, label: lbl(x.co), field: how === 'wa' ? 'נשלח לקבלן בוואטסאפ' : 'נשלח לקבלן במייל', new_value: vendor?.name || x.co.vendor_name || '' });
}
const n0 = v => Number(v) || 0;
