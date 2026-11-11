// בדיקת התקנה: אילו עמודות שהקוד צריך חסרות במסד
export function schemaDiff(expected, live) {
  const have = new Set(live.map(r => `${r.table_name}.${r.column_name}`));
  return expected.filter(k => !have.has(k));
}
