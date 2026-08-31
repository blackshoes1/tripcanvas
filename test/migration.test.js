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
