// נספח לחשבון: דף לכל הוראת שינוי שנכללת בחשבון, לפי הסטטוס שלה.
// הוראה מאושרת: מצורף המסמך החתום ע"י המשלם (הקובץ שצורף להוראה ב-📎). תמונות מוצגות כמו שהן, ו-PDF מומר לתמונות כדי שיודפס עם החשבון.
import { esc, money, num, fmtDate } from '../util.js';
import { VO_APPROVED, VO_STATUS } from '../calc.js';
import { attachBtn, fileBlob } from '../files.js';
import { can } from '../app.js';

const NOTE = {
  approved: 'הוראת השינוי אושרה. מצורף מסמך האישור החתום ע"י המשלם.',
  partial: 'הוראת השינוי אושרה חלקית. מצורף מסמך האישור החתום ע"י המשלם.',
  submitted: 'הוראת השינוי הוגשה וממתינה לאישור. החיוב בגינה מותנה באישורה.',
  draft: 'הוראת השינוי בהכנה וטרם הוגשה לאישור. החיוב בגינה מותנה באישורה.',
  executed_unapproved: 'העבודה בוצעה לפי דרישה וטרם התקבל אישור בכתב. מצורף התיעוד הקיים. החיוב בגינה מותנה באישורה.'
};

export function voAppendix(P, r0, filesFor) {
  const by = {};
  for (const r of r0.rows.filter(r => r.vo && (Math.abs(r.cumSub) > 1e-9 || Math.abs(r.curSub) > 1e-9))) (by[r.vo.id] ||= { vo: r.vo, rows: [] }).rows.push(r);
  const list = Object.values(by).sort((a, b) => String(a.vo.number).localeCompare(String(b.vo.number), 'he', { numeric: true }));
  if (!list.length) return '';
  return `<div class="card apx-head"><h2>נספח: הוראות שינוי בחשבון (${list.length})</h2>
    <p class="small mut">לכל הוראת שינוי שנכללת בחשבון יש דף משלה, לפי הסטטוס שלה. בהוראה מאושרת מצורף מסמך האישור החתום ע"י המשלם. את המסמך מצרפים בכפתור 📎 שבדף ההוראה, והוא מודפס יחד עם החשבון.</p></div>
  ${list.map(({ vo, rows }) => {
    const docs = filesFor(P.data.files, vo.id), ok = VO_APPROVED.includes(vo.status);
    const sub = rows.reduce((a, r) => a + n0(r.curSubAmt), 0), cum = rows.reduce((a, r) => a + n0(r.cumSubAmt), 0);
    return `<div class="card apx-page" data-vo="${vo.id}">
      <div class="apx-top"><div><div class="small mut">נספח להוראת שינוי</div><h2 style="margin:2px 0">${esc(vo.number)} · ${esc(vo.title)}</h2>
        <div class="small">${vo.vo_date ? 'תאריך ' + fmtDate(vo.vo_date) + ' · ' : ''}${vo.has_written_order ? 'יש הוראה בכתב' : 'אין הוראה בכתב'}</div></div>
        <span class="chip ${ok ? 'green' : vo.status === 'rejected' ? 'red' : 'amber'}">${esc(VO_STATUS[vo.status] || '')}</span></div>
      <p class="${ok ? '' : 'neg'} small" style="margin:8px 0">${NOTE[vo.status] || ''}</p>
      <div class="tw"><table><thead><tr><th>סעיף</th><th>יח'</th><th class="n">כמות בהוראה</th><th class="n">מחיר</th><th class="n">מצטבר בחשבון</th><th class="n">בחשבון הזה</th></tr></thead><tbody>
        ${rows.map(r => `<tr><td class="wrap">${esc(r.item.code || '')} ${esc(r.item.description)}</td><td>${esc(r.item.unit || '')}</td><td class="n">${num(r.item.qty)}</td><td class="n">${money(r.item.unit_price)}</td><td class="n">${money(r.cumSubAmt)}</td><td class="n">${money(r.curSubAmt)}</td></tr>`).join('')}
        <tr class="tot"><td>סה"כ</td><td></td><td></td><td></td><td class="n">${money(cum)}</td><td class="n">${money(sub)}</td></tr></tbody></table></div>
      ${vo.status === 'partial' && vo.approved_amount != null ? `<p class="small">סכום מאושר: <b>${money(vo.approved_amount)}</b></p>` : ''}
      <h3 style="margin:12px 0 6px">${ok ? 'מסמך האישור החתום' : 'מסמכים מצורפים'} ${can.edit() ? attachBtn(P.data.files, 'variations', vo.id, { projectId: P.id, docType: 'vo', label: `${vo.number} ${vo.title}` }) : ''}</h3>
      ${docs.length ? `<div class="apx-docs" data-docs="${docs.map(d => d.id).join(',')}"><div class="small mut no-print">טוען את המסמכים...</div></div>`
        : `<div class="note ${ok ? 'neg' : ''}">${ok ? 'חסר מסמך האישור החתום. מצרפים אותו בכפתור 📎 כאן או בהוראת השינוי, והוא יודפס עם החשבון.' : 'אין מסמכים מצורפים.'}</div>`}
    </div>`; }).join('')}`;
}
const n0 = v => Number(v) || 0;

let pdfjs = null;
async function loadPdf() {
  if (pdfjs) return pdfjs;
  await new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'vendor/pdf.min.js'; s.onload = res; s.onerror = () => rej(new Error('pdf')); document.head.appendChild(s); });
  pdfjs = window.pdfjsLib; pdfjs.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';
  return pdfjs;
}

// מציג את המסמכים המצורפים: תמונה כמו שהיא, PDF כתמונות של כל עמוד (עד 6), ושאר הקבצים כשם בלבד
export async function fillAppendixDocs(el, files) {
  for (const box of el.querySelectorAll('[data-docs]')) {
    const out = [];
    for (const id of box.dataset.docs.split(',')) {
      const f = files.find(x => x.id === id); if (!f) continue;
      const cap = `<div class="small mut">${esc(f.name)}${f.created_at ? ' · צורף ' + fmtDate(String(f.created_at).slice(0, 10)) : ''}</div>`;
      try {
        const b = await fileBlob(f), type = b.type || f.mime || '';
        if (/^image\//.test(type)) out.push(`<figure class="apx-doc">${cap}<img src="${URL.createObjectURL(b)}" alt="${esc(f.name)}"></figure>`);
        else if (/pdf/.test(type) || /\.pdf$/i.test(f.name)) {
          const lib = await loadPdf(); const doc = await lib.getDocument({ data: new Uint8Array(await b.arrayBuffer()) }).promise;
          const imgs = [];
          for (let i = 1; i <= Math.min(doc.numPages, 6); i++) {
            const pg = await doc.getPage(i), vp = pg.getViewport({ scale: 1.6 }), c = document.createElement('canvas');
            c.width = vp.width; c.height = vp.height; await pg.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
            imgs.push(`<img src="${c.toDataURL('image/jpeg', 0.85)}" alt="${esc(f.name)} עמוד ${i}">`);
          }
          out.push(`<figure class="apx-doc">${cap}${imgs.join('')}${doc.numPages > 6 ? `<div class="small mut">מוצגים 6 עמודים מתוך ${doc.numPages}</div>` : ''}</figure>`);
        } else out.push(`<div class="apx-doc">${cap}<div class="small">קובץ מצורף (לא ניתן להצגה בהדפסה)</div></div>`);
      } catch { out.push(`<div class="apx-doc">${cap}<div class="small neg">לא ניתן לטעון את הקובץ</div></div>`); }
    }
    box.innerHTML = out.join('') || '<div class="small mut">אין מסמכים</div>';
  }
}
