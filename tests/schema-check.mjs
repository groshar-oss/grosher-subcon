// בדיקת התקנה (בלי דפדפן): node tests/schema-check.mjs
import assert from 'node:assert/strict';
import { schemaDiff } from '../js/schema-check.js';
import { SCHEMA_EXPECTED } from '../js/schema-expected.js';

const live = SCHEMA_EXPECTED.map(k => ({ table_name: k.split('.')[0], column_name: k.slice(k.indexOf('.') + 1) }));
assert.deepEqual(schemaDiff(SCHEMA_EXPECTED, live), []);
assert.deepEqual(schemaDiff(SCHEMA_EXPECTED, live.filter(x => !(x.table_name === 'boq_items' && x.column_name === 'is_overhead'))), ['boq_items.is_overhead']);
console.log('ok   schema check (' + SCHEMA_EXPECTED.length + ' columns)');
