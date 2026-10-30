// חתימה על מסמכים (חבילה 24): חשבון קבלן לאישור היזם, והוראת שינוי לאישור הקבלן הראשי / המזמין.
// אותו מנגנון כמו אישור הוראת שינוי ליזם: קישור אישי לחתימה, תוקף 14 יום, תזכורת, ביטול, מסמך חתום שנשמר בפרויקט.
import { esc, toast, fmtDate, modal, WA_ICON, MAIL_ICON, $ } from '../util.js';
import { emailsOf, waLink } from '../alertsui.js';
import { logSend } from '../sendlog.js';
import { db, uuid } from '../db.js';
import { S, can, logChange, tenant, settings } from '../app.js';
import { docSheetHtml, docPdfName } from '../docsheet.js';
import { composeMail, googleConfigured } from '../mailui.js';
import { htmlPdfBlob } from '../drivesync.js';
import { uploadFile, fileBlob } from '../files.js';
import { party } from '../dev.js';
import { n, itemSale, VO_APPROVED } from '../calc.js';
import { SIGNOFF_STATUS, EXCEED_TEXT, isLump } from '../devflow.js';

const VALID_DAYS = 14;
const PDF_OPT = { width: 760, orientation: 'portrait' };
export const docSignUrl = token => new URL('sign.html?k=d&t=' + encodeURIComponent(token), location.href.split('#')[0]).href;
const fmtLong = d => new Date(d).toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric' });
const KEY = { cbill: 'cbill_id', variation: 'variation_id' };
const TBL = { cbill: 'cbills', variation: 'variations' };
const txt = html => { const d = document.createElement('div'); d.innerHTML = html; return d.textContent.replace(/\s+/g, ' ').trim(); };
const ils = v => '₪' + Math.round(n(v)).toLocaleString('en-US');

// ===== צילום המסמך בזמן השליחה =====
/** חשבון קבלן. R = שורת החשבון מ-flowOf, ck = billChecks, texts = { check, gate } (פונקציות טקסט מהמסך) */
export function cbillSnapshot(P, R, ck, texts) {
  const b = R.bill, C = R.contract, vat = n(settings().vat_pct);
  const rows = R.rows.filter(r => r.cumSub > 0 || r.prev > 0).map(r => ({ code: r.kind === 'o' ? r.co?.number || '' : r.code || '', description: r.description, qty: n(r.qty), price: r.price ?? null, prev: n(r.prev), cumSub: n(r.cumSub), cumApp: n(r.cumApp),
    claimedCur: n(r.claimedCur), amtCur: n(r.amtCur), lump: isLump(r), flags: r.flags.filter(f => f !== 'cut').map(f => ({ over_qty: 'מעל החוזה', co_over: 'מעל המאושר', price_diff: 'מחיר שונה', unapproved_co: 'שינוי לא אושר' }[f] || f)) }));
  const totals = { claimed: R.claimed, cut: R.cut, gross: R.gross, indexDiff: R.indexDiff || 0, retention: R.retention || 0, retention_pct: n(C.retention_pct), advance: R.advance || 0, other: R.other || 0, other_note: b.other_note || '',
    net: R.net, vat: R.vat, vat_pct: vat, total: R.total, grossCum: R.grossCum, contractTotal: R.contractAmt + R.coAmt, retentionCum: R.retentionCum || 0 };
  return { v: 1, tenant: tenant()?.name || '', project: P.project.name, address: P.project.address || '', sender: S.user?.email || '',
    bill: { vendor: C.vendor_name || '', contract: C.title, contract_no: C.number || '', number: b.number, period_to: b.period_to || null, received_date: b.received_date || null, invoice_no: b.invoice_no || '', invoice_date: b.invoice_date || null,
      invoice_legal: !!b.invoice_legal, checked_by: b.checked_by || '', notes: b.notes || '', doc_override: b.doc_override || '' },
    rows, overs: R.rows.filter(r => r.exceed?.length).map(r => ({ code: r.kind === 'o' ? r.co?.number || '' : r.code || '', description: r.description, lump: isLump(r), what: r.exceed.map(x => EXCEED_TEXT[x]).join(', '),
      app: n(r.cumApp), sub: n(r.cumSub), qty: n(r.qty), why: texts.over ? texts.over(r.line || {}) : '' })),
    checks: ck.list.map(f => txt(texts.check(f))), gate: ck.doc_override ? [] : ck.gate.map(g => txt(texts.gate(g))), totals, sig: cbillSig(R) };
}
export const cbillSig = R => `${Math.round(n(R.total))}|${R.rows.map(r => `${n(r.cumSub)}~${n(r.cumApp)}`).join('#')}`;

/** הוראת שינוי בפרויקט קבלן משנה / ביצוע. g = קבוצת ההוראה מ-P.summary.voGroups */
export function varSnapshot(P, g) {
  const v = g.vo, pt = party(P.project), mc = (P.mcs || P.data.mcs || []).find(m => m.id === P.project.main_contractor_id);
  const items = g.rows.map(r => ({ code: r.item.code || '', description: r.item.description, unit: r.item.unit || '', qty: n(r.item.qty), price: r.item.unit_price ?? null, amount: itemSale(r.item) }));
  const xs = (P.pd.extras || []).filter(x => x.variation_id === v.id);
  const day = xs[0] && (P.pd.days || []).find(d => d.log_date === xs[0].log_date);
  const SRC = { change_order: 'הוראת שינוי', supervisor: 'הוראת מפקח', main_request: pt.req, daywork: 'עבודת רג\'י', field: 'יומן העבודה (מהשטח)' };
  return { v: 1, tenant: tenant()?.name || '', project: P.project.name, address: P.project.address || '', sender: S.user?.email || '', party: pt.name, party_the: pt.the, to_org: mc?.name || '',
    vo: { number: v.number, title: v.title, date: v.vo_date || null, source: SRC[v.source] || '', notes: v.notes || '' }, items, total: g.requested,
    field: xs[0] ? { date: xs[0].log_date, sup_name: day?.sup_sig ? day.sup_name || 'מפקח' : '', sup_signed_at: day?.sup_signed_at || null } : null, sig: varSig(g) };
}
export const varSig = g => `${Math.round(n(g.requested))}|${g.rows.map(r => `${String(r.item.description || '').trim()}~${n(r.item.qty)}~${n(r.item.unit_price)}`).join('#')}`;

// ===== מצב =====
/** הבקשה האחרונה, מצב (כולל פג תוקף), ימי המתנה, והאם המסמך השתנה מאז */
export function docState(P, kind, refId, curSig = null) {
  const list = (P.pd.docSignoffs || []).filter(s => s.kind === kind && s[KEY[kind]] === refId).sort((a, b) => String(a.sent_at).localeCompare(String(b.sent_at)));
  const last = list[list.length - 1]; if (!last) return null;
  const status = last.status === 'pending' && new Date(last.expires_at) < new Date() ? 'expired' : last.status;
  const waited = Math.max(0, Math.floor((Date.now() - new Date(last.sent_at)) / 864e5));
  const signed = list.filter(s => s.status === 'approved').pop() || null;
  const changedPending = status === 'pending' && curSig != null && last.snapshot?.sig && last.snapshot.sig !== curSig;
  const changed = !!signed && curSig != null && signed.snapshot?.sig && signed.snapshot.sig !== curSig;
  return { last, status, waited, signed, changed, changedPending, list };
}

const WHO = { cbill: 'היזם', variation: null };
const whoOf = (kind, P) => kind === 'cbill' ? WHO.cbill : party(P.project).the;

/** תיבת המצב והכפתורים. ctx = { kind, P, refId, can: האם אפשר לשלוח עכשיו, why: למה לא } */
export function docSignBlock(ctx) {
  const { kind, P, refId } = ctx, st = ctx.state, ed = can.edit(), who = whoOf(kind, P);
  let html = '';
  if (!st) html = `<p class="small">עוד לא נשלח לאישור ${esc(who)} בחתימה.</p>`;
  else {
    const L = st.last, s = st.status;
    html = `<p class="small"><span class="chip ${s === 'approved' ? 'green' : s === 'rejected' ? 'red' : s === 'pending' ? 'amber' : ''}">${SIGNOFF_STATUS[s].replace('היזם', who)}</span>
      נשלח ${fmtDate(L.sent_at)}${L.sent_to ? ` ל-${esc(L.sent_to)}` : ''}${s === 'pending' ? ` · ממתין ${st.waited} ימים · בתוקף עד ${fmtDate(L.expires_at)}` : ''}
      ${['approved', 'rejected'].includes(s) ? ` · ${s === 'approved' ? 'אישר' : 'דחה'}: <b>${esc(L.signer_name || '')}</b> ${L.signed_at ? new Date(L.signed_at).toLocaleString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''}` : ''}
      ${L.signer_note ? `<br>הערה: ${esc(L.signer_note)}` : ''}</p>
      ${L.signature ? `<img src="${esc(L.signature)}" alt="חתימה" class="sigimg">` : ''}
      ${st.changed ? `<p class="small neg"><b>המסמך שונה אחרי החתימה.</b> הסכומים או השורות שונים ממה שנחתם. צריך לשלוח לאישור מחדש.</p>` : ''}`;
  }
  const b = [];
  if (ed) {
    const s = st?.status;
    if (!st || ['rejected', 'expired', 'cancelled'].includes(s) || st.changed || (s === 'approved' && kind === 'variation' && !VO_APPROVED.includes(ctx.voStatus))) {
      if (ctx.can) b.push(`<button type="button" class="btn small" data-dact="send">✍ ${st ? 'שליחה מחדש לאישור וחתימה' : `שליחה ל${who.replace(/^ה/, '')} לאישור וחתימה`}</button>`);
      else if (ctx.why) html += `<p class="small mut">${esc(ctx.why)}</p>`;
    }
    if (s === 'pending') b.push('<button type="button" class="btn small" data-dact="remind">תזכורת</button>', `<button type="button" class="btn small ghost" data-dact="copy">העתקת הקישור</button>`, `<a class="btn small ghost" href="${esc(docSignUrl(st.last.token))}" target="_blank" rel="noopener">דף החתימה</a>`, '<button type="button" class="btn small ghost" data-dact="cancel">ביטול הבקשה</button>');
    if (st && ['approved', 'rejected'].includes(s)) b.push('<button type="button" class="btn small ghost" data-dact="pdf">PDF חתום</button>');
  }
  return `<div class="docsign" data-kind="${kind}" data-ref="${refId}">${html}${b.length ? `<div class="actions">${b.join('')}</div>` : ''}</div>`;
}

/** תווית קטנה לשורת רשימה */
export function docSignChip(st) {
  if (!st) return '';
  if (st.changed) return ' <span class="chip red" title="שונה אחרי החתימה">שונה אחרי חתימה</span>';
  if (st.status === 'pending') return ` <span class="chip amber" title="נשלח ${fmtDate(st.last.sent_at)}">✍ ממתין ${st.waited} ימים</span>`;
  if (st.status === 'approved') return ' <span class="chip green" title="אושר בחתימה">✍ נחתם</span>';
  if (st.status === 'rejected') return ' <span class="chip red">נדחה בחתימה</span>';
  if (st.status === 'expired') return ' <span class="chip">הקישור פג</span>';
  return '';
}

/** חיבור הכפתורים. getCtx(kind, refId) מחזיר ctx מעודכן ({ kind, P, refId, state, snapshot(), label, ... }); after = רענון */
export function wireDocSign(el, getCtx, after) {
  el.querySelectorAll('.docsign [data-dact]').forEach(btn => btn.onclick = async e => {
    e.preventDefault();
    const box = btn.closest('.docsign'), ctx = getCtx(box.dataset.kind, box.dataset.ref), act = btn.dataset.dact;
    btn.disabled = true;
    try {
      if (act === 'send') { if (await sendDoc(ctx)) after?.(); }
      else if (act === 'remind') { if (await sendDoc(ctx, { reminder: true })) after?.(); }
      else if (act === 'copy') { const u = docSignUrl(ctx.state.last.token); try { await navigator.clipboard.writeText(u); toast('הקישור הועתק. אפשר להדביק בוואטסאפ או במייל'); } catch { await modal({ title: 'הקישור לחתימה', ok: null, cancel: 'סגירה', body: `<input readonly dir="ltr" value="${esc(u)}" onfocus="this.select()">` }); } }
      else if (act === 'cancel') { await db.update('doc_signoffs', ctx.state.last.id, { status: 'cancelled' }); await logChange({ project_id: ctx.P.id, entity: ctx.kind, entity_id: ctx.refId, label: ctx.label, field: 'אישור בחתימה', old_value: 'ממתין לחתימה', new_value: 'הבקשה בוטלה' }); toast('הבקשה בוטלה. הקישור כבר לא פעיל'); after?.(); }
      else if (act === 'pdf') { const f = await signedDocFile(ctx.P, ctx.state.last, ctx); if (f) { const u = URL.createObjectURL(await fileBlob(f)); window.open(u, '_blank'); setTimeout(() => URL.revokeObjectURL(u), 60000); } }
    } catch (err) { toast(err.message || 'הפעולה נכשלה', 'bad'); }
    btn.disabled = false;
  });
}

// ===== נמען =====
async function recipient(kind, P) {
  const p = P.project, t = tenant() || {};
  let pcs = [], contacts = [];
  try { pcs = await db.select('project_contacts', { eq: { project_id: p.id } }); const { loadContacts } = await import('../contacts.js'); contacts = await loadContacts(); } catch { /* אין ספר טלפונים */ }
  const by = Object.fromEntries(contacts.map(c => [c.id, c]));
  const ap = pcs.filter(r => r.role === 'approver').map(r => by[r.contact_id]).find(Boolean);
  const apr = { name: p.approver_name || ap?.name || '', email: p.approver_email || ap?.email || '', phone: ap?.phone || '' };
  if (kind === 'variation') {
    const mc = (P.mcs || P.data.mcs || []).find(m => m.id === p.main_contractor_id);
    if (mc && (mc.email || mc.phone)) return { name: mc.contact_name || mc.name || '', email: emailsOf(mc.email)[0] || '', phone: mc.phone || '', from: `כרטיס ${party(p).name}: ${mc.name}` };
    if (apr.email || apr.phone) return { ...apr, from: 'מאשר הוראות השינוי בפרויקט' };
    return { name: mc?.contact_name || '', email: '', phone: '', from: '' };
  }
  if (apr.email || apr.phone) return { ...apr, from: 'מאשר הוראות השינוי בפרויקט' };
  const em = emailsOf(p.notify_emails)[0];
  if (em || p.notify_phone) return { name: p.notify_name || '', email: em || '', phone: p.notify_phone || '', from: 'נמען ההתרעות בפרויקט' };
  return { name: t.contact_name || '', email: emailsOf(t.email)[0] || '', phone: t.phone || '', from: t.email ? 'כרטיס הלקוח' : '' };
}

// ===== שליחה =====
/** בקשה חדשה (או תזכורת על אותו קישור): בוחרים מייל / וואטסאפ / העתקת קישור */
export async function sendDoc(ctx, { reminder = false } = {}) {
  const { kind, P, refId } = ctx;
  const R = await recipient(kind, P), who = whoOf(kind, P);
  const how = await chooseHow(R, reminder, who);
  if (!how) return false;
  let so = reminder ? ctx.state?.last : null, created = false;
  if (!so) {
    const snap = ctx.snapshot();
    so = { id: uuid(), tenant_id: S.tenantId, project_id: P.id, kind, [KEY[kind]]: refId, token: uuid(), sent_to: (how === 'mail' ? R.email : how === 'wa' ? R.phone : '') || '', sent_name: R.name || '', sent_by: S.user?.email || '',
      sent_at: new Date().toISOString(), expires_at: new Date(Date.now() + VALID_DAYS * 864e5).toISOString(), snapshot: snap, status: 'pending' };
    [so] = await db.insert('doc_signoffs', so); created = true;
  }
  const snap = so.snapshot, link = docSignUrl(so.token);
  window.__LAST_SIGN_LINK__ = link; // לבדיקות
  const what = kind === 'cbill' ? `חשבון ${snap.bill.number} של ${snap.bill.vendor} בפרויקט ${snap.project}` : `הוראת שינוי ${snap.vo.number} "${snap.vo.title}" בפרויקט ${snap.project}`;
  const amount = kind === 'cbill' ? `סכום מומלץ לתשלום: ${ils(snap.totals.total)} כולל מע"מ (${ils(snap.totals.net)} לפני מע"מ)` : `סה"כ לאישור: ${ils(snap.total)} לפני מע"מ`;
  const text = `${R.name ? `שלום ${R.name},` : 'שלום,'}\n\n${reminder ? 'תזכורת: ' : ''}${kind === 'cbill' ? 'מצורף לאישורך דף בדיקה והמלצה לתשלום עבור' : 'מצורפת לאישורך'} ${what}.\n${amount}\n\n` +
    `לאישור או לדחייה בחתימה: ${how === 'mail' ? 'לוחצים על הכפתור "לאישור וחתימה" למטה' : link}\nהקישור אישי ובתוקף עד ${fmtLong(so.expires_at)}.\n\nבברכה,\n${S.user?.email || ''}\nגרושר פרויקטים בע"מ`;
  const logKind = kind === 'cbill' ? 'cbill_approval' : 'vo_approval';
  let sentTo = '';
  if (how === 'mail') {
    let pdf; try { pdf = await htmlPdfBlob(docSheetHtml(kind, snap, so), PDF_OPT); } catch (e) { console.warn('pdf', e); }
    const button = `<div dir="rtl" style="margin:16px 0"><a href="${esc(link)}" style="display:inline-block;background:#2f5bea;color:#fff;text-decoration:none;font-weight:700;font-size:16px;padding:12px 26px;border-radius:10px;font-family:Arial,sans-serif">לאישור וחתימה</a>
      <div style="font-size:12px;color:#6b7491;margin-top:6px;font-family:Arial,sans-serif" dir="ltr">${esc(link)}</div></div>`;
    const r = await composeMail({ log: { project_id: P.id, kind: logKind }, title: reminder ? `תזכורת לאישור ${who}` : `שליחה לאישור ${who} בחתימה`, to: [R.email].filter(Boolean),
      subject: `${reminder ? 'תזכורת: ' : ''}${kind === 'cbill' ? `אישור חשבון ${snap.bill.number} · ${snap.bill.vendor}` : `בקשה לאישור הוראת שינוי ${snap.vo.number}`} · ${snap.project}`, text, html: button + docSheetHtml(kind, snap, so),
      attachments: pdf ? [{ name: docPdfName(kind, snap, null), blob: pdf }] : [], note: R.from ? `הנמען נלקח מ${R.from}. אפשר לשנות.` : `לא נמצא מייל ל${who}. כותבים כאן.` });
    if (!r) { if (created) await db.remove('doc_signoffs', so.id); return false; }
    sentTo = r.to.join(', ');
  } else if (how === 'wa') {
    const url = waLink(R.phone || '', text);
    window.__LAST_SEND__ = { how, url, text }; window.open(url, '_blank', 'noopener');
    await logSend({ project_id: P.id, channel: 'whatsapp', kind: logKind, recipients: [R.name, R.phone].filter(Boolean).join(' '), subject: what, body: text });
    sentTo = [R.name, R.phone].filter(Boolean).join(' ');
  } else {
    try { await navigator.clipboard.writeText(link); } catch { /* מוצג בחלון */ }
    await modal({ title: 'הקישור לחתימה', ok: null, cancel: 'סגירה', body: `<p class="small">הקישור הועתק. מדביקים אותו בהודעה ל${esc(who)}.</p><input readonly dir="ltr" value="${esc(link)}" onfocus="this.select()">` });
    sentTo = 'קישור הועתק';
  }
  if (created) {
    await db.update('doc_signoffs', so.id, { sent_to: sentTo });
    for (const o of (ctx.state?.list || []).filter(s => s.status === 'pending' && s.id !== so.id)) await db.update('doc_signoffs', o.id, { status: 'cancelled' });
    if (kind === 'variation' && ctx.voStatus === 'draft') await db.update('variations', refId, { status: 'submitted' });
  } else await db.update('doc_signoffs', so.id, { reminded_at: new Date().toISOString() });
  await logChange({ project_id: P.id, entity: kind, entity_id: refId, label: ctx.label, field: 'אישור בחתימה', old_value: null, new_value: `${reminder ? 'תזכורת נשלחה' : 'נשלח לאישור'} · ${sentTo}`, reason: amount });
  if (how !== 'mail') toast(reminder ? 'התזכורת נפתחה לשליחה' : 'הבקשה נוצרה. הקישור בתוקף 14 יום');
  return true;
}

async function chooseHow(R, reminder, who) {
  let pick = null;
  await modal({ title: reminder ? 'תזכורת: איך לשלוח?' : `שליחה ל${who.replace(/^ה/, '')} לאישור וחתימה`, ok: null, body: `
    <p class="small">${R.name || R.email || R.phone ? `נמען: <b>${esc(R.name || '')}</b> ${R.email ? `<span dir="ltr">${esc(R.email)}</span>` : ''} ${R.phone ? `<span dir="ltr">${esc(R.phone)}</span>` : ''}` : `לא נמצא איש קשר ל${esc(who)}. אפשר להוסיף בהגדרות הפרויקט או בכרטיס.`}</p>
    <div class="howlist">
      <button type="button" class="btn" data-how="mail">${MAIL_ICON} מייל עם PDF וכפתור לחתימה</button>
      <button type="button" class="btn ghost" data-how="wa">${WA_ICON} וואטסאפ עם הקישור</button>
      <button type="button" class="btn ghost" data-how="copy">🔗 העתקת הקישור בלבד</button></div>
    ${googleConfigured() ? '' : '<p class="small mut">מייל ישיר מהמערכת דורש חיבור Gmail (תצוגה ומצב ← Google).</p>'}
    <p class="small mut">הקישור אישי ובתוקף ${VALID_DAYS} יום. אחרי החתימה המסמך החתום נשמר בפרויקט.</p>`,
    onMount: (el, close) => el.querySelectorAll('[data-how]').forEach(b => b.onclick = e => { e.preventDefault(); pick = b.dataset.how; close(true); }) });
  return pick;
}

// ===== המסמך החתום =====
/** נשמר פעם אחת במסמכי הפרויקט (ובדרייב), מקושר לחשבון או להוראת השינוי. כך הוא מצטרף לבד לנספח בחשבון */
export async function signedDocFile(P, L, ctx = null) {
  if (!L || !['approved', 'rejected'].includes(L.status)) return null;
  const ex = L.filed_file_id && (P.data.files || []).find(f => f.id === L.filed_file_id);
  if (ex) return ex;
  const kind = L.kind, refId = L[KEY[kind]];
  const blob = await htmlPdfBlob(docSheetHtml(kind, L.snapshot, L), PDF_OPT);
  const file = new File([blob], docPdfName(kind, L.snapshot, L), { type: 'application/pdf' });
  const label = ctx?.label || (kind === 'cbill' ? `${L.snapshot.bill?.vendor || ''} חשבון ${L.snapshot.bill?.number || ''}` : `${L.snapshot.vo?.number || ''} ${L.snapshot.vo?.title || ''}`);
  const row = await uploadFile(file, { projectId: P.id, docType: kind === 'cbill' ? 'approved_bill' : 'vo', status: 'stored', links: [{ table: TBL[kind], id: refId, label }],
    note: `${L.status === 'approved' ? 'אושר' : 'נדחה'} בחתימה אלקטרונית · ${L.signer_name || ''}` });
  await db.update('doc_signoffs', L.id, { filed_file_id: row.id });
  L.filed_file_id = row.id; (P.data.files ||= []).unshift(row);
  return row;
}
/** בכניסה למסך: כל חתימה חדשה נשמרת כמסמך */
export async function fileNewDocSignatures(P, kind = null) {
  if (!can.edit() || !can.expense?.()) return 0;
  let k = 0;
  for (const L of (P.pd.docSignoffs || []).filter(s => (!kind || s.kind === kind) && ['approved', 'rejected'].includes(s.status) && !s.filed_file_id)) {
    try { await signedDocFile(P, L); k++; } catch (e) { console.warn('signed pdf', e); }
  }
  if (k) toast(k === 1 ? 'מסמך חתום נשמר במסמכי הפרויקט' : `${k} מסמכים חתומים נשמרו במסמכי הפרויקט`);
  return k;
}
