// בדיקת תחביר לכל קובצי ה-JavaScript של האתר (בלי ספריות צד שלישי). נכשל אם קובץ אחד שבור.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const SKIP = new Set(['node_modules', 'vendor', 'lib', '.git', 'tests']);
const files = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(m?js)$/.test(e.name)) files.push(p);
  }
})(ROOT);
let bad = 0;
for (const f of files) {
  const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
  if (r.status !== 0) { bad++; console.log('✗ ' + path.relative(ROOT, f) + '\n' + r.stderr.split('\n').slice(0, 5).join('\n')); }
}
console.log(`${files.length - bad}/${files.length} קבצים תקינים`);
process.exit(bad ? 1 : 0);
