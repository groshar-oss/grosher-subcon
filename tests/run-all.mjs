// מריץ את כל הבדיקות: שרת סטטי על 8123 (כמו GitHub Pages) ואז כל קובץ בדיקה בנפרד.
//   npm install && npx playwright install chromium && node tests/run-all.mjs [שם-קובץ ...]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.mjs': 'text/javascript' };
const srv = http.createServer((q, s) => {
  let u = decodeURIComponent(q.url.split('?')[0]);
  if (u.endsWith('/')) u += 'index.html';
  const f = path.join(ROOT, u);
  if (!f.startsWith(ROOT)) { s.statusCode = 403; return s.end(); }
  // הבדיקות רצות במצב הדגמה (נתונים בדפדפן), לא מול Supabase האמיתי
  if (u === '/js/config.js') {
    s.setHeader('Content-Type', TYPES['.js']);
    return s.end(fs.readFileSync(f, 'utf8').replace(/supabaseUrl: '[^']*'/, "supabaseUrl: ''").replace(/supabaseAnonKey: '[^']*'/, "supabaseAnonKey: ''"));
  }
  fs.readFile(f, (e, d) => {
    if (e) { s.statusCode = 404; return s.end('not found'); }
    s.setHeader('Content-Type', TYPES[path.extname(f)] || 'application/octet-stream');
    s.end(d);
  });
}).listen(8123);
fs.mkdirSync(path.join(ROOT, 'tests/shots'), { recursive: true });

// בדיקות שצריכות קובץ אמיתי של לקוח (tests/private, לא בריפו). בלי הקובץ הן מדולגות
const NEEDS = { 'stage20.mjs': 'tests/private/fitout-sample.json', 'stage30.mjs': 'tests/private/pricing-sample.xlsx' };
const pick = process.argv.slice(2);
const files = fs.readdirSync(path.join(ROOT, 'tests')).filter((f) => f.endsWith('.mjs') && f !== 'run-all.mjs' && (!pick.length || pick.includes(f))).sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
const res = [];
for (const f of files) {
  if (NEEDS[f] && !fs.existsSync(path.join(ROOT, NEEDS[f]))) { res.push([f, 'skip']); console.log(`— ${f}: דילוג (חסר ${NEEDS[f]})`); continue; }
  // spawn ולא spawnSync: השרת הסטטי רץ באותו תהליך וצריך להמשיך לענות בזמן הבדיקה
  const r = await new Promise((resolve) => {
    const c = spawn(process.execPath, [path.join('tests', f)], { cwd: ROOT });
    let out = '';
    c.stdout.on('data', (d) => (out += d)); c.stderr.on('data', (d) => (out += d));
    const kill = setTimeout(() => { out += '\nError: timeout (4 דקות)'; c.kill('SIGKILL'); }, 240000);
    c.on('close', (status) => { clearTimeout(kill); resolve({ status, out }); });
  });
  const out = r.out;
  const fails = out.split('\n').filter((l) => /^FAIL|Error|✗/.test(l));
  const ok = r.status === 0;
  res.push([f, ok ? 'ok' : 'fail']);
  console.log(`${ok ? '✓' : '✗'} ${f}${ok ? '' : '\n   ' + fails.slice(0, 6).join('\n   ')}`);
}
srv.close();
const bad = res.filter((r) => r[1] === 'fail');
console.log(`\n${res.filter((r) => r[1] === 'ok').length} עברו · ${bad.length} נכשלו · ${res.filter((r) => r[1] === 'skip').length} דולגו`);
process.exit(bad.length ? 1 : 0);
