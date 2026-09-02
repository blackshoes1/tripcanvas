const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const sql=fs.readFileSync(path.join(__dirname,'..','supabase','migrations','202608190001_sync_integrity.sql'),'utf8');

test('migration은 두 테이블 RLS와 owner 정책을 코드화한다',()=>{
  assert.match(sql,/alter table public\.trips enable row level security/i);
  assert.match(sql,/alter table public\.trip_snapshots enable row level security/i);
  assert.match(sql,/trips_owner_update[\s\S]*using[\s\S]*with check/i);
  assert.match(sql,/snapshots_owner_update[\s\S]*using[\s\S]*with check/i);
});

test('migration은 revision CAS와 tombstone RPC를 제공한다',()=>{
  assert.match(sql,/create or replace function public\.sync_trip/i);
  assert.match(sql,/p_expected_revision is distinct from current_row\.revision/i);
  assert.match(sql,/create or replace function public\.tombstone_trip/i);
  assert.match(sql,/deleted_at=now\(\)/i);
});

const feedbackSql=fs.readFileSync(path.join(__dirname,'..','supabase','migrations','202608310001_suggestion_feedback.sql'),'utf8');

test('추천 반응 기록도 RLS owner 정책 아래에 있다 (남의 기록을 볼 수 없다)',()=>{
  assert.match(feedbackSql,/alter table public\.suggestion_feedback enable row level security/i);
  assert.match(feedbackSql,/suggestion_feedback_owner_select[\s\S]*auth\.uid\(\)\)=user_id/i);
  assert.match(feedbackSql,/suggestion_feedback_owner_update[\s\S]*using[\s\S]*with check/i);
  assert.match(feedbackSql,/revoke all on public\.suggestion_feedback from anon/i);
});

test('같은 제안을 두 번 건너뛰어도 한 행이다 (중복 제출 방지)',()=>{
  assert.match(feedbackSql,/unique \(user_id, trip_client_id, day_iso, suggestion_key\)/i);
  assert.match(feedbackSql,/check \(action in \('ACCEPTED','SKIPPED','DISMISSED','REPLACED'\)\)/i);
});

const pushSql=fs.readFileSync(path.join(__dirname,'..','supabase','migrations','202608310002_push_delivery.sql'),'utf8');

test('기기 토큰·발송 기록도 RLS owner 정책 아래에 있다',()=>{
  assert.match(pushSql,/alter table public\.device_tokens enable row level security/i);
  assert.match(pushSql,/alter table public\.notification_log enable row level security/i);
  assert.match(pushSql,/device_tokens_owner_update[\s\S]*using[\s\S]*with check/i);
  assert.match(pushSql,/revoke all on public\.device_tokens, public\.notification_log from anon/i);
});

test('같은 상황을 두 번 알리지 않도록 dedupe 키가 유일하다',()=>{
  assert.match(pushSql,/unique \(user_id, dedupe_key\)/i);
  assert.match(pushSql,/unique \(user_id, device_id\)/i);
  assert.match(pushSql,/state_version text/i,'낡은 알림으로 낡은 제안을 적용하지 않기 위해 상태 지문을 남긴다');
});

test('알림 기반 테이블에 위치를 저장하지 않는다',()=>{
  assert.ok(!/\blat\b|\blng\b|latitude|longitude/i.test(pushSql),'위치 history를 남기지 않는다');
});

const memorySql=fs.readFileSync(path.join(__dirname,'..','supabase','migrations','202608310003_trip_memories.sql'),'utf8');

test('여행 기록도 RLS owner 정책 아래에 있다',()=>{
  assert.match(memorySql,/alter table public\.trip_memories enable row level security/i);
  assert.match(memorySql,/trip_memories_owner_select[\s\S]*auth\.uid\(\)\)=user_id/i);
  assert.match(memorySql,/revoke all on public\.trip_memories from anon/i);
});

test('사진 원본을 서버에 담지 않는다 — 식별자만 남긴다',()=>{
  assert.match(memorySql,/asset_refs jsonb/i);
  assert.ok(!/bytea|base64|image_data|blob/i.test(memorySql),'이미지 바이트를 저장하는 컬럼이 없어야 한다');
});

test('오프라인에서 만든 기록이 두 번 올라가지 않는다',()=>{
  assert.match(memorySql,/client_key text/i);
  assert.match(memorySql,/unique \(user_id, client_key\)/i);
});

// ── 함께하기(협업) 1단계: 멤버십 · 권한 · 초대 ──
// DB 엔진에서 RLS를 실제로 돌리지는 못한다(docs/supabase-migrations.md). 여기서는 "접근 제어가 코드화되어 있는가"를 본다:
// 정책이 DB에 있고, 토큰 원문이 저장되지 않고, security definer 함수가 public에 열려 있지 않은지.
const collabSql=fs.readFileSync(path.join(__dirname,'..','supabase','migrations','202609020001_trip_collaboration.sql'),'utf8');

test('협업: 멤버·초대 테이블은 RLS 아래에 있고 쓰기 정책이 없다 — 쓰기는 RPC만 지난다(§65)',()=>{
  assert.match(collabSql,/alter table public\.trip_members enable row level security/i);
  assert.match(collabSql,/alter table public\.trip_invites enable row level security/i);
  assert.match(collabSql,/create policy "trip_members_member_select"[\s\S]*tc_trip_role\(trip_id\) is not null/i);
  assert.match(collabSql,/create policy "trip_invites_owner_select"[\s\S]*tc_trip_role\(trip_id\)='OWNER'/i);
  assert.ok(!/create policy "trip_members_\w+_(insert|update|delete)"/i.test(collabSql),'멤버 행을 클라이언트가 직접 쓰는 정책이 없어야 한다');
  assert.ok(!/create policy "trip_invites_\w+_(insert|update|delete)"/i.test(collabSql),'초대 행을 클라이언트가 직접 쓰는 정책이 없어야 한다');
  assert.match(collabSql,/revoke all on public\.trip_members, public\.trip_invites from anon, public/i);
});

test('협업: trips는 소유자 또는 활성 멤버만 읽고, EDITOR까지만 쓰고, 삭제는 소유자만(§66)',()=>{
  assert.match(collabSql,/create policy "trips_member_select"[\s\S]*=user_id or public\.tc_trip_role\(id\) is not null/i);
  assert.match(collabSql,/create policy "trips_editor_update"[\s\S]*using[\s\S]*tc_trip_role\(id\)='EDITOR'[\s\S]*with check[\s\S]*tc_trip_role\(id\)='EDITOR'/i);
  assert.match(collabSql,/create policy "trips_owner_delete"[\s\S]*using \(\(select auth\.uid\(\)\)=user_id\)/i);
  assert.match(collabSql,/create policy "trips_owner_insert"[\s\S]*with check \(\(select auth\.uid\(\)\)=user_id\)/i);
});

test('협업: 정책이 부르는 헬퍼는 security definer라 재귀가 없고, 소유자 변경은 트리거가 막는다',()=>{
  assert.match(collabSql,/function public\.tc_trip_role\(p_trip_id public\.trips\.id%type\)[\s\S]*security definer/i);
  // 운영 DB의 trips.id는 uuid, 저장소 기본 마이그레이션은 bigint — 어느 쪽에도 적용되도록 타입을 읽어서 만든다
  assert.match(collabSql,/format_type\(a\.atttypid, a\.atttypmod\)[\s\S]*trip_id %s not null references public\.trips\(id\)/i,'trip_id는 trips.id의 실제 타입으로');
  assert.ok(!/trip_id bigint/i.test(collabSql),'trip_id 타입을 bigint로 박아두면 운영(uuid)에서 외래키가 실패한다');
  assert.match(collabSql,/function public\.tc_trips_lock_owner\(\)[\s\S]*new\.user_id is distinct from old\.user_id[\s\S]*raise exception/i);
  assert.match(collabSql,/create trigger tc_trips_lock_owner before update on public\.trips/i);
  // 기존 여행의 소유자는 OWNER 멤버십을 갖는다(§96) — 트리거(새 여행)와 백필(기존 여행) 둘 다
  assert.match(collabSql,/create trigger tc_trips_owner_member after insert on public\.trips/i);
  assert.match(collabSql,/insert into public\.trip_members\(trip_id,user_id,role,status,joined_at\)\s*select t\.id,t\.user_id,'OWNER','ACTIVE'/i);
});

test('협업: sync_trip은 멤버를 인식하고 VIEWER·나간 사람의 쓰기를 42501로 거절한다',()=>{
  const fn=collabSql.slice(collabSql.indexOf('function public.sync_trip('),collabSql.indexOf('function public.tombstone_trip('));
  assert.match(fn,/tc_trip_role\(t\.id\) is not null/i,'소유한 것뿐 아니라 공유받은 행도 찾는다');
  assert.match(fn,/order by \(t\.user_id=auth\.uid\(\)\) desc/i,'같은 client_id면 소유한 쪽을 우선한다');
  assert.match(fn,/v_role is distinct from 'OWNER' and v_role is distinct from 'EDITOR'[\s\S]*TRIP_FORBIDDEN' using errcode='42501'/i);
  assert.match(fn,/tc_was_member\(p_client_id\)[\s\S]*TRIP_FORBIDDEN/i,'나간 사람의 로컬 사본이 새 여행으로 복제되지 않는다');
  assert.match(fn,/p_expected_revision is distinct from current_row\.revision/i,'CAS는 그대로다');
  const del=collabSql.slice(collabSql.indexOf('function public.tombstone_trip('),collabSql.indexOf('function public.my_trip_roles('));
  assert.match(del,/v_owner<>auth\.uid\(\)[\s\S]*TRIP_FORBIDDEN/i,'삭제는 소유자만');
  // RLS 아래에서 SELECT … FOR UPDATE는 update 정책까지 통과한 행만 돌려준다 — VIEWER에게 행이 '없는 것'이 되어
  // 거절 대신 복제본을 만들었다(실제 PostgreSQL 테스트에서 잡힘). 조회와 잠금은 반드시 분리돼 있어야 한다.
  assert.match(fn,/select t\.id into v_id[\s\S]*limit 1;\s*\n\s*if v_id is null/i,'sync_trip: 잠금 없는 조회가 먼저');
  assert.match(fn,/where t\.id=v_id for update/i,'sync_trip: 역할 판정 뒤에 잠근다');
  assert.match(del,/select t\.id, t\.user_id into v_id, v_owner[\s\S]*limit 1;/i,'tombstone_trip: 잠금 없는 조회가 먼저');
});

test('협업: 초대 토큰은 해시로만 저장되고 원문은 만든 순간 한 번만 돌려준다(§6)',()=>{
  assert.match(collabSql,/token_hash text not null unique/i);
  assert.ok(!/\btoken text\b(?![\s\S]{0,80}returns table)/i.test(collabSql.replace(/returns table\([^)]*\)/gi,'')),'토큰 원문 컬럼이 없어야 한다');
  assert.match(collabSql,/gen_random_bytes\(24\)/i,'192비트 난수');
  assert.match(collabSql,/digest\(v_token,'sha256'\)/i);
  assert.match(collabSql,/function public\.create_trip_invite[\s\S]*t\.user_id=v_uid[\s\S]*TRIP_FORBIDDEN/i,'초대 생성은 소유자만');
  assert.match(collabSql,/least\(greatest\(coalesce\(p_hours,168\),1\),24\*30\)/i,'만료는 1시간~30일 — 영원한 링크는 없다');
});

test('협업: 미리보기는 로그인 전에도 되지만 여행 본문은 주지 않는다(§6·§67)',()=>{
  const fn=collabSql.slice(collabSql.indexOf('function public.invite_preview('),collabSql.indexOf('function public.accept_trip_invite('));
  assert.match(fn,/security definer/i);
  assert.ok(!/data->'days'->/i.test(fn) && !/->'spots'/i.test(fn) && !/->'bookings'/i.test(fn),'일정·예약 본문을 돌려주면 안 된다');
  assert.match(fn,/data->>'name'/i);
  assert.match(fn,/jsonb_array_length/i,'일수만 센다');
  assert.match(collabSql,/grant execute on function public\.invite_preview\(text\) to anon, authenticated/i);
  assert.ok(!/grant execute on function public\.accept_trip_invite\(text,text\) to anon/i.test(collabSql),'수락은 로그인해야 한다');
});

test('협업: 수락은 멱등이고(§74), 내보내진 사람은 이전 링크로 못 돌아온다(§70), 주최자는 못 나간다(§71)',()=>{
  const acc=collabSql.slice(collabSql.indexOf('function public.accept_trip_invite('),collabSql.indexOf('function public.leave_trip('));
  assert.match(acc,/v_mem\.status='ACTIVE'[\s\S]*already_member|v_mem\.status='ACTIVE' then[\s\S]*true/i);
  assert.match(acc,/v_mem\.status='REMOVED' and v_mem\.updated_at>=v_inv\.created_at[\s\S]*'REMOVED'/i);
  assert.match(acc,/use_count=i\.use_count\+1/i);
  const leave=collabSql.slice(collabSql.indexOf('function public.leave_trip('),collabSql.indexOf('function public.manage_trip_member('));
  assert.match(leave,/OWNER_CANNOT_LEAVE/);
  assert.match(leave,/status='LEFT'/);
  const manage=collabSql.slice(collabSql.indexOf('function public.manage_trip_member('),collabSql.indexOf('-- ── 권한'));
  assert.match(manage,/v_mem\.role='OWNER'[\s\S]*OWNER_LOCKED/i,'소유자 행은 바꾸거나 내보낼 수 없다');
  assert.match(manage,/p_action='REMOVE'[\s\S]*status='REMOVED'/i);
});

test('협업: security definer 함수는 전부 public에서 실행 권한을 거둔다',()=>{
  const defs=[...collabSql.matchAll(/create or replace function public\.(\w+)\(([^)]*)\)[\s\S]*?language \w+[^;]*?security definer/gi)].map(m=>m[1]);
  assert.ok(defs.length>=8,'security definer 함수가 있어야 한다: '+defs.join(','));
  for(const name of defs){
    if(/^tc_trips_|^tc_touch/.test(name)) continue;   // 트리거 함수는 직접 호출되지 않는다
    assert.match(collabSql,new RegExp(`revoke all on function public\\.${name}\\([^)]*\\) from public`,'i'),`${name}: revoke from public`);
  }
});

test('협업: 소유자 삭제 정책과 스냅샷 정책은 그대로다 — 기존 단일 사용자 흐름을 깨지 않는다(§95)',()=>{
  assert.match(collabSql,/"trips_owner_delete"/);
  assert.ok(!/trip_snapshots/i.test(collabSql),'스냅샷은 사용자별 기록이라 손대지 않는다');
});
