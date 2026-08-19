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
