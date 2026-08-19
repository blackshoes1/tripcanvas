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
