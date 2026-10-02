const test=require('node:test');
const assert=require('node:assert/strict');
const {createRoutingClient}=require('../routing.js');
const L=require('../lib.js');

function client(fetchImpl){return createRoutingClient({fetchImpl,googleKey:'browser-test-key',encodePolyline:L.encodePolyline,ringPts:L.ringPts,haversine:L.haversine,inKorea:L.inKorea});}

test('라우팅 모듈은 대중교통 구간별 departureTime을 Google 요청에 전달한다',async()=>{
  const calls=[];
  const route=client(async(url,options)=>{calls.push({url,body:JSON.parse(options.body)});return {ok:true,json:async()=>({routes:[{duration:'600s',distanceMeters:1000,polyline:{encodedPolyline:'x'}}]})};});
  await route.fetchLeg({lat:35,lng:139},{lat:35.1,lng:139.1},'transit','2027-01-01T01:00:00Z');
  assert.equal(calls[0].body.departureTime,'2027-01-01T01:00:00Z');
  assert.equal(calls[0].body.travelMode,'TRANSIT');
});

test('라우팅 모듈은 국내 자차를 same-origin Kakao proxy로만 보낸다',async()=>{
  let call;
  const route=client(async(url,options)=>{call={url,options};return {ok:true,json:async()=>({route:{result_code:0,summary:{duration:60,distance:500,fare:{taxi:4000}},sections:[]}})};});
  const result=await route.fetchLeg({lat:37.5,lng:127},{lat:37.51,lng:127.01},'car',null);
  assert.equal(call.url,'/api/kakao-directions');
  assert.equal(call.options.method,'POST');
  assert.equal(result.sec,60);
});

test('기차·항공은 네트워크 없이 사용자 시간표 우선용 추정치를 반환한다',async()=>{
  const route=client(async()=>{throw new Error('should not fetch');});
  assert.equal((await route.fetchLeg({lat:0,lng:0},{lat:1,lng:1},'train',null)).est,1);
  assert.equal((await route.fetchLeg({lat:0,lng:0},{lat:10,lng:10},'flight',null)).mode,'flight');
});

// ── 구간 캐시 정책 — 실패는 잠깐만, 저장은 정리한 사본만 ──
const {transientRouteFailure,legFailActive,compactLegCache,LEG_FAIL_TTL_MS,LEG_NOROUTE_TTL_MS,LEG_CACHE_MAX}=require('../routing.js');

test('경로 조회 실패는 TTL 동안만 재조회를 막는다 — 오프라인 한 순간이 영원한 직선 추정이 되지 않게',()=>{
  const now=1_800_000_000_000;
  assert.equal(legFailActive({fail:now-1000},now),true,'방금 실패한 구간은 바로 다시 묻지 않는다');
  assert.equal(legFailActive({fail:now-LEG_FAIL_TTL_MS},now),false,'TTL이 지나면 다시 묻는다');
  assert.equal(legFailActive({fail:now+60_000},now),false,'시각이 미래(기기 시계가 바뀜)면 막지 않는다');
  assert.equal(legFailActive({sec:60,m:500,path:'x'},now),false,'실패가 아니면 막을 것이 없다');
  assert.equal(legFailActive(undefined,now),false);
  assert.ok(LEG_FAIL_TTL_MS>=60_000&&LEG_FAIL_TTL_MS<=60*60_000,'몇 분 단위 — 한 시간을 넘기면 잠깐의 혼잡이 굳는다');
});

test('경로 없음은 잠깐인 실패보다 오래 기억한다 — 다시 열 때마다 인근 도로 탐색을 되풀이하지 않게',()=>{
  const now=1_800_000_000_000;
  assert.equal(legFailActive({fail:now-LEG_FAIL_TTL_MS,permanent:1},now),true,'잠깐인 실패의 TTL이 지나도 경로 없음은 그대로다');
  assert.equal(legFailActive({fail:now-LEG_NOROUTE_TTL_MS+1,permanent:1},now),true);
  assert.equal(legFailActive({fail:now-LEG_NOROUTE_TTL_MS,permanent:1},now),false,'TTL이 지나면 다시 묻는다(도로가 생겼을 수 있다)');
  assert.ok(LEG_NOROUTE_TTL_MS>LEG_FAIL_TTL_MS);
});

test('잠깐인 실패는 응답 상태로 가린다 — 경로 없음(프록시 422)만 카카오의 답이다',()=>{
  for(const status of [429,500,502,503,504,403]) assert.equal(transientRouteFailure({ok:false,status}),true,`${status}`);
  assert.equal(transientRouteFailure({ok:false,status:422}),false,'경로 없음은 다시 물어도 같다');
  assert.equal(transientRouteFailure({ok:true,status:200}),false);
});

test('국내 경로 없음은 인근 도로를 끝까지 찾고, 잠깐인 실패(429·오프라인)를 만나면 거기서 멈춘다',async()=>{
  const A={lat:37.5,lng:127},B={lat:37.51,lng:127.01};
  const noRoad=()=>({ok:false,status:422,json:async()=>({error:'route_unavailable',code:102})});
  let calls=0;
  assert.equal(await client(async()=>{calls++;return noRoad();}).fetchLeg(A,B,'car',null),null);
  assert.equal(calls,33,'첫 시도 + 출발지 둘레 4반경 × 8방위 — 이 묶음이 열 때마다 나가면 프록시 분당 30번을 혼자 넘긴다');
  calls=0;
  const limited=client(async()=>{calls++;return calls===1?noRoad():{ok:false,status:429,json:async()=>({error:'rate_limited'})};});
  assert.equal(await limited.fetchLeg(A,B,'car',null),null);
  assert.equal(calls,2,'429 뒤로 남은 후보를 두드리지 않는다 — 같은 분의 다른 구간까지 막힌다');
  calls=0;
  const offline=client(async()=>{calls++;if(calls>1)throw new TypeError('offline');return noRoad();});
  assert.equal(await offline.fetchLeg(A,B,'car',null),null);
  assert.equal(calls,2,'오프라인도 거기서 멈춘다');
});

test('기기에 남기는 구간 캐시는 실패를 빼고, 지난 출발 시각 키를 버린다',()=>{
  const now=Date.parse('2027-01-01T00:00:00Z');
  const route={sec:600,m:4000,path:'abc',mode:'transit',when:'2026-12-31T09:00:00.000Z',at:now-1000};
  const kept=compactLegCache({
    'A>B#car':{sec:60,m:500,path:'x',at:now},
    'A>C#car':{fail:now-1000},                                       // 잠깐인 실패는 세션 메모리에만
    'A>G#car':{fail:now-1000,permanent:1,at:now},                    // 경로 없음은 TTL 동안 남는다
    'A>H#car':{fail:now-LEG_NOROUTE_TTL_MS,permanent:1,at:now},      // TTL이 지난 경로 없음은 다시 묻는다
    'A>D#transit@Asia/Seoul@2026-12-31T09:00:00.000Z':route,         // 지난 출발 시각 — 다시 쓰이지 않는다
    'A>D#transit':route,                                             // 같은 결과라도 기본 키는 남는다(지도·재생이 쓴다)
    'A>E#transit@Asia/Seoul@2027-01-02T09:00:00.000Z':{sec:900,m:5000,path:'y',at:now},
    'A>F#transit@UTC@not-a-date':{sec:900,m:5000,path:'y',at:now}
  },now);
  assert.deepEqual(Object.keys(kept).sort(),['A>B#car','A>D#transit','A>E#transit@Asia/Seoul@2027-01-02T09:00:00.000Z','A>G#car']);
});

test('기기에 남기는 구간 캐시는 상한을 넘지 않고, 오래 안 쓴 것부터 버린다',()=>{
  const now=1_800_000_000_000, cache={};
  cache['old#car']={sec:1,m:1,path:'o'};                              // at이 없는 예전 항목이 먼저 나간다
  for(let i=0;i<5;i++) cache[`k${i}#car`]={sec:60,m:500,path:'x',at:now-i*1000};
  const kept=compactLegCache(cache,now,3);
  assert.deepEqual(Object.keys(kept).sort(),['k0#car','k1#car','k2#car']);
  assert.equal(Object.keys(compactLegCache(cache,now)).length,6,'기본 상한 안이면 다 남는다');
  assert.ok(LEG_CACHE_MAX>=100,'여행 몇 개의 구간은 넉넉히 담는다');
  const big={};
  for(let i=0;i<LEG_CACHE_MAX+50;i++) big[`b${i}#car`]={sec:60,m:500,path:'x',at:i};
  assert.equal(Object.keys(compactLegCache(big,now)).length,LEG_CACHE_MAX);
  assert.equal(Object.keys(compactLegCache(big,now,Infinity)).length,LEG_CACHE_MAX+50,'불러올 때는 상한 없이 실패·지난 키만 뺀다');
  assert.deepEqual(compactLegCache(null,now),{});
});

test('이 페이지에서 쓴 구간은 상한과 상관없이 남는다 — 상한보다 구간이 많은 여행도 다시 열 때 조회가 0건',()=>{
  const legs=Array.from({length:LEG_CACHE_MAX+140},(_,i)=>`L${i}#car`);   // 90일 × 하루 6구간이면 540
  let stored=null, clock=1_800_000_000_000;
  // 앱을 한 번 연다: 불러오기(상한 없음) → 렌더가 캐시에 있는 구간에 at을 찍고 → 빠진 구간을 하나씩 받아 받을 때마다 저장
  const open=()=>{
    const sessionAt=clock, cache=compactLegCache(stored,clock,Infinity);
    const missing=legs.filter(key=>{ clock++; if(cache[key]){ cache[key].at=clock; return false; } return true; });
    for(const key of missing){ clock++; cache[key]={sec:60,m:500,path:'x',at:clock}; stored=compactLegCache(cache,clock,LEG_CACHE_MAX,sessionAt); }
    return missing.length;
  };
  assert.equal(open(),legs.length);
  assert.equal(Object.keys(stored).length,legs.length,'지금 여행의 구간은 상한을 넘어도 다 남는다');
  assert.equal(open(),0,'다시 열면 아무것도 다시 묻지 않는다');

  // 상한은 남은 자리에서 나머지(지난 세션들의 구간)에만 걸린다
  const mixed={};
  for(let i=0;i<5;i++) mixed[`old${i}#car`]={sec:60,m:500,path:'x',at:i+1};
  for(let i=0;i<3;i++) mixed[`now${i}#car`]={sec:60,m:500,path:'x',at:100+i};
  assert.deepEqual(Object.keys(compactLegCache(mixed,200,5,100)).sort(),['now0#car','now1#car','now2#car','old3#car','old4#car']);
  assert.deepEqual(Object.keys(compactLegCache(mixed,200,2,100)).sort(),['now0#car','now1#car','now2#car'],'이 페이지 것만으로 상한을 넘으면 나머지는 남지 않는다');
});
