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
const {legFailActive,compactLegCache,LEG_FAIL_TTL_MS,LEG_CACHE_MAX}=require('../routing.js');

test('경로 조회 실패는 TTL 동안만 재조회를 막는다 — 오프라인 한 순간이 영원한 직선 추정이 되지 않게',()=>{
  const now=1_800_000_000_000;
  assert.equal(legFailActive({fail:now-1000},now),true,'방금 실패한 구간은 바로 다시 묻지 않는다');
  assert.equal(legFailActive({fail:now-LEG_FAIL_TTL_MS},now),false,'TTL이 지나면 다시 묻는다');
  assert.equal(legFailActive({fail:now+60_000},now),false,'시각이 미래(기기 시계가 바뀜)면 막지 않는다');
  assert.equal(legFailActive({sec:60,m:500,path:'x'},now),false,'실패가 아니면 막을 것이 없다');
  assert.equal(legFailActive(undefined,now),false);
  assert.ok(LEG_FAIL_TTL_MS>=60_000&&LEG_FAIL_TTL_MS<=60*60_000,'몇 분 단위 — 한 시간을 넘기면 잠깐의 혼잡이 굳는다');
});

test('기기에 남기는 구간 캐시는 실패를 빼고, 지난 출발 시각 키를 버린다',()=>{
  const now=Date.parse('2027-01-01T00:00:00Z');
  const route={sec:600,m:4000,path:'abc',mode:'transit',when:'2026-12-31T09:00:00.000Z',at:now-1000};
  const kept=compactLegCache({
    'A>B#car':{sec:60,m:500,path:'x',at:now},
    'A>C#car':{fail:now-1000},                                       // 실패는 세션 메모리에만
    'A>D#transit@Asia/Seoul@2026-12-31T09:00:00.000Z':route,         // 지난 출발 시각 — 다시 쓰이지 않는다
    'A>D#transit':route,                                             // 같은 결과라도 기본 키는 남는다(지도·재생이 쓴다)
    'A>E#transit@Asia/Seoul@2027-01-02T09:00:00.000Z':{sec:900,m:5000,path:'y',at:now},
    'A>F#transit@UTC@not-a-date':{sec:900,m:5000,path:'y',at:now}
  },now);
  assert.deepEqual(Object.keys(kept).sort(),['A>B#car','A>D#transit','A>E#transit@Asia/Seoul@2027-01-02T09:00:00.000Z']);
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
