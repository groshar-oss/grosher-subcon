// קבצים: העלאה לאחסון, פתיחה, קישור לרשומות, ועותק בגוגל דרייב של מנהל השירות
import { db } from './db.js';
import { esc, $, $$, modal, toast, fmtDate } from './util.js';
import { S, tenant } from './app.js';
import { gReady, gEnabled, folderPath, driveUpload, setGconf } from './google.js';
import { INTAKE_TYPES } from './intake.js';

export const FILE_STATUS = { new: 'ממתין לקריאה', review: 'ממתין לבדיקה', done: 'נקלט', stored: 'נשמר כקובץ', error: 'שגיאה בקריאה' };
const ext = name => (/\.([a-z0-9]{1,6})$/i.exec(name || '')?.[1] || 'bin').toLowerCase();
const uuid = () => crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2);

// תמונה גדולה מהטלפון: מקטינים ל-2000 פיקסלים לפני השמירה (קריאה מהירה וזולה יותר)
async function shrink(file) {
  if (!/^image\/(jpeg|png|webp)/.test(file.type) || file.size < 1.5e6 || typeof createImageBitmap !== 'function') return file;
  try {
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    const b = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.85));
    return b && b.size < file.size ? new File([b], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' }) : file;
  } catch { return file; }
}

export async function uploadFile(file, { projectId = null, docType = null, status = 'new', links = [], note = null } = {}) {
  const f = await shrink(file);
  const path = `${S.tenantId}/${projectId || 'general'}/${new Date().toISOString().slice(0, 7)}/${uuid()}.${ext(f.name)}`;
  await db.putFile(path, f);
  const [row] = await db.insert('files', { tenant_id: S.tenantId, project_id: projectId, name: f.name, mime: f.type || null, size: f.size, path, doc_type: docType,
    status, links, note, uploaded_email: S.user?.email || null });
  row._blob = f;
  mirror(row).catch(() => {}); // עותק בדרייב ברקע, אם מחובר
  return row;
}

export const fileBlob = row => row._blob || db.getFile(row.path);
export async function openFile(row) {
  const w = window.open('', '_blank');
  try {
    const b = await fileBlob(row);
    const url = URL.createObjectURL(b.type ? b : new Blob([b], { type: row.mime || 'application/octet-stream' }));
    if (w) w.location.href = url; else location.href = url;
  } catch (e) { w?.close(); throw e; }
}

// קישור קובץ לרשומה (הזמנה, חשבונית, הוראת שינוי...)
export async function linkFile(row, table, id, label) {
  const links = [...(row.links || []).filter(l => !(l.table === table && l.id === id)), { table, id, label }];
  return db.update('files', row.id, { links });
}
export const filesFor = (files, id) => (files || []).filter(f => (f.links || []).some(l => l.id === id));
export const clip = (files, id) => filesFor(files, id).length ? `<span class="chip blue" title="יש מסמך מצורף">📎 ${filesFor(files, id).length}</span>` : '';

// כפתור 📎 ליד רשומה: צפייה במסמכים המצורפים והוספת קובץ (נשמר בתיק, בלי קריאה)
export const attachBtn = (files, table, id, { projectId = null, docType = null, label = '' } = {}) => {
  const k = filesFor(files, id).length;
  return `<button type="button" class="btn small ghost att${k ? ' has' : ''}" data-att="${table}" data-aid="${id}" data-ap="${projectId || ''}" data-at="${docType || ''}" data-al="${esc(label)}" title="${k ? k + ' מסמכים מצורפים' : 'צירוף מסמך'}" aria-label="מסמכים מצורפים">📎${k ? ' ' + k : ''}</button>`;
};
export function wireAttach(el, files, onChange) {
  $$('[data-att]', el).forEach(b => b.onclick = e => { e.preventDefault(); e.stopPropagation();
    attachDialog(files, { table: b.dataset.att, id: b.dataset.aid, projectId: b.dataset.ap || null, docType: b.dataset.at || null, label: b.dataset.al }).then(ch => ch && onChange?.()); });
}
export async function attachDialog(files, { table, id, projectId, docType, label }) {
  let changed = false;
  const list = () => filesFor(files, id);
  const rows = () => list().map(f => `<div class="att-row"><span>📄 <b>${esc(f.name)}</b> <span class="small mut">${fmtDate(f.created_at)}</span></span><span class="actions"><button type="button" class="btn small ghost" data-of="${f.id}">פתיחה</button><button type="button" class="btn small ghost" data-uf="${f.id}" title="הסרת הקישור לרשומה (הקובץ נשאר בתיבת המסמכים)">ניתוק</button></span></div>`).join('') || '<p class="small mut">אין עדיין מסמכים מצורפים</p>';
  await modal({ title: 'מסמכים: ' + (label || ''), ok: 'סגירה', cancel: null,
    body: `<div id="atl">${rows()}</div><input type="file" id="atf" multiple hidden accept=".pdf,image/*,.xlsx,.xls,.csv,.docx">
      <button type="button" class="btn ghost" id="atb" style="margin-top:10px">+ צירוף קובץ</button><p class="small mut">הקובץ נשמר בתיק הפרויקט${projectId ? '' : ''} ובגוגל דרייב (אם מחובר), ומקושר לרשומה הזו.</p>`,
    onMount: el => {
      const draw = () => { $('#atl', el).innerHTML = rows();
        $$('[data-of]', el).forEach(b => b.onclick = () => openFile(files.find(f => f.id === b.dataset.of)).catch(x => toast(x.message, 'bad')));
        $$('[data-uf]', el).forEach(b => b.onclick = async () => { const f = files.find(x => x.id === b.dataset.uf);
          const links = (f.links || []).filter(l => l.id !== id); await db.update('files', f.id, { links }); f.links = links; changed = true; draw(); }); };
      draw();
      $('#atb', el).onclick = () => $('#atf', el).click();
      $('#atf', el).onchange = async e => {
        for (const file of [...e.target.files]) {
          try { const row = await uploadFile(file, { projectId, docType, status: 'stored', links: [{ table, id, label }] }); row.done_at = row.created_at; files.unshift(row); changed = true; }
          catch (x) { toast(`${file.name}: ${x.message}`, 'bad'); }
        }
        e.target.value = ''; draw(); toast('הקובץ צורף');
      };
    } });
  return changed;
}

// ===== גוגל דרייב =====
// מבנה: <שורש> / <לקוח> / <פרויקט או כללי> / מסמכים / <סוג מסמך> / קובץ (נתונים ודוחות לכל פרויקט: drivesync.js)
async function projName(id) {
  if (!id) return 'כללי';
  const [p] = await db.select('projects', { eq: { id } });
  return p?.name || 'כללי';
}
export async function mirror(row) {
  if (!gEnabled() || !gReady() || row.drive_id) return false;
  const folder = await folderPath([tenant()?.name || 'לקוח', await projName(row.project_id), 'מסמכים', INTAKE_TYPES[row.doc_type]?.folder || 'כללי']);
  const b = await fileBlob(row);
  const r = await driveUpload(b, { name: row.name, folder, description: `${INTAKE_TYPES[row.doc_type]?.label || 'מסמך'} · הועלה ${new Date(row.created_at || Date.now()).toLocaleDateString('he-IL')}` });
  await db.update('files', row.id, { drive_id: r.id });
  row.drive_id = r.id;
  return true;
}

// סנכרון: כל הקבצים שעוד אין להם עותק, וגיבוי נתונים מלא באקסל
export async function syncDrive(data, { backup = true } = {}) {
  const files = await db.select('files', { eq: { tenant_id: S.tenantId } });
  let n = 0, fail = 0;
  for (const f of files.filter(x => !x.drive_id)) { try { if (await mirror(f)) n++; } catch (e) { if (e.auth) throw e; fail++; } }
  if (backup && data) await backupToDrive(data, files);
  setGconf({ lastSync: Date.now(), lastErr: fail ? `${fail} קבצים לא הועלו` : '' });
  return { n, fail };
}

const TABLE_NAMES = { projects: 'פרויקטים', mcs: 'קבלנים ראשיים', items: 'כתב כמויות', lines: 'תמחיר', vos: 'הוראות שינוי', expenses: 'הוצאות', workers: 'עובדים', entries: 'יומן עבודה', days: 'ימי עבודה',
  wqty: 'כמויות מהשטח', pos: 'הזמנות רכש', poLines: 'שורות הזמנה', bills: 'חשבונות', billLines: 'שורות חשבון', fines: 'קנסות', payments: 'תשלומים', vendors: 'ספקים', documents: 'מסמכי ספקים', guarantees: 'ערבויות',
  contracts: 'התקשרויות', cLines: 'שורות התקשרות', cos: 'הוראות שינוי יזם', coLines: 'שורות הוראות שינוי', cbills: 'חשבונות קבלנים', cbLines: 'שורות חשבונות קבלנים', income: 'הכנסות יזם', alertStates: 'מצב התרעות' };
export async function backupToDrive(data, files) {
  const XLSX = window.XLSX || (await import('./import.js').then(m => m.loadXLSX()));
  const wb = XLSX.utils.book_new();
  for (const [k, name] of Object.entries(TABLE_NAMES)) {
    const rows = (data[k] || []).map(r => Object.fromEntries(Object.entries(r).map(([a, v]) => [a, v && typeof v === 'object' ? JSON.stringify(v) : v])));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows.length ? rows : [{ '': 'אין נתונים' }]), name.slice(0, 31));
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet((files || []).map(f => ({ שם: f.name, סוג: INTAKE_TYPES[f.doc_type]?.label || '', סטטוס: FILE_STATUS[f.status], הועלה: f.created_at, 'בדרייב': f.drive_id ? 'כן' : 'לא' }))), 'קבצים');
  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const folder = await folderPath([tenant()?.name || 'לקוח']);
  const key = 'backup-' + S.tenantId;
  const c = (await import('./google.js')).gconf();
  try {
    const r = await driveUpload(blob, { name: 'גיבוי נתונים - כל הלקוח.xlsx', folder, fileId: c.folders?.[key] });
    setGconf({ folders: { ...(await import('./google.js')).gconf().folders, [key]: r.id } });
  } catch (e) {
    if (c.folders?.[key] && /404/.test(e.message)) { // הקובץ נמחק מהדרייב: יוצרים חדש
      const r = await driveUpload(blob, { name: 'גיבוי נתונים - כל הלקוח.xlsx', folder });
      setGconf({ folders: { ...(await import('./google.js')).gconf().folders, [key]: r.id } });
    } else throw e;
  }
}
