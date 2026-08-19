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
