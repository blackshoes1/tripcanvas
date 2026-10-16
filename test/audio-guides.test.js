const test=require('node:test');
const assert=require('node:assert/strict');
const {MAX_FILE_BYTES,AudioGuideError,validateFile,placeKey,createStore}=require('../audio-guides.js');

function audio(name='guide.mp3',type='audio/mpeg'){
  const blob=new Blob(['a personal narrated story'],{type});
  return Object.assign(blob,{name});
}

test('음성 파일 검증은 모바일의 MIME 없는 M4A와 표준 음성을 허용한다',()=>{
  for(const file of [audio(),audio('대성당.M4A',''),audio('story.m4a','video/mp4'),audio('story.wav','application/octet-stream'),audio('recording','audio/ogg')])
    assert.doesNotThrow(()=>validateFile(file));
});

test('빈 파일·비음성 파일·100MB 초과는 저장 전에 구체적인 오류로 거절한다',()=>{
  for(const [file,code] of [[Object.assign(new Blob([]),{name:'empty.mp3'}),'EMPTY_FILE'],[audio('guide.html','text/html'),'NOT_AUDIO'],[{name:'large.mp3',size:MAX_FILE_BYTES+1,type:'audio/mpeg',slice(){}},'FILE_TOO_LARGE']])
    assert.throws(()=>validateFile(file),error=>error instanceof AudioGuideError&&error.code===code&&/[가-힣]/.test(error.message));
  const max={name:'max.mp3',size:MAX_FILE_BYTES,type:'audio/mpeg',slice(){}};
  assert.doesNotThrow(()=>validateFile(max));
});

test('장소 식별은 공급자 id를 우선하며 같은 좌표의 이름 변경에도 가이드를 유지한다',()=>{
  assert.equal(placeKey({placeId:'  ChIJ123 ',kakaoId:77,lat:37,lng:127}),JSON.stringify(['google','ChIJ123']));
  assert.equal(placeKey({kakaoId:77,lat:37,lng:127}),JSON.stringify(['kakao','77']));
  assert.equal(placeKey({name:'원래 이름',lat:37.1234562,lng:127}),placeKey({name:'새 이름',lat:'37.1234562',lng:'127'}));
  assert.equal(placeKey({lat:0,lng:0}),JSON.stringify(['point','0.000000','0.000000']));
});

test('좌표 없는 장소는 도시와 이름으로 구분하며 빈 장소를 잘못 연결하지 않는다',()=>{
  assert.equal(placeKey({name:'  Cathedral ',city:' SEVILLE '}),JSON.stringify(['name','seville','cathedral']));
  assert.notEqual(placeKey({name:'Cathedral',city:'Seville'}),placeKey({name:'Cathedral',city:'Madrid'}));
  assert.equal(placeKey({name:'Note',city:'Madrid',lat:91,lng:0}),JSON.stringify(['name','madrid','note']));
  assert.equal(placeKey({name:'Note',lat:true,lng:false}),JSON.stringify(['name','','note']));
  for(const spot of [null,{}, {city:'Madrid'}, {lat:null,lng:null}, {lat:'',lng:''}])
    assert.throws(()=>placeKey(spot),{code:'INVALID_PLACE'});
});

test('저장소가 없는 브라우저도 여행은 열 수 있고 가이드를 요청할 때만 오류를 낸다',async()=>{
  const store=createStore({indexedDB:null});
  await assert.rejects(store.list('trip','place'),{code:'UNAVAILABLE'});
  await assert.rejects(store.list('','place'),{code:'INVALID_PLACE'});
  await assert.rejects(store.add('trip','place',audio('x.html','text/html')),{code:'NOT_AUDIO'});
  store.close();
});

// Small IDB event harness: tests exercise isolation and commit/abort semantics;
// browser E2E uses the real IndexedDB implementation and page reloads.
function databaseHarness(initialRows=[]){
  let rows=new Map(initialRows.map(row=>[row.id,row]));
  let nextAbort=null;
  let nextOpenError=null;
  let closed=0;
  const factory={open(){
    const request={};
    queueMicrotask(()=>{
      if(nextOpenError){request.error=nextOpenError;nextOpenError=null;request.onerror();return;}
      request.result={
        close(){closed++;},
        transaction(_store,mode){
          let pending=0,ended=false;
          const working=new Map(rows);
          const tx={error:null,abort(){ended=true;queueMicrotask(()=>tx.onabort?.());}};
          function commitWhenIdle(){
            queueMicrotask(()=>{
              if(ended||pending)return;
              ended=true;
              if(nextAbort){tx.error=nextAbort;nextAbort=null;tx.onabort();return;}
              if(mode==='readwrite')rows=working;
              tx.oncomplete();
            });
          }
          function requestFor(fn){
            pending++;
            const req={};
            queueMicrotask(()=>{
              if(ended)return;
              req.result=fn();
              req.onsuccess?.();
              pending--;
              commitWhenIdle();
            });
            return req;
          }
          tx.objectStore=()=>({
            add(guide){return requestFor(()=>{working.set(guide.id,guide);return guide.id;});},
            get(id){return requestFor(()=>working.get(id));},
            delete(id){return requestFor(()=>working.delete(id));},
            index(){return {getAll([tripId,spotId]){return requestFor(()=>[...working.values()].filter(row=>row.tripId===tripId&&row.spotId===spotId));}};}
          });
          return tx;
        }
      };
      request.onsuccess();
    });
    return request;
  }};
  return {factory,abortNext(error){nextAbort=error;},failOpen(error){nextOpenError=error;},get closed(){return closed;},stored(id){return rows.get(id);}};
}

test('음성과 장소 연결은 여행별·장소별로 격리되고 같은 장소 여러 음성을 보존한다',async()=>{
  const harness=databaseHarness();
  const store=createStore({indexedDB:harness.factory});
  const first=await store.add('trip-a','cathedral',audio('01.mp3'));
  assert.ok(harness.stored(first.id).bytes instanceof ArrayBuffer,'WebKit이 저장할 수 있는 바이트로 보관한다');
  assert.equal(harness.stored(first.id).blob,undefined,'IndexedDB에 Blob을 직접 쓰지 않는다');
  await store.add('trip-a','cathedral',audio('02.mp3'));
  await store.add('trip-b','cathedral',audio('다른 여행.mp3'));
  await store.add('trip-a','palace',audio('다른 장소.mp3'));
  assert.deepEqual((await store.list('trip-a','cathedral')).map(row=>row.name).sort(),['01.mp3','02.mp3']);
  assert.equal(await first.blob.text(),'a personal narrated story');
  assert.equal(await store.remove('trip-b','cathedral',first.id),false);
  assert.equal(await store.remove('trip-a','palace',first.id),false);
  assert.equal((await store.list('trip-a','cathedral')).length,2);
  assert.equal(await store.remove('trip-a','cathedral',first.id),true);
  assert.equal(await store.remove('trip-a','cathedral',first.id),false);
  assert.equal((await store.list('trip-a','cathedral')).length,1);
  store.close();
  assert.equal(harness.closed,1);
  assert.equal((await store.list('trip-a','cathedral')).length,1,'다시 열어도 저장한 음성이 남는다');
  const restored=(await store.list('trip-a','cathedral'))[0];
  assert.equal(await restored.blob.text(),'a personal narrated story');
  assert.equal(restored.blob.type,'audio/mpeg');
});

test('기존 Blob 방식으로 저장한 음성도 바이트 방식 음성과 함께 읽는다',async()=>{
  const legacy={id:'legacy',tripId:'trip',spotId:'place',name:'예전 음성.mp3',type:'audio/mpeg',size:3,createdAt:1,blob:new Blob(['old'],{type:'audio/mpeg'})};
  const harness=databaseHarness([legacy]);
  const store=createStore({indexedDB:harness.factory});
  await store.add('trip','place',audio('새 음성.mp3'));
  const rows=await store.list('trip','place');
  assert.equal(rows.length,2);
  assert.equal(await rows[0].blob.text(),'old');
  assert.equal(await rows[1].blob.text(),'a personal narrated story');
});

test('파일을 읽지 못하면 한국어 오류를 내고 저장소를 건드리지 않는다',async()=>{
  let opened=false;
  const store=createStore({indexedDB:{open(){opened=true;throw new Error('should not open');}}});
  const unreadable=audio();unreadable.arrayBuffer=async()=>{throw new Error('File IO failed');};
  await assert.rejects(store.add('trip','place',unreadable),error=>error instanceof AudioGuideError&&error.code==='STORAGE'&&/[가-힣]/.test(error.message));
  assert.equal(opened,false);
});

test('쓰기 요청 성공 뒤 트랜잭션이 중단되면 저장 성공을 알리지 않고 파일을 남기지 않는다',async()=>{
  const harness=databaseHarness();
  const store=createStore({indexedDB:harness.factory});
  harness.abortNext({name:'QuotaExceededError'});
  await assert.rejects(store.add('trip','place',audio()),{code:'QUOTA'});
  assert.deepEqual(await store.list('trip','place'),[]);
  const saved=await store.add('trip','place',audio());
  assert.equal((await store.list('trip','place'))[0].id,saved.id);
});

test('브라우저 저장 접근 거절 뒤 재시도할 수 있다',async()=>{
  const harness=databaseHarness();
  const store=createStore({indexedDB:harness.factory});
  harness.failOpen({name:'SecurityError'});
  await assert.rejects(store.list('trip','place'),{code:'UNAVAILABLE'});
  assert.deepEqual(await store.list('trip','place'),[]);
});

test('업그레이드가 막히면 이유를 안내하고 뒤늦게 열린 연결을 닫는다',async()=>{
  let request,closed=false;
  const store=createStore({indexedDB:{open(){request={};queueMicrotask(()=>request.onblocked());return request;}}});
  await assert.rejects(store.list('trip','place'),{code:'BLOCKED'});
  request.result={close(){closed=true;}};
  request.onsuccess();
  assert.equal(closed,true);
});
