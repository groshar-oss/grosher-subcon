-- בדיקת התקנה (גל 1): רשימת העמודות במסד, כדי שמסך "תצוגה ומצב" יראה אם schema.sql לא הורץ עד הסוף.
-- רק מנהל השירות יכול לקרוא. בטוח להרצה חוזרת. (נכלל גם בסוף schema.sql)
create or replace function schema_columns()
returns table (table_name text, column_name text)
language plpgsql stable security definer set search_path = public, pg_catalog as $$
begin
  if not is_service_admin() then raise exception 'not allowed'; end if;
  return query
    select c.table_name::text, c.column_name::text
    from information_schema.columns c
    join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
    where c.table_schema = 'public';
end $$;
revoke all on function schema_columns() from public, anon;
grant execute on function schema_columns() to authenticated;
notify pgrst, 'reload schema';
