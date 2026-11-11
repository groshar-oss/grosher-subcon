\set ON_ERROR_STOP 1
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
insert into projects(id,tenant_id,name,project_type) values ('20000000-0000-0000-0000-0000000000d1','10000000-0000-0000-0000-000000000001','DEV','dev');
insert into contracts(id,tenant_id,project_id,title,vendor_name,status) values ('50000000-0000-0000-0000-0000000000c1','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-0000000000d1','שלד','קבלן א','signed');
insert into cbills(id,tenant_id,project_id,contract_id,number,status,invoice_no) values ('60000000-0000-0000-0000-0000000000b1','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-0000000000d1','50000000-0000-0000-0000-0000000000c1',1,'recommended','INV1');
insert into doc_signoffs(id,tenant_id,project_id,kind,cbill_id,token,snapshot,sent_to) values ('70000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-0000000000d1','cbill','60000000-0000-0000-0000-0000000000b1','80000000-0000-0000-0000-000000000001',
 '{"bill":{"vendor":"קבלן א","number":1,"contract":"שלד"},"totals":{"net":1000.4,"vat_pct":18,"total":1180}}','dev@x.com');
-- variation in sub project P1
insert into variations(id,tenant_id,project_id,number,title,status) values ('90000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','VO-01','תוספת','draft');
insert into doc_signoffs(tenant_id,project_id,kind,variation_id,token,snapshot) values ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','variation','90000000-0000-0000-0000-000000000001','80000000-0000-0000-0000-000000000002','{"vo":{"number":"VO-01"}}');
insert into doc_signoffs(tenant_id,project_id,kind,variation_id,token,snapshot) values ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','variation','90000000-0000-0000-0000-000000000001','80000000-0000-0000-0000-000000000003','{"vo":{"number":"VO-01"}}');
-- foreman cannot see signoffs
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';
select count(*) fore_ds_0 from doc_signoffs;
-- anonymous signer
reset request.jwt.claim.sub;
set role anon;
select doc_signoff_get('80000000-0000-0000-0000-000000000001')->>'status' anon_get_pending;
select doc_signoff_submit('80000000-0000-0000-0000-000000000001','דני יזם','data:image/png;base64,AAA','approved','ok') ->>'status' approved;
\set ON_ERROR_STOP 0
select 'expect error already handled' x; select doc_signoff_submit('80000000-0000-0000-0000-000000000001','דני','data:image/png;base64,AAA','approved');
select 'expect error no signature' x; select doc_signoff_submit('80000000-0000-0000-0000-000000000002','דני',null,'approved');
\set ON_ERROR_STOP 1
select doc_signoff_submit('80000000-0000-0000-0000-000000000002','קבלן ראשי','data:image/png;base64,AAA','approved') ->>'status' var_approved;
\set ON_ERROR_STOP 0
reset role;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select status cbill_status_approved, approved_date is not null has_date from cbills where id='60000000-0000-0000-0000-0000000000b1';
select amount exp_1000_4, status, supplier_name, cbill_id is not null from expenses where cbill_id='60000000-0000-0000-0000-0000000000b1';
select status var_approved, has_written_order from variations where id='90000000-0000-0000-0000-000000000001';
select count(*) log_2 from change_log where user_name like '%(דף חתימה)';
-- rejection path: second bill
update cbills set status='recommended' where id='60000000-0000-0000-0000-0000000000b1';
insert into doc_signoffs(tenant_id,project_id,kind,cbill_id,token,snapshot) values ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-0000000000d1','cbill','60000000-0000-0000-0000-0000000000b1','80000000-0000-0000-0000-000000000004','{"bill":{"vendor":"א","number":1}}');
update cbills set status='checked' where id='60000000-0000-0000-0000-0000000000b1';
set role anon;
select 'expect error status changed' x; select doc_signoff_submit('80000000-0000-0000-0000-000000000004','דני','data:image/png;base64,AAA','approved');
reset role; set role authenticated;
update cbills set status='recommended' where id='60000000-0000-0000-0000-0000000000b1';
set role anon;
select doc_signoff_submit('80000000-0000-0000-0000-000000000004','דני',null,'rejected','חסר פירוט') ->>'status' rejected;
reset role; set role authenticated;
select status back_checked, notes from cbills where id='60000000-0000-0000-0000-0000000000b1';
-- supervisor signature through save_work_day (foreman)
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';
select save_work_day('20000000-0000-0000-0000-000000000001','2026-10-20','{"weather":null,"entries":[],"qty":[],"extras":[],"sup":{"name":"מפקח","sig":"data:image/png;base64,AAA","note":"תקין","snapshot":{"sig":"x","lines":["a"]}}}') save1;
select sup_name, sup_note, sup_snapshot->'lines' from work_days where log_date='2026-10-20';
select save_work_day('20000000-0000-0000-0000-000000000001','2026-10-20','{"weather":"rain","entries":[],"qty":[]}') save_keep;
select sup_name kept, weather from work_days where log_date='2026-10-20';
select save_work_day('20000000-0000-0000-0000-000000000001','2026-10-20','{"weather":"rain","entries":[],"qty":[],"sup":null}') save_clear;
select sup_name is null cleared from work_days where log_date='2026-10-20';
select 'expect error bad sig' x; select save_work_day('20000000-0000-0000-0000-000000000001','2026-10-20','{"sup":{"name":"x","sig":"javascript:1"}}');
