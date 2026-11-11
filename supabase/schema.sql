-- גרושר · מערכת בקרת עלויות לקבלני משנה
-- סכמת בסיס הנתונים (שלבים 1-8). להריץ ב-Supabase: עורך פקודות > שאילתה חדשה > הדבקה > הרצה (SQL Editor > New query > Run).
-- בטוח להרצה חוזרת: יוצר רק מה שחסר.

create extension if not exists pgcrypto;

-- ===== משתמשים והרשאות =====
create table if not exists profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  is_service_admin boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  company_no text,
  trades text,
  contact_name text,
  phone text,
  email text,
  settings jsonb not null default '{}'::jsonb,
  is_demo boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists memberships (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner','foreman','accountant','viewer')),
  project_ids uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  unique (tenant_id, user_id)
);

-- ===== פרויקטים וכתב כמויות =====
create table if not exists main_contractors (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null,
  company_no text,
  contact_name text,
  phone text,
  email text,
  pay_terms_days int not null default 60,
  created_at timestamptz not null default now()
);

create table if not exists projects (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  main_contractor_id uuid references main_contractors(id) on delete set null,
  name text not null,
  address text,
  owner_name text,
  start_date date,
  end_date date,
  contract_type text not null default 'measure' check (contract_type in ('measure','milestones','percent','mixed')),
  pay_terms_days int not null default 60,
  indexation boolean not null default false,
  base_index numeric,
  retention_pct numeric not null default 5,
  retention_cap numeric,
  insurance_pct numeric not null default 0,
  shared_pct numeric not null default 0,
  tax_pct numeric not null default 0,
  overhead_pct numeric not null default 0,
  status text not null default 'active' check (status in ('tender','active','closing','closed')),
  is_demo boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists variations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  number text not null,
  title text not null,
  source text not null default 'change_order' check (source in ('change_order','supervisor','main_request','daywork')),
  has_written_order boolean not null default false,
  vo_date date,
  status text not null default 'draft' check (status in ('draft','submitted','approved','partial','rejected','executed_unapproved')),
  approved_amount numeric,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists boq_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  variation_id uuid references variations(id) on delete cascade,
  chapter text,
  code text,
  description text not null,
  unit text,
  qty numeric,
  unit_price numeric,
  billing_method text not null default 'measure' check (billing_method in ('measure','lump','percent')),
  progress_pct numeric not null default 0,
  forecast_manual numeric,
  forecast_note text,
  sort int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists cost_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  boq_item_id uuid not null references boq_items(id) on delete cascade,
  kind text not null check (kind in ('material','labor','piece','sub','equipment','transport','other')),
  description text,
  qty numeric,
  unit text,
  unit_cost numeric,
  waste_pct numeric not null default 0,
  sort int not null default 0,
  created_at timestamptz not null default now()
);


create table if not exists expenses (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  boq_item_id uuid references boq_items(id) on delete set null,
  variation_id uuid references variations(id) on delete set null,
  kind text not null default 'material' check (kind in ('material','labor','piece','sub','equipment','transport','general','other')),
  supplier_name text,
  doc_no text,
  doc_date date,
  description text,
  amount numeric not null default 0,
  vat_pct numeric not null default 18,
  status text not null default 'invoice' check (status in ('expected','invoice','approved','paid')),
  pay_date date,
  notes text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists expenses_project on expenses(project_id);

create table if not exists change_log (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  project_id uuid references projects(id) on delete cascade,
  entity text not null,
  entity_id uuid,
  label text,
  field text,
  old_value text,
  new_value text,
  reason text,
  user_id uuid default auth.uid(),
  user_name text,
  at timestamptz not null default now()
);

create index if not exists boq_items_project on boq_items(project_id);
create index if not exists cost_lines_item on cost_lines(boq_item_id);
create index if not exists cost_lines_project on cost_lines(project_id);
create index if not exists variations_project on variations(project_id);
create index if not exists projects_tenant on projects(tenant_id);
create index if not exists change_log_project on change_log(project_id, at desc);

-- ===== פונקציות הרשאה =====
create or replace function is_service_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_service_admin from profiles where user_id = auth.uid()), false)
$$;

create or replace function tenant_role(t uuid) returns text
language sql stable security definer set search_path = public as $$
  select case when is_service_admin() then 'admin'
              else (select role from memberships where tenant_id = t and user_id = auth.uid()) end
$$;

-- מנהל עבודה רואה רק פרויקטים שהוקצו לו
create or replace function can_see_project(p uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from projects pr
    where pr.id = p and (
      is_service_admin()
      or exists (select 1 from memberships m where m.tenant_id = pr.tenant_id and m.user_id = auth.uid()
                 and (m.role <> 'foreman' or p = any(m.project_ids)))
    ))
$$;

-- פרופיל נוצר אוטומטית בהרשמה
create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles(user_id, email) values (new.id, new.email) on conflict do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function handle_new_user();

-- המשתמשת הראשונה שנרשמת הופכת למנהלת השירות (רק אם עדיין אין כזו)
create or replace function claim_service_admin() returns boolean
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles(user_id, email) select id, email from auth.users where id = auth.uid() on conflict do nothing;
  if exists (select 1 from profiles where is_service_admin) then
    return is_service_admin();
  end if;
  update profiles set is_service_admin = true where user_id = auth.uid();
  return true;
end $$;

-- הוספת משתמש ללקוח לפי אימייל (המשתמש צריך להירשם קודם)
create or replace function add_member(t uuid, member_email text, member_role text, member_projects uuid[] default '{}')
returns text language plpgsql security definer set search_path = public as $$
declare uid uuid;
begin
  if coalesce(tenant_role(t), '') not in ('admin','owner') then raise exception 'אין הרשאה'; end if;
  if member_role not in ('owner','foreman','accountant','viewer') then raise exception 'תפקיד לא מוכר'; end if;
  select id into uid from auth.users where lower(email) = lower(trim(member_email));
  if uid is null then return 'not_registered'; end if;
  insert into memberships(tenant_id, user_id, role, project_ids) values (t, uid, member_role, coalesce(member_projects,'{}'))
  on conflict (tenant_id, user_id) do update set role = excluded.role, project_ids = excluded.project_ids;
  return 'ok';
end $$;

-- רשימת חברי לקוח עם אימייל (לבעלים ולמנהלת)
create or replace function tenant_members(t uuid)
returns table(id uuid, user_id uuid, email text, role text, project_ids uuid[])
language sql stable security definer set search_path = public as $$
  select m.id, m.user_id, u.email::text, m.role, m.project_ids
  from memberships m join auth.users u on u.id = m.user_id
  where m.tenant_id = t and tenant_role(t) in ('admin','owner')
$$;

-- סעיפים לשטח, בלי מחירים (למנהל עבודה)
create or replace function field_boq(p uuid)
returns table(id uuid, chapter text, code text, description text, unit text, variation_id uuid)
language sql stable security definer set search_path = public as $$
  select b.id, b.chapter, b.code, b.description, b.unit, b.variation_id
  from boq_items b where b.project_id = p and can_see_project(p)
  order by b.sort, b.code
$$;


-- ===== שלב 3: עובדים, יומן עבודה ורכש =====
alter table cost_lines add column if not exists labor_type text;
alter table cost_lines drop constraint if exists cost_lines_labor_type_check;
alter table cost_lines add constraint cost_lines_labor_type_check check (labor_type in ('salary','daily','hourly'));
alter table cost_lines add column if not exists crew numeric;

create table if not exists workers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null,
  id_no text,
  phone text,
  trade text,
  pay_type text not null default 'daily' check (pay_type in ('salary','daily','piece')),
  monthly_salary numeric,
  daily_rate numeric,
  piece_rate numeric,
  ot_rate numeric,
  cost_factor numeric,
  is_foreign boolean not null default false,
  agency text,
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default now()
);

-- שלב 8: עובד שעתי
alter table workers add column if not exists hourly_rate numeric;
alter table workers drop constraint if exists workers_pay_type_check;
alter table workers add constraint workers_pay_type_check check (pay_type in ('salary','daily','hourly','piece'));

create table if not exists work_days (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  log_date date not null,
  weather text,
  delays text,
  notes text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  unique (project_id, log_date)
);

create table if not exists work_entries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  log_date date not null,
  worker_id uuid not null references workers(id) on delete restrict,
  boq_item_id uuid references boq_items(id) on delete set null,
  variation_id uuid references variations(id) on delete set null,
  cost_line_id uuid references cost_lines(id) on delete set null,
  days numeric not null default 1,
  ot_hours numeric not null default 0,
  piece_qty numeric,
  piece_rate numeric,
  note text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
alter table work_entries add column if not exists hours numeric;
create index if not exists work_entries_project on work_entries(project_id, log_date);
create index if not exists work_entries_worker on work_entries(worker_id, log_date);

create table if not exists work_qty (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  log_date date not null,
  boq_item_id uuid not null references boq_items(id) on delete cascade,
  qty numeric not null default 0,
  note text,
  created_at timestamptz not null default now()
);
create index if not exists work_qty_project on work_qty(project_id, log_date);

create table if not exists purchase_orders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  number text,
  supplier_name text not null,
  order_date date,
  expected_date date,
  status text not null default 'open' check (status in ('open','partial','delivered','closed','cancelled')),
  delivery_notes text,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists po_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  po_id uuid not null references purchase_orders(id) on delete cascade,
  boq_item_id uuid references boq_items(id) on delete set null,
  variation_id uuid references variations(id) on delete set null,
  cost_line_id uuid references cost_lines(id) on delete set null,
  description text,
  qty numeric not null default 0,
  unit text,
  unit_price numeric not null default 0,
  delivered_qty numeric not null default 0,
  sort int not null default 0
);
create index if not exists po_lines_po on po_lines(po_id);

alter table expenses add column if not exists po_id uuid references purchase_orders(id) on delete set null;
alter table expenses add column if not exists cost_line_id uuid references cost_lines(id) on delete set null;
alter table expenses add column if not exists qty numeric;
alter table expenses add column if not exists unit text;


-- ===== שלב 4: חשבונות חלקיים, קנסות ותקבולים =====
create table if not exists bills (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  number int not null,
  period_to date,
  bill_date date,
  submitted_date date,
  approved_date date,
  due_date date,
  status text not null default 'draft' check (status in ('draft','submitted','partial','approved','paid')),
  index_value numeric,
  offsets numeric not null default 0,
  offsets_note text,
  notes text,
  created_at timestamptz not null default now(),
  unique (project_id, number)
);

create table if not exists bill_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  bill_id uuid not null references bills(id) on delete cascade,
  boq_item_id uuid not null references boq_items(id) on delete cascade,
  cum_qty_sub numeric,
  cum_qty_app numeric,
  note text,
  unique (bill_id, boq_item_id)
);
create index if not exists bill_lines_bill on bill_lines(bill_id);
-- שלב 5: סיבת קיצוץ לשורה
alter table bill_lines add column if not exists cut_reason text;

create table if not exists bill_fines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  bill_id uuid not null references bills(id) on delete cascade,
  description text not null,
  amount numeric not null default 0,
  disputed boolean not null default false,
  note text
);

create table if not exists bill_payments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  bill_id uuid not null references bills(id) on delete cascade,
  pay_date date not null,
  amount numeric not null default 0,
  method text,
  note text
);

-- מי יכול לרשום ביומן: מנהלת, בעלים, ומנהל עבודה בפרויקטים שלו. הלקוח של הרשומה חייב להיות הלקוח של הפרויקט.
create or replace function can_log(p uuid, t uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from projects pr where pr.id = p and pr.tenant_id = t)
     and coalesce(tenant_role(t), '') in ('admin','owner','foreman') and can_see_project(p)
$$;

-- רשימת עובדים לשטח: שמות וסוג העסקה בלבד, בלי שכר ותעריפים
drop function if exists field_workers(uuid);
create or replace function field_workers(t uuid)
returns table(id uuid, name text, pay_type text, trade text, active boolean)
language sql stable security definer set search_path = public as $$
  select w.id, w.name, w.pay_type, w.trade, w.active from workers w
  where w.tenant_id = t and tenant_role(t) is not null order by w.name
$$;


create or replace function worker_in_tenant(w uuid, t uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from workers where id = w and tenant_id = t)
$$;

-- שמירת יום עבודה שלם בפעולה אחת (מחליפה את רישומי היום). ההרשאות נבדקות לפי מי שקורא.
create or replace function save_work_day(p uuid, d date, payload jsonb)
returns text language plpgsql security invoker set search_path = public as $$
declare t uuid;
begin
  select tenant_id into t from projects where id = p;
  if t is null or not can_log(p, t) then raise exception 'אין הרשאה'; end if;
  delete from work_entries where project_id = p and log_date = d;
  delete from work_qty where project_id = p and log_date = d;
  if coalesce((payload->>'delete')::boolean, false) then
    delete from work_days where project_id = p and log_date = d;
    return 'deleted';
  end if;
  insert into work_days(tenant_id, project_id, log_date, weather, delays, notes)
  values (t, p, d, payload->>'weather', payload->>'delays', payload->>'notes')
  on conflict (project_id, log_date) do update set weather = excluded.weather, delays = excluded.delays, notes = excluded.notes;
  insert into work_entries(tenant_id, project_id, log_date, worker_id, boq_item_id, variation_id, days, hours, ot_hours, piece_qty, note)
  select t, p, d, (e->>'worker_id')::uuid, nullif(e->>'boq_item_id', '')::uuid, nullif(e->>'variation_id', '')::uuid,
         coalesce(nullif(e->>'days', '')::numeric, 1), nullif(e->>'hours', '')::numeric, coalesce(nullif(e->>'ot_hours', '')::numeric, 0), nullif(e->>'piece_qty', '')::numeric, e->>'note'
  from jsonb_array_elements(coalesce(payload->'entries', '[]'::jsonb)) e;
  insert into work_qty(tenant_id, project_id, log_date, boq_item_id, qty, note)
  select t, p, d, (q->>'boq_item_id')::uuid, coalesce(nullif(q->>'qty', '')::numeric, 0), q->>'note'
  from jsonb_array_elements(coalesce(payload->'qty', '[]'::jsonb)) q;
  return 'ok';
end $$;

-- ===== RLS =====
alter table profiles enable row level security;
alter table tenants enable row level security;
alter table memberships enable row level security;
alter table main_contractors enable row level security;
alter table projects enable row level security;
alter table variations enable row level security;
alter table boq_items enable row level security;
alter table cost_lines enable row level security;
alter table change_log enable row level security;
alter table expenses enable row level security;

drop policy if exists p_profiles_self on profiles;
create policy p_profiles_self on profiles for select using (user_id = auth.uid() or is_service_admin());
drop policy if exists p_tenants_sel on tenants;
create policy p_tenants_sel on tenants for select using (tenant_role(id) is not null);
drop policy if exists p_tenants_ins on tenants;
create policy p_tenants_ins on tenants for insert with check (is_service_admin());
drop policy if exists p_tenants_upd on tenants;
create policy p_tenants_upd on tenants for update using (tenant_role(id) in ('admin','owner'));
drop policy if exists p_tenants_del on tenants;
create policy p_tenants_del on tenants for delete using (is_service_admin());

drop policy if exists p_members_sel on memberships;
create policy p_members_sel on memberships for select using (user_id = auth.uid() or tenant_role(tenant_id) in ('admin','owner'));
drop policy if exists p_members_del on memberships;
create policy p_members_del on memberships for delete using (tenant_role(tenant_id) in ('admin','owner'));

-- קבלנים ראשיים ופרויקטים: כולם בלקוח רואים (מנהל עבודה רק פרויקטים שלו), עורכים: מנהלת ובעלים
drop policy if exists p_mc_sel on main_contractors;
create policy p_mc_sel on main_contractors for select using (tenant_role(tenant_id) in ('admin','owner','accountant','viewer'));
drop policy if exists p_mc_all on main_contractors;
create policy p_mc_all on main_contractors for all using (tenant_role(tenant_id) in ('admin','owner')) with check (tenant_role(tenant_id) in ('admin','owner'));

drop policy if exists p_proj_sel on projects;
create policy p_proj_sel on projects for select using (can_see_project(id));
drop policy if exists p_proj_all on projects;
create policy p_proj_all on projects for all using (tenant_role(tenant_id) in ('admin','owner')) with check (tenant_role(tenant_id) in ('admin','owner'));

-- מחירים: מנהל עבודה לא רואה בכלל (מקבל את field_boq)
drop policy if exists p_boq_sel on boq_items;
create policy p_boq_sel on boq_items for select using (tenant_role(tenant_id) in ('admin','owner','accountant','viewer'));
drop policy if exists p_boq_all on boq_items;
create policy p_boq_all on boq_items for all using (tenant_role(tenant_id) in ('admin','owner')) with check (tenant_role(tenant_id) in ('admin','owner'));

drop policy if exists p_vo_sel on variations;
create policy p_vo_sel on variations for select using (tenant_role(tenant_id) in ('admin','owner','accountant','viewer'));
drop policy if exists p_vo_all on variations;
create policy p_vo_all on variations for all using (tenant_role(tenant_id) in ('admin','owner')) with check (tenant_role(tenant_id) in ('admin','owner'));

-- תמחיר: מנהלת, בעלים וצפייה
drop policy if exists p_cost_sel on cost_lines;
create policy p_cost_sel on cost_lines for select using (tenant_role(tenant_id) in ('admin','owner','viewer'));
drop policy if exists p_cost_all on cost_lines;
create policy p_cost_all on cost_lines for all using (tenant_role(tenant_id) in ('admin','owner')) with check (tenant_role(tenant_id) in ('admin','owner'));


-- הוצאות: הנהלת חשבונות מזינה ומעדכנת; מנהל עבודה לא רואה סכומים
drop policy if exists p_exp_sel on expenses;
create policy p_exp_sel on expenses for select using (tenant_role(tenant_id) in ('admin','owner','accountant','viewer'));
drop policy if exists p_exp_all on expenses;
create policy p_exp_all on expenses for all using (tenant_role(tenant_id) in ('admin','owner','accountant')) with check (tenant_role(tenant_id) in ('admin','owner','accountant'));

drop policy if exists p_log_sel on change_log;
create policy p_log_sel on change_log for select using (tenant_role(tenant_id) in ('admin','owner'));
drop policy if exists p_log_ins on change_log;
create policy p_log_ins on change_log for insert with check (tenant_role(tenant_id) is not null);


alter table workers enable row level security;
alter table work_days enable row level security;
alter table work_entries enable row level security;
alter table work_qty enable row level security;
alter table purchase_orders enable row level security;
alter table po_lines enable row level security;

-- עובדים ושכר: לא למנהל עבודה (הוא מקבל את field_workers)
drop policy if exists p_workers_sel on workers;
create policy p_workers_sel on workers for select using (tenant_role(tenant_id) in ('admin','owner','accountant','viewer'));
drop policy if exists p_workers_all on workers;
create policy p_workers_all on workers for all using (tenant_role(tenant_id) in ('admin','owner','accountant')) with check (tenant_role(tenant_id) in ('admin','owner','accountant'));

-- יומן עבודה: כל מי שרואה את הפרויקט קורא; רושמים מנהלת, בעלים ומנהל עבודה
drop policy if exists p_wd_sel on work_days;
create policy p_wd_sel on work_days for select using (can_see_project(project_id));
drop policy if exists p_wd_all on work_days;
create policy p_wd_all on work_days for all using (can_log(project_id, tenant_id)) with check (can_log(project_id, tenant_id));
drop policy if exists p_we_sel on work_entries;
create policy p_we_sel on work_entries for select using (can_see_project(project_id));
drop policy if exists p_we_all on work_entries;
create policy p_we_all on work_entries for all using (can_log(project_id, tenant_id)) with check (can_log(project_id, tenant_id) and worker_in_tenant(worker_id, tenant_id));
drop policy if exists p_wq_sel on work_qty;
create policy p_wq_sel on work_qty for select using (can_see_project(project_id));
drop policy if exists p_wq_all on work_qty;
create policy p_wq_all on work_qty for all using (can_log(project_id, tenant_id)) with check (can_log(project_id, tenant_id));

-- רכש: מנהלת, בעלים והנהלת חשבונות
drop policy if exists p_po_sel on purchase_orders;
create policy p_po_sel on purchase_orders for select using (tenant_role(tenant_id) in ('admin','owner','accountant','viewer'));
drop policy if exists p_po_all on purchase_orders;
create policy p_po_all on purchase_orders for all using (tenant_role(tenant_id) in ('admin','owner','accountant')) with check (tenant_role(tenant_id) in ('admin','owner','accountant'));
drop policy if exists p_pol_sel on po_lines;
create policy p_pol_sel on po_lines for select using (tenant_role(tenant_id) in ('admin','owner','accountant','viewer'));
drop policy if exists p_pol_all on po_lines;
create policy p_pol_all on po_lines for all using (tenant_role(tenant_id) in ('admin','owner','accountant')) with check (tenant_role(tenant_id) in ('admin','owner','accountant'));

grant execute on function field_workers(uuid) to authenticated;
grant execute on function save_work_day(uuid, date, jsonb) to authenticated;


alter table bills enable row level security;
-- שלב 5: סטטוס קנס (הוטל / בערעור / בוטל). קנס שבוטל לא מנוכה. disputed נשאר לתאימות.
alter table bill_fines add column if not exists status text not null default 'imposed';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'bill_fines_status_chk') then
    alter table bill_fines add constraint bill_fines_status_chk check (status in ('imposed','appeal','cancelled'));
    update bill_fines set status = 'appeal' where disputed;
  end if;
end $$;

alter table bill_lines enable row level security;
alter table bill_fines enable row level security;
alter table bill_payments enable row level security;
-- חשבונות: מנהלת, בעלים והנהלת חשבונות עורכים; צפייה קוראת. מנהל עבודה לא רואה.
drop policy if exists p_b_sel on bills;
create policy p_b_sel on bills for select using (tenant_role(tenant_id) in ('admin','owner','accountant','viewer'));
drop policy if exists p_b_all on bills;
create policy p_b_all on bills for all using (tenant_role(tenant_id) in ('admin','owner','accountant')) with check (tenant_role(tenant_id) in ('admin','owner','accountant'));
drop policy if exists p_bl_sel on bill_lines;
create policy p_bl_sel on bill_lines for select using (tenant_role(tenant_id) in ('admin','owner','accountant','viewer'));
drop policy if exists p_bl_all on bill_lines;
create policy p_bl_all on bill_lines for all using (tenant_role(tenant_id) in ('admin','owner','accountant')) with check (tenant_role(tenant_id) in ('admin','owner','accountant'));
drop policy if exists p_bf_sel on bill_fines;
create policy p_bf_sel on bill_fines for select using (tenant_role(tenant_id) in ('admin','owner','accountant','viewer'));
drop policy if exists p_bf_all on bill_fines;
create policy p_bf_all on bill_fines for all using (tenant_role(tenant_id) in ('admin','owner','accountant')) with check (tenant_role(tenant_id) in ('admin','owner','accountant'));
drop policy if exists p_bp_sel on bill_payments;
create policy p_bp_sel on bill_payments for select using (tenant_role(tenant_id) in ('admin','owner','accountant','viewer'));
drop policy if exists p_bp_all on bill_payments;
create policy p_bp_all on bill_payments for all using (tenant_role(tenant_id) in ('admin','owner','accountant')) with check (tenant_role(tenant_id) in ('admin','owner','accountant'));


-- ===== שלב 7: ספקים וקבלנים, מסמכים עם תוקף, ערבויות, ספר טלפונים, חשבון סופי =====
create table if not exists vendors (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null,
  kind text not null default 'supplier' check (kind in ('supplier','contractor','service')),
  company_no text,
  contact_name text,
  phone text,
  email text,
  bank text,
  pay_terms_days int,
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists vendors_tenant on vendors(tenant_id);

-- מסמך של ספק/קבלן (vendor_id), או מסמך של הלקוח עצמו מול קבלן ראשי (main_contractor_id), או של הלקוח באופן כללי (שניהם ריקים)
create table if not exists documents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  vendor_id uuid references vendors(id) on delete cascade,
  main_contractor_id uuid references main_contractors(id) on delete cascade,
  project_id uuid references projects(id) on delete cascade,
  doc_type text not null default 'other' check (doc_type in ('insurance','license','books','tax','safety','other')),
  title text,
  number text,
  issue_date date,
  expiry date,
  link text,
  notes text,
  created_at timestamptz not null default now()
);
create index if not exists documents_tenant on documents(tenant_id);

create table if not exists guarantees (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  project_id uuid references projects(id) on delete cascade,
  main_contractor_id uuid references main_contractors(id) on delete set null,
  kind text not null default 'performance' check (kind in ('performance','advance','warranty','tender','other')),
  bank text,
  number text,
  amount numeric not null default 0,
  issue_date date,
  expiry date,
  status text not null default 'active' check (status in ('active','returned')),
  returned_date date,
  notes text,
  created_at timestamptz not null default now()
);
create index if not exists guarantees_tenant on guarantees(tenant_id);

create table if not exists contacts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null,
  company text,
  role text,
  phone text,
  phone2 text,
  email text,
  vendor_id uuid references vendors(id) on delete set null,
  main_contractor_id uuid references main_contractors(id) on delete set null,
  notes text,
  created_at timestamptz not null default now()
);
create index if not exists contacts_tenant on contacts(tenant_id);

-- חשבון סופי: תנאי סגירה בפרויקט וסימון החשבון
alter table projects add column if not exists completion_date date;
alter table projects add column if not exists warranty_months int not null default 12;
alter table projects add column if not exists as_made_ok boolean not null default false;
alter table projects add column if not exists rejects_ok boolean not null default false;
alter table projects add column if not exists retention_released numeric not null default 0;
alter table bills add column if not exists is_final boolean not null default false;

alter table vendors enable row level security;
alter table documents enable row level security;
alter table guarantees enable row level security;
alter table contacts enable row level security;
-- ספקים, מסמכים וערבויות: מנהלת, בעלים והנהלת חשבונות עורכים; צפייה קוראת
drop policy if exists p_v_sel on vendors;
create policy p_v_sel on vendors for select using (tenant_role(tenant_id) in ('admin','owner','accountant','viewer'));
drop policy if exists p_v_all on vendors;
create policy p_v_all on vendors for all using (tenant_role(tenant_id) in ('admin','owner','accountant')) with check (tenant_role(tenant_id) in ('admin','owner','accountant'));
drop policy if exists p_d_sel on documents;
create policy p_d_sel on documents for select using (tenant_role(tenant_id) in ('admin','owner','accountant','viewer'));
drop policy if exists p_d_all on documents;
create policy p_d_all on documents for all using (tenant_role(tenant_id) in ('admin','owner','accountant')) with check (tenant_role(tenant_id) in ('admin','owner','accountant'));
drop policy if exists p_g_sel on guarantees;
create policy p_g_sel on guarantees for select using (tenant_role(tenant_id) in ('admin','owner','accountant','viewer'));
drop policy if exists p_g_all on guarantees;
create policy p_g_all on guarantees for all using (tenant_role(tenant_id) in ('admin','owner','accountant')) with check (tenant_role(tenant_id) in ('admin','owner','accountant'));
-- ספר טלפונים: כל מי שבלקוח קורא (גם מנהל עבודה); עורכים: מנהלת, בעלים, הנהלת חשבונות
drop policy if exists p_c_sel on contacts;
create policy p_c_sel on contacts for select using (tenant_role(tenant_id) is not null);
drop policy if exists p_c_all on contacts;
create policy p_c_all on contacts for all using (tenant_role(tenant_id) in ('admin','owner','accountant')) with check (tenant_role(tenant_id) in ('admin','owner','accountant'));

-- ===== שלב 8: תיבת מסמכים, קבצים וקליטה חכמה =====
create table if not exists files (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  project_id uuid references projects(id) on delete set null,
  name text not null,
  mime text,
  size bigint,
  path text not null,
  doc_type text,
  status text not null default 'new' check (status in ('new','review','done','stored','error')),
  extracted jsonb,
  links jsonb not null default '[]',
  drive_id text,
  note text,
  error text,
  uploaded_by uuid default auth.uid(),
  uploaded_email text,
  created_at timestamptz not null default now(),
  done_at timestamptz
);
create index if not exists files_tenant on files(tenant_id, created_at desc);
alter table files enable row level security;
-- מנהלת, בעלים והנהלת חשבונות: הכול. מנהל עבודה: מעלה ורואה רק את מה שהעלה בעצמו (צילום תעודות משלוח)
drop policy if exists p_f_sel on files;
create policy p_f_sel on files for select using (tenant_role(tenant_id) in ('admin','owner','accountant') or (tenant_role(tenant_id) = 'foreman' and uploaded_by = auth.uid()));
drop policy if exists p_f_ins on files;
create policy p_f_ins on files for insert with check (tenant_role(tenant_id) in ('admin','owner','accountant')
  or (tenant_role(tenant_id) = 'foreman' and uploaded_by = auth.uid() and project_id is not null and can_see_project(project_id) and status = 'new'));
drop policy if exists p_f_upd on files;
create policy p_f_upd on files for update using (tenant_role(tenant_id) in ('admin','owner','accountant')) with check (tenant_role(tenant_id) in ('admin','owner','accountant'));
drop policy if exists p_f_del on files;
create policy p_f_del on files for delete using (tenant_role(tenant_id) in ('admin','owner','accountant'));

-- התראות שנשלחו במייל (כדי לא לשלוח את אותה התראה פעמיים)
create table if not exists alert_log (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  key text not null,
  title text,
  sent_to text,
  sent_at timestamptz not null default now(),
  unique (tenant_id, key)
);
alter table alert_log enable row level security;
drop policy if exists p_al_all on alert_log;
create policy p_al_all on alert_log for all using (tenant_role(tenant_id) in ('admin','owner','accountant')) with check (tenant_role(tenant_id) in ('admin','owner','accountant'));

-- אחסון הקבצים: תיקייה ראשונה בנתיב = מזהה הלקוח
insert into storage.buckets (id, name, public, file_size_limit) values ('files', 'files', false, 26214400) on conflict (id) do nothing;
drop policy if exists subcon_files_sel on storage.objects;
create policy subcon_files_sel on storage.objects for select to authenticated using (bucket_id = 'files' and (
  tenant_role(((storage.foldername(name))[1])::uuid) in ('admin','owner','accountant')
  or (tenant_role(((storage.foldername(name))[1])::uuid) = 'foreman' and owner = auth.uid())));
drop policy if exists subcon_files_ins on storage.objects;
create policy subcon_files_ins on storage.objects for insert to authenticated with check (bucket_id = 'files'
  and tenant_role(((storage.foldername(name))[1])::uuid) in ('admin','owner','accountant','foreman'));
drop policy if exists subcon_files_del on storage.objects;
create policy subcon_files_del on storage.objects for delete to authenticated using (bucket_id = 'files'
  and tenant_role(((storage.foldername(name))[1])::uuid) in ('admin','owner','accountant'));

grant execute on function claim_service_admin() to authenticated;
grant execute on function add_member(uuid, text, text, uuid[]) to authenticated;
grant execute on function tenant_members(uuid) to authenticated;
grant execute on function field_boq(uuid) to authenticated;

-- הרשאות טבלה למשתמשים מחוברים (ההגבלה בפועל נעשית ב-RLS למעלה)
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
revoke all on all tables in schema public from anon;

-- ===== שלב 9: תשלומים לספקים =====
alter table expenses add column if not exists pay_method text;
alter table expenses add column if not exists pay_ref text;

-- ===== חבילה 12: פרויקט יזם, תקציב עם בסיס נעול, התקשרויות =====
-- סוג פרויקט: sub = קבלן משנה (כמו עד היום), dev = יזם / בעלים (תקציב, התקשרויות, חשבונות קבלנים)
alter table projects add column if not exists project_type text not null default 'sub';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'projects_type_chk') then
    alter table projects add constraint projects_type_chk check (project_type in ('sub','dev'));
  end if;
end $$;
-- בסיס מאושר: צילום של סכום כל סעיף ברגע הנעילה
alter table projects add column if not exists baseline jsonb;
alter table projects add column if not exists baseline_at timestamptz;
alter table projects add column if not exists baseline_note text;

-- ספק / קבלן / יועץ
alter table vendors drop constraint if exists vendors_kind_check;
alter table vendors add constraint vendors_kind_check check (kind in ('supplier','contractor','service','consultant'));

create table if not exists contracts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  vendor_id uuid references vendors(id) on delete set null,
  vendor_name text,
  number text,
  title text not null,
  kind text not null default 'contractor' check (kind in ('contractor','supplier','consultant','other')),
  status text not null default 'signed' check (status in ('draft','signed','closed','cancelled')),
  signed_date date,
  pay_terms_days int,
  retention_pct numeric not null default 0,
  advance_amount numeric not null default 0,
  advance_offset_pct numeric not null default 0,
  indexation boolean not null default false,
  base_index numeric,
  notes text,
  created_at timestamptz not null default now()
);
create index if not exists contracts_project on contracts(project_id);

create table if not exists contract_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  contract_id uuid not null references contracts(id) on delete cascade,
  boq_item_id uuid references boq_items(id) on delete set null,
  code text,
  description text not null,
  unit text,
  qty numeric,
  unit_price numeric,
  sort int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists contract_lines_contract on contract_lines(contract_id);

alter table guarantees add column if not exists vendor_id uuid references vendors(id) on delete set null;
alter table guarantees add column if not exists contract_id uuid references contracts(id) on delete set null;
alter table expenses add column if not exists contract_id uuid references contracts(id) on delete set null;

alter table contracts enable row level security;
alter table contract_lines enable row level security;
drop policy if exists p_ct_sel on contracts;
create policy p_ct_sel on contracts for select using (tenant_role(tenant_id) in ('admin','owner','accountant','viewer'));
drop policy if exists p_ct_all on contracts;
create policy p_ct_all on contracts for all using (tenant_role(tenant_id) in ('admin','owner')) with check (tenant_role(tenant_id) in ('admin','owner'));
drop policy if exists p_ctl_sel on contract_lines;
create policy p_ctl_sel on contract_lines for select using (tenant_role(tenant_id) in ('admin','owner','accountant','viewer'));
drop policy if exists p_ctl_all on contract_lines;
create policy p_ctl_all on contract_lines for all using (tenant_role(tenant_id) in ('admin','owner')) with check (tenant_role(tenant_id) in ('admin','owner'));
grant select, insert, update, delete on contracts, contract_lines to authenticated;

-- ===== חבילה 13: הוראות שינוי ליזם, חשבונות קבלנים ובדיקתם, חשבונית כחוק =====
-- הוראת שינוי מול קבלן / ספק בפרויקט יזם. מסלול: בקשה, בדיקה ותמחור, אישור בכתב, ביצוע ומדידה (נכלל בחשבון ושולם מחושבים לפי החשבונות)
create table if not exists change_orders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  contract_id uuid references contracts(id) on delete set null,
  vendor_name text,
  boq_item_id uuid references boq_items(id) on delete set null,
  number text,
  title text not null,
  initiator text not null default 'developer' check (initiator in ('developer','architect','consultant','contractor','authority','buyer','other')),
  initiator_name text,
  reason text,
  schedule_days int not null default 0,
  stage text not null default 'request' check (stage in ('request','pricing','approved','executed','billed','paid','rejected')),
  request_date date,
  approved_date date,
  approved_by text,
  approval_ref text,
  executed_date date,
  price_analysis text,
  decision_note text,
  notes text,
  created_at timestamptz not null default now()
);
create index if not exists change_orders_project on change_orders(project_id);

-- שורות הוראת שינוי: ארבעה מחירים, כולם ניתנים לשינוי ידני
create table if not exists co_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  co_id uuid not null references change_orders(id) on delete cascade,
  contract_line_id uuid references contract_lines(id) on delete set null,
  description text not null,
  unit text,
  qty numeric,
  price_sale numeric,
  price_contract numeric,
  price_requested numeric,
  price_approved numeric,
  sort int not null default 0
);
create index if not exists co_lines_co on co_lines(co_id);

-- חשבון מצטבר שקבלן / ספק מגיש ליזם
create table if not exists cbills (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  contract_id uuid not null references contracts(id) on delete cascade,
  number int not null,
  period_to date,
  received_date date,
  invoice_no text,
  invoice_date date,
  invoice_legal boolean not null default false,
  status text not null default 'received' check (status in ('received','checked','recommended','approved','paid')),
  index_value numeric,
  other_deductions numeric not null default 0,
  other_note text,
  checked_by text,
  recommended_date date,
  approved_date date,
  paid_date date,
  doc_override text,
  notes text,
  created_at timestamptz not null default now(),
  unique (contract_id, number)
);
create index if not exists cbills_project on cbills(project_id);

create table if not exists cbill_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  cbill_id uuid not null references cbills(id) on delete cascade,
  contract_line_id uuid references contract_lines(id) on delete cascade,
  co_line_id uuid references co_lines(id) on delete cascade,
  cum_qty_sub numeric,
  price_sub numeric,
  cum_qty_app numeric,
  note text
);
create index if not exists cbill_lines_bill on cbill_lines(cbill_id);

-- תשלום לקבלן נרשם כהוצאה שמקושרת לחשבון
alter table expenses add column if not exists cbill_id uuid references cbills(id) on delete set null;

alter table change_orders enable row level security;
alter table co_lines enable row level security;
alter table cbills enable row level security;
alter table cbill_lines enable row level security;
do $$ declare t text; begin
  foreach t in array array['change_orders','co_lines','cbills','cbill_lines'] loop
    execute format('drop policy if exists %I on %I', 'p_' || t || '_sel', t);
    execute format('create policy %I on %I for select using (tenant_role(tenant_id) in (''admin'',''owner'',''accountant'',''viewer''))', 'p_' || t || '_sel', t);
    execute format('drop policy if exists %I on %I', 'p_' || t || '_all', t);
    execute format('create policy %I on %I for all using (tenant_role(tenant_id) in (''admin'',''owner'')) with check (tenant_role(tenant_id) in (''admin'',''owner''))', 'p_' || t || '_all', t);
  end loop;
end $$;
grant select, insert, update, delete on change_orders, co_lines, cbills, cbill_lines to authenticated;

-- ===== חבילה 14: הכנסות יזם, תזרים יזם, מצב והחלטה לכל התרעה, נמענים לפרויקט =====
create table if not exists dev_income (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  source text not null default 'buyer' check (source in ('buyer','bank','equity','other')),
  payer text,
  description text,
  due_date date,
  amount numeric not null default 0,
  status text not null default 'expected' check (status in ('expected','received')),
  received_date date,
  received_amount numeric,
  notes text,
  created_at timestamptz not null default now()
);
create index if not exists dev_income_project on dev_income(project_id);

-- מצב התרעה: פתוח / בטיפול / טופל, והחלטה נדרשת (נוסח שאפשר לערוך)
create table if not exists alert_state (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  project_id uuid references projects(id) on delete cascade,
  key text not null,
  title text,
  status text not null default 'open' check (status in ('open','in_progress','handled')),
  decision text,
  note text,
  updated_by text,
  updated_at timestamptz not null default now(),
  unique (tenant_id, key)
);

-- נמענים להתרעות בכל פרויקט (ללקוח: וואטסאפ ומייל)
alter table projects add column if not exists notify_name text;
alter table projects add column if not exists notify_phone text;
alter table projects add column if not exists notify_emails text;

alter table dev_income enable row level security;
alter table alert_state enable row level security;
drop policy if exists p_di_sel on dev_income;
create policy p_di_sel on dev_income for select using (tenant_role(tenant_id) in ('admin','owner','accountant','viewer'));
drop policy if exists p_di_all on dev_income;
create policy p_di_all on dev_income for all using (tenant_role(tenant_id) in ('admin','owner','accountant')) with check (tenant_role(tenant_id) in ('admin','owner','accountant'));
drop policy if exists p_as_sel on alert_state;
create policy p_as_sel on alert_state for select using (tenant_role(tenant_id) in ('admin','owner','accountant','viewer'));
drop policy if exists p_as_all on alert_state;
create policy p_as_all on alert_state for all using (tenant_role(tenant_id) in ('admin','owner','accountant')) with check (tenant_role(tenant_id) in ('admin','owner','accountant'));
grant select, insert, update, delete on dev_income, alert_state to authenticated;

-- ===== חבילה 17: אישור יזם להוראות שינוי (חתימה אלקטרונית פשוטה) =====
-- שלב חדש: ממתין לאישור יזם
alter table change_orders drop constraint if exists change_orders_stage_check;
alter table change_orders add constraint change_orders_stage_check check (stage in ('request','pricing','dev_approval','approved','executed','billed','paid','rejected'));
-- מי מאשר הוראות שינוי בפרויקט
alter table projects add column if not exists approver_name text;
alter table projects add column if not exists approver_email text;

-- בקשת אישור: קישור אישי (token) שנשלח ליזם במייל. נשמרים צילום הסכומים בזמן השליחה והחתימה.
create table if not exists co_signoffs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  co_id uuid not null references change_orders(id) on delete cascade,
  token uuid not null unique default gen_random_uuid(),
  sent_to text,
  sent_name text,
  sent_by text,
  sent_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '14 days',
  snapshot jsonb not null,
  status text not null default 'pending' check (status in ('pending','approved','rejected','cancelled')),
  signer_name text,
  signature text,
  signed_at timestamptz,
  signer_note text,
  signer_agent text,
  filed_file_id uuid,
  reminded_at timestamptz
);
create index if not exists co_signoffs_co on co_signoffs(co_id);
alter table co_signoffs enable row level security;
drop policy if exists p_cs_sel on co_signoffs;
create policy p_cs_sel on co_signoffs for select using (tenant_role(tenant_id) in ('admin','owner','accountant','viewer'));
drop policy if exists p_cs_all on co_signoffs;
create policy p_cs_all on co_signoffs for all using (tenant_role(tenant_id) in ('admin','owner','accountant')) with check (tenant_role(tenant_id) in ('admin','owner','accountant'));
grant select, insert, update, delete on co_signoffs to authenticated;

-- דף החתימה (בלי כניסה למערכת): רואה רק את הבקשה של הקישור האישי, ורק בזמן תוקף
create or replace function co_signoff_get(t uuid)
returns json language sql stable security definer set search_path = public as $$
  select json_build_object('status', case when s.status = 'pending' and s.expires_at < now() then 'expired' else s.status end,
    'expires_at', s.expires_at, 'sent_at', s.sent_at, 'sent_name', s.sent_name, 'snapshot', s.snapshot,
    'signer_name', s.signer_name, 'signed_at', s.signed_at, 'signer_note', s.signer_note)
  from co_signoffs s where s.token = t
$$;

create or replace function co_signoff_submit(t uuid, signer text, sig text, decision text, note text default null, agent text default null)
returns json language plpgsql security definer set search_path = public as $$
declare s co_signoffs; nm text;
begin
  select * into s from co_signoffs where token = t for update;
  if not found then raise exception 'הקישור לא נמצא'; end if;
  if s.status <> 'pending' then raise exception 'הבקשה כבר טופלה'; end if;
  if s.expires_at < now() then raise exception 'תוקף הקישור פג. צריך לבקש קישור חדש'; end if;
  if decision not in ('approved','rejected') then raise exception 'החלטה לא תקינה'; end if;
  if coalesce(trim(signer), '') = '' then raise exception 'חסר שם החותם'; end if;
  if decision = 'approved' and coalesce(sig, '') not like 'data:image/png;base64,%' then raise exception 'חסרה חתימה'; end if;
  if length(coalesce(sig, '')) > 400000 then raise exception 'החתימה גדולה מדי'; end if;
  update co_signoffs set status = decision, signer_name = trim(signer), signature = sig, signed_at = now(), signer_note = nullif(trim(coalesce(note, '')), ''), signer_agent = left(agent, 300) where id = s.id;
  nm := trim(signer);
  if decision = 'approved' then
    -- אישור (גם אישור מחדש אחרי שינוי): מעדכן את פרטי האישור; השלב מתקדם רק אם עוד לא אושר
    update change_orders set stage = case when stage in ('request','pricing','dev_approval') then 'approved' else stage end, approved_date = current_date, approved_by = nm,
      approval_ref = 'חתימה אלקטרונית ' || to_char(now() at time zone 'Asia/Jerusalem', 'DD.MM.YYYY HH24:MI') where id = s.co_id and stage <> 'rejected';
  else
    update change_orders set stage = 'rejected', decision_note = coalesce(nullif(trim(coalesce(note, '')), ''), decision_note) where id = s.co_id and stage in ('request','pricing','dev_approval');
  end if;
  insert into change_log (tenant_id, project_id, entity, entity_id, label, field, old_value, new_value, reason, user_id, user_name)
  values (s.tenant_id, s.project_id, 'change_order', s.co_id, coalesce(s.snapshot->'co'->>'number', '') || ' ' || coalesce(s.snapshot->'co'->>'title', ''), 'אישור יזם', 'ממתין לאישור יזם',
    case when decision = 'approved' then 'אושר בחתימה' else 'נדחה' end, nullif(trim(coalesce(note, '')), ''), null, nm || ' (דף חתימה)');
  return json_build_object('status', decision, 'signed_at', now());
end $$;
grant execute on function co_signoff_get(uuid) to anon, authenticated;
grant execute on function co_signoff_submit(uuid, text, text, text, text, text) to anon, authenticated;

-- ===== חבילה 18: מודולים בפרויקט, מדד חודשי, עלויות חודשיות קבועות =====
-- אילו מודולים דלוקים בפרויקט. ריק = פרויקט מלפני החבילה (החלקים הקיימים דלוקים)
alter table projects add column if not exists modules jsonb;

-- מדד תשומות הבנייה: ערך אחד לכל חודש, משותף לכל הפרויקטים של הלקוח
create table if not exists index_series (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  month text not null check (month ~ '^\d{4}-\d{2}$'),
  value numeric not null check (value > 0),
  note text,
  created_at timestamptz not null default now(),
  unique (tenant_id, month)
);
alter table index_series enable row level security;
drop policy if exists p_ix_sel on index_series;
create policy p_ix_sel on index_series for select using (tenant_role(tenant_id) in ('admin','owner','accountant','viewer'));
drop policy if exists p_ix_all on index_series;
create policy p_ix_all on index_series for all using (tenant_role(tenant_id) in ('admin','owner','accountant')) with check (tenant_role(tenant_id) in ('admin','owner','accountant'));

-- עלויות חודשיות קבועות בפרויקט (מנהל עבודה, שמירה, מכולות, ביטוח...)
create table if not exists fixed_costs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  name text not null,
  amount numeric not null default 0,
  vat boolean not null default true,
  from_month text not null check (from_month ~ '^\d{4}-\d{2}$'),
  to_month text not null check (to_month ~ '^\d{4}-\d{2}$'),
  boq_item_id uuid references boq_items(id) on delete set null,
  supplier_name text,
  notes text,
  created_at timestamptz not null default now()
);
create index if not exists fixed_costs_project on fixed_costs(project_id);
alter table fixed_costs enable row level security;
drop policy if exists p_fc_sel on fixed_costs;
create policy p_fc_sel on fixed_costs for select using (tenant_role(tenant_id) in ('admin','owner','accountant','viewer'));
drop policy if exists p_fc_all on fixed_costs;
create policy p_fc_all on fixed_costs for all using (tenant_role(tenant_id) in ('admin','owner','accountant')) with check (tenant_role(tenant_id) in ('admin','owner','accountant'));
grant select, insert, update, delete on index_series, fixed_costs to authenticated;

-- ===== חבילה 19: פרויקט ביצוע (מול מזמין) ופריסה ארוכה =====
-- סוג שלישי: exec = ביצוע. החברה היא הקבלן מול מזמין. החישוב כמו קבלן משנה
alter table projects drop constraint if exists projects_type_chk;
alter table projects add constraint projects_type_chk check (project_type in ('sub','dev','exec'));
-- פריסה לאורך הפרויקט: { curve: 'linear'|'s', floors: [{ name, from_month, to_month, weight }] }
alter table projects add column if not exists spread jsonb;

-- ===== חבילה 20: הזמנת משתמשים =====
-- מי שעוד לא רשום מקבל הזמנה. כשהוא נרשם ונכנס, הוא מצטרף לבד ללקוח עם התפקיד שנבחר
create table if not exists member_invites (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  email text not null,
  role text not null check (role in ('owner','foreman','accountant','viewer')),
  project_ids uuid[] not null default '{}',
  invited_by text,
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  unique (tenant_id, email)
);
alter table member_invites enable row level security;
drop policy if exists p_inv_sel on member_invites;
create policy p_inv_sel on member_invites for select using (tenant_role(tenant_id) in ('admin','owner'));
drop policy if exists p_inv_del on member_invites;
create policy p_inv_del on member_invites for delete using (tenant_role(tenant_id) in ('admin','owner'));
grant select, delete on member_invites to authenticated;

create or replace function add_member(t uuid, member_email text, member_role text, member_projects uuid[] default '{}')
returns text language plpgsql security definer set search_path = public as $$
declare uid uuid; em text := lower(trim(member_email));
begin
  if coalesce(tenant_role(t), '') not in ('admin','owner') then raise exception 'אין הרשאה'; end if;
  if member_role not in ('owner','foreman','accountant','viewer') then raise exception 'תפקיד לא מוכר'; end if;
  if em !~ '^\S+@\S+\.\S+$' then raise exception 'אימייל לא תקין'; end if;
  select id into uid from auth.users where lower(email) = em;
  if uid is null then
    insert into member_invites(tenant_id, email, role, project_ids, invited_by)
    values (t, em, member_role, coalesce(member_projects,'{}'), (select email from auth.users where id = auth.uid()))
    on conflict (tenant_id, email) do update set role = excluded.role, project_ids = excluded.project_ids, accepted_at = null, created_at = now();
    return 'invited';
  end if;
  insert into memberships(tenant_id, user_id, role, project_ids) values (t, uid, member_role, coalesce(member_projects,'{}'))
  on conflict (tenant_id, user_id) do update set role = excluded.role, project_ids = excluded.project_ids;
  return 'ok';
end $$;

-- נקרא בכל כניסה: מצרף את המשתמש לכל הלקוחות שהזמינו את האימייל שלו
create or replace function accept_invites()
returns integer language plpgsql security definer set search_path = public as $$
declare em text; n integer := 0; r record;
begin
  if auth.uid() is null then return 0; end if;
  select lower(email) into em from auth.users where id = auth.uid();
  for r in select * from member_invites where lower(email) = em and accepted_at is null loop
    insert into memberships(tenant_id, user_id, role, project_ids) values (r.tenant_id, auth.uid(), r.role, r.project_ids)
    on conflict (tenant_id, user_id) do nothing;
    update member_invites set accepted_at = now() where id = r.id;
    n := n + 1;
  end loop;
  return n;
end $$;
grant execute on function add_member(uuid, text, text, uuid[]) to authenticated;
grant execute on function accept_invites() to authenticated;

-- ===== חבילה 20: מכירות וליווי בנקאי (יזם) =====
-- מלאי דירות: כל דירה עם מחיר מחירון, מצב, רוכש ולוח תשלומים. דירה שנמכרה יוצרת שורות ב"הכנסות היזם"
create table if not exists dev_units (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  name text not null,
  building text,
  floor text,
  rooms numeric,
  area numeric,
  list_price numeric not null default 0,
  status text not null default 'available' check (status in ('available','reserved','sold')),
  buyer text,
  buyer_phone text,
  buyer_email text,
  sale_date date,
  sale_price numeric,
  plan jsonb,
  notes text,
  sort integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists dev_units_project on dev_units(project_id);
alter table dev_units enable row level security;
drop policy if exists p_du_sel on dev_units;
create policy p_du_sel on dev_units for select using (tenant_role(tenant_id) in ('admin','owner','accountant','viewer'));
drop policy if exists p_du_all on dev_units;
create policy p_du_all on dev_units for all using (tenant_role(tenant_id) in ('admin','owner','accountant')) with check (tenant_role(tenant_id) in ('admin','owner','accountant'));
grant select, insert, update, delete on dev_units to authenticated;
alter table dev_income add column if not exists unit_id uuid references dev_units(id) on delete set null;
-- הגדרות מכירה: { pace, from_month, plan: [{ label, pct, offset, month }], forecast: true }
alter table projects add column if not exists sales jsonb;
-- ליווי בנקאי: { line, equity_pct, equity_amount, presale_pct, presale_basis, rate_pct, fee_pct }
alter table projects add column if not exists bank jsonb;

-- ===== חבילה 21: תבניות פרויקט, סגירת חודש, ארכיון שליחות =====
create table if not exists project_templates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null,
  project_type text not null default 'sub',
  data jsonb not null default '{}',
  created_by text,
  created_at timestamptz not null default now()
);
alter table project_templates enable row level security;
drop policy if exists p_tpl_sel on project_templates;
create policy p_tpl_sel on project_templates for select using (tenant_role(tenant_id) in ('admin','owner','accountant'));
drop policy if exists p_tpl_all on project_templates;
create policy p_tpl_all on project_templates for all using (tenant_role(tenant_id) in ('admin','owner')) with check (tenant_role(tenant_id) in ('admin','owner'));
grant select, insert, update, delete on project_templates to authenticated;

-- סגירת חודש: כל החודשים עד החודש האחרון שנסגר נעולים. snapshot = סיכום הבפועל לכל פרויקט ברגע הסגירה
create table if not exists month_closes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  month text not null,
  snapshot jsonb,
  closed_by text,
  closed_at timestamptz not null default now(),
  unique (tenant_id, month)
);
alter table month_closes enable row level security;
drop policy if exists p_mc_sel on month_closes;
create policy p_mc_sel on month_closes for select using (tenant_role(tenant_id) is not null);
drop policy if exists p_mc_all on month_closes;
create policy p_mc_all on month_closes for all using (tenant_role(tenant_id) in ('admin','owner','accountant')) with check (tenant_role(tenant_id) in ('admin','owner','accountant'));
grant select, insert, update, delete on month_closes to authenticated;
-- שורת תיקון: הוצאה או הכנסה שנרשמה בחודש פתוח ומתקנת חודש סגור
alter table expenses add column if not exists corr_month text;
alter table expenses add column if not exists correction_of uuid;
alter table dev_income add column if not exists corr_month text;
alter table dev_income add column if not exists correction_of uuid;

-- ארכיון: כל מה שיצא ללקוח (מייל, וואטסאפ, סיכום תקופתי)
create table if not exists send_log (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  project_id uuid references projects(id) on delete set null,
  channel text not null check (channel in ('email','whatsapp','digest')),
  kind text,
  recipients text,
  subject text,
  body text,
  attachments text,
  sent_by text,
  sent_at timestamptz not null default now()
);
create index if not exists send_log_tenant on send_log(tenant_id, sent_at desc);
alter table send_log enable row level security;
drop policy if exists p_sl_sel on send_log;
create policy p_sl_sel on send_log for select using (tenant_role(tenant_id) in ('admin','owner','accountant'));
drop policy if exists p_sl_ins on send_log;
create policy p_sl_ins on send_log for insert with check (tenant_role(tenant_id) is not null);
grant select, insert on send_log to authenticated;

-- ===== חבילה 22: ספר הטלפונים כמקום היחיד לטלפון ומייל =====
-- בכל מקום אחר שומרים קישור לאיש הקשר. שדות הטקסט (contact_name, phone, email וכו') נשארים כהעתק שמתעדכן לבד מהספר
alter table tenants add column if not exists contact_id uuid references contacts(id) on delete set null;
alter table main_contractors add column if not exists contact_id uuid references contacts(id) on delete set null;
alter table vendors add column if not exists contact_id uuid references contacts(id) on delete set null;
create table if not exists project_contacts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  contact_id uuid not null references contacts(id) on delete cascade,
  role text not null check (role in ('notify','approver')),
  sort int not null default 0,
  created_at timestamptz not null default now(),
  unique (project_id, contact_id, role)
);
create index if not exists project_contacts_project on project_contacts(project_id);
alter table project_contacts enable row level security;
drop policy if exists p_pc_sel on project_contacts;
create policy p_pc_sel on project_contacts for select using (tenant_role(tenant_id) is not null);
drop policy if exists p_pc_all on project_contacts;
create policy p_pc_all on project_contacts for all using (tenant_role(tenant_id) in ('admin','owner','accountant')) with check (tenant_role(tenant_id) in ('admin','owner','accountant'));
grant select, insert, update, delete on project_contacts to authenticated;

-- העברה חד פעמית: כל איש קשר שהוקלד במקום אחר נכנס לספר (או מתחבר לקיים לפי טלפון או מייל)
create or replace function pb_digits(v text) returns text language sql immutable as $$
  select nullif(regexp_replace(regexp_replace(coalesce(v,''), '\D', '', 'g'), '^972', '0'), '') $$;
create or replace function pb_find_or_add(t uuid, nm text, ph text, em text, comp text) returns uuid language plpgsql as $$
declare cid uuid; e text := lower(nullif(trim(coalesce(em,'')), ''));
begin
  if pb_digits(ph) is null and e is null then return null; end if;
  select id into cid from contacts where tenant_id = t and ((pb_digits(ph) is not null and pb_digits(phone) = pb_digits(ph)) or (e is not null and lower(email) = e)) order by created_at limit 1;
  if cid is null then
    insert into contacts(tenant_id, name, company, phone, email) values (t, coalesce(nullif(trim(nm),''), comp, e, ph), comp, nullif(trim(coalesce(ph,'')),''), e) returning id into cid;
  else
    update contacts set email = coalesce(email, e), phone = coalesce(phone, nullif(trim(coalesce(ph,'')),'')) where id = cid;
  end if;
  return cid;
end $$;
do $$
declare r record; cid uuid; em text; k int;
begin
  for r in select * from tenants where contact_id is null loop
    update tenants set contact_id = pb_find_or_add(r.id, r.contact_name, r.phone, r.email, r.name) where id = r.id; end loop;
  for r in select * from main_contractors where contact_id is null loop
    update main_contractors set contact_id = pb_find_or_add(r.tenant_id, r.contact_name, r.phone, r.email, r.name) where id = r.id; end loop;
  for r in select * from vendors where contact_id is null loop
    update vendors set contact_id = pb_find_or_add(r.tenant_id, r.contact_name, r.phone, r.email, r.name) where id = r.id; end loop;
  for r in select * from projects p where not exists (select 1 from project_contacts c where c.project_id = p.id) loop
    k := 0;
    if r.notify_phone is not null or r.notify_emails is not null then
      -- הטלפון עם המייל הראשון; כל מייל נוסף כאיש קשר משלו
      cid := pb_find_or_add(r.tenant_id, r.notify_name, r.notify_phone, split_part(regexp_replace(coalesce(r.notify_emails,''), '[\s;]+', ',', 'g'), ',', 1), null);
      if cid is not null then insert into project_contacts(tenant_id, project_id, contact_id, role, sort) values (r.tenant_id, r.id, cid, 'notify', k) on conflict do nothing; k := k + 1; end if;
      for em in select x from unnest(string_to_array(regexp_replace(coalesce(r.notify_emails,''), '[\s;]+', ',', 'g'), ',')) x offset 1 loop
        if trim(em) <> '' then cid := pb_find_or_add(r.tenant_id, null, null, em, null);
          insert into project_contacts(tenant_id, project_id, contact_id, role, sort) values (r.tenant_id, r.id, cid, 'notify', k) on conflict do nothing; k := k + 1; end if;
      end loop;
    end if;
    if r.approver_email is not null then
      cid := pb_find_or_add(r.tenant_id, r.approver_name, null, r.approver_email, null);
      if cid is not null then insert into project_contacts(tenant_id, project_id, contact_id, role) values (r.tenant_id, r.id, cid, 'approver') on conflict do nothing; end if;
    end if;
  end loop;
end $$;

-- ===== חבילה 23: מנהל עבודה מוסיף עובד ועבודה שלא ברשימה =====
alter table workers add column if not exists pending_rate boolean not null default false;
alter table workers add column if not exists added_by text;
alter table variations drop constraint if exists variations_source_check;
alter table variations add constraint variations_source_check check (source in ('change_order','supervisor','main_request','daywork','field'));
alter table variations add column if not exists from_field boolean not null default false;

-- עבודה שלא ברשימה ביומן (תיאור חופשי). is_vo = תוספת / הוראת שינוי: נפתחת לבד הוראת שינוי לטיפול המשרד
create table if not exists work_extras (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  log_date date not null,
  description text not null,
  unit text,
  qty numeric,
  note text,
  is_vo boolean not null default false,
  variation_id uuid references variations(id) on delete set null,
  boq_item_id uuid references boq_items(id) on delete set null,
  handled boolean not null default false,
  created_by text,
  created_at timestamptz not null default now()
);
create index if not exists work_extras_project on work_extras(project_id, log_date);
alter table work_extras enable row level security;
drop policy if exists p_wx_sel on work_extras;
create policy p_wx_sel on work_extras for select using (can_see_project(project_id));
drop policy if exists p_wx_all on work_extras;
create policy p_wx_all on work_extras for all using (can_log(project_id, tenant_id) or tenant_role(tenant_id) in ('admin','owner','accountant')) with check (can_log(project_id, tenant_id) or tenant_role(tenant_id) in ('admin','owner','accountant'));

create or replace function my_email() returns text language sql stable security definer set search_path = public as $$
  select email from auth.users where id = auth.uid()
$$;
grant execute on function my_email() to authenticated;

-- רשימת עובדים לשטח: גם סימון "ממתין לתעריף"
drop function if exists field_workers(uuid);
create or replace function field_workers(t uuid)
returns table(id uuid, name text, pay_type text, trade text, active boolean, pending_rate boolean)
language sql stable security definer set search_path = public as $$
  select w.id, w.name, w.pay_type, w.trade, w.active, w.pending_rate from workers w
  where w.tenant_id = t and tenant_role(t) is not null order by w.name
$$;
grant execute on function field_workers(uuid) to authenticated;

-- מנהל עבודה מוסיף עובד חדש מהשטח: בלי שכר, מסומן "ממתין לתעריף"
create or replace function field_add_worker(p uuid, wname text, wphone text, wpay text, wtrade text)
returns uuid language plpgsql security definer set search_path = public as $$
declare t uuid; wid uuid;
begin
  select tenant_id into t from projects where id = p;
  if t is null or not can_log(p, t) then raise exception 'אין הרשאה'; end if;
  if coalesce(trim(wname), '') = '' then raise exception 'חסר שם עובד'; end if;
  insert into workers(tenant_id, name, phone, pay_type, trade, active, pending_rate, added_by)
  values (t, trim(wname), nullif(trim(coalesce(wphone, '')), ''), case when wpay in ('salary','daily','hourly','piece') then wpay else 'daily' end,
          nullif(trim(coalesce(wtrade, '')), ''), true, true, (select email from auth.users where id = auth.uid()))
  returning id into wid;
  return wid;
end $$;
grant execute on function field_add_worker(uuid, text, text, text, text) to authenticated;

-- עבודה שסומנה כתוספת: פותחת הוראת שינוי (טיוטה) עם סעיף אחד, לתמחור ולגבייה במשרד
create or replace function field_extra_vo(x uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare e work_extras; vid uuid; k int;
begin
  select * into e from work_extras where id = x;
  if e.id is null or not can_log(e.project_id, e.tenant_id) then raise exception 'אין הרשאה'; end if;
  if e.variation_id is not null then return e.variation_id; end if;
  select count(*) + 1 into k from variations where project_id = e.project_id;
  insert into variations(tenant_id, project_id, number, title, source, status, vo_date, from_field, notes)
  values (e.tenant_id, e.project_id, 'VO-' || lpad(k::text, 2, '0'), e.description, 'field', 'draft', e.log_date, true,
          'נפתח מיומן העבודה ' || to_char(e.log_date, 'DD.MM.YYYY') || coalesce(' · ' || e.qty::text || ' ' || coalesce(e.unit, ''), '') || coalesce(' · ' || e.note, '') || coalesce(' · ' || e.created_by, ''))
  returning id into vid;
  insert into boq_items(tenant_id, project_id, variation_id, description, unit, qty)
  values (e.tenant_id, e.project_id, vid, e.description, e.unit, e.qty);
  update work_extras set variation_id = vid where id = x;
  return vid;
end $$;
grant execute on function field_extra_vo(uuid) to authenticated;

-- שמירת יום עבודה: גם עבודות שלא ברשימה (נשמרות לפי מזהה, כדי לא לאבד קישור להוראת שינוי)
create or replace function save_work_day(p uuid, d date, payload jsonb)
returns text language plpgsql security invoker set search_path = public as $$
declare t uuid; ids uuid[]; x jsonb; me text;
begin
  select tenant_id into t from projects where id = p;
  if t is null or not can_log(p, t) then raise exception 'אין הרשאה'; end if;
  delete from work_entries where project_id = p and log_date = d;
  delete from work_qty where project_id = p and log_date = d;
  if coalesce((payload->>'delete')::boolean, false) then
    delete from work_extras where project_id = p and log_date = d and variation_id is null;
    delete from work_days where project_id = p and log_date = d;
    return 'deleted';
  end if;
  insert into work_days(tenant_id, project_id, log_date, weather, delays, notes)
  values (t, p, d, payload->>'weather', payload->>'delays', payload->>'notes')
  on conflict (project_id, log_date) do update set weather = excluded.weather, delays = excluded.delays, notes = excluded.notes;
  insert into work_entries(tenant_id, project_id, log_date, worker_id, boq_item_id, variation_id, days, hours, ot_hours, piece_qty, note)
  select t, p, d, (e->>'worker_id')::uuid, nullif(e->>'boq_item_id', '')::uuid, nullif(e->>'variation_id', '')::uuid,
         coalesce(nullif(e->>'days', '')::numeric, 1), nullif(e->>'hours', '')::numeric, coalesce(nullif(e->>'ot_hours', '')::numeric, 0), nullif(e->>'piece_qty', '')::numeric, e->>'note'
  from jsonb_array_elements(coalesce(payload->'entries', '[]'::jsonb)) e;
  insert into work_qty(tenant_id, project_id, log_date, boq_item_id, qty, note)
  select t, p, d, (q->>'boq_item_id')::uuid, coalesce(nullif(q->>'qty', '')::numeric, 0), q->>'note'
  from jsonb_array_elements(coalesce(payload->'qty', '[]'::jsonb)) q;
  if payload ? 'extras' then
    me := my_email();
    select coalesce(array_agg((x2->>'id')::uuid), '{}') into ids from jsonb_array_elements(payload->'extras') x2 where coalesce(x2->>'id', '') <> '';
    delete from work_extras where project_id = p and log_date = d and variation_id is null and not (id = any(ids));
    for x in select * from jsonb_array_elements(payload->'extras') loop
      if coalesce(trim(x->>'description'), '') = '' then continue; end if;
      insert into work_extras(id, tenant_id, project_id, log_date, description, unit, qty, note, is_vo, created_by)
      values (coalesce(nullif(x->>'id', '')::uuid, gen_random_uuid()), t, p, d, trim(x->>'description'), nullif(x->>'unit', ''), nullif(x->>'qty', '')::numeric, nullif(x->>'note', ''), coalesce((x->>'is_vo')::boolean, false), me)
      on conflict (id) do update set description = excluded.description, unit = excluded.unit, qty = excluded.qty, note = excluded.note, is_vo = excluded.is_vo;
      if coalesce((x->>'is_vo')::boolean, false) then
        perform field_extra_vo(coalesce(nullif(x->>'id', '')::uuid, (select id from work_extras where project_id = p and log_date = d and description = trim(x->>'description') order by created_at desc limit 1)));
      end if;
    end loop;
  end if;
  return 'ok';
end $$;

-- ספר הטלפונים: מנהל עבודה לא רואה אותו
drop policy if exists p_c_sel on contacts;
create policy p_c_sel on contacts for select using (tenant_role(tenant_id) in ('admin','owner','accountant','viewer'));

-- ===== חבילה 24: חתימות =====
-- בקשת חתימה כללית: חשבון קבלן (היזם מאשר לתשלום) או הוראת שינוי בפרויקט קבלן משנה (הקבלן הראשי / המזמין מאשר)
create table if not exists doc_signoffs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  kind text not null check (kind in ('cbill','variation')),
  cbill_id uuid references cbills(id) on delete cascade,
  variation_id uuid references variations(id) on delete cascade,
  token uuid not null unique default gen_random_uuid(),
  sent_to text,
  sent_name text,
  sent_by text,
  sent_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '14 days',
  snapshot jsonb not null,
  status text not null default 'pending' check (status in ('pending','approved','rejected','cancelled')),
  signer_name text,
  signature text,
  signed_at timestamptz,
  signer_note text,
  signer_agent text,
  filed_file_id uuid,
  reminded_at timestamptz
);
create index if not exists doc_signoffs_cbill on doc_signoffs(cbill_id);
create index if not exists doc_signoffs_var on doc_signoffs(variation_id);
alter table doc_signoffs enable row level security;
drop policy if exists p_ds_sel on doc_signoffs;
create policy p_ds_sel on doc_signoffs for select using (tenant_role(tenant_id) in ('admin','owner','accountant','viewer'));
drop policy if exists p_ds_all on doc_signoffs;
create policy p_ds_all on doc_signoffs for all using (tenant_role(tenant_id) in ('admin','owner','accountant')) with check (tenant_role(tenant_id) in ('admin','owner','accountant'));
grant select, insert, update, delete on doc_signoffs to authenticated;

create or replace function doc_signoff_get(t uuid)
returns json language sql stable security definer set search_path = public as $$
  select json_build_object('kind', s.kind, 'status', case when s.status = 'pending' and s.expires_at < now() then 'expired' else s.status end,
    'expires_at', s.expires_at, 'sent_at', s.sent_at, 'sent_name', s.sent_name, 'sent_to', s.sent_to, 'snapshot', s.snapshot,
    'signer_name', s.signer_name, 'signed_at', s.signed_at, 'signer_note', s.signer_note, 'signature', s.signature)
  from doc_signoffs s where s.token = t
$$;

create or replace function doc_signoff_submit(t uuid, signer text, sig text, decision text, note text default null, agent text default null)
returns json language plpgsql security definer set search_path = public as $$
declare s doc_signoffs; nm text; nt text; b cbills; v variations; sn jsonb; lbl text;
begin
  select * into s from doc_signoffs where token = t for update;
  if not found then raise exception 'הקישור לא נמצא'; end if;
  if s.status <> 'pending' then raise exception 'הבקשה כבר טופלה'; end if;
  if s.expires_at < now() then raise exception 'תוקף הקישור פג. צריך לבקש קישור חדש'; end if;
  if decision not in ('approved','rejected') then raise exception 'החלטה לא תקינה'; end if;
  if coalesce(trim(signer), '') = '' then raise exception 'חסר שם החותם'; end if;
  if decision = 'approved' and coalesce(sig, '') not like 'data:image/png;base64,%' then raise exception 'חסרה חתימה'; end if;
  if length(coalesce(sig, '')) > 400000 then raise exception 'החתימה גדולה מדי'; end if;
  nm := trim(signer); nt := nullif(trim(coalesce(note, '')), ''); sn := s.snapshot;
  if s.kind = 'cbill' then
    select * into b from cbills where id = s.cbill_id for update;
    if b.id is null then raise exception 'החשבון נמחק. אין מה לאשר'; end if;
    if b.status <> 'recommended' then raise exception 'החשבון כבר לא ממתין לאישור (הסטטוס שלו השתנה). צריך לבקש קישור חדש'; end if;
    lbl := coalesce(sn->'bill'->>'vendor', '') || ' חשבון ' || coalesce(sn->'bill'->>'number', '');
    if decision = 'approved' then
      update cbills set status = 'approved', approved_date = current_date where id = b.id;
      -- התשלום נכנס לתזרים, כמו אישור ידני
      if not exists (select 1 from expenses where cbill_id = b.id) then
        insert into expenses(tenant_id, project_id, cbill_id, contract_id, supplier_name, kind, doc_no, doc_date, description, amount, vat_pct, status)
        values (b.tenant_id, b.project_id, b.id, b.contract_id, sn->'bill'->>'vendor', 'sub', b.invoice_no, coalesce(b.invoice_date, current_date),
          'חשבון ' || b.number || ' · ' || coalesce(sn->'bill'->>'contract', ''), round(coalesce((sn->'totals'->>'net')::numeric, 0), 2), coalesce((sn->'totals'->>'vat_pct')::numeric, 18), 'approved');
      end if;
    else
      update cbills set status = 'checked', notes = concat_ws(E'\n', nullif(notes, ''), 'היזם דחה (' || nm || '): ' || coalesce(nt, 'בלי הערה')) where id = b.id;
    end if;
    insert into change_log (tenant_id, project_id, entity, entity_id, label, field, old_value, new_value, reason, user_id, user_name)
    values (s.tenant_id, s.project_id, 'cbill', b.id, lbl, 'אישור יזם לחשבון', 'הומלץ לתשלום', case when decision = 'approved' then 'אושר בחתימה' else 'נדחה, חזר לבדיקה' end, nt, null, nm || ' (דף חתימה)');
  else
    select * into v from variations where id = s.variation_id for update;
    if v.id is null then raise exception 'הוראת השינוי נמחקה. אין מה לאשר'; end if;
    lbl := v.number || ' ' || v.title;
    if decision = 'approved' then
      update variations set status = case when status in ('draft','submitted','executed_unapproved') then 'approved' else status end, has_written_order = true where id = v.id and status <> 'rejected';
    else
      update variations set status = 'rejected', notes = concat_ws(E'\n', nullif(notes, ''), 'נדחה בחתימה (' || nm || '): ' || coalesce(nt, 'בלי הערה')) where id = v.id and status in ('draft','submitted','executed_unapproved');
    end if;
    insert into change_log (tenant_id, project_id, entity, entity_id, label, field, old_value, new_value, reason, user_id, user_name)
    values (s.tenant_id, s.project_id, 'variation', v.id, lbl, 'אישור בחתימה', 'נשלח לחתימה', case when decision = 'approved' then 'אושר בחתימה' else 'נדחה' end, nt, null, nm || ' (דף חתימה)');
  end if;
  update doc_signoffs set status = decision, signer_name = nm, signature = sig, signed_at = now(), signer_note = nt, signer_agent = left(agent, 300) where id = s.id;
  return json_build_object('status', decision, 'signed_at', now());
end $$;
grant execute on function doc_signoff_get(uuid) to anon, authenticated;
grant execute on function doc_signoff_submit(uuid, text, text, text, text, text) to anon, authenticated;

-- חתימת מפקח על יום עבודה (לא חובה): נחתמת בטלפון של מנהל העבודה. sup_snapshot = מה שנחתם (כמויות ותוספות)
alter table work_days add column if not exists sup_name text;
alter table work_days add column if not exists sup_sig text;
alter table work_days add column if not exists sup_signed_at timestamptz;
alter table work_days add column if not exists sup_note text;
alter table work_days add column if not exists sup_snapshot jsonb;

create or replace function save_work_day(p uuid, d date, payload jsonb)
returns text language plpgsql security invoker set search_path = public as $$
declare t uuid; ids uuid[]; x jsonb; me text; sp jsonb;
begin
  select tenant_id into t from projects where id = p;
  if t is null or not can_log(p, t) then raise exception 'אין הרשאה'; end if;
  delete from work_entries where project_id = p and log_date = d;
  delete from work_qty where project_id = p and log_date = d;
  if coalesce((payload->>'delete')::boolean, false) then
    delete from work_extras where project_id = p and log_date = d and variation_id is null;
    delete from work_days where project_id = p and log_date = d;
    return 'deleted';
  end if;
  insert into work_days(tenant_id, project_id, log_date, weather, delays, notes)
  values (t, p, d, payload->>'weather', payload->>'delays', payload->>'notes')
  on conflict (project_id, log_date) do update set weather = excluded.weather, delays = excluded.delays, notes = excluded.notes;
  -- חתימת מפקח: נשמרת רק אם נשלחה. null = הסרת החתימה
  if payload ? 'sup' then
    sp := payload->'sup';
    if sp is null or jsonb_typeof(sp) = 'null' then
      update work_days set sup_name = null, sup_sig = null, sup_signed_at = null, sup_note = null, sup_snapshot = null where project_id = p and log_date = d;
    else
      if coalesce(sp->>'sig', '') not like 'data:image/png;base64,%' or length(sp->>'sig') > 400000 then raise exception 'חתימת המפקח לא תקינה'; end if;
      update work_days set sup_name = nullif(trim(coalesce(sp->>'name', '')), ''), sup_sig = sp->>'sig', sup_signed_at = coalesce(nullif(sp->>'signed_at', '')::timestamptz, now()),
        sup_note = nullif(trim(coalesce(sp->>'note', '')), ''), sup_snapshot = sp->'snapshot' where project_id = p and log_date = d;
    end if;
  end if;
  insert into work_entries(tenant_id, project_id, log_date, worker_id, boq_item_id, variation_id, days, hours, ot_hours, piece_qty, note)
  select t, p, d, (e->>'worker_id')::uuid, nullif(e->>'boq_item_id', '')::uuid, nullif(e->>'variation_id', '')::uuid,
         coalesce(nullif(e->>'days', '')::numeric, 1), nullif(e->>'hours', '')::numeric, coalesce(nullif(e->>'ot_hours', '')::numeric, 0), nullif(e->>'piece_qty', '')::numeric, e->>'note'
  from jsonb_array_elements(coalesce(payload->'entries', '[]'::jsonb)) e;
  insert into work_qty(tenant_id, project_id, log_date, boq_item_id, qty, note)
  select t, p, d, (q->>'boq_item_id')::uuid, coalesce(nullif(q->>'qty', '')::numeric, 0), q->>'note'
  from jsonb_array_elements(coalesce(payload->'qty', '[]'::jsonb)) q;
  if payload ? 'extras' then
    me := my_email();
    select coalesce(array_agg((x2->>'id')::uuid), '{}') into ids from jsonb_array_elements(payload->'extras') x2 where coalesce(x2->>'id', '') <> '';
    delete from work_extras where project_id = p and log_date = d and variation_id is null and not (id = any(ids));
    for x in select * from jsonb_array_elements(payload->'extras') loop
      if coalesce(trim(x->>'description'), '') = '' then continue; end if;
      insert into work_extras(id, tenant_id, project_id, log_date, description, unit, qty, note, is_vo, created_by)
      values (coalesce(nullif(x->>'id', '')::uuid, gen_random_uuid()), t, p, d, trim(x->>'description'), nullif(x->>'unit', ''), nullif(x->>'qty', '')::numeric, nullif(x->>'note', ''), coalesce((x->>'is_vo')::boolean, false), me)
      on conflict (id) do update set description = excluded.description, unit = excluded.unit, qty = excluded.qty, note = excluded.note, is_vo = excluded.is_vo;
      if coalesce((x->>'is_vo')::boolean, false) then
        perform field_extra_vo(coalesce(nullif(x->>'id', '')::uuid, (select id from work_extras where project_id = p and log_date = d and description = trim(x->>'description') order by created_at desc limit 1)));
      end if;
    end loop;
  end if;
  return 'ok';
end $$;

-- ===== חבילה 25: חריגה בחשבון קבלן (מאושר מעל המוגש או מעל החוזה) =====
-- לא נחסם, אבל כל חריגה מוסברת: הערה או קישור להוראת שינוי מאותה התקשרות
alter table cbill_lines add column if not exists over_reason text;
alter table cbill_lines add column if not exists over_co_id uuid references change_orders(id) on delete set null;

-- ===== חבילה 29: פרק "תקורות אתר" =====
-- סעיף תקורה: פנימי, עם עלות בתמחיר ובפועל, בלי מכירה. לא מופיע בכתב הכמויות למזמין ולא בחשבונות
alter table boq_items add column if not exists is_overhead boolean not null default false;

-- ===== בדיקת התקנה (גל 1, 11.11.2026) =====
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
