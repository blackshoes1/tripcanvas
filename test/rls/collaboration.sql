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

-- ══ 2단계: 후보 장소와 반응 ══════════════════════════════════════════════════
-- 여기 오기까지의 상태: A=OWNER · B=EDITOR(활성) · C=멤버 아님.

-- A가 후보를 낸다. 낸 사람은 이미 가고 싶다는 뜻이라 MUST가 자동으로 붙는다.
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-00000000000a"}',false);
create temp table t_cand as select public.add_trip_candidate('trip1','사그라다 파밀리아','ChIJ1',41.4036,2.1744,'Barcelona','야경이 좋대',null) as id;
grant select on t_cand to public;
insert into t_out select 'cand.a.add', (id is not null)::text from t_cand;
insert into t_out select 'cand.a.auto_must', must_count::text||':'||coalesce(my_reaction,'-') from public.list_trip_candidates('trip1');

-- B(편집자)도 후보를 낼 수 있다
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-00000000000b"}',false);
create temp table t_cand2 as select public.add_trip_candidate('trip1','카사 바트요',null,null,null,null,null,null) as id;
grant select on t_cand2 to public;
insert into t_out select 'cand.b.count', count(*)::text from public.list_trip_candidates('trip1');
-- 제안자 이름은 이 여행에서 쓰는 이름이다 — 계정 이메일은 나오지 않는다(§69)
insert into t_out select 'cand.labels', string_agg(proposed_by_label,',' order by title) from public.list_trip_candidates('trip1');
insert into t_out select 'cand.no_email', (not exists(select 1 from public.list_trip_candidates('trip1') where proposed_by_label like '%@%'))::text;

-- ── C(멤버 아님)는 후보를 못 본다 · 못 만든다 · 반응도 못 한다 ──
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-00000000000c"}',false);
insert into t_out select 'cand.c.select', count(*)::text from public.trip_candidates;
insert into t_out select 'cand.c.reactions', count(*)::text from public.candidate_reactions;
insert into t_out select 'cand.c.list', count(*)::text from public.list_trip_candidates('trip1');
-- C에게도 client_id가 'trip1'인 제 여행이 있다(앞의 c.sync_same_id) — 그래서 추가 자체는 된다.
-- 중요한 것은 그것이 **C의 여행에** 들어가고 A의 여행은 그대로라는 점이다.
do $$ begin perform public.add_trip_candidate('trip1','몰래 추가',null,null,null,null,null,null); insert into t_out values('cand.c.add','ok');
  exception when others then insert into t_out values('cand.c.add',sqlstate); end $$;
insert into t_out select 'cand.c.add_lands_in_own', string_agg(title,',') from public.list_trip_candidates('trip1');
do $$ begin perform public.react_to_candidate((select id from t_cand),'MUST'); insert into t_out values('cand.c.react','ok');
  exception when others then insert into t_out values('cand.c.react',sqlstate); end $$;

-- A의 여행은 C의 추가에 흔들리지 않았다
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-00000000000a"}',false);
insert into t_out select 'cand.a.untouched', string_agg(title,',' order by title) from public.list_trip_candidates('trip1');

-- ── 반응은 한 사람 한 표이고 다시 눌러도 같다(멱등 §66) ──
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-00000000000b"}',false);
select public.react_to_candidate((select id from t_cand),'OK');
select public.react_to_candidate((select id from t_cand),'OK');
insert into t_out select 'cand.react.idempotent', count(*)::text from public.candidate_reactions r where r.candidate_id=(select id from t_cand) and r.user_id='00000000-0000-0000-0000-00000000000b';
-- 마음이 바뀌면 표가 옮겨간다 — 행이 늘지 않는다
select public.react_to_candidate((select id from t_cand),'MUST');
insert into t_out select 'cand.react.changed', must_count::text||':'||ok_count::text||':'||pass_count::text
  from public.list_trip_candidates('trip1') where id=(select id from t_cand);
insert into t_out select 'cand.react.rows', count(*)::text from public.candidate_reactions r where r.candidate_id=(select id from t_cand);
-- 서로의 의견은 보인다(§10 — 이번 단계는 공개가 기본)
insert into t_out select 'cand.react.who', (select string_agg(x->>'name'||'/'||(x->>'reaction'),',') from public.list_trip_candidates('trip1') c, jsonb_array_elements(c.reactions) x where c.id=(select id from t_cand));
-- 반응 거두기
select public.react_to_candidate((select id from t_cand),null);
insert into t_out select 'cand.react.cleared', coalesce(my_reaction,'-')||':'||must_count::text from public.list_trip_candidates('trip1') where id=(select id from t_cand);
select public.react_to_candidate((select id from t_cand),'MUST');
do $$ begin perform public.react_to_candidate((select id from t_cand),'LOVE'); insert into t_out values('cand.react.invalid','ok');
  exception when others then insert into t_out values('cand.react.invalid',sqlstate); end $$;

-- ── 보기 권한: 의견은 내지만 후보를 만들지는 못한다 ──
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-00000000000a"}',false);
select public.manage_trip_member((select m.id from public.trip_members m join public.trips t on t.id=m.trip_id where t.client_id='trip1' and m.user_id='00000000-0000-0000-0000-00000000000b'),'SET_ROLE','VIEWER');
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-00000000000b"}',false);
insert into t_out select 'cand.viewer.reads', count(*)::text from public.list_trip_candidates('trip1');
insert into t_out select 'cand.viewer.react', public.react_to_candidate((select id from t_cand),'PASS')::text;
insert into t_out select 'cand.viewer.react.applied', coalesce(my_reaction,'-') from public.list_trip_candidates('trip1') where id=(select id from t_cand);
do $$ begin perform public.add_trip_candidate('trip1','보기 권한이 낸 후보',null,null,null,null,null,null); insert into t_out values('cand.viewer.add','ok');
  exception when others then insert into t_out values('cand.viewer.add',sqlstate); end $$;
do $$ begin perform public.manage_trip_candidate((select id from t_cand),'SCHEDULE','2'); insert into t_out values('cand.viewer.schedule','ok');
  exception when others then insert into t_out values('cand.viewer.schedule',sqlstate); end $$;
-- 정책이 아니라 권한 자체가 없다 — 테이블에 직접 쓰지 못한다
do $$ begin insert into public.candidate_reactions(candidate_id,user_id,reaction) values((select id from t_cand),'00000000-0000-0000-0000-00000000000b','MUST'); insert into t_out values('cand.viewer.direct_react','ok');
  exception when others then insert into t_out values('cand.viewer.direct_react',sqlstate); end $$;
do $$ begin insert into public.trip_candidates(trip_id,title,proposed_by) values((select t.id from public.trips t where t.client_id='trip1'),'직접','00000000-0000-0000-0000-00000000000b'); insert into t_out values('cand.viewer.direct_add','ok');
  exception when others then insert into t_out values('cand.viewer.direct_add',sqlstate); end $$;
-- 남의 후보는 못 지운다. 내가 낸 것은 지운다
do $$ begin perform public.manage_trip_candidate((select id from t_cand),'REMOVE'); insert into t_out values('cand.b.remove_others','ok');
  exception when others then insert into t_out values('cand.b.remove_others',sqlstate); end $$;

-- ── 편집자로 되돌리고 일정에 넣는다 — 인기순 자동 반영은 없다(§12·§79) ──
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-00000000000a"}',false);
select public.manage_trip_member((select m.id from public.trip_members m join public.trips t on t.id=m.trip_id where t.client_id='trip1' and m.user_id='00000000-0000-0000-0000-00000000000b'),'SET_ROLE','EDITOR');
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-00000000000b"}',false);
insert into t_out select 'cand.schedule', public.manage_trip_candidate((select id from t_cand),'SCHEDULE','2')::text;
insert into t_out select 'cand.scheduled', status||':'||coalesce(scheduled_ref,'-') from public.list_trip_candidates('trip1') where id=(select id from t_cand);
select public.manage_trip_candidate((select id from t_cand),'UNSCHEDULE');
insert into t_out select 'cand.unschedule', status||':'||coalesce(scheduled_ref,'-') from public.list_trip_candidates('trip1') where id=(select id from t_cand);
-- 편집 권한이어도 남의 후보는 못 지운다 — 여기서 갈리는 것은 역할이 아니라 '누가 냈는가'다
do $$ begin perform public.manage_trip_candidate((select id from t_cand),'REMOVE'); insert into t_out values('cand.editor.remove_others','ok');
  exception when others then insert into t_out values('cand.editor.remove_others',sqlstate); end $$;
-- 내가 낸 후보는 내가 거둔다. 반응도 같이 사라진다
insert into t_out select 'cand.b.remove_own', public.manage_trip_candidate((select id from t_cand2),'REMOVE')::text;
insert into t_out select 'cand.after_remove', count(*)::text from public.list_trip_candidates('trip1');
insert into t_out select 'cand.reactions_cascade', count(*)::text from public.candidate_reactions r where r.candidate_id=(select id from t_cand2);
-- 주최자는 남의 후보도 거둘 수 있다
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-00000000000a"}',false);
create temp table t_cand3 as select public.add_trip_candidate('trip1','구엘 공원',null,null,null,null,null,null) as id;
grant select on t_cand3 to public;
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-00000000000b"}',false);
select public.react_to_candidate((select id from t_cand3),'PASS');
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-00000000000a"}',false);
insert into t_out select 'cand.owner_removes_any', public.manage_trip_candidate((select id from t_cand3),'REMOVE')::text;
-- 나간 사람은 반응도 못 남긴다
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-00000000000b"}',false);
select public.leave_trip('trip1');
do $$ begin perform public.react_to_candidate((select id from t_cand),'MUST'); insert into t_out values('cand.left.react','ok');
  exception when others then insert into t_out values('cand.left.react',sqlstate); end $$;
insert into t_out select 'cand.left.list', count(*)::text from public.list_trip_candidates('trip1');
-- 여행이 지워지면 후보도 따라 지워진다
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-00000000000a"}',false);

-- ══ 3단계: 코멘트 · 활동 기록 ═══════════════════════════════════════════════
-- 여기 오기까지: A=OWNER · B=LEFT · C=멤버 아님(client_id 'trip1'인 제 여행이 있다). B를 새 링크로 다시 들인다.
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-00000000000a"}',false);
create temp table t_inv4 as select * from public.create_trip_invite('trip1','EDITOR',168,null);
grant select on t_inv4 to public;
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-00000000000b"}',false);
insert into t_out select 'cm.b.rejoin', ok::text||':'||role from public.accept_trip_invite((select token from t_inv4),'영희');

-- B(편집자)가 후보에 한마디 남긴다. 빈 말은 거절
create temp table t_cm as select public.add_candidate_comment((select id from t_cand),'야경 보고 저녁 먹자') as id;
grant select on t_cm to public;
insert into t_out select 'cm.b.add', (id is not null)::text from t_cm;
do $$ begin perform public.add_candidate_comment((select id from t_cand),'   '); insert into t_out values('cm.empty','ok');
  exception when others then insert into t_out values('cm.empty',sqlstate); end $$;

-- C(멤버 아님)는 남기지도 보지도 못한다
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-00000000000c"}',false);
do $$ begin perform public.add_candidate_comment((select id from t_cand),'몰래'); insert into t_out values('cm.c.add','ok');
  exception when others then insert into t_out values('cm.c.add',sqlstate); end $$;
insert into t_out select 'cm.c.select', count(*)::text from public.trip_comments;
insert into t_out select 'cm.c.list', count(*)::text from public.list_candidate_comments((select id from t_cand));

-- 보기 권한도 코멘트는 남긴다 — 의견이다(반응과 같은 규칙)
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-00000000000a"}',false);
select public.manage_trip_member((select m.id from public.trip_members m join public.trips t on t.id=m.trip_id where t.client_id='trip1' and m.user_id='00000000-0000-0000-0000-00000000000b'),'SET_ROLE','VIEWER');
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-00000000000b"}',false);
create temp table t_cm2 as select public.add_candidate_comment((select id from t_cand),'보기 권한의 한마디') as id;
grant select on t_cm2 to public;
insert into t_out select 'cm.viewer.add', (id is not null)::text from t_cm2;
insert into t_out select 'cm.list', string_agg(author_label||'/'||body||'/'||mine, ',' order by id) from public.list_candidate_comments((select id from t_cand));
insert into t_out select 'cm.count', comment_count::text from public.list_trip_candidates('trip1') where id=(select id from t_cand);

-- 지우기: 쓴 사람이나 주최자만. 두 번 지워도 같다
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-00000000000a"}',false);
create temp table t_cm3 as select public.add_candidate_comment((select id from t_cand),'주최자 코멘트') as id;
grant select on t_cm3 to public;
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-00000000000b"}',false);
do $$ begin perform public.delete_candidate_comment((select id from t_cm3)); insert into t_out values('cm.b.delete_others','ok');
  exception when others then insert into t_out values('cm.b.delete_others',sqlstate); end $$;
insert into t_out select 'cm.b.delete_own', public.delete_candidate_comment((select id from t_cm2))::text;
insert into t_out select 'cm.b.delete_again', public.delete_candidate_comment((select id from t_cm2))::text;
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-00000000000a"}',false);
insert into t_out select 'cm.owner.delete_any', public.delete_candidate_comment((select id from t_cm))::text;
insert into t_out select 'cm.after', string_agg(author_label||'/'||body, ',' order by id) from public.list_candidate_comments((select id from t_cand));
-- 테이블 직접 쓰기는 권한 자체가 없다
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-00000000000b"}',false);
do $$ begin insert into public.trip_comments(trip_id,candidate_id,user_id,body) values((select c.trip_id from public.trip_candidates c where c.id=(select id from t_cand)),(select id from t_cand),'00000000-0000-0000-0000-00000000000b','직접'); insert into t_out values('cm.direct','ok');
  exception when others then insert into t_out values('cm.direct',sqlstate); end $$;
do $$ begin insert into public.trip_activity(trip_id,kind) values((select c.trip_id from public.trip_candidates c where c.id=(select id from t_cand)),'SCHEDULE_CHANGED'); insert into t_out values('act.direct','ok');
  exception when others then insert into t_out values('act.direct',sqlstate); end $$;

-- ── 활동 기록: 예약 추가와 일정 변경은 다른 멤버가 있을 때만 남고, 종류가 갈린다 ──
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-00000000000a"}',false);
select public.manage_trip_member((select m.id from public.trip_members m join public.trips t on t.id=m.trip_id where t.client_id='trip1' and m.user_id='00000000-0000-0000-0000-00000000000b'),'SET_ROLE','EDITOR');
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-00000000000b"}',false);
insert into t_out select 'act.b.booking', applied::text||':'||revision from public.sync_trip('trip1',
  '{"id":"trip1","name":"스페인 (영희 편집)","start":"2026-10-25","days":[{"spots":[]},{"spots":[]}],"bookings":[{"id":"bk1","kind":"hotel","name":"호텔"}]}'::jsonb,
  (select t.revision from public.trips t where t.client_id='trip1' and t.user_id='00000000-0000-0000-0000-00000000000a'), false);
insert into t_out select 'act.b.schedule', applied::text||':'||revision from public.sync_trip('trip1',
  '{"id":"trip1","name":"스페인 (영희 편집2)","start":"2026-10-25","days":[{"spots":[]},{"spots":[]}],"bookings":[{"id":"bk1","kind":"hotel","name":"호텔"}]}'::jsonb,
  (select t.revision from public.trips t where t.client_id='trip1' and t.user_id='00000000-0000-0000-0000-00000000000a'), false);
-- 혼자 쓰는 여행의 저장은 기록하지 않는다 — C의 제 여행
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-00000000000c"}',false);
insert into t_out select 'act.c.solo_save', applied::text from public.sync_trip('trip1','{"id":"trip1","name":"C의 trip1 (수정)","days":[{"spots":[]}]}'::jsonb,
  (select t.revision from public.trips t where t.client_id='trip1' and t.user_id='00000000-0000-0000-0000-00000000000c'), false);
insert into t_out select 'act.c.kinds', string_agg(kind, ',' order by id) from public.list_trip_activity('trip1', 50);
insert into t_out select 'act.c.select', count(*)::text from public.trip_activity;

-- A가 보는 기록: 의미 있는 것만, 순서대로. 소유자의 참여는 없고, 제안자의 자동 MUST는 없다
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-00000000000a"}',false);
insert into t_out select 'act.a.kinds', string_agg(kind, ',' order by id) from public.list_trip_activity('trip1', 200);
insert into t_out select 'act.a.no_owner_join', count(*)::text from public.list_trip_activity('trip1', 200) where kind='MEMBER_JOINED' and member_label='주최자';
insert into t_out select 'act.a.labels', string_agg(kind||'='||actor_label||'/'||coalesce(member_label,'-')||'/'||mine, ',' order by id)
  from public.list_trip_activity('trip1', 200) where kind in ('MEMBER_JOINED','MEMBER_REMOVED','CANDIDATE_PROPOSED','COMMENT_ADDED','BOOKING_ADDED');
insert into t_out select 'act.a.subjects', string_agg(subject::text, '|' order by id) from public.list_trip_activity('trip1', 200) where kind in ('CANDIDATE_SCHEDULED','BOOKING_ADDED','COMMENT_ADDED');
insert into t_out select 'act.a.limit', count(*)::text from public.list_trip_activity('trip1', 3);
-- 실시간 퍼블리케이션에 활동 테이블만 실려 있다 — 여행 문서(jsonb 전체)는 내보내지 않는다
reset role;
insert into t_out select 'act.publication', string_agg(tablename, ',' order by tablename) from pg_publication_tables where pubname='supabase_realtime';
set role authenticated;

-- ══ 4단계: 여행별 멤버 취향 ═════════════════════════════════════════════════
-- 여기 오기까지: A=OWNER · B=EDITOR(활성) · C=멤버 아님(client_id 'trip1'인 제 여행이 있다).
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-00000000000b"}',false);
-- 모르는 키·값은 버리고 아는 것만 남는다(화면이 무엇을 보내든). 배열은 정리·중복 제거·12개 제한
insert into t_out select 'pref.b.set', public.set_trip_preference('trip1',
  '{"pace":"RELAXED","walking":"LOW","morning":false,"night":true,"interests":["야경","미술관"," 야경 ","",null],"dislikes":["쇼핑"],"note":"  신혼여행이라 여유롭게  ","junk":"x","pace2":"PACKED"}'::jsonb)::text;
insert into t_out select 'pref.b.bad_values', public.set_trip_preference('trip1','{"pace":"FAST","walking":"LOW","morning":"yes","interests":"미술관"}'::jsonb)::text;
insert into t_out select 'pref.b.not_object', public.set_trip_preference('trip1','[1,2]'::jsonb)::text;
insert into t_out select 'pref.b.empty_arrays', public.set_trip_preference('trip1','{"interests":[],"dislikes":[""],"pace":"NORMAL"}'::jsonb)::text;
insert into t_out select 'pref.b.limit', jsonb_array_length((public.set_trip_preference('trip1',
  ('{"interests":' || (select jsonb_agg('관심'||g) from generate_series(1,20) g)::text || '}')::jsonb))->'interests')::text;
select public.set_trip_preference('trip1','{"pace":"RELAXED","walking":"LOW","night":true,"interests":["미술관","야경"],"dislikes":["쇼핑"]}'::jsonb);
-- 같은 여행 멤버끼리 서로 본다 · 이름표만, 이메일 없음
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-00000000000a"}',false);
insert into t_out select 'pref.a.list', string_agg(label||'/'||role||'/'||mine||'/'||prefs::text, ' | ' order by (role='OWNER') desc) from public.list_trip_preferences('trip1');
insert into t_out select 'pref.a.set', (public.set_trip_preference('trip1','{"pace":"PACKED","interests":["미술관","맛집"]}'::jsonb)->>'pace');
-- 남의 취향은 못 바꾼다 — RPC는 본인 행만 갱신하고, 테이블 직접 쓰기는 권한 자체가 없다
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-00000000000b"}',false);
do $$ begin update public.trip_members set prefs='{"pace":"PACKED"}'::jsonb where user_id='00000000-0000-0000-0000-00000000000a'; insert into t_out values('pref.b.direct','ok');
  exception when others then insert into t_out values('pref.b.direct',sqlstate); end $$;
insert into t_out select 'pref.a.unchanged', (prefs->>'pace') from public.list_trip_preferences('trip1') where not mine;
-- 보기 권한도 취향은 남긴다(의견이다)
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-00000000000a"}',false);
select public.manage_trip_member((select m.id from public.trip_members m join public.trips t on t.id=m.trip_id where t.client_id='trip1' and m.user_id='00000000-0000-0000-0000-00000000000b'),'SET_ROLE','VIEWER');
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-00000000000b"}',false);
insert into t_out select 'pref.viewer.set', (public.set_trip_preference('trip1','{"walking":"HIGH"}'::jsonb)->>'walking');
-- C(멤버 아님)의 'trip1' 저장은 제 여행에만 들어가고, A의 목록에는 C가 없다
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-00000000000c"}',false);
insert into t_out select 'pref.c.set', (public.set_trip_preference('trip1','{"pace":"NORMAL"}'::jsonb)->>'pace');
insert into t_out select 'pref.c.list', string_agg(label||'/'||role, ',') from public.list_trip_preferences('trip1');
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-00000000000a"}',false);
insert into t_out select 'pref.a.count', count(*)::text from public.list_trip_preferences('trip1');
-- 취향 변경은 활동 기록에 남지 않는다(§38 — 의미 있는 변경만)
insert into t_out select 'pref.no_activity', (not exists(select 1 from public.list_trip_activity('trip1',200) where subject ? 'prefs'))::text;
-- 되돌리기: B를 편집자로
select public.manage_trip_member((select m.id from public.trip_members m join public.trips t on t.id=m.trip_id where t.client_id='trip1' and m.user_id='00000000-0000-0000-0000-00000000000b'),'SET_ROLE','EDITOR');

-- ══ 5단계: 갈린 후보의 결정 — 이번 일정에서는 제외 / 되돌리기 ═══════════════
-- 여기 오기까지: A=OWNER · B=EDITOR(활성) · C=멤버 아님. t_cand는 PROPOSED(UNSCHEDULE 뒤).
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-00000000000b"}',false);
insert into t_out select 'dec.b.reject', public.manage_trip_candidate((select id from t_cand),'REJECT')::text;
insert into t_out select 'dec.status', status||':'||coalesce(scheduled_ref,'-') from public.list_trip_candidates('trip1') where id=(select id from t_cand);
-- 결정은 활동 기록에 남는다 — 상태가 안 바뀌면(두 번 눌러도) 한 번만
select public.manage_trip_candidate((select id from t_cand),'REJECT');
insert into t_out select 'dec.activity', count(*)::text from public.list_trip_activity('trip1',200) where kind='CANDIDATE_REJECTED';
insert into t_out select 'dec.activity.subject', subject->>'title' from public.list_trip_activity('trip1',200) where kind='CANDIDATE_REJECTED' limit 1;
-- 되돌리기 → PROPOSED, 기록 없음. 의견·코멘트는 그대로
insert into t_out select 'dec.b.reopen', public.manage_trip_candidate((select id from t_cand),'REOPEN')::text;
insert into t_out select 'dec.reopened', status||':'||must_count||':'||comment_count from public.list_trip_candidates('trip1') where id=(select id from t_cand);
insert into t_out select 'dec.activity.after_reopen', count(*)::text from public.list_trip_activity('trip1',200) where kind='CANDIDATE_REJECTED';
-- 보기 권한은 결정하지 못한다 · 모르는 액션은 22023 · 멤버 아니면 42501
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-00000000000a"}',false);
select public.manage_trip_member((select m.id from public.trip_members m join public.trips t on t.id=m.trip_id where t.client_id='trip1' and m.user_id='00000000-0000-0000-0000-00000000000b'),'SET_ROLE','VIEWER');
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-00000000000b"}',false);
do $$ begin perform public.manage_trip_candidate((select id from t_cand),'REJECT'); insert into t_out values('dec.viewer.reject','ok');
  exception when others then insert into t_out values('dec.viewer.reject',sqlstate); end $$;
do $$ begin perform public.manage_trip_candidate((select id from t_cand),'REOPEN'); insert into t_out values('dec.viewer.reopen','ok');
  exception when others then insert into t_out values('dec.viewer.reopen',sqlstate); end $$;
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-00000000000a"}',false);
select public.manage_trip_member((select m.id from public.trip_members m join public.trips t on t.id=m.trip_id where t.client_id='trip1' and m.user_id='00000000-0000-0000-0000-00000000000b'),'SET_ROLE','EDITOR');
do $$ begin perform public.manage_trip_candidate((select id from t_cand),'NUKE'); insert into t_out values('dec.invalid','ok');
  exception when others then insert into t_out values('dec.invalid',sqlstate); end $$;
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-00000000000c"}',false);
do $$ begin perform public.manage_trip_candidate((select id from t_cand),'REJECT'); insert into t_out values('dec.c.reject','ok');
  exception when others then insert into t_out values('dec.c.reject',sqlstate); end $$;
-- 주최자도 뺄 수 있다(편집 권한)
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-00000000000a"}',false);
insert into t_out select 'dec.a.reject', public.manage_trip_candidate((select id from t_cand),'REJECT')::text;
select public.manage_trip_candidate((select id from t_cand),'REOPEN');

-- ── 스냅샷·기존 소유자 흐름은 그대로 ──
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-00000000000a"}',false);
insert into public.trip_snapshots(user_id,client_id,name,data,source_revision) values('00000000-0000-0000-0000-00000000000a','trip1','스페인','{}'::jsonb,2);
insert into t_out select 'a.snapshots', count(*)::text from public.trip_snapshots;
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-00000000000b"}',false);
insert into t_out select 'b.snapshots', count(*)::text from public.trip_snapshots;
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-00000000000a"}',false);
insert into t_out select 'a.tombstone_by_owner', applied::text from public.tombstone_trip('trip1',(select t.revision from public.trips t where t.client_id='trip1' and t.user_id='00000000-0000-0000-0000-00000000000a'),false);

reset role;
select 'OUT:'||k||'='||coalesce(v,'<null>') from t_out order by k;
