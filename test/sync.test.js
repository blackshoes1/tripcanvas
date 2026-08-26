const test=require('node:test');
const assert=require('node:assert/strict');
const S=require('../sync.js');

const trip=(name='local')=>({id:'t1',name,days:[{spots:[]}]});

test('동일 revision에서 로컬 편집은 CAS 업로드 대상으로 분류한다',()=>{
  const out=S.mergeForLogin([trip('local')],[{client_id:'t1',data:trip('cloud'),revision:3,deleted_at:null}],{t1:{revision:3,status:'clean'}});
  assert.equal(out.actions[0].kind,'upload');
  assert.equal(out.conflicts.length,0);
});

test('두 클라이언트 중 서버 revision이 앞서면 조용히 덮어쓰지 않는다',()=>{
  const out=S.mergeForLogin([trip('stale')],[{client_id:'t1',data:trip('newer'),revision:4,deleted_at:null}],{t1:{revision:3,status:'clean'}});
  assert.equal(out.conflicts[0].kind,'changed-both');
  assert.equal(out.trips[0].name,'stale');
});

test('다른 기기의 tombstone은 오래된 로컬본을 자동 부활시키지 않는다',()=>{
  const out=S.mergeForLogin([trip('stale')],[{client_id:'t1',data:trip('deleted'),revision:5,deleted_at:'2026-01-01T00:00:00Z'}],{t1:{revision:4,status:'clean'}});
  assert.equal(out.actions.length,0);
  assert.equal(out.conflicts[0].kind,'remote-deleted');
});

test('revision 없는 기존 로컬 데이터는 신규 업로드하되 원격과 다르면 충돌로 보존한다',()=>{
  assert.equal(S.mergeForLogin([trip()],[ ],{}).actions.length,1);
  const clash=S.mergeForLogin([trip('old')],[{client_id:'t1',data:trip('cloud'),revision:1}],{});
  assert.equal(clash.conflicts.length,1);
});

test('삭제와 undo 경합은 완료된 tombstone 뒤 재동기화를 요구한다',()=>{
  const meta={t1:{revision:2,status:'clean',op:''}};
  S.beginDelete(meta,'t1','op1');
  S.undoDelete(meta,'t1');
  const result=S.finishDelete(meta,'t1','op1',3);
  assert.equal(result.resync,true);
  assert.equal(meta.t1.revision,3);
  assert.equal(meta.t1.status,'dirty');
});

test('미해결 충돌은 다음 병합에서도 충돌로 남는다 — 서버 revision을 base에 stamp하지 않는다',()=>{
  const rows=[{client_id:'t1',data:trip('cloud'),revision:5,deleted_at:null}];
  const first=S.mergeForLogin([trip('local')],rows,{t1:{revision:3,status:'clean'}});
  assert.equal(first.conflicts[0].kind,'changed-both');
  assert.equal(first.conflicts[0].revision,5,'충돌 카드에는 서버 revision을 전달한다');
  assert.equal(first.meta.t1.revision,3,'로컬이 파생된 base revision은 그대로 둔다');
  // 사용자가 버전을 고르지 않고 새로고침한 상황: 같은 병합을 다시 돌려도 "조용한 업로드"로 둔갑하면 안 된다
  const again=S.mergeForLogin([trip('local')],rows,first.meta);
  assert.equal(again.actions.length,0,'원격본을 덮어쓰는 업로드가 생기지 않는다');
  assert.equal(again.conflicts[0].kind,'changed-both');
  assert.equal(again.trips[0].name,'local','로컬본도 그대로 보존된다');
});

test('원격 tombstone 충돌도 base revision을 유지해 반복 확인된다',()=>{
  const rows=[{client_id:'t1',data:trip('cloud'),revision:7,deleted_at:'2026-01-01T00:00:00Z'}];
  const first=S.mergeForLogin([trip('local')],rows,{t1:{revision:4,status:'clean'}});
  assert.equal(first.meta.t1.revision,4);
  assert.equal(S.mergeForLogin([trip('local')],rows,first.meta).conflicts[0].kind,'remote-deleted');
});

test('hashTrip — 같은 내용은 같은 지문, 한 글자만 달라도 다른 지문',()=>{
  assert.equal(S.hashTrip(trip('a')),S.hashTrip(trip('a')));
  assert.notEqual(S.hashTrip(trip('a')),S.hashTrip(trip('b')));
  assert.equal(typeof S.hashTrip(trip('a')),'string');
});

test('원격과 동일한 로컬은 지문까지 기록해 재업로드를 만들지 않는다',()=>{
  const out=S.mergeForLogin([trip('same')],[{client_id:'t1',data:trip('same'),revision:2,deleted_at:null}],{t1:{revision:2,status:'clean'}});
  assert.equal(out.meta.t1.hash,S.hashTrip(trip('same')));
});
