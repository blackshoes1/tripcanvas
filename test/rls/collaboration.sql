-- 함께하기 RLS·RPC 시나리오 (§88~§94). 한 psql 세션에서 postgres로 시작해 set role로 사용자를 바꿔 가며 돈다.
-- 결과는 t_out(k,v)에 쌓고, test/rls.integration.test.js가 기대값과 맞춰 본다.
-- 실패가 기대되는 호출은 do 블록 안에서 sqlstate를 기록한다 (42501 = insufficient_privilege).
\set ON_ERROR_STOP on
\set QUIET on

create temp table t_out(k text primary key, v text);
grant insert, select on t_out to public;

insert into auth.users(id,email) values
  ('00000000-0000-0000-0000-00000000000a','a@example.com'),   -- A: 주최자
  ('00000000-0000-0000-0000-00000000000b','b@example.com'),   -- B: 초대받는 사람
  ('00000000-0000-0000-0000-00000000000c','c@example.com');   -- C: 멤버가 아닌 사람

-- ── A가 여행을 만든다 ──
set role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-00000000000a"}',false);
select applied, revision from public.sync_trip('trip1','{"id":"trip1","name":"스페인","start":"2026-10-25","days":[{"spots":[]},{"spots":[]}]}'::jsonb,null,false);
insert into t_out select 'a.trips', count(*)::text from public.trips;
insert into t_out select 'a.owner_member', (select count(*) from public.trip_members m join public.trips t on t.id=m.trip_id where t.client_id='trip1' and m.role='OWNER' and m.status='ACTIVE')::text;
insert into t_out select 'a.roles', string_agg(role||':'||member_count, ',') from public.my_trip_roles();

-- ── B는 초대 전에는 아무것도 못 본다 ──
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-00000000000b"}',false);
insert into t_out select 'b.before.trips', count(*)::text from public.trips;
insert into t_out select 'b.before.members', count(*)::text from public.trip_members;
insert into t_out select 'b.before.invites', count(*)::text from public.trip_invites;
insert into t_out select 'b.before.list_members', count(*)::text from public.list_trip_members('trip1');
-- B는 제 여행을 만들 수 있고(격리), 그것이 A의 여행을 건드리지 않는다
select applied from public.sync_trip('b-own','{"id":"b-own","name":"B의 여행","days":[{"spots":[]}]}'::jsonb,null,false);
insert into t_out select 'b.own.trips', count(*)::text from public.trips;

-- ── B가 A의 여행에 초대 링크를 만들려 하면 거절된다 ──
do $$ begin perform public.create_trip_invite('trip1','EDITOR',168,null); insert into t_out values('b.invite.forbidden','ok');
  exception when others then insert into t_out values('b.invite.forbidden',sqlstate); end $$;

-- ── A가 편집자 초대 링크를 만든다 ──
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-00000000000a"}',false);
create temp table t_inv as select * from public.create_trip_invite('trip1','EDITOR',168,null);
grant select on t_inv to public;
insert into t_out select 'a.invite.token_len', length(token)::text from t_inv;
insert into t_out select 'a.invite.role', role from t_inv;
reset role;
insert into t_out select 'db.token_not_stored', (not exists(select 1 from public.trip_invites i, t_inv where i.token_hash=t_inv.token))::text;
insert into t_out select 'db.token_hash_is_sha256', (exists(select 1 from public.trip_invites i, t_inv where i.token_hash=encode(extensions.digest(t_inv.token,'sha256'),'hex')))::text;

-- ── 로그인 전(anon): 미리보기는 되지만 수락은 안 되고 여행 본문은 없다 ──
set role anon;
select set_config('request.jwt.claims','',false);
insert into t_out select 'anon.preview', valid::text||':'||reason||':'||trip_name||':'||start_date||':'||day_count||':'||role from public.invite_preview((select token from t_inv));
do $$ begin perform public.accept_trip_invite((select token from t_inv),'x'); insert into t_out values('anon.accept','ok');
  exception when others then insert into t_out values('anon.accept',sqlstate); end $$;
do $$ declare n int; begin select count(*) into n from public.trips; insert into t_out values('anon.trips',n::text);
  exception when others then insert into t_out values('anon.trips',sqlstate); end $$;
insert into t_out select 'anon.preview.garbage', valid::text||':'||reason from public.invite_preview('not-a-real-token-value-xx');

-- ── C(멤버 아님)는 토큰을 알아도 여행을 읽을 수 없다(§67) ──
set role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-00000000000c"}',false);
insert into t_out select 'c.preview.valid', valid::text from public.invite_preview((select token from t_inv));
insert into t_out select 'c.trips', count(*)::text from public.trips;

-- ── B가 수락한다 — 그때부터 보인다 ──
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-00000000000b"}',false);
insert into t_out select 'b.accept', ok::text||':'||reason||':'||client_id||':'||trip_name||':'||role||':'||already_member from public.accept_trip_invite((select token from t_inv),'영희');
insert into t_out select 'b.accept.again', ok::text||':'||reason||':'||already_member from public.accept_trip_invite((select token from t_inv),'영희2');
insert into t_out select 'b.after.trips', count(*)::text from public.trips;
insert into t_out select 'b.after.roles', string_agg(client_id||'='||role||':'||member_count||':'||owner, ',' order by client_id) from public.my_trip_roles();
insert into t_out select 'b.after.members', string_agg(coalesce(display_name,'-')||'/'||role||'/'||me, ',' order by role) from public.list_trip_members('trip1');
reset role;
insert into t_out select 'db.invite.use_count', use_count::text from public.trip_invites limit 1;

-- ── 편집자 B가 저장하면 A에게 보인다 (CAS 그대로) ──
set role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-00000000000b"}',false);
insert into t_out select 'b.edit', applied::text||':'||conflict||':'||revision from public.sync_trip('trip1','{"id":"trip1","name":"스페인 (영희 편집)","start":"2026-10-25","days":[{"spots":[]},{"spots":[]}]}'::jsonb,1,false);
insert into t_out select 'b.edit.stale', applied::text||':'||conflict||':'||revision from public.sync_trip('trip1','{"id":"trip1","name":"stale","days":[{"spots":[]}]}'::jsonb,1,false);
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-00000000000a"}',false);
insert into t_out select 'a.sees_edit', data->>'name' from public.trips where client_id='trip1';
insert into t_out select 'a.roles.after', string_agg(role||':'||member_count, ',') from public.my_trip_roles() where client_id='trip1';

-- ── 편집자가 소유권을 가로채려 하면 트리거가 막는다 ──
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-00000000000b"}',false);
do $$ begin update public.trips set user_id='00000000-0000-0000-0000-00000000000b' where client_id='trip1' and user_id<>'00000000-0000-0000-0000-00000000000b'; insert into t_out values('b.hijack','ok');
  exception when others then insert into t_out values('b.hijack',sqlstate); end $$;
-- 편집자는 삭제(tombstone)도 못 한다
do $$ begin perform public.tombstone_trip('trip1',2,false); insert into t_out values('b.tombstone','ok');
  exception when others then insert into t_out values('b.tombstone',sqlstate); end $$;
-- 편집자는 다른 멤버의 역할을 못 바꾼다 (A의 행)
do $$ declare mid bigint; begin select id into mid from public.list_trip_members('trip1') where role='OWNER';
  perform public.manage_trip_member(mid,'REMOVE',null); insert into t_out values('b.remove_owner','ok');
  exception when others then insert into t_out values('b.remove_owner',sqlstate); end $$;
-- 본인 이름은 바꿀 수 있다
do $$ declare mid bigint; begin select id into mid from public.list_trip_members('trip1') where me;
  perform public.manage_trip_member(mid,'RENAME','영희(수정)'); insert into t_out values('b.rename','ok');
  exception when others then insert into t_out values('b.rename',sqlstate); end $$;
insert into t_out select 'b.rename.check', display_name from public.list_trip_members('trip1') where me;

-- ── A가 B를 보기 권한으로 내리면 B는 읽기만 된다 ──
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-00000000000a"}',false);
do $$ declare mid bigint; begin select id into mid from public.list_trip_members('trip1') where role='EDITOR';
  perform public.manage_trip_member(mid,'SET_ROLE','VIEWER'); insert into t_out values('a.demote','ok');
  exception when others then insert into t_out values('a.demote',sqlstate); end $$;
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-00000000000b"}',false);
insert into t_out select 'b.viewer.reads', count(*)::text from public.trips where client_id='trip1';
do $$ begin perform public.sync_trip('trip1','{"id":"trip1","name":"viewer write","days":[{"spots":[]}]}'::jsonb,2,false); insert into t_out values('b.viewer.write','ok');
  exception when others then insert into t_out values('b.viewer.write',sqlstate); end $$;
do $$ declare n int; begin update public.trips set data=data||'{"name":"direct"}'::jsonb where client_id='trip1'; get diagnostics n=row_count; insert into t_out values('b.viewer.direct_update',n::text);
  exception when others then insert into t_out values('b.viewer.direct_update',sqlstate); end $$;
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-00000000000a"}',false);
insert into t_out select 'a.after_viewer_write', data->>'name' from public.trips where client_id='trip1';
-- 소유자 자신의 행은 못 바꾼다
do $$ declare mid bigint; begin select id into mid from public.list_trip_members('trip1') where role='OWNER';
  perform public.manage_trip_member(mid,'SET_ROLE','VIEWER'); insert into t_out values('a.self_demote','ok');
  exception when others then insert into t_out values('a.self_demote',sqlstate); end $$;
-- 주최자는 나갈 수 없다
do $$ begin perform public.leave_trip('trip1'); insert into t_out values('a.leave','ok');
  exception when others then insert into t_out values('a.leave',sqlstate); end $$;

-- ── C가 같은 client_id로 저장하면 제 여행이 생길 뿐 A의 행은 그대로다 ──
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-00000000000c"}',false);
insert into t_out select 'c.sync_same_id', applied::text||':'||revision from public.sync_trip('trip1','{"id":"trip1","name":"C의 trip1","days":[{"spots":[]}]}'::jsonb,null,false);
insert into t_out select 'c.trips.after_sync', string_agg(data->>'name', ',') from public.trips;
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-00000000000a"}',false);
insert into t_out select 'a.after_c', data->>'name'||':'||revision from public.trips where client_id='trip1';

-- ── B가 나가면 보이지 않고, 나간 뒤 저장은 조용한 복제가 아니라 거절이다 ──
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-00000000000b"}',false);
insert into t_out select 'b.leave', public.leave_trip('trip1')::text;
insert into t_out select 'b.leave.again', public.leave_trip('trip1')::text;
insert into t_out select 'b.left.trips', string_agg(client_id, ',') from public.trips;
do $$ begin perform public.sync_trip('trip1','{"id":"trip1","name":"after leave","days":[{"spots":[]}]}'::jsonb,null,false); insert into t_out values('b.left.write','ok');
  exception when others then insert into t_out values('b.left.write',sqlstate); end $$;

-- ── 취소된 링크 · 내보내진 사람 · 만료 ──
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-00000000000a"}',false);
insert into t_out select 'a.revoke', public.revoke_trip_invite((select id from public.list_trip_invites('trip1') limit 1))::text;
insert into t_out select 'a.invites.active', count(*) filter (where active)::text||'/'||count(*)::text from public.list_trip_invites('trip1');
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-00000000000c"}',false);
insert into t_out select 'c.revoked.preview', valid::text||':'||reason from public.invite_preview((select token from t_inv));
insert into t_out select 'c.revoked.accept', ok::text||':'||reason from public.accept_trip_invite((select token from t_inv),'철수');
-- 새 링크로 B가 다시 들어온다(LEFT → ACTIVE), 그다음 A가 내보낸다
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-00000000000a"}',false);
create temp table t_inv2 as select * from public.create_trip_invite('trip1','VIEWER',168,null);
grant select on t_inv2 to public;
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-00000000000b"}',false);
insert into t_out select 'b.rejoin', ok::text||':'||reason||':'||role||':'||already_member from public.accept_trip_invite((select token from t_inv2),'영희');
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-00000000000a"}',false);
do $$ declare mid bigint; begin select id into mid from public.list_trip_members('trip1') where role<>'OWNER';
  perform public.manage_trip_member(mid,'REMOVE',null); insert into t_out values('a.remove_b','ok');
  exception when others then insert into t_out values('a.remove_b',sqlstate); end $$;
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-00000000000b"}',false);
insert into t_out select 'b.removed.trips', count(*)::text from public.trips where client_id='trip1';
insert into t_out select 'b.removed.old_link', ok::text||':'||reason from public.accept_trip_invite((select token from t_inv2),'영희');
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-00000000000a"}',false);
create temp table t_inv3 as select * from public.create_trip_invite('trip1','EDITOR',1,null);
grant select on t_inv3 to public;
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-00000000000b"}',false);
insert into t_out select 'b.removed.new_link', ok::text||':'||reason||':'||role from public.accept_trip_invite((select token from t_inv3),'영희');
-- 만료 — 시계를 돌린다
reset role;
update public.trip_invites set expires_at=now()-interval '1 minute' where token_hash=(select encode(extensions.digest(token,'sha256'),'hex') from t_inv3);
set role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-00000000000c"}',false);
insert into t_out select 'c.expired.preview', valid::text||':'||reason from public.invite_preview((select token from t_inv3));
insert into t_out select 'c.expired.accept', ok::text||':'||reason from public.accept_trip_invite((select token from t_inv3),'철수');
-- 이미 멤버인 B는 만료된 링크를 열어도 '이미 참여 중'이다(§74)
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-00000000000b"}',false);
insert into t_out select 'b.expired.but_member', valid::text||':'||reason||':'||already_member from public.invite_preview((select token from t_inv3));
insert into t_out select 'b.expired.accept_member', ok::text||':'||already_member from public.accept_trip_invite((select token from t_inv3),'영희');

-- ── 스냅샷·기존 소유자 흐름은 그대로 ──
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-00000000000a"}',false);
insert into public.trip_snapshots(user_id,client_id,name,data,source_revision) values('00000000-0000-0000-0000-00000000000a','trip1','스페인','{}'::jsonb,2);
insert into t_out select 'a.snapshots', count(*)::text from public.trip_snapshots;
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-00000000000b"}',false);
insert into t_out select 'b.snapshots', count(*)::text from public.trip_snapshots;
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-00000000000a"}',false);
insert into t_out select 'a.tombstone_by_owner', applied::text from public.tombstone_trip('trip1',2,false);

reset role;
select 'OUT:'||k||'='||coalesce(v,'<null>') from t_out order by k;
