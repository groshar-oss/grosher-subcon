#!/usr/bin/env bash
# מפיק את js/schema-expected.js: כל העמודות שהמסד צריך לכלול אחרי supabase/schema.sql.
# להריץ אחרי כל שינוי ב-schema.sql (דורש Postgres מקומי: PGHOST/PGPORT).
set -euo pipefail
cd "$(dirname "$0")/.."
PSQL="psql -h ${PGHOST:-/tmp} -p ${PGPORT:-55432} -U postgres -v ON_ERROR_STOP=1 -q"
DB=subcon_schema_gen
$PSQL -d postgres -c "drop database if exists $DB" -c "create database $DB"
$PSQL -d $DB -f tests/sql/stub.sql >/dev/null
PGOPTIONS="-c client_min_messages=warning" $PSQL -d $DB -f supabase/schema.sql >/dev/null
{
  echo "// נוצר אוטומטית ע\"י scripts/gen-schema-expected.sh. לא לערוך ידנית."
  echo "// כל העמודות שהמסד צריך לכלול אחרי הרצת supabase/schema.sql (בדיקת התקנה במסך תצוגה ומצב)"
  printf "export const SCHEMA_EXPECTED = "
  $PSQL -d $DB -At -c "select json_agg(c.table_name||'.'||c.column_name order by 1) from information_schema.columns c join information_schema.tables t using (table_schema, table_name) where c.table_schema='public' and t.table_type='BASE TABLE'"
  echo ";"
} > js/schema-expected.js
$PSQL -d postgres -c "drop database $DB"
echo "js/schema-expected.js: $(grep -o '","' js/schema-expected.js | wc -l) עמודות"
