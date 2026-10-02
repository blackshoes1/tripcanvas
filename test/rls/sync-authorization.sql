-- 합성 데이터만 사용한다. 협업 시나리오 뒤 같은 임시 DB에서 실행한다.
\set ON_ERROR_STOP on
reset role;
create temp table t_authz_out(k text primary key, v text);
grant insert, select on t_authz_out to public;
set role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-00000000000a"}',false);
select applied from public.sync_trip('authz-regression','{"name":"before","days":[]}',null,false);
select applied from public.sync_trip('authz-regression','{"name":"after","days":[]}',1,false);
insert into t_authz_out select 'authz.same_retry', applied||':'||conflict||':'||revision
  from public.sync_trip('authz-regression','{"days":[],"name":"after"}',1,false);
reset role;
insert into public.trip_members(trip_id,user_id,role,status,joined_at)
  select id,'00000000-0000-0000-0000-00000000000b','EDITOR','ACTIVE',now()
  from public.trips where client_id='authz-regression';
set role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-00000000000a"}',false);
select applied from public.tombstone_trip('authz-regression',2,false);
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-00000000000b"}',false);
do $$ begin
  perform public.sync_trip('authz-regression','{"name":"unauthorized revival","days":[]}',3,true);
  insert into t_authz_out values('authz.editor_revive','allowed');
exception when others then insert into t_authz_out values('authz.editor_revive',sqlstate); end $$;
insert into t_authz_out select 'authz.editor_tombstone_conflict', applied||':'||conflict||':'||revision
  from public.sync_trip('authz-regression','{"name":"after","days":[]}',3,false);
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-00000000000a"}',false);
insert into t_authz_out select 'authz.owner_revive', applied||':'||conflict||':'||revision
  from public.sync_trip('authz-regression','{"name":"owner revival","days":[]}',3,true);
select public.manage_trip_member((select m.id from public.trip_members m join public.trips t on t.id=m.trip_id
  where t.client_id='authz-regression' and m.user_id='00000000-0000-0000-0000-00000000000b'),'SET_ROLE','VIEWER');
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-00000000000b"}',false);
do $$ begin
  perform public.sync_trip('authz-regression','{"name":"viewer edit","days":[]}',4,true);
  insert into t_authz_out values('authz.viewer_force','allowed');
exception when others then insert into t_authz_out values('authz.viewer_force',sqlstate); end $$;
reset role;
insert into t_authz_out select 'authz.no_owned_copy', count(*)::text from public.trips
  where client_id='authz-regression' and user_id='00000000-0000-0000-0000-00000000000b';
insert into t_authz_out select 'authz.unchanged_after_viewer', (data->>'name')||':'||revision from public.trips where client_id='authz-regression';
insert into t_authz_out select 'authz.public_invoker', (not prosecdef)::text from pg_proc
  where oid='public.sync_trip(text,jsonb,bigint,boolean)'::regprocedure;
insert into t_authz_out select 'authz.anon_helper_blocked', (not has_function_privilege('anon','tc_private.lock_trip_role(text)','EXECUTE'))::text;
select 'OUT:'||k||'='||coalesce(v,'<null>') from t_authz_out order by k;
