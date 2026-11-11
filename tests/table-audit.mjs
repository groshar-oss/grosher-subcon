// סקירת כל הטבלאות: יישור כותרת מול תאים, מספרים לא מיושרים, וסכומים בלי ₪ בשורות סיכום
import { chromium } from 'playwright';
const BASE = 'http://localhost:8123/';
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.goto(BASE); await p.waitForSelector('.kpis'); await p.evaluate(() => localStorage.clear()); await p.reload(); await p.waitForSelector('.kpis');
const T = await p.evaluate(() => JSON.parse(localStorage.getItem('grosher-subcon-demo-v5')).tables);
const issues = new Map();
const add = (k, v) => { if (!issues.has(k)) issues.set(k, v); };
async function audit(route) {
  await p.goto(BASE + route); await p.waitForTimeout(700);
  const res = await p.evaluate(() => {
    const out = []; const isNum = s => /^[−+\-]?₪?[\d,]+(\.\d+)?%?$/.test(s.replace(/\s/g, '')) && /\d/.test(s);
    const money = s => /₪/.test(s);
    document.querySelectorAll('#main table').forEach((t, ti) => {
      if (t.closest('.sumt') || t.classList.contains('sumt')) {}
      const rows = [...t.rows]; if (!rows.length) return;
      const grid = rows.map(r => { const a = []; [...r.cells].forEach(c => { for (let i = 0; i < c.colSpan; i++) a.push(c); }); return a; });
      const ths = rows.filter(r => [...r.cells].every(c => c.tagName === 'TH'));
      const hdr = ths.length ? grid[rows.indexOf(ths[ths.length - 1])] : null;
      const body = rows.filter(r => !ths.includes(r));
      const ncol = Math.max(...grid.map(g => g.length));
      const where = (t.closest('[data-sheet]')?.dataset.sheet || t.closest('.card')?.querySelector('h2,h3')?.textContent || '').slice(0, 40);
      for (let ci = 0; ci < ncol; ci++) {
        const cells = body.map(r => grid[rows.indexOf(r)][ci]).filter(c => c && c.colSpan === 1 && c.textContent.trim());
        const nums = cells.filter(c => isNum(c.textContent.trim()));
        const th = hdr?.[ci]; const thTxt = th?.textContent.trim() || '';
        const IDS = /^(קוד|מס'|מס|מסמך|חשבון|סעיפים|סעיף|לפני|אחרי|טלפון|ח\.פ\.?|ע\.מ\.?|חשבונית|מספר)$/;
        if (nums.length && nums.length >= cells.length * 0.6 && !IDS.test(thTxt)) {
          const bad = nums.filter(c => getComputedStyle(c).textAlign !== 'center');
          if (bad.length) out.push(`number not centered | ${where} | col "${thTxt}" e.g. ${bad[0].textContent.trim()}`);
        }
        if (th && th.colSpan === 1 && cells.length) {
          const nz = a => a === 'start' ? 'right' : a === 'end' ? 'left' : a; const al = cells.map(c => nz(getComputedStyle(c).textAlign)); const cnt = {}; al.forEach(a => cnt[a] = (cnt[a] || 0) + 1);
          const maj = Object.entries(cnt).sort((a, b) => b[1] - a[1])[0][0]; const ta = nz(getComputedStyle(th).textAlign);
          if (ta !== maj) out.push(`header/cells misaligned | ${where} | "${thTxt}" th=${ta} cells=${maj} e.g. ${cells[0].textContent.trim().slice(0, 30)}`);
        }
        // שורת סיכום שלא מסומנת כסיכום
        body.forEach(r => { const f = (r.cells[0]?.textContent.trim() || '') + '|' + (r.cells[1]?.textContent.trim() || ''); if (/סה"כ/.test(f) && !r.classList.contains('tot') && ci === 0 && r.cells.length > 2) out.push(`total row without tot class | ${where} | ${f.slice(0, 40)}`); });
        // סיכום: תא סכום בלי ₪ כשבעמודה יש כסף או שהכותרת כספית
        const colMoney = cells.some(c => money(c.textContent)) || /₪/.test(thTxt);
        body.filter(r => r.classList.contains('tot')).forEach(r => { const c = grid[rows.indexOf(r)][ci]; if (!c || c.colSpan > 1) return; const s = c.textContent.trim();
          if (isNum(s) && !/%/.test(s) && !money(s) && Math.abs(parseFloat(s.replace(/[^\d.]/g, ''))) >= 100) out.push(`total without ₪ | ${where} | col "${thTxt}" row "${r.cells[0].textContent.trim() || r.cells[1]?.textContent.trim()}" = ${s}${colMoney ? '' : ' (col has no ₪)'}`); });
      }
      if (hdr) hdr.forEach(th => { if (th.scrollWidth > th.clientWidth + 2 && getComputedStyle(th).whiteSpace === 'nowrap') {} });
    });
    return out;
  });
  res.forEach(r => add(r.split(' e.g.')[0].split(' = ')[0], route + ' :: ' + r));
}
for (const tn of T.tenants) {
  await p.selectOption('#tsel', tn.id); await p.waitForTimeout(500);
  for (const r of ['#/', '#/projects', '#/collection', '#/payables', '#/cashflow', '#/vendors', '#/workers']) await audit(r);
  const dev = T.projects.some(x => x.tenant_id === tn.id && x.project_type === 'dev');
  const kinds = dev ? ['d-budget', 'd-cash', 'd-cos', 'd-cbills', 'd-vendors', 'd-docs', 'd-group', 'd-alerts'] : [];
  if (T.projects.some(x => x.tenant_id === tn.id && x.project_type !== 'dev')) kinds.push('profit', 'labor', 'expenses', 'vo', 'retention', 'client');
  for (const k of kinds) await audit('#/reports/' + k);
  for (const pr of T.projects.filter(x => x.tenant_id === tn.id)) {
    await p.goto(BASE + '#/project/' + pr.id); await p.waitForTimeout(600);
    const tabs = await p.$$eval('.ptabs a', as => as.map(a => a.getAttribute('href')));
    for (const t of tabs) await audit(t);
    // חשבון אחד
    for (const t of tabs.filter(t => /bills$/.test(t))) { await p.goto(BASE + t); await p.waitForTimeout(600);
      const l = await p.$$eval('#main a[href*="/bill/"], #main a[href*="/cbill/"]', as => as.slice(0, 1).map(a => a.getAttribute('href'))); for (const x of l) await audit(x); }
  }
}
for (const [k, v] of issues) console.log(v);
console.log('issues', issues.size, 'errors', errs.length, errs.slice(0, 3));
await b.close();
