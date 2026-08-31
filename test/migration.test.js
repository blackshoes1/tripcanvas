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
