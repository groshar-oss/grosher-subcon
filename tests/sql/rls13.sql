\set ON_ERROR_STOP 1
-- חבילה 13: הרשאות לטבלאות הוראות שינוי וחשבונות קבלנים (רץ אחרי rls.sql)
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
insert into contracts(id,tenant_id,project_id,title) values ('40000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','c');
insert into change_orders(id,tenant_id,project_id,contract_id,title) values ('50000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','co');
insert into cbills(id,tenant_id,project_id,contract_id,number) values ('60000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001',1);
select (select count(*) from cbills) owner_cbills_1, (select count(*) from change_orders) owner_cos_1;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';
select (select count(*) from cbills) fore_cbills_0, (select count(*) from change_orders) fore_cos_0;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000d';
select (select count(*) from cbills) acc_cbills_1;
do $$ begin
  begin insert into cbills(tenant_id,project_id,contract_id,number) values ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001',2); raise exception 'accountant insert should fail';
  exception when insufficient_privilege then raise notice 'acc insert blocked ok'; end;
end $$;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000e';
select (select count(*) from cbills) stranger_cbills_0;
-- חבילה 14
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000d';
insert into dev_income(tenant_id,project_id,amount) values ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',100);
insert into alert_state(tenant_id,key) values ('10000000-0000-0000-0000-000000000001','k1');
select (select count(*) from dev_income) acc_income_1, (select count(*) from alert_state) acc_state_1;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';
select (select count(*) from dev_income) fore_income_0, (select count(*) from alert_state) fore_state_0;
