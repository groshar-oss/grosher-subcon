// גוגל דרייב: תיקייה לכל פרויקט (מסמכים, נתונים, דוחות), סנכרון אוטומטי פעם ביום, וכפתור חיווי בתפריט.
// מבנה: <תיקיית השורש> / <לקוח> / <פרויקט> / מסמכים | נתונים | דוחות
import { esc, toast } from './util.js';
import { db } from './db.js';
import { S, tenant, loadTenantData } from './app.js';
import { gconf, setGconf, gConnect, gReady, gEnabled, folderPath, driveUpload } from './google.js';
import { mirror, backupToDrive } from './files.js';
import { loadXLSX } from './import.js';

export const PROJECT_TABLES = { projects: 'פרטי הפרויקט', items: 'כתב כמויות - תקציב', lines: 'תמחיר', vos: 'הוראות שינוי לקבלן ראשי', expenses: 'הוצאות',
  entries: 'יומן עבודה', days: 'ימי עבודה', wqty: 'כמויות מהשטח', pos: 'הזמנות רכש', poLines: 'שורות הזמנה', bills: 'חשבונות לקבלן ראשי', billLines: 'שורות חשבון',
  fines: 'קנסות', payments: 'תקבולים', documents: 'מסמכים', guarantees: 'ערבויות', files: 'קבצים', contracts: 'התקשרויות', cLines: 'שורות התקשרות',
  cos: 'הוראות שינוי', coLines: 'שורות הוראות שינוי', cbills: 'חשבונות קבלנים', cbLines: 'שורות חשבונות קבלנים', income: 'הכנסות', alertStates: 'מצב התרעות', signoffs: 'אישורי יזם', fixedCosts: 'עלויות קבועות' };

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const clientName = () => tenant()?.name || 'לקוח';
const projFolder = (p, sub) => folderPath([clientName(), p ? p.name : 'כללי', ...(sub ? [sub] : [])]);
const todayKey = () => new Date().toISOString().slice(0, 10);
let running = null;

// קובץ קבוע (מוחלף בכל סנכרון): מזהה הקובץ נשמר במטמון לפי מפתח
async function putFile(blob, name, folder, key) {
  const c = gconf(), ids = c.folders || {};
  try {
    const r = await driveUpload(blob, { name, folder, fileId: ids[key] });
    setGconf({ folders: { ...gconf().folders, [key]: r.id } }); return r;
  } catch (e) {
    if (!ids[key] || !/404/.test(e.message)) throw e;
    const r = await driveUpload(blob, { name, folder }); // הקובץ נמחק מהדרייב: יוצרים חדש
    setGconf({ folders: { ...gconf().folders, [key]: r.id } }); return r;
  }
}
// תא באקסל מוגבל ל-32,767 תווים: החתימה (תמונה) לא נכנסת לגיליון, היא נשמרת ב-PDF החתום
const flat = rows => rows.map(r => Object.fromEntries(Object.entries(r).filter(([a]) => a !== 'signature').map(([a, v]) => [a, v && typeof v === 'object' ? JSON.stringify(v).slice(0, 32000) : typeof v === 'string' ? v.slice(0, 32000) : v])));

/** אקסל עם כל הנתונים של פרויקט אחד: גיליון לכל סוג נתונים */
export async function projectDataBook(data, p) {
  const XLSX = await loadXLSX();
  const wb = XLSX.utils.book_new(); wb.Workbook = { Views: [{ RTL: true }] };
  for (const [k, name] of Object.entries(PROJECT_TABLES)) {
    const rows = (data[k] || []).filter(r => (k === 'projects' ? r.id : r.project_id) === p.id);
    if (!rows.length) continue;
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(flat(rows)), name.slice(0, 31));
  }
  return new Blob([XLSX.write(wb, { type: 'array', bookType: 'xlsx' })], { type: XLSX_TYPE });
}

/** כל טבלאות הדוח באקסל (גיליון לכל טבלה) */
export async function tablesBook(root) {
  const XLSX = await loadXLSX();
  const wb = XLSX.utils.book_new(); wb.Workbook = { Views: [{ RTL: true }] };
  [...root.querySelectorAll('table')].forEach((t, i) => {
    const sec = t.closest('[data-sheet]')?.dataset.sheet || `גיליון ${i + 1}`;
    let nm = sec.replace(/[\\/?*[\]:]/g, ' ').slice(0, 28); while (wb.SheetNames.includes(nm)) nm = nm.slice(0, 25) + ' ' + (i + 1);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.table_to_sheet(t), nm);
  });
  if (!wb.SheetNames.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['אין נתונים']]), 'דוח');
  return new Blob([XLSX.write(wb, { type: 'array', bookType: 'xlsx' })], { type: XLSX_TYPE });
}

/** הדוחות של פרויקט אחד (לפי סוג הפרויקט) */
async function projectReports(data, p) {
  if (p.project_type === 'dev') { const m = await import('./views/devreports.js'); return m.devReportNodes(data, p.id); }
  const m = await import('./views/reports.js'); return m.subReportNodes(data, p.id);
}

/** סנכרון מלא: קבצים, גיבוי ללקוח, ולכל פרויקט פעיל: נתונים ודוחות */
export function syncAll({ quiet = false } = {}) {
  if (running) return running;
  running = (async () => {
    const t0 = Date.now(); let files = 0, fail = 0, projects = 0;
    setPill('busy');
    try {
      const data = await loadTenantData();
      const all = await db.select('files', { eq: { tenant_id: S.tenantId } });
      for (const f of all.filter(x => !x.drive_id)) { try { if (await mirror(f)) files++; } catch (e) { if (e.auth) throw e; fail++; } }
      await backupToDrive(data, all);
      const live = data.projects.filter(p => p.status !== 'closed');
      for (const p of live) {
        try {
          await putFile(await projectDataBook(data, p), `נתוני פרויקט - ${p.name}.xlsx`, await projFolder(p, 'נתונים'), `data|${p.id}`);
          const reps = await projectReports(data, p);
          if (reps.length) {
            const folder = await projFolder(p, 'דוחות');
            for (const r of reps) await putFile(await tablesBook(r.node), `${r.title}.xlsx`, folder, `rep|${p.id}|${r.kind}`);
          }
          projects++;
        } catch (e) { if (e.auth) throw e; fail++; console.warn('drive project', p.name, e); }
      }
      setGconf({ lastSync: Date.now(), lastSyncDay: todayKey(), lastErr: fail ? `${fail} פריטים לא עלו` : '' });
      if (!quiet) toast(`הדרייב עודכן: ${projects} פרויקטים, ${files} קבצים חדשים${fail ? ` · ${fail} נכשלו` : ''}`, fail ? 'warn' : 'ok');
      return { files, fail, projects, ms: Date.now() - t0 };
    } catch (e) {
      setGconf({ lastErr: e.message });
      if (!quiet || e.auth) toast(e.message, 'bad');
      throw e;
    } finally { running = null; setPill(); }
  })();
  return running;
}

/** סנכרון אוטומטי: פעם ביום, בכניסה הראשונה למערכת כשהחיבור פעיל */
export function maybeAutoSync() {
  if (!S.tenantId || !gEnabled() || !gReady() || running) return;
  const c = gconf(); const k = `${todayKey()}|${S.tenantId}`;
  if ((c.autoDone || '') === k) return;
  setGconf({ autoDone: k });
  syncAll({ quiet: true }).catch(() => {});
}

// html2canvas מצייר כל אות לחוד (בגלל letter-spacing שמונע הדבקת מילים בעברית), ולכן סוגריים בטקסט עברי יוצאים הפוכים: מחליפים אותם בעותק שמצולם
const HEB = /[\u0590-\u05FF]/;
function mirrorParens(doc) {
  const w = doc.createTreeWalker(doc.body, 4); let n;
  while ((n = w.nextNode())) if (HEB.test(n.nodeValue) && /[()]/.test(n.nodeValue)) n.nodeValue = n.nodeValue.replace(/[()]/g, c => (c === '(' ? ')' : '('));
}
async function loadPdfLib() {
  if (!window.html2pdf) await new Promise((res, rej) => { const s = document.createElement('script'); s.src = new URL('../vendor/html2pdf.bundle.min.js', import.meta.url).href; s.onload = res; s.onerror = () => rej(new Error('טעינת רכיב ה-PDF נכשלה. נסה לרענן את הדף.')); document.head.appendChild(s); });
}
/** אלמנט כ-PDF (לרוחב A4) */
export async function nodePdfBlob(node, { orientation = 'landscape' } = {}) {
  await loadPdfLib();
  document.body.classList.add('pdfing');
  try {
    return await window.html2pdf().set({ margin: [8, 8, 10, 8], image: { type: 'jpeg', quality: 0.92 }, html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff', onclone: mirrorParens },
      jsPDF: { unit: 'mm', format: 'a4', orientation }, pagebreak: { mode: ['css', 'legacy'], avoid: ['tr', '.kpi'] } }).from(node).outputPdf('blob');
  } finally { document.body.classList.remove('pdfing'); }
}
/** HTML חופשי כ-PDF: מוסיפים לדף זמנית (מחוץ למסך) ומצלמים */
export async function htmlPdfBlob(html, { width = 1030, orientation = 'landscape' } = {}) {
  const wrap = document.createElement('div'); wrap.style.cssText = 'position:fixed;top:0;left:-12000px';
  const box = document.createElement('div'); box.className = 'pdfbox'; box.style.cssText = `background:#fff;padding:6px;width:${width}px`; box.innerHTML = html;
  wrap.appendChild(box); document.body.appendChild(wrap);
  try { return await nodePdfBlob(box, { orientation }); } finally { wrap.remove(); }
}
/** דוח כ-PDF לתיקיית הדוחות של הפרויקט (או של הלקוח, לדוח של כל הפרויקטים) */
export async function savePdfToDrive(node, title, project = null) {
  if (!gReady()) await gConnect();
  const blob = await nodePdfBlob(node);
  const d = new Date(), stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const folder = project ? await projFolder(project, 'דוחות') : await folderPath([clientName(), 'דוחות']);
  const r = await driveUpload(blob, { name: `${title} ${stamp}.pdf`, folder, description: `הופק ${d.toLocaleString('he-IL')}` });
  window.__LAST_PDF__ = { size: blob.size, title, project: project?.name || null };
  return r;
}

// ===== כפתור חיווי =====
export function pillState() {
  const c = gconf();
  if (running) return { st: 'busy', t: 'מסנכרן לדרייב...', s: '' };
  if (!c.clientId && !window.__GOOGLE_MOCK__) return { st: 'off', t: 'חיבור ל-Google לא מוגדר', s: 'הגדרה במסך "תצוגה ומצב"' };
  if (gEnabled() && gReady()) {
    const last = c.lastSync ? new Date(c.lastSync) : null;
    const when = !last ? 'עוד לא סונכרן' : last.toDateString() === new Date().toDateString() ? `סונכרן היום ${last.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}` : `סונכרן ${last.toLocaleDateString('he-IL')}`;
    return { st: c.lastErr ? 'warn' : 'on', t: 'מחובר ל-Google', s: c.lastErr ? c.lastErr : when + ' · לסנכרון עכשיו' };
  }
  if (gEnabled()) return { st: 'warn', t: 'החיבור ל-Google פג', s: 'לחיצה להתחברות מחדש' };
  return { st: 'off', t: 'לא מחובר ל-Google', s: 'לחיצה להתחברות' };
}
export const pillHtml = () => { const p = pillState(); return `<button type="button" id="gpill" class="gpill ${p.st}" title="${esc(p.s)}"><i></i><span><b>${esc(p.t)}</b>${p.s ? `<small>${esc(p.s)}</small>` : ''}</span></button>`; };
export function setPill(st) {
  const el = document.getElementById('gpill'); if (!el) return;
  el.outerHTML = pillHtml();
  if (st === 'busy') document.getElementById('gpill')?.classList.add('busy');
  wirePill();
  const dot = document.getElementById('gdot'); if (dot) dot.className = 'gdot ' + pillState().st;
}
export function wirePill() {
  const el = document.getElementById('gpill'); if (!el) return;
  el.onclick = async () => {
    const c = gconf();
    if (!c.clientId && !window.__GOOGLE_MOCK__) { location.hash = '#/settings'; return; }
    try { if (!gReady()) { await gConnect(); toast('מחובר ל-Google'); } await syncAll(); } catch (e) { setPill(); }
  };
}
