\set ON_ERROR_STOP 1
-- grants come from schema.sql
insert into auth.users(id,email) values
 ('00000000-0000-0000-0000-00000000000a','admin@x.com'),('00000000-0000-0000-0000-00000000000b','owner@x.com'),
 ('00000000-0000-0000-0000-00000000000c','fore@x.com'),('00000000-0000-0000-0000-00000000000d','acc@x.com'),
 ('00000000-0000-0000-0000-00000000000e','stranger@x.com');
set role authenticated;
-- admin claims
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
select claim_service_admin() as admin_claimed;
insert into tenants(id,name) values ('10000000-0000-0000-0000-000000000001','T1');
insert into projects(id,tenant_id,name) values ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','P1'),('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','P2');
insert into boq_items(id,tenant_id,project_id,code,description,qty,unit_price) values ('30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','1.01','x',10,100);
insert into cost_lines(tenant_id,project_id,boq_item_id,kind,description,qty,unit_cost) values ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','material','m',1,50);
select add_member('10000000-0000-0000-0000-000000000001','OWNER@x.com','owner') a1,
       add_member('10000000-0000-0000-0000-000000000001','fore@x.com','foreman',array['20000000-0000-0000-0000-000000000001']::uuid[]) a2,
       add_member('10000000-0000-0000-0000-000000000001','acc@x.com','accountant') a3,
       add_member('10000000-0000-0000-0000-000000000001','nobody@x.com','viewer') a4;
-- second claim by owner must fail
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select claim_service_admin() as owner_claim_should_be_false,
 (select count(*) from projects) owner_projects, (select count(*) from cost_lines) owner_costs;
-- foreman
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';
select (select count(*) from projects) fore_projects_1, (select count(*) from boq_items) fore_boq_0,
 (select count(*) from cost_lines) fore_cost_0, (select count(*) from field_boq('20000000-0000-0000-0000-000000000001')) fore_field_1,
 (select count(*) from field_boq('20000000-0000-0000-0000-000000000002')) fore_field_p2_0, (select count(*) from tenant_members('10000000-0000-0000-0000-000000000001')) fore_members_0;
-- accountant
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000d';
select (select count(*) from projects) acc_proj_2, (select count(*) from boq_items) acc_boq_1, (select count(*) from cost_lines) acc_cost_0;
insert into expenses(tenant_id,project_id,kind,description,amount) values ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','material','inv',500);
select count(*) acc_expenses_1 from expenses;
-- stranger
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000e';
select (select count(*) from tenants) str_t_0,(select count(*) from projects) str_p_0,(select count(*) from expenses) str_e_0, claim_service_admin() str_claim_false;
\set ON_ERROR_STOP 0
insert into tenants(name) values ('hack');
select add_member('10000000-0000-0000-0000-000000000001','stranger@x.com','owner');
-- owner members list
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select count(*) owner_members_3 from tenant_members('10000000-0000-0000-0000-000000000001');
-- ===== שלב 3 =====
\set ON_ERROR_STOP 0
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
insert into workers(id,tenant_id,name,pay_type,monthly_salary) values ('40000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','W1','salary',9000);
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';
select (select count(*) from workers) fore_workers_0, (select count(*) from field_workers('10000000-0000-0000-0000-000000000001')) fore_fieldworkers_1;
insert into work_entries(tenant_id,project_id,log_date,worker_id,days) values ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','2026-10-01','40000000-0000-0000-0000-000000000001',1);
select 'expect RLS error (P2 not assigned):' x;
insert into work_entries(tenant_id,project_id,log_date,worker_id,days) values ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','2026-10-01','40000000-0000-0000-0000-000000000001',1);
select count(*) fore_entries_1 from work_entries;
select 'expect RLS error (po):' x;
insert into purchase_orders(tenant_id,project_id,supplier_name) values ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','s');
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000d';
select 'expect RLS error (accountant log):' x;
insert into work_entries(tenant_id,project_id,log_date,worker_id,days) values ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','2026-10-02','40000000-0000-0000-0000-000000000001',1);
insert into purchase_orders(tenant_id,project_id,supplier_name) values ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','s');
select (select count(*) from purchase_orders) acc_po_1, (select count(*) from workers) acc_workers_1, (select count(*) from work_entries) acc_entries_1;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000e';
select (select count(*) from work_entries) str_0, (select count(*) from field_workers('10000000-0000-0000-0000-000000000001')) str_fw_0;
-- save_work_day
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';
select save_work_day('20000000-0000-0000-0000-000000000001','2026-10-05','{"notes":"n","entries":[{"worker_id":"40000000-0000-0000-0000-000000000001","days":1,"ot_hours":2},{"worker_id":"40000000-0000-0000-0000-000000000001","days":0.5}],"qty":[{"boq_item_id":"30000000-0000-0000-0000-000000000001","qty":12}]}') fore_save_ok;
select save_work_day('20000000-0000-0000-0000-000000000001','2026-10-05','{"entries":[{"worker_id":"40000000-0000-0000-0000-000000000001","days":1}]}') resave;
select (select count(*) from work_entries where log_date='2026-10-05') entries_1, (select count(*) from work_qty) qty_0, (select count(*) from work_days) days_1;
select 'expect error (P2):' x;
select save_work_day('20000000-0000-0000-0000-000000000002','2026-10-05','{"entries":[]}');
select save_work_day('20000000-0000-0000-0000-000000000001','2026-10-05','{"delete":true}') del;
select (select count(*) from work_days) days_0;
-- שלב 4
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000d';
insert into bills(tenant_id,project_id,number,status) values ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',1,'draft');
select count(*) acc_bills_1 from bills;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';
select count(*) fore_bills_0 from bills;
-- שלבים 5-7
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000d';
insert into vendors(tenant_id,name,kind) values ('10000000-0000-0000-0000-000000000001','ספק','contractor');
insert into documents(tenant_id,doc_type,expiry) values ('10000000-0000-0000-0000-000000000001','insurance','2027-01-01');
insert into guarantees(tenant_id,project_id,amount) values ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',1000);
insert into contacts(tenant_id,name,phone) values ('10000000-0000-0000-0000-000000000001','איש','050');
insert into bill_fines(tenant_id,project_id,bill_id,description,amount,status) select tenant_id,project_id,id,'קנס',100,'cancelled' from bills limit 1;
select (select count(*) from vendors) acc_v_1, (select count(*) from documents) acc_d_1, (select count(*) from guarantees) acc_g_1, (select count(*) from contacts) acc_c_1, (select status from bill_fines limit 1) fine_cancelled;
select 'expect check error (fine status):' x;
insert into bill_fines(tenant_id,project_id,bill_id,description,amount,status) select tenant_id,project_id,id,'קנס',100,'bad' from bills limit 1;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';
select (select count(*) from vendors) fore_v_0, (select count(*) from documents) fore_d_0, (select count(*) from guarantees) fore_g_0, (select count(*) from contacts) fore_c_1;
select 'expect RLS error (foreman contact):' x;
insert into contacts(tenant_id,name) values ('10000000-0000-0000-0000-000000000001','x');
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000e';
select (select count(*) from vendors) str_v_0, (select count(*) from contacts) str_c_0, (select count(*) from guarantees) str_g_0;
-- ===== שלב 8: קבצים, אחסון ושעתי =====
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
insert into workers(tenant_id,name,pay_type,hourly_rate) values ('10000000-0000-0000-0000-000000000001','שעתי','hourly',55);
select save_work_day('20000000-0000-0000-0000-000000000001','2026-10-05', jsonb_build_object('entries', jsonb_build_array(jsonb_build_object('worker_id',(select id from workers where name='שעתי'),'days',0.667,'hours',6)))) saved_hourly;
select hours as hourly_hours_6 from work_entries where log_date='2026-10-05';
insert into files(tenant_id,name,path) values ('10000000-0000-0000-0000-000000000001','admin.pdf','10000000-0000-0000-0000-000000000001/x/admin.pdf');
insert into storage.objects(bucket_id,name) values ('files','10000000-0000-0000-0000-000000000001/x/admin.pdf');
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';
insert into files(tenant_id,project_id,name,path,doc_type) values ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','tm.jpg','10000000-0000-0000-0000-000000000001/x/tm.jpg','delivery');
select 'expect RLS error (foreman file without project):' x;
insert into files(tenant_id,name,path,doc_type) values ('10000000-0000-0000-0000-000000000001','np.jpg','10000000-0000-0000-0000-000000000001/x/np.jpg','delivery');
insert into storage.objects(bucket_id,name) values ('files','10000000-0000-0000-0000-000000000001/x/tm.jpg');
select (select count(*) from files) fore_files_1, (select count(*) from storage.objects) fore_objects_1;
select 'expect RLS error (foreman updates file):' x;
update files set status='done' where name='tm.jpg' returning id;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000d';
select (select count(*) from files) acc_files_2, (select count(*) from storage.objects) acc_objects_2;
insert into alert_log(tenant_id,key) values ('10000000-0000-0000-0000-000000000001','k1');
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000e';
select (select count(*) from files) str_files_0, (select count(*) from storage.objects) str_objects_0, (select count(*) from alert_log) str_al_0;
select 'expect RLS error (stranger uploads):' x;
insert into storage.objects(bucket_id,name) values ('files','10000000-0000-0000-0000-000000000001/x/evil.pdf');
