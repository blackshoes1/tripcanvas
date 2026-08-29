// app.js 통합 배선 테스트 — jsdom에 실제 index.html + lib.js + sync.js + routing.js + app.js를 올려 함수 배선을 검증한다.
// 순수 함수 테스트가 못 잡는 'anchor vs carry' 류 배선 회귀를 자동 검출하는 것이 목적.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

let JSDOM = null;
try { ({ JSDOM } = require('jsdom')); } catch (e) { /* jsdom 미설치 → 통합 테스트는 skip */ }
const noJsdom = JSDOM ? false : 'jsdom 미설치 (npm install 필요)';

const root = path.join(__dirname, '..');

// index.html에서 <script> 태그를 모두 제거하고, lib.js·sync.js·routing.js·app.js를 인라인으로 주입해 실행한다.
// 외부 SDK(google/kakao/supabase/Sortable)는 미정의, 네트워크(fetch)는 거부 스텁으로 두고
// 앱의 가드(if(window.google)…, .catch 등)가 처리하게 한다.
function boot() {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8').replace(/<script\b[\s\S]*?<\/script>/gi, '');
  const dom = new JSDOM(html, { url: 'http://localhost/', runScripts: 'dangerously', pretendToBeVisual: true });
  const { window } = dom;
  window.fetch = () => Promise.reject(new Error('no-net'));                          // loadFx 등 네트워크 차단(가드가 catch)
  window.TextEncoder = TextEncoder;                                                 // jsdom에 없음 — lib의 크기 검증(_utf8Bytes)이 실제 브라우저처럼 돌게
  window.LZString = { compressToEncodedURIComponent: (x) => x, decompressFromEncodedURIComponent: (x) => x };
  const inject = (file) => {
    const s = window.document.createElement('script');
    s.textContent = fs.readFileSync(path.join(root, file), 'utf8');
    window.document.body.appendChild(s);
  };
  inject('lib.js');
  inject('sync.js');
  inject('routing.js');
  inject('price.js');
  inject('app.js');
  return window;
}
// 여행 하나를 store에 넣고 activeId·activeDay 지정
function withTrip(w, daysJson, activeDay = 0) {
  w.eval(`store.trips.push({id:'__it__',name:'T',start:'2026-08-01',days:${daysJson}}); store.activeId='__it__'; activeDay=${activeDay};`);
}

test('통합 부트: index.html+lib+app 무크래시 로드', { skip: noJsdom }, () => {
  const w = boot();
  ['dayContext', 'startAnchorFor', 'carryStayFor', 'desiredEngine', 'legModeOf', 'normalizeTrip', 'animPath', 'dayEtas']
    .forEach((fn) => assert.equal(w.eval(`typeof ${fn}`), 'function', `${fn} 정의됨`));
});

test('통합: 동기화 실패 상태를 보존하고 명시적 재시도로 회복한다', { skip: noJsdom }, async () => {
  const w=boot();
  w.eval(`user={id:'u1'}; sb={rpc:async()=>({data:null,error:{message:'offline'}})};`);
  await w.eval(`syncTripCloud({id:'retry1',name:'R',days:[{spots:[]}]})`);
  assert.equal(w.eval(`syncMeta.retry1.status`),'error');
  w.eval(`clearTimeout(cloudRetryT); sb={rpc:async()=>({data:[{applied:true,conflict:false,revision:2,data:null,deleted_at:null}],error:null})};`);
  await w.eval(`syncTripCloud({id:'retry1',name:'R',days:[{spots:[]}]})`);
  assert.equal(w.eval(`syncMeta.retry1.status`),'clean');
  assert.equal(w.eval(`syncMeta.retry1.revision`),2);
  w.close();
});

test('통합: 충돌 UI는 클라우드·기기·복사본 세 선택지를 제공한다', { skip: noJsdom }, () => {
  const w=boot();
  assert.equal(w.document.getElementById('syncUseCloud').textContent,'클라우드본 사용');
  assert.equal(w.document.getElementById('syncUseDevice').textContent,'이 기기본 사용');
  assert.match(w.document.getElementById('syncKeepCopy').textContent,/복사본/);
  w.close();
});

test('통합: 대중교통 구간은 각 구간 출발시각과 시간대로 별도 캐시된다', { skip: noJsdom },()=>{
  const w=boot();
  const result=w.eval(`(()=>{
    const day={startAt:'09:00',timeZone:'Asia/Tokyo',mode:'transit',spots:[
      {name:'A',lat:35.1,lng:139.1,bookAt:'12:00',stayMin:30},
      {name:'B',lat:35.2,lng:139.2,stayMin:60},
      {name:'C',lat:35.3,lng:139.3}
    ]};
    const tl=computeTimeline(day,{legMin:()=>30});
    const first=legDepartMinute(day,tl,1),second=legDepartMinute(day,tl,2);
    const w1=planDepartISO('2027-07-15',first,day.timeZone),w2=planDepartISO('2027-07-15',second,day.timeZone);
    return {first,second,w1,w2,k1:legRequestKey(day.spots[0],day.spots[1],'transit',w1,day.timeZone),k2:legRequestKey(day.spots[1],day.spots[2],'transit',w2,day.timeZone)};
  })()`);
  assert.equal(result.first,750); // 예약 12:00까지 대기 + 30분 체류
  assert.equal(result.second,840); // 12:30 출발 + 30분 이동 + 60분 체류
  assert.notEqual(result.w1,result.w2);
  assert.notEqual(result.k1,result.k2);
  w.close();
});

test('통합: 시간대 없는 기존 데이터는 출발시각을 강제 추정하지 않는다', { skip: noJsdom },()=>{
  const w=boot();
  assert.equal(w.eval(`planDepartISO('2027-07-15',540,'')`),null);
  assert.doesNotThrow(()=>w.eval(`dayTimeline({startAt:'09:00',spots:[{name:'A'}]},null,0)`));
  w.close();
});

test('통합: 사이드바·이미지 ETA 동일 + 비숙소 앵커 반영 (anchor 배선 회귀 방지)', { skip: noJsdom }, () => {
  const w = boot();
  // Day1은 숙소 없이 마지막 장소(비숙소)로 끝남 → carry면 ETA 반영 안 됨, anchor면 반영됨
  withTrip(w, `[
    {mode:'car',startAt:'09:00',spots:[{lat:37.50,lng:127.00,name:'A',city:'S'},{lat:37.52,lng:127.03,name:'last',city:'S'}]},
    {mode:'car',startAt:'09:00',spots:[{lat:37.60,lng:127.10,name:'B',city:'S'}]}
  ]`);
  const sidebar = w.eval('dayContext(1).timeline[0].eta');
  const image = w.eval('dayEtas(trip().days[1], startAnchorFor(1))[0]');
  assert.equal(sidebar, image, '사이드바·이미지 ETA가 같아야(둘 다 anchor 기준)');
  assert.ok(sidebar > w.eval('parseHM("09:00")'), '비숙소 전날 마지막 장소가 ETA에 반영');
  assert.equal(w.eval('carryStayFor(1)'), null, '숙소 아님 → 🏠 carry는 null');
});

test('통합: startPolicy none → 앵커·이월·재생 연결 모두 사라짐', { skip: noJsdom }, () => {
  const w = boot();
  withTrip(w, `[
    {mode:'car',startAt:'09:00',spots:[{lat:37.5,lng:127,name:'A',city:'S',stay:true}]},
    {mode:'car',startAt:'09:00',startPolicy:'none',spots:[{lat:37.6,lng:127.1,name:'B',city:'S'}]}
  ]`);
  assert.equal(w.eval('startAnchorFor(1)'), null, 'none → 앵커 없음');
  assert.equal(w.eval('carryStayFor(1)'), null, 'none → carry 없음');
  assert.equal(w.eval('hm(dayContext(1).timeline[0].eta)'), '09:00', 'none → 이월 이동 미반영');
  assert.equal(w.eval('animPath().some(p=>p.di===1)'), false, 'none → 재생에 Day2 이월 구간 없음(단일 장소)');
});

test('통합: 혼합 여행 엔진이 보는 범위 따라 전환 (국내일=카카오 / 해외일=구글 / 전체=구글)', { skip: noJsdom }, () => {
  const w = boot();
  withTrip(w, `[
    {mode:'car',spots:[{lat:37.5665,lng:126.978,name:'Seoul',city:'Seoul'}]},
    {mode:'transit',spots:[{lat:35.68,lng:139.76,name:'Tokyo',city:'Tokyo'}]}
  ]`);
  w.eval('activeDay=0'); assert.equal(w.eval('desiredEngine()'), 'google', '혼합 전체 → 구글');
  w.eval('activeDay=1'); assert.equal(w.eval('desiredEngine()'), 'kakao', '국내 일자 → 카카오');
  w.eval('activeDay=2'); assert.equal(w.eval('desiredEngine()'), 'google', '해외 일자 → 구글');
});

test('통합: 구간별 수단(legMode) 우선, 없거나 무효면 일자 기본/car', { skip: noJsdom }, () => {
  const w = boot();
  assert.equal(w.eval(`legModeOf({mode:'walk',spots:[]}, {legMode:'flight'})`), 'flight');
  assert.equal(w.eval(`legModeOf({mode:'walk',spots:[]}, {})`), 'walk');
  assert.equal(w.eval(`legModeOf({mode:'zzz',spots:[]}, {legMode:'bad'})`), 'car');
});

test('통합: 긴 일정 카드는 주요 정보·메타·이동 행을 분리하고 작업 메뉴를 보존한다', { skip: noJsdom }, () => {
  const w = boot();
  const longName = 'Aeropuerto Adolfo Suárez Madrid-Barajas International Terminal 4S 출국장 매우 긴 장소명';
  withTrip(w, JSON.stringify([{
    title: '마드리드에서 세비야를 거쳐 구시가지까지 이동하는 매우 긴 일정 제목',
    mode: 'transit', startAt: '07:00', timeZone: 'Europe/Madrid',
    spots: [
      { name: 'Madrid 출발 숙소', lat: 40.4168, lng: -3.7038, city: 'Madrid', stay: true, nights: 2, stayMin: 30 },
      { name: longName, lat: 40.4983, lng: -3.5676, city: 'Madrid', at: '08:30', bookAt: '08:00', stayMin: 90,
        cost: 228, cur: 'EUR', bookUrl: 'https://example.com/booking', opt: true, legMode: 'transit' },
      { name: '좌표가 아직 없는 아주 긴 후보 장소 이름과 추가 설명', city: 'Sevilla', opt: true }
    ]
  }]));
  w.eval('renderSidebar()');

  const card = w.document.querySelector('.dayCard');
  assert.ok(card.querySelector('.dayHeadMain .dayTitle'), '일자 제목은 첫 행');
  assert.ok(card.querySelector('.dayHeadMain > .actionMenu'), '일자 메뉴는 첫 행의 고정 열');
  assert.ok(card.querySelector('.dayHeadMeta .date'), '날짜는 두 번째 메타 행');
  assert.ok(card.querySelector('.dayHeadMeta .modeBtn'), '이동수단은 두 번째 메타 행');

  const spot = card.querySelector('.spot[data-si="1"]');
  const main = spot.querySelector(':scope > .spotMain');
  assert.ok(main.querySelector(':scope > .spotTime'), 'ETA 독립 열');
  assert.equal(main.querySelector('.spotName').textContent, longName, '장소명 원문 보존');
  assert.equal(main.querySelector('.spotIdentity').title, longName, '잘린 장소명의 전체 title 제공');
  assert.match(main.querySelector('.spotIdentity').getAttribute('aria-label'), new RegExp(longName), '접근 가능한 전체 이름 제공');
  assert.ok(main.querySelector(':scope > .actionMenu'), '장소 메뉴는 44px 전용 열');

  const meta = spot.querySelector(':scope > .spotMeta');
  assert.ok(meta, '메타데이터 독립 행');
  assert.ok(meta.children.length >= 5, '여러 메타데이터가 개별 항목으로 분리');
  [...meta.children].forEach((item) => assert.ok(item.classList.contains('spotMetaItem'), `${item.outerHTML} 메타 항목 클래스`));
  assert.equal(meta.querySelectorAll('.cost').length, 2, '외화 원금과 원화 환산을 별도 항목으로 분리');
  assert.ok(meta.querySelector('.book[href="https://example.com/booking"]'), '예약 링크 보존');

  const leg = spot.querySelector(':scope > .spotLeg');
  assert.ok(leg.querySelector('.legModeBtn'), '구간 수단 버튼 보존');
  assert.ok(leg.querySelector('.leg'), '거리·시간 구간 정보 보존');
  ['위로', '아래로', '편집', '복사', '삭제'].forEach((title) => assert.ok(spot.querySelector(`.actionMenuPanel [title="${title}"]`), `${title} 동작 보존`));

  const noLoc = card.querySelector('.spot[data-si="2"]');
  assert.ok(noLoc.querySelector(':scope > .spotMeta .noloc'), '위치 지정도 메타 행에 배치');
  w.close();
});

test('통합: 예약 가격 추적 — 확정 배지·확정/잠재 분리 요약·필터바 칩 배선', { skip: noJsdom }, () => {
  const w = boot();
  // 해외 좌표(스페인) — render()가 카카오 엔진 로드를 시도하지 않게. 오퍼는 마지막 성공 조회 레코드로 주입
  w.eval(`store.trips.push({id:'__bk__',name:'B',start:'2026-08-01',
      days:[{mode:'car',spots:[{lat:39.5,lng:-0.4,name:'Cap Rocat',city:'Mallorca',stay:true,bookingId:'bk1',placeId:'ChIJtest1234'}]}],
      bookings:[{id:'bk1',type:'hotel',title:'Cap Rocat',price:1350000,track:true,refundable:true,adults:2,rooms:1,start:'2099-10-30',end:'2099-11-01'}]});
    store.activeId='__bk__'; activeDay=0;
    priceStore['bk1']={at:new Date().toISOString(), err:null,
      obs:[{price:1180000,cur:'KRW',seller:'Expedia',quality:'EQUIVALENT',at:new Date().toISOString()}],
      offers:[{seller:'Expedia',price:1180000,cur:'KRW',refundable:true,link:'https://www.expedia.com/x'},
              {seller:'Agoda',price:1160000,cur:'KRW'}]};`);
  w.eval('render()');
  // 숙소 카드에 🔴 확정 절약 배지 (동일 조건 오퍼 기준)
  const badge = w.document.querySelector('.spot .pxBtn .pxBadge.pxSave');
  assert.ok(badge, '확정 절약 배지 표시');
  assert.match(badge.textContent, /170,000.*절약 가능/);
  // 상태 판정 배선 — 확정(Expedia)과 잠재(Agoda, 더 저렴하지만 미확인)를 분리
  const st = JSON.parse(w.eval(`JSON.stringify(hotelStateOf(bookingOf('bk1')))`));
  assert.equal(st.state, 'SAVING_AVAILABLE');
  assert.equal(st.confirmed.saving, 170000);
  assert.equal(st.confirmed.offer.seller, 'Expedia');
  assert.equal(st.potential.offer.seller, 'Agoda');
  assert.equal(st.potential.delta, 190000);
  const sum = JSON.parse(w.eval('JSON.stringify(tripSavingInfo())'));
  assert.equal(sum.booked, 1350000);
  assert.equal(sum.confirmed, 170000);
  assert.equal(sum.potential, 190000);
  // 필터바 칩은 확정 금액을 우선 표기
  assert.match(w.document.querySelector('#filterbar .pxChip').textContent, /170,000/);
  // 목록 모달 — 확정·잠재를 별도 행으로 (§31: 섞지 않는다)
  w.eval('renderBookingList()');
  const summary = w.document.getElementById('bookingSummary').textContent;
  assert.match(summary, /현재 확정 절약 가능/);
  assert.match(summary, /조건 확인 필요/);
  assert.match(summary, /190,000/);
  // 상세 박스 — 판매처 비교에 ✓ 동일 조건 vs 조건 확인 필요 구분 + 마지막 확인 시각
  w.eval(`editingBooking='bk1'; renderBookingStatusBox(bookingOf('bk1'))`);
  const boxText = w.document.getElementById('bkStatus').textContent;
  assert.match(boxText, /✓ 동일 조건/);
  assert.match(boxText, /조건 확인 필요/);
  assert.match(boxText, /마지막 가격 확인/);
  assert.ok(w.document.querySelector('#bkStatus #bkRebooked'), '[재예약했어요] 액션 제공');
  assert.ok(w.document.querySelector('#bkStatus a[href^="https://www.expedia.com"]'), '판매처 딥링크(https만)');
  w.close();
});

test('통합: checkBookingPrice — 실 프록시 흐름(성공·쿨다운·중복알림 방지·실패 보존)', { skip: noJsdom }, async () => {
  const w = boot();
  w.eval(`store.trips.push({id:'__bk2__',name:'B',days:[{spots:[]}],
      bookings:[{id:'bkx',type:'hotel',title:'Cap Rocat',price:1350000,track:true,refundable:true,start:'2099-10-30',end:'2099-11-01'},
                {id:'bkc',type:'car',title:'렌터카',price:500000,track:true,start:'2099-10-30',end:'2099-11-01'},
                {id:'bko',type:'hotel',title:'추적 끔',price:100000,track:false,start:'2099-10-30',end:'2099-11-01'}]});
    store.activeId='__bk2__';
    window.__alerts=0; onSavingOpportunity(()=>{window.__alerts++;});
    window.__fetchCalls=0;
    window.fetch=async(url,opts)=>{   // 호텔 프록시만 응답 — 부트가 큐잉한 경로 조회 등은 기존처럼 거부
      if(!String(url).includes('/api/hotel-offers')) throw new Error('no-net');
      window.__fetchCalls++;
      return {ok:true, json:async()=>({status:'OK', property:{name:'Cap Rocat', token:'tok_cap', confidence:0.95},
        offers:[{seller:'Expedia', price:1180000, cur:'KRW', refundable:true, link:'https://www.expedia.com/x'},
                {seller:'Agoda', price:1160000, cur:'KRW'}]})}; };`);
  const r1 = await w.eval(`checkBookingPrice('bkx',{force:true})`);
  assert.ok(r1 && r1.ok, '조회 성공');
  assert.equal(w.eval(`priceStore['bkx'].offers.length`), 2, '오퍼 저장');
  assert.equal(w.eval(`priceStore['bkx'].offers[0].quality`), 'EQUIVALENT', '조건 매칭 계산됨');
  assert.equal(w.eval(`priceStore['bkx'].obs.length`), 1, '하루 1점 관측 — 확정 후보 기준');
  assert.equal(w.eval(`priceStore['bkx'].obs[0].price`), 1180000);
  assert.equal(w.eval(`bookingOf('bkx').ptoken`), 'tok_cap', 'property 매핑 캐시 저장(§23)');
  assert.equal(w.eval(`window.__alerts`), 1, '확정 절약 알림 1회');
  // 쿨다운: 방금 확인 → 재조회 없이 저장값 유지 (§27)
  const r2 = await w.eval(`checkBookingPrice('bkx',{force:true})`);
  assert.ok(r2 && r2.cooldown, '쿨다운 반환');
  assert.equal(w.eval(`window.__fetchCalls`), 1, '추가 API 호출 없음');
  // 같은 가격 재발견 → 알림 반복 금지 (§29): 마지막 확인을 과거로 돌리고 재조회
  w.eval(`priceStore['bkx'].at=new Date(Date.now()-3600e3).toISOString()`);
  await w.eval(`checkBookingPrice('bkx',{force:true})`);
  assert.equal(w.eval(`window.__alerts`), 1, '같은 가격은 다시 알리지 않음');
  // 렌터카는 Discovery Provider가 없으므로 조회하지 않는다 (가짜 데이터 금지 §43)
  assert.equal(await w.eval(`checkBookingPrice('bkc',{force:true})`), null);
  assert.equal(await w.eval(`checkBookingPrice('bko',{force:true})`), null, '추적 꺼짐');
  assert.equal(w.eval(`window.__fetchCalls`), 2, '호텔 외 종류는 API 호출 없음');
  w.close();
});

test('통합: 가격 조회 실패 — 기존 관측 보존, 최신 가격으로 오인 금지 (§36)', { skip: noJsdom }, async () => {
  const w = boot();
  w.eval(`store.trips.push({id:'__bk3__',name:'B',days:[{spots:[]}],
      bookings:[{id:'bkf',type:'hotel',title:'H',price:1000000,track:true,refundable:true,start:'2099-10-30',end:'2099-11-01'}]});
    store.activeId='__bk3__';
    priceStore['bkf']={at:'2026-08-20T00:00:00Z', err:null, obs:[{price:990000,cur:'KRW',seller:'X',quality:'EQUIVALENT',at:'2026-08-20T00:00:00Z'}],
      offers:[{seller:'X',price:990000,cur:'KRW',refundable:true}]};
    window.fetch=async()=>{ const e=new Error('down'); throw e; };`);
  assert.equal(await w.eval(`checkBookingPrice('bkf',{force:true})`), null);
  assert.equal(w.eval(`priceStore['bkf'].err.code`), 'NETWORK_ERROR', '실패 원인 기록');
  assert.equal(w.eval(`priceStore['bkf'].obs.length`), 1, '기존 관측 보존');
  assert.equal(w.eval(`priceStore['bkf'].at`), '2026-08-20T00:00:00Z', '마지막 성공 시각 유지');
  // 상세 박스에 실패·마지막 성공 조회를 그대로 안내
  w.eval(`editingBooking='bkf'; renderBookingStatusBox(bookingOf('bkf'))`);
  assert.match(w.document.getElementById('bkStatus').textContent, /최근 재확인 실패/);
  // 프록시가 AUTH_REQUIRED(503)를 주면 성공 이력 없는 예약은 ERROR 상태로 정직하게 표시
  w.eval(`store.trips.find(t=>t.id==='__bk3__').bookings.push({id:'bkn',type:'hotel',title:'N',price:1,track:true,start:'2099-10-30',end:'2099-11-01'});
    window.fetch=async()=>({ok:false, json:async()=>({error:'AUTH_REQUIRED'})});`);
  await w.eval(`checkBookingPrice('bkn',{force:true})`);
  assert.equal(w.eval(`priceStore['bkn'].err.code`), 'AUTH_REQUIRED');
  assert.equal(w.eval(`hotelStateOf(bookingOf('bkn')).state`), 'ERROR');
  w.close();
});

test('통합: 호텔 매칭 후보(UNMATCHED) — 자동 확정하지 않고 사용자가 선택 (§22)', { skip: noJsdom }, async () => {
  const w = boot();
  w.eval(`store.trips.push({id:'__bk4__',name:'B',days:[{spots:[]}],
      bookings:[{id:'bku',type:'hotel',title:'애매한 이름',price:1,track:true,start:'2099-10-30',end:'2099-11-01'}]});
    store.activeId='__bk4__';
    window.fetch=async()=>({ok:true, json:async()=>({status:'UNMATCHED', candidates:[{name:'후보 호텔 A', token:'tok_a'},{name:'후보 호텔 B', token:'tok_b'}]})});`);
  await w.eval(`checkBookingPrice('bku',{force:true})`);
  assert.equal(w.eval(`priceStore['bku'].err.code`), 'UNMATCHED');
  assert.equal(w.eval(`priceStore['bku'].candidates.length`), 2);
  w.eval(`editingBooking='bku'; renderBookingStatusBox(bookingOf('bku'))`);
  assert.equal(w.document.querySelectorAll('#bkStatus .pxPick').length, 2, '후보 선택 버튼 렌더');
  w.close();
});

test('통합: 검색 오류 분류 classifySearchErr (인증/할당량/네트워크/일반)', { skip: noJsdom }, () => {
  const w = boot();
  assert.equal(w.eval(`classifySearchErr(new Error('Failed to fetch'))`), 'network');
  assert.equal(w.eval(`classifySearchErr(new Error('OVER_QUERY_LIMIT: quota exceeded'))`), 'quota');
  assert.equal(w.eval(`classifySearchErr(new Error('This API project is not authorized to use this API'))`), 'auth');
  assert.equal(w.eval(`classifySearchErr(new Error('RefererNotAllowedMapError'))`), 'auth');
  assert.equal(w.eval(`classifySearchErr(new Error('boom'))`), 'error');
  ['auth', 'quota', 'network', 'error'].forEach(k =>
    assert.equal(w.eval(`typeof SEARCH_ERR_MSG['${k}']`), 'string', `${k} 안내문 존재`));
});

test('통합: 재생 탐색 계산 playSeekTarget / playLegIndexAt', { skip: noJsdom }, () => {
  const w = boot();
  // phases [0..100 dur2000][100..300 dur4000], gtotal 300, frac 0.5 → d=150 (두번째 phase)
  const t = JSON.parse(w.eval(`JSON.stringify(playSeekTarget([{a:0,b:100,dur:2000},{a:100,b:300,dur:4000}], 300, 0.5))`));
  assert.equal(t.pIdx, 1);
  assert.equal(t.d, 150);
  assert.ok(Math.abs(t.elapsed - ((150 - 100) / 200 * 4000)) < 1e-6, `elapsed=${t.elapsed}`);   // 1000ms
  assert.equal(w.eval(`playSeekTarget([{a:0,b:100,dur:2000}], 100, 1).pIdx`), 0);                // 끝은 마지막 phase
  // leg 인덱스: legStarts=[0,50,120]
  assert.equal(w.eval(`playLegIndexAt([0,50,120], 0)`), 0);
  assert.equal(w.eval(`playLegIndexAt([0,50,120], 60)`), 1);
  assert.equal(w.eval(`playLegIndexAt([0,50,120], 200)`), 2);
});

test('통합: 장소 선택 상태는 class 기반으로 붙고, 다른 장소를 고르면 이전 선택이 해제된다', { skip: noJsdom }, () => {
  const w = boot();
  withTrip(w, `[{mode:'car',startAt:'09:00',spots:[
    {lat:37.50,lng:127.00,name:'A',city:'S'},
    {lat:37.55,lng:127.05,name:'B',city:'S',cost:228,cur:'EUR',bookAt:'14:00',bookUrl:'https://example.com',opt:true}
  ]}]`);
  w.eval('renderSidebar()');

  // 선택 → .is-selected 가 붙고 Day 카드도 함께 강조
  w.eval('selectSpotCard(0,1)');
  assert.ok(w.document.querySelector('.spot[data-di="0"][data-si="1"].is-selected'), '선택한 장소에 is-selected');
  assert.ok(w.document.querySelector('.dayCard.is-selected'), '해당 Day 카드도 강조');

  // 다른 장소 선택 → 이전 선택 해제(항상 하나만)
  w.eval('selectSpotCard(0,0)');
  assert.equal(w.document.querySelectorAll('.spot.is-selected').length, 1, '선택은 항상 하나');
  assert.ok(w.document.querySelector('.spot[data-di="0"][data-si="0"].is-selected'), '새 선택으로 이동');

  // 재렌더 후에도 선택 유지 (DOM이 새로 만들어져도 상태 복원)
  w.eval('renderSidebar()');
  assert.ok(w.document.querySelector('.spot[data-di="0"][data-si="0"].is-selected'), '재렌더 후 유지');

  // 강조를 inline 배경으로 넣지 않는다 (class 기반 통일) — style 속성은 도시색 토큰(--c) 용도로만 쓴다
  const inline = w.document.querySelector('.spot.is-selected').getAttribute('style') || '';
  assert.ok(!/background/i.test(inline), 'inline 배경 미사용');
  assert.ok(/^--c:/.test(inline) || inline === '', 'style 속성은 도시색 토큰만');

  // 사라진 인덱스를 가리키면 자동 해제
  w.eval('selectSpotCard(0,99); renderSidebar()');
  assert.equal(w.document.querySelectorAll('.spot.is-selected').length, 0, '없는 선택은 해제');

  // 선택 해제
  w.eval('selectSpotCard(0,1); selectSpotCard(null)');
  assert.equal(w.document.querySelectorAll('.spot.is-selected').length, 0, '명시적 해제');
  w.close();
});

test('통합: 선택 상태가 장소 클릭·작업 메뉴 동작을 방해하지 않는다', { skip: noJsdom }, () => {
  const w = boot();
  withTrip(w, `[{mode:'car',startAt:'09:00',spots:[{lat:37.50,lng:127.00,name:'A',city:'S'}]}]`);
  w.eval('renderSidebar(); selectSpotCard(0,0)');
  const spot = w.document.querySelector('.spot.is-selected');

  // 이름 버튼(지도 보기)과 작업 메뉴가 선택 상태에서도 그대로 존재
  assert.ok(spot.querySelector('.spotIdentity'), '이름 버튼 유지');
  const menu = spot.querySelector('.actionMenu');
  assert.ok(menu, '⋮ 작업 메뉴 유지');
  assert.ok(menu.querySelector('summary'), '메뉴 트리거 유지');

  // focusSpot(선택+지도 이동)이 예외 없이 동작
  assert.doesNotThrow(() => w.eval('focusSpot(0,0)'), 'focusSpot 무예외');
  assert.ok(w.document.querySelector('.spot[data-di="0"][data-si="0"].is-selected'), 'focusSpot 후에도 선택');

  // 메뉴 열기(details)가 선택 상태에서도 동작
  menu.setAttribute('open', '');
  assert.ok(menu.hasAttribute('open'), '작업 메뉴 열림');
  w.close();
});

test('통합: 한글 호텔명은 영문으로 변환해 시세를 조회하고 결과를 캐시한다', { skip: noJsdom }, async () => {
  const w = boot();
  // SerpApi는 한글 쿼리로 엉뚱한 숙소를 주므로, Google Places(영문 응답)로 한 번 바꿔 조회한다
  w.eval(`googlePlaces=async()=>({list:[{name:'The Shilla Seoul'}],err:null});`);
  const b = w.eval(`(async()=>{
    const b={id:'bk9', title:'신라호텔'};
    const name=await enNameForBooking(b,{name:'신라호텔', lat:37.5559, lng:127.0054});
    return JSON.stringify({name, cached:b.enName});
  })()`);
  const out = JSON.parse(await b);
  assert.equal(out.name, 'The Shilla Seoul', '영문명으로 조회');
  assert.equal(out.cached, 'The Shilla Seoul', '예약에 캐시되어 재조회하지 않음');

  // 이미 영문이면 그대로 쓰고 Places를 호출하지 않는다
  w.eval(`googlePlaces=async()=>{ throw new Error('called'); };`);
  const en = await w.eval(`enNameForBooking({id:'bk8',title:'Lotte Hotel Seoul'},{name:'Lotte Hotel Seoul'})`);
  assert.equal(en, 'Lotte Hotel Seoul');

  // 변환이 실패해도 원래 이름으로 진행한다(후보 선택 UI가 마지막 안전망)
  const fb = await w.eval(`enNameForBooking({id:'bk7',title:'신라호텔'},{name:'신라호텔'})`);
  assert.equal(fb, '신라호텔');
  w.close();
});

test('통합: 숙소 카드에서 가격 추적을 시작할 수 있고, 예약이 생기면 상태 배지로 바뀐다', { skip: noJsdom }, () => {
  const w = boot();
  withTrip(w, `[{mode:'car',startAt:'09:00',spots:[
    {name:'Lotte Hotel Seoul',lat:37.5651,lng:126.9814,city:'Seoul',stay:true,nights:3},
    {name:'경복궁',lat:37.5796,lng:126.9770,city:'Seoul'}
  ]}]`);
  w.eval('renderSidebar()');

  // 숙소에만 노출된다 — 기능을 ☰ 메뉴에서만 찾을 수 있던 문제를 카드에서 해결
  assert.equal(w.document.querySelectorAll('.pxStart').length, 1, '숙소 1곳에만');
  assert.ok(!w.document.querySelectorAll('.spot')[1].querySelector('.pxStart'), '일반 장소엔 없음');

  // 이름·기간·장소 연결이 미리 채워져 예약가만 넣으면 된다
  w.eval('startHotelTracking(0,0)');
  const val = (id) => w.document.getElementById(id).value;
  assert.ok(w.document.getElementById('bookingModalBg').classList.contains('show'), '예약 모달 열림');
  assert.equal(val('bkTitle'), 'Lotte Hotel Seoul');
  assert.equal(val('bkStart'), '2026-08-01');
  assert.equal(val('bkEnd'), '2026-08-04', '연박(3박)이 체크아웃에 반영');
  assert.notEqual(val('bkSpot'), '', '일정 장소가 연결됨');

  // 예약이 연결되면 시작 버튼 대신 추적 상태가 보인다
  w.eval(`trip().bookings=[{id:'bkZ',type:'hotel',title:'Lotte Hotel Seoul',price:600000,cur:'KRW',start:'2099-10-30',end:'2099-11-02',track:true}];
    trip().days[0].spots[0].bookingId='bkZ'; renderSidebar();`);
  assert.ok(!w.document.querySelector('.pxStart'), '시작 버튼은 사라짐');
  assert.match(w.document.querySelector('.pxBtn').textContent, /가격 추적/);
  w.close();
});

test('통합: 조회 실패는 원인 코드를 함께 보여주고, 잘못된 매물 매핑은 스스로 버린다', { skip: noJsdom }, async () => {
  const w = boot();
  withTrip(w, `[{mode:'car',startAt:'09:00',spots:[{name:'H',lat:37.5,lng:127,city:'S',stay:true,bookingId:'bkE'}]}]`);
  w.eval(`trip().bookings=[{id:'bkE',type:'hotel',title:'H',price:500000,cur:'KRW',start:'2099-10-30',end:'2099-11-01',track:true,ptoken:'STALE_TOKEN'}];`);

  // 매물 관련 실패면 저장된 ptoken을 버려야 다음 조회에서 다시 검색한다(같은 실패 무한반복 방지)
  w.eval(`MetasearchHotelProvider.searchOffers=async()=>{ throw Object.assign(new Error('x'),{code:'PROPERTY_NOT_FOUND'}); };`);
  await w.eval(`checkBookingPrice('bkE',{force:true})`);
  assert.equal(w.eval(`bookingOf('bkE').ptoken`), undefined, '잘못된 매핑 폐기');
  assert.equal(w.eval(`recOf('bkE').err.code`), 'PROPERTY_NOT_FOUND');

  // 네트워크 오류처럼 매물과 무관한 실패는 매핑을 유지한다
  w.eval(`bookingOf('bkE').ptoken='KEEP'; recOf('bkE').err=null; recOf('bkE').at=null;
    MetasearchHotelProvider.searchOffers=async()=>{ throw Object.assign(new Error('x'),{code:'NETWORK_ERROR'}); };`);
  await w.eval(`checkBookingPrice('bkE',{force:true})`);
  assert.equal(w.eval(`bookingOf('bkE').ptoken`), 'KEEP', '네트워크 오류엔 매핑 유지');

  // 화면에 원인 코드가 함께 나온다
  w.eval(`openBookingModal('bkE')`);
  assert.match(w.document.getElementById('bkStatus').textContent, /NETWORK_ERROR/);
  w.close();
});

test('통합: 체크인이 지난 예약은 조회하지 않고 "추적을 마쳤어요"로 안내한다', { skip: noJsdom }, async () => {
  const w = boot();
  const day = (d) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);
  withTrip(w, `[{mode:'car',startAt:'09:00',spots:[{name:'H',lat:37.5,lng:127,city:'S',stay:true,bookingId:'bkP'}]}]`);
  // 체크인은 지났고 체크아웃은 아직 — 지금까지 매 조회가 PROVIDER_ERROR로 실패하던 조합
  w.eval(`trip().bookings=[{id:'bkP',type:'hotel',title:'H',price:500000,cur:'KRW',start:'${day(-3)}',end:'${day(2)}',track:true}];
    window.called=0; MetasearchHotelProvider.searchOffers=async()=>{ window.called++; throw new Error('should not be called'); };`);

  const r = await w.eval(`checkBookingPrice('bkP',{force:true})`);
  assert.equal(r, null, '조회를 시도하지 않는다');
  assert.equal(w.eval('called'), 0, 'upstream 호출 없음(유료 호출 낭비 방지)');

  w.eval(`openBookingModal('bkP')`);
  assert.match(w.document.getElementById('bkStatus').textContent, /추적을 마쳤어요/);
  w.close();
});

test('통합: 체크아웃이 체크인보다 앞서면 저장을 막는다(잘못된 날짜가 조회 실패로 이어지던 문제)', { skip: noJsdom }, () => {
  const w = boot();
  withTrip(w, `[{mode:'car',startAt:'09:00',spots:[{name:'H',lat:37.5,lng:127,city:'S',stay:true}]}]`);
  w.eval('openBookingModal(null)');
  const set = (id, v) => { w.document.getElementById(id).value = v; };
  set('bkType', 'hotel'); set('bkTitle', 'H'); set('bkPrice', '500000');
  set('bkStart', '2099-11-05'); set('bkEnd', '2099-11-02');   // 역순
  w.document.getElementById('bkSave').click();
  assert.equal(w.eval('(trip().bookings||[]).length'), 0, '역순 날짜는 저장되지 않는다');

  set('bkEnd', '2099-11-05');                                  // 같은 날
  w.document.getElementById('bkSave').click();
  assert.equal(w.eval('(trip().bookings||[]).length'), 0, '같은 날도 저장되지 않는다');

  set('bkEnd', '2099-11-07');                                  // 정상
  w.document.getElementById('bkSave').click();
  assert.equal(w.eval('(trip().bookings||[]).length'), 1, '정상 날짜는 저장');
  w.close();
});

test('통합: 렌터카 예약 — 조건 저장·시장 검색·매칭·절약 표시까지 End-to-End', { skip: noJsdom }, async () => {
  const w = boot();
  const day = (d) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);
  withTrip(w, `[{mode:'car',startAt:'09:00',spots:[{name:'X',lat:39.5,lng:2.7,city:'Palma'}]}]`);

  // 1) 모달에서 렌터카 조건 저장 (bkCarFields)
  w.eval('openBookingModal(null)');
  const set=(id,v)=>{ w.document.getElementById(id).value=v; };
  set('bkType','car'); w.eval('toggleBkFields()');
  assert.equal(w.document.getElementById('bkCarFields').style.display, 'block', '렌터카 필드 노출');
  assert.equal(w.document.getElementById('bkHotelFields').style.display, 'none');
  set('bkTitle','RecordGo Compact'); set('bkPrice','320'); set('bkCur','EUR');
  set('bkStart',day(30)); set('bkEnd',day(34));
  set('bkCarPickup','Palma Airport'); set('bkCarPickupCode','pmi');
  set('bkCarClass','compact'); set('bkCarTrans','automatic'); set('bkCarMileage','UNLIMITED');
  w.document.getElementById('bkFreeCancel').checked=true;
  w.document.getElementById('bkSave').click();
  const b=w.eval('JSON.parse(JSON.stringify(trip().bookings[0]))');
  assert.equal(b.carPickupCode, 'PMI', '공항코드 대문자 저장');
  assert.equal(b.carClass, 'compact');
  assert.equal(b.transmission, 'automatic');

  // 2) 시장 검색(Provider 스텁 — 테스트에서만 mock 허용) → carMatchQuality 디스패치 → 확정 절약
  await new Promise(res=>setTimeout(res,20));   // bkSave가 발사한 자동 조회(no-net 실패) 정리 대기
  w.eval('_pxInflight.clear(); recOf(trip().bookings[0].id).err=null;');
  w.eval(`CarMarketProvider.searchOffers=async()=>({status:'OK',offers:[
    {seller:'Sixt',price:258,total:258,cur:'EUR',pickupCode:'PMI',vehicleClass:'compact',transmission:'automatic',mileage:'UNLIMITED',refundable:true,link:'https://sixt.example.com/x'},
    {seller:'Europcar',price:247,total:247,cur:'EUR',pickupCode:'PMI',vehicleClass:'economy',transmission:'manual',refundable:true}
  ]});`);
  const r=await w.eval(`checkBookingPrice(trip().bookings[0].id,{force:true})`);
  assert.ok(r&&r.ok, '조회 성공');
  const st=w.eval(`JSON.parse(JSON.stringify(hotelStateOf(trip().bookings[0])))`);
  assert.equal(st.state, 'SAVING_AVAILABLE', '동일 조건 Sixt로 확정 절약');
  assert.equal(st.confirmed.saving, 62, '€62 — Europcar €73은 조건이 달라 확정에 포함 안 됨');
  assert.equal(st.potential.delta, 73, 'Europcar는 잠재(조건 확인 필요)로만');

  // 3) 상태 박스: 확정+잠재 구분 표시
  w.eval(`openBookingModal(trip().bookings[0].id)`);
  const boxText=w.document.getElementById('bkStatus').textContent;
  assert.match(boxText, /절약/, '절약 표시');
  assert.match(boxText, /Sixt/);
  assert.match(boxText, /조건 확인 필요/, 'Europcar는 조건 확인 필요로 구분');
  w.close();
});

test('통합: 렌터카 자동 소스 미연결(AUTH_REQUIRED) → 수동 관측 fallback이 동작한다', { skip: noJsdom }, async () => {
  const w = boot();
  const day = (d) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);
  withTrip(w, `[{mode:'car',startAt:'09:00',spots:[]}]`);
  w.eval(`trip().bookings=[{id:'car1',type:'car',title:'RecordGo Compact',price:320,cur:'EUR',
    start:'${day(30)}',end:'${day(34)}',carPickupCode:'PMI',carClass:'compact',transmission:'automatic',
    url:'https://www.recordrentacar.com/en/',track:true,refundable:true}];`);

  // 자동 조회가 AUTH_REQUIRED로 실패 (프록시에 연결된 Provider 없음)
  w.eval(`CarMarketProvider.searchOffers=async()=>{ throw Object.assign(new Error('x'),{code:'AUTH_REQUIRED'}); };`);
  await w.eval(`checkBookingPrice('car1',{force:true})`);
  w.eval(`openBookingModal('car1')`);
  const t1=w.document.getElementById('bkStatus').textContent;
  assert.match(t1, /자동 시장 추적 미연결/, '실패가 아니라 미연결로 안내');
  assert.ok(w.document.getElementById('bkManualPrice'), '수동 가격 입력 제공');
  assert.match(w.document.getElementById('bkStatus').innerHTML, /recordrentacar\.com/, '예약 사이트 열기 링크');

  // 수동 가격 기록 → 판단은 자동 (€320→€250 하락 → 확정 절약)
  w.document.getElementById('bkManualPrice').value='250';
  w.document.getElementById('bkManualSave').click();
  const st=w.eval(`JSON.parse(JSON.stringify(hotelStateOf(bookingOf('car1'))))`);
  assert.equal(st.state, 'SAVING_AVAILABLE', '입력만 수동, 판단은 자동');
  assert.equal(st.confirmed.saving, 70);
  const rec=w.eval(`JSON.parse(JSON.stringify(recOf('car1')))`);
  assert.equal(rec.obs.length, 1, 'PriceObservation 기록');
  assert.equal(rec.obs[0].manual, 1, '수동 관측 표식');
  w.close();
});

test('통합: 지도 탭 한 번으로 그 좌표에 장소 추가 모달이 열린다 (폰에 우클릭이 없다)', { skip: noJsdom }, async () => {
  const w = boot();
  withTrip(w, `[{mode:'car',startAt:'09:00',spots:[]},{mode:'car',startAt:'09:00',spots:[]}]`, 2);
  w.eval('reverseSpot=async()=>({name:"탭한 곳",city:"서울"});');

  w.eval('onMapTap(37.5665,126.9780)');
  assert.ok(!w.document.getElementById('spotModalBg').classList.contains('show'), '더블탭 구분을 위해 즉시 열지 않는다');
  await new Promise(r=>setTimeout(r,320));
  assert.ok(w.document.getElementById('spotModalBg').classList.contains('show'), '탭 후 장소 추가 모달');
  assert.equal(w.document.getElementById('spotLat').value, '37.5665');
  assert.equal(w.document.getElementById('spotLng').value, '126.978');
  assert.equal(w.eval('editing.di'), 1, '현재 보고 있는 일자에 추가된다');
  w.close();
});

test('통합: 더블탭 확대·패닝은 장소 추가로 오인하지 않는다', { skip: noJsdom }, async () => {
  const w = boot();
  withTrip(w, `[{mode:'car',startAt:'09:00',spots:[]}]`);
  w.eval('reverseSpot=async()=>({});');

  w.eval('onMapTap(37.5,127.0); cancelMapTap();');     // dblclick/drag 핸들러가 하는 일
  await new Promise(r=>setTimeout(r,320));
  assert.ok(!w.document.getElementById('spotModalBg').classList.contains('show'), '취소되면 모달이 뜨지 않아야');
  w.close();
});

test('통합: 좌표 지정 중(pickMode)에는 탭이 추가가 아니라 좌표 지정으로 간다', { skip: noJsdom }, async () => {
  const w = boot();
  withTrip(w, `[{mode:'car',startAt:'09:00',spots:[]}]`);
  w.eval('reverseSpot=async()=>({});');
  w.eval('openSpotModal(0,-1); document.getElementById("pickOnMap").onclick();');
  assert.equal(w.eval('pickMode'), true);

  w.eval('onMapTap(37.4,127.4)');
  assert.equal(w.eval('pickMode'), false, '탭 즉시 좌표가 지정된다(지연 없음)');
  assert.equal(w.document.getElementById('spotLat').value, '37.4');
  assert.match(w.document.getElementById('coordHint').textContent, /37\.4000/);
  w.close();
});

test('통합: 읽기전용(viewMode)에서는 지도 탭으로 추가되지 않는다', { skip: noJsdom }, async () => {
  const w = boot();
  withTrip(w, `[{mode:'car',startAt:'09:00',spots:[]}]`);
  w.eval('viewMode=true; onMapTap(37.5,127.0);');
  await new Promise(r=>setTimeout(r,320));
  assert.ok(!w.document.getElementById('spotModalBg').classList.contains('show'));
  w.close();
});

test('통합: 메뉴가 열려 있을 때의 지도 탭은 닫기일 뿐, 장소를 추가하지 않는다', { skip: noJsdom }, async () => {
  const w = boot();
  withTrip(w, `[{mode:'car',startAt:'09:00',spots:[]}]`);
  w.eval('reverseSpot=async()=>({});');
  w.document.getElementById('hdrMenu').classList.add('open');
  w.eval('onMapTap(37.5,127.0)');
  await new Promise(r=>setTimeout(r,320));
  assert.ok(!w.document.getElementById('spotModalBg').classList.contains('show'), '메뉴 닫기용 탭은 추가로 이어지지 않아야');
  w.close();
});

// 구글 Places 스텁 — 탭한 POI(placeId)와 '주변 검색'을 구분해 무엇이 호출됐는지 기록한다
function stubGooglePlaces(w, { nearbyName='주변에서 제일 유명한 곳', exactName='탭한 식당' } = {}){
  w.eval(`
    window.__calls={fetched:null, nearby:null};
    class FakePlace {
      constructor(o){ this.id=o&&o.id; this.lang=o&&o.requestedLanguage;
        this.displayName={text:'${exactName}'}; this.formattedAddress='x'; this.addressComponents=[]; }
      fetchFields(req){ window.__calls.fetched={id:this.id, lang:this.lang, fields:req&&req.fields}; return Promise.resolve({place:this}); }
      static searchNearby(req){
        window.__calls.nearby=JSON.parse(JSON.stringify({radius:req.locationRestriction.radius, rank:req.rankPreference||null}));
        return Promise.resolve({places:[{displayName:{text:'${nearbyName}'}, formattedAddress:'y', addressComponents:[]}]});
      }
    }
    window.google={maps:{importLibrary:async()=>({Place:FakePlace, SearchNearbyRankPreference:{DISTANCE:'DISTANCE', POPULARITY:'POPULARITY'}})}};
  `);
}

test('통합: POI를 탭하면 주변 추측이 아니라 그 장소를 그대로 쓴다', { skip: noJsdom }, async () => {
  const w = boot();
  withTrip(w, `[{mode:'car',startAt:'09:00',spots:[]}]`);
  stubGooglePlaces(w);

  const got = await w.eval(`reverseSpot(39.5696,2.6502,'PLACE_ID_123')`);   // 해외(팔마) 좌표
  assert.equal(got.name, '탭한 식당', '탭한 POI의 이름');
  const calls = w.eval('JSON.stringify(window.__calls)');
  const c = JSON.parse(calls);
  assert.equal(c.fetched.id, 'PLACE_ID_123', '그 장소를 id로 직접 조회');
  assert.equal(c.nearby, null, 'placeId가 있으면 주변 검색을 하지 않는다 — 추측 금지');
  w.close();
});

test('통합: 빈 자리를 탭하면 가장 가까운 곳만 본다 (예전엔 반경 100m의 최고 인기 장소였다)', { skip: noJsdom }, async () => {
  const w = boot();
  withTrip(w, `[{mode:'car',startAt:'09:00',spots:[]}]`);
  stubGooglePlaces(w);

  const got = await w.eval(`reverseSpot(39.5696,2.6502)`);
  assert.equal(got.name, '주변에서 제일 유명한 곳', 'POI 미특정이면 주변 검색으로 폴백');
  const c = JSON.parse(w.eval('JSON.stringify(window.__calls)'));
  assert.equal(c.rank ?? c.nearby.rank, 'DISTANCE', "'가장 인기'가 아니라 '가장 가까운'");
  assert.ok(c.nearby.radius <= 50, '반경 100m는 너무 넓어 엉뚱한 가게가 잡혔다 — got ' + c.nearby.radius);
  w.close();
});

test('통합: 탭한 POI의 placeId가 모달까지 전달된다', { skip: noJsdom }, async () => {
  const w = boot();
  withTrip(w, `[{mode:'car',startAt:'09:00',spots:[]}]`);
  w.eval('window.__rev=null; reverseSpot=(lat,lng,pid)=>{ window.__rev={lat,lng,pid}; return Promise.resolve({}); };');

  w.eval("onMapTap(39.5696,2.6502,'PLACE_ID_123')");
  await new Promise(r=>setTimeout(r,320));
  assert.equal(w.document.getElementById('spotPlaceId').value, 'PLACE_ID_123', '검색 결과와 동일하게 placeId 보존');
  assert.equal(JSON.parse(w.eval('JSON.stringify(window.__rev)')).pid, 'PLACE_ID_123', '자동채움까지 관통');
  w.close();
});

test('통합: 국내는 건물명보다 가까운 상호를 우선한다', { skip: noJsdom }, async () => {
  const w = boot();
  withTrip(w, `[{mode:'car',startAt:'09:00',spots:[]}]`);
  w.eval(`
    window.loadKakao=async()=>true;
    window.kakao={maps:{
      LatLng:function(a,b){this.a=a;this.b=b;},
      services:{
        Status:{OK:'OK'}, SortBy:{DISTANCE:'DISTANCE'},
        Geocoder:function(){ this.coord2Address=(lng,lat,cb)=>cb([{address:{region_1depth_name:'서울특별시',region_2depth_name:'중구'},
          road_address:{building_name:'○○빌딩'}}],'OK'); },
        Places:function(){ this.categorySearch=(code,cb,opt)=>{
          if(code==='FD6') cb([{place_name:'탭한 국밥집',distance:'12'}],'OK'); else cb([],'ZERO_RESULT'); }; }
      }}};
  `);
  const got = await w.eval(`reverseSpot(37.5665,126.9780)`);
  assert.equal(got.name, '탭한 국밥집', '건물명(○○빌딩)이 아니라 탭한 가게');
  assert.equal(got.city, '서울', '광역시 접미사 제거');
  w.close();
});

test('통합: 국내에서 가까운 상호가 없으면 건물명으로 폴백한다', { skip: noJsdom }, async () => {
  const w = boot();
  withTrip(w, `[{mode:'car',startAt:'09:00',spots:[]}]`);
  w.eval(`
    window.loadKakao=async()=>true;
    window.kakao={maps:{
      LatLng:function(){},
      services:{
        Status:{OK:'OK'}, SortBy:{DISTANCE:'DISTANCE'},
        Geocoder:function(){ this.coord2Address=(lng,lat,cb)=>cb([{address:{region_1depth_name:'경기도',region_2depth_name:'성남시'},
          road_address:{building_name:'○○빌딩'}}],'OK'); },
        Places:function(){ this.categorySearch=(code,cb)=>cb([],'ZERO_RESULT'); }
      }}};
  `);
  const got = await w.eval(`reverseSpot(37.4,127.1)`);
  assert.equal(got.name, '○○빌딩');
  assert.equal(got.city, '성남');
  w.close();
});

// 카카오 SDK 스텁 — categorySearch가 카테고리별 장소를 돌려주는 것처럼 흉내낸다
function stubKakaoPOI(w, { level=3, places=null } = {}){
  const data = places || [
    { id:'1', place_name:'탭한 국밥집', x:'126.9780', y:'37.5665', address_name:'서울 중구 을지로 12', road_address_name:'서울 중구 을지로 12' },
    { id:'2', place_name:'옆집 카페',   x:'126.9782', y:'37.5666', address_name:'서울 중구 을지로 14' }
  ];
  w.eval(`
    window.__ov=[];
    window.kakao={maps:{
      LatLng:function(a,b){this.a=a;this.b=b;this.getLat=()=>a;this.getLng=()=>b;},
      CustomOverlay:function(o){ this.o=o; window.__ov.push(o); this.setMap=function(m){ this.mapped=!!m; }; },
      event:{addListener:()=>{},removeListener:()=>{}},
      services:{ Status:{OK:'OK'}, SortBy:{DISTANCE:'DISTANCE'},
        Places:function(){ this.categorySearch=(code,cb)=>{ cb(code==='FD6'? ${JSON.stringify(data)} : [], 'OK'); }; } }
    }};
    const _P=(a,b)=>({getLat:()=>a,getLng:()=>b});
    kmap={ getLevel:()=>${level}, relayout(){},
      getCenter:()=>new kakao.maps.LatLng(37.5665,126.9780),
      getBounds:()=>({ getSouthWest:()=>_P(37.560,126.970), getNorthEast:()=>_P(37.572,126.990) }) };
    engine='kakao';
  `);
}

test('통합: 국내 지도에 POI 마커를 깔고, 그걸 누르면 그 장소가 정확히 들어간다', { skip: noJsdom }, async () => {
  const w = boot();
  withTrip(w, `[{mode:'car',startAt:'09:00',spots:[]}]`);
  stubKakaoPOI(w);
  // 역지오코딩이 불리면 실패로 간주 — POI를 눌렀으면 추측할 이유가 없다
  w.eval('window.__reverseCalled=0; reverseSpot=()=>{ window.__reverseCalled++; return Promise.resolve({name:"엉뚱한 곳",city:"엉뚱"}); };');

  w.eval('refreshKakaoPOI()');
  await new Promise(r=>setTimeout(r,20));
  const chips = w.eval('poiOverlays.length');
  assert.equal(chips, 2, '조회된 장소만큼 마커');

  // 첫 칩(국밥집)을 누른다
  const el = w.eval('window.__ov[0].content');
  el.dispatchEvent(new w.Event('click',{bubbles:true,cancelable:true}));
  await new Promise(r=>setTimeout(r,20));
  assert.equal(w.document.getElementById('spotName').value, '탭한 국밥집', '누른 그 장소');
  assert.equal(w.document.getElementById('spotCity').value, '서울');
  assert.equal(w.eval('window.__reverseCalled'), 0, 'POI를 눌렀으면 좌표 역추적을 하지 않는다');
  w.close();
});

test('통합: POI 칩 이름은 textContent로 넣어 스크립트가 실행되지 않는다', { skip: noJsdom }, async () => {
  const w = boot();
  withTrip(w, `[{mode:'car',startAt:'09:00',spots:[]}]`);
  stubKakaoPOI(w, { places:[{ id:'x', place_name:'<img src=x onerror=alert(1)>가게', x:'126.9', y:'37.5', address_name:'서울 중구' }] });
  w.eval('refreshKakaoPOI()');
  await new Promise(r=>setTimeout(r,20));
  const el = w.eval('window.__ov[0].content');
  assert.equal(el.querySelector('img'), null, '마크업으로 해석되면 안 된다');
  assert.equal(el.textContent, '<img src=x onerror=alert(1)>가게', '문자 그대로 표시');
  w.close();
});

test('통합: 넓게 보는 중이거나 읽기전용이면 POI를 깔지 않는다', { skip: noJsdom }, async () => {
  const w = boot();
  withTrip(w, `[{mode:'car',startAt:'09:00',spots:[]}]`);
  stubKakaoPOI(w, { level:9 });                       // 넓은 범위
  w.eval('refreshKakaoPOI()');
  await new Promise(r=>setTimeout(r,20));
  assert.equal(w.eval('poiOverlays.length'), 0, '축소 상태에선 표시 안 함');

  stubKakaoPOI(w, { level:3 });
  w.eval('viewMode=true; refreshKakaoPOI()');
  await new Promise(r=>setTimeout(r,20));
  assert.equal(w.eval('poiOverlays.length'), 0, '읽기전용에선 표시 안 함');
  w.close();
});

test('통합: 해외(구글) 엔진에서는 국내 POI 레이어가 뜨지 않는다', { skip: noJsdom }, async () => {
  const w = boot();
  withTrip(w, `[{mode:'car',startAt:'09:00',spots:[]}]`);
  stubKakaoPOI(w, { level:3 });
  w.eval("engine='google'; refreshKakaoPOI()");
  await new Promise(r=>setTimeout(r,20));
  assert.equal(w.eval('poiOverlays.length'), 0);
  w.close();
});

test('통합: 지도가 크기를 못 잡아 bounds가 한 점이면 중심 반경으로 훑는다', { skip: noJsdom }, async () => {
  const w = boot();
  withTrip(w, `[{mode:'car',startAt:'09:00',spots:[]}]`);
  // 접힌 bounds(sw===ne)를 주는 카카오 스텁 — 실제 브라우저에서 이 상태면 조회가 0건이었다
  w.eval(`
    window.__opt=null;
    const P=(a,b)=>({getLat:()=>a,getLng:()=>b});
    window.kakao={maps:{
      LatLng:function(a,b){this.getLat=()=>a;this.getLng=()=>b;},
      CustomOverlay:function(o){ this.o=o; this.setMap=function(){}; },
      event:{addListener:()=>{},removeListener:()=>{}},
      services:{ Status:{OK:'OK'}, SortBy:{DISTANCE:'DISTANCE'},
        Places:function(){ this.categorySearch=(code,cb,opt)=>{ window.__opt=opt;
          cb(code==='FD6'? [{id:'1',place_name:'독일분식',x:'126.9821',y:'37.5662',address_name:'서울 중구 을지로1가'}] : [], 'OK'); }; } }
    }};
    kmap={ getLevel:()=>3, getCenter:()=>new kakao.maps.LatLng(37.5662,126.9821),
           getBounds:()=>({ getSouthWest:()=>P(37.5662,126.9821), getNorthEast:()=>P(37.5662,126.9821) }) };
    engine='kakao';
  `);
  w.eval('refreshKakaoPOI()');
  await new Promise(r=>setTimeout(r,20));
  const opt = JSON.parse(w.eval('JSON.stringify({hasBounds: !!(window.__opt&&window.__opt.bounds), radius: window.__opt&&window.__opt.radius})'));
  assert.equal(opt.hasBounds, false, '접힌 bounds는 쓰지 않는다');
  assert.ok(opt.radius > 0, '중심 반경으로 폴백 — got ' + opt.radius);
  assert.equal(w.eval('poiOverlays.length'), 1, '폴백으로도 장소가 깔린다');
  w.close();
});

test('통합: 충돌 응답은 로컬 base revision을 서버 값으로 덮어쓰지 않는다', { skip: noJsdom }, async () => {
  const w=boot();
  w.eval(`user={id:'u1'}; syncMeta.c1={revision:3,status:'clean',op:'',hash:''};
    sb={rpc:async()=>({data:[{applied:false,conflict:true,revision:9,data:{id:'c1',name:'cloud',days:[{spots:[]}]},deleted_at:null}],error:null})};`);
  await w.eval(`syncTripCloud({id:'c1',name:'local',days:[{spots:[]}]})`);
  assert.equal(w.eval(`syncMeta.c1.status`),'conflict');
  assert.equal(w.eval(`syncMeta.c1.revision`),3,'base revision 유지 — 다음 병합이 조용한 덮어쓰기로 바뀌지 않게');
  assert.equal(w.eval(`currentSyncConflict && currentSyncConflict.revision`),9,'충돌 카드에는 서버 revision을 넘긴다');
  w.close();
});

test('통합: 지금 보고 있지 않은 여행의 편집도 클라우드로 올라간다', { skip: noJsdom }, async () => {
  const w=boot();
  const sent=await w.eval(`(async()=>{
    window.__sent=[];
    store.trips=[{id:'A',name:'A',days:[{spots:[]}]},{id:'B',name:'B',days:[{spots:[]}]}];
    store.activeId='B';
    syncMeta={
      A:{revision:1,status:'clean',op:'',hash:'stale'},
      B:{revision:1,status:'clean',op:'',hash:TC_SYNC.hashTrip(store.trips[1])}
    };
    user={id:'u1'};
    // 성공 경로는 버전 스냅샷까지 타므로 from() 체인도 최소한으로 흉내낸다
    const q={insert:async()=>({error:null}),select(){return this},eq(){return this},order(){return this},range:async()=>({data:[],error:null}),delete(){return this},in:async()=>({error:null})};
    sb={from:()=>q,rpc:async(n,a)=>{ window.__sent.push(a.p_client_id); return {data:[{applied:true,conflict:false,revision:2,data:null,deleted_at:null}],error:null}; }};
    syncStaleTrips();
    await new Promise(r=>setTimeout(r,0));
    return window.__sent.join(',');
  })()`);
  assert.equal(sent,'A','활성 여행(B)이 아니어도 지문이 밀린 A가 올라간다');
  assert.equal(w.eval(`syncMeta.A.hash`),w.eval(`TC_SYNC.hashTrip(store.trips[0])`),'성공 후 지문을 기록해 중복 업로드를 막는다');
  w.close();
});

// 다른 탭이 localStorage에 쓴 상황을 흉내낸다 (storage 이벤트는 쓴 탭 자신에겐 오지 않는다)
function fireStorage(w, key, newValue){
  const e=new w.window.StorageEvent('storage',{key,newValue});
  w.window.dispatchEvent(e);
}

test('통합: 다른 탭의 저장을 감지해 낡은 메모리 store를 갈아끼운다', { skip: noJsdom }, () => {
  const w=boot();
  w.eval(`store.trips=[{id:'T1',name:'옛것',start:'',days:[{title:'',drive:'',note:'',spots:[]}]}]; store.activeId='T1'; histLast=JSON.stringify(store); render();`);
  const fresh=JSON.stringify({trips:[{id:'T1',name:'다른 탭이 고침',start:'',days:[{title:'',drive:'',note:'',spots:[]},{title:'2일차',drive:'',note:'',spots:[]}]}],activeId:'T1'});
  fireStorage(w,'tripcanvas_v1',fresh);
  assert.equal(w.eval(`store.trips[0].name`),'다른 탭이 고침');
  assert.equal(w.eval(`store.trips[0].days.length`),2);
  w.close();
});

test('통합: 다른 탭의 변경을 받아들여도 되쓰기·클라우드 에코가 없다', { skip: noJsdom }, () => {
  const w=boot();
  w.eval(`store.trips=[{id:'T1',name:'옛것',start:'',days:[{title:'',drive:'',note:'',spots:[]}]}]; store.activeId='T1'; histLast=JSON.stringify(store); render();
    window.__wrote=0; window.__synced=0;
    const realSet=localStorage.setItem.bind(localStorage);
    localStorage.setItem=(k,v)=>{ if(k==='tripcanvas_v1') window.__wrote++; return realSet(k,v); };
    user={id:'u1'}; sb={rpc:async()=>{ window.__synced++; return {data:[{applied:true,conflict:false,revision:2,data:null,deleted_at:null}],error:null}; }};`);
  const fresh=JSON.stringify({trips:[{id:'T1',name:'다른 탭',start:'',days:[{title:'',drive:'',note:'',spots:[]}]}],activeId:'T1'});
  fireStorage(w,'tripcanvas_v1',fresh);
  assert.equal(w.eval(`store.trips[0].name`),'다른 탭');
  assert.equal(w.eval(`window.__wrote`),0,'받아들인 상태를 다시 쓰지 않는다 (탭 간 핑퐁 방지)');
  assert.equal(w.eval(`window.__synced`),0,'클라우드로도 되쏘지 않는다');
  assert.equal(w.eval(`JSON.stringify(store)===histLast`),true,'histLast를 정규화된 형태로 맞춰 save가 no-op이 된다');
  w.close();
});

test('통합: 입력 중이면 화면을 뺏지 않고 사용자가 불러오기를 고르게 한다', { skip: noJsdom }, () => {
  const w=boot();
  w.eval(`store.trips=[{id:'T1',name:'옛것',start:'',days:[{title:'',drive:'',note:'',spots:[]}]}]; store.activeId='T1'; histLast=JSON.stringify(store); render();
    document.getElementById('spotModalBg').classList.add('show');`);
  const fresh=JSON.stringify({trips:[{id:'T1',name:'다른 탭',start:'',days:[{title:'',drive:'',note:'',spots:[]}]}],activeId:'T1'});
  fireStorage(w,'tripcanvas_v1',fresh);
  assert.equal(w.eval(`store.trips[0].name`),'옛것','편집 중엔 자동으로 바꾸지 않는다');
  assert.match(w.document.getElementById('toast').textContent,/다른 탭/);
  w.eval(`document.querySelector('#toast .toastAct').click()`);
  assert.equal(w.eval(`store.trips[0].name`),'다른 탭','불러오기를 누르면 그때 반영된다');
  w.close();
});

test('통합: 손상된 외부 저장본은 무시하고 현재 store를 지킨다', { skip: noJsdom }, () => {
  const w=boot();
  w.eval(`store.trips=[{id:'T1',name:'멀쩡',start:'',days:[{title:'',drive:'',note:'',spots:[]}]}]; store.activeId='T1'; histLast=JSON.stringify(store); render();`);
  fireStorage(w,'tripcanvas_v1','{"trips":"not-an-array"}');
  assert.equal(w.eval(`store.trips[0].name`),'멀쩡');
  w.close();
});

test('통합: 다른 탭이 갱신한 syncMeta를 메모리로 다시 읽어 헛충돌을 막는다', { skip: noJsdom }, () => {
  const w=boot();
  w.eval(`syncMeta={T1:{revision:3,status:'clean',op:'',hash:'old'}};
    localStorage.setItem('tripcanvas_sync_v2', JSON.stringify({T1:{revision:9,status:'clean',op:'',hash:'new'}}));`);
  fireStorage(w,'tripcanvas_sync_v2',w.eval(`localStorage.getItem('tripcanvas_sync_v2')`));
  assert.equal(w.eval(`syncMeta.T1.revision`),9);
  assert.equal(w.eval(`syncMeta.T1.hash`),'new');
  w.close();
});

test('통합: 사이드바·핀에 카테고리 아이콘이 붙고, 번호(동선 순서)는 그대로다', { skip: noJsdom }, () => {
  const w=boot();
  withTrip(w, `[{title:'D1',drive:'',note:'',spots:[
    {name:'Mediodía Hotel',city:'Madrid',desc:'',lat:40.40,lng:-3.69,stay:true},
    {name:'DABOV Specialty Coffee Spain',city:'Madrid',desc:'',lat:40.41,lng:-3.69},
    {name:'Cháchara',city:'Madrid',desc:'',lat:40.40,lng:-3.69,cat:'food'},
    {name:'무명 장소',city:'Madrid',desc:'',lat:40.42,lng:-3.70}
  ]}]`);
  w.eval('render()');
  const spots=[...w.document.querySelectorAll('.spot[data-si]')];
  const icon=i=>{ const el=spots[i].querySelector('.spotCat'); return el?el.textContent:null; };
  assert.equal(icon(0),'🏠','🏠 숙소 체크만으로 아이콘');
  assert.equal(icon(1),'☕','이름으로 추론(저장값 없음)');
  assert.equal(icon(2),'🍽','명시한 카테고리가 이름 추론을 이긴다');
  assert.equal(icon(3),null,'모르면 아이콘을 붙이지 않는다');
  assert.equal(spots[0].querySelector('.spotOrder').textContent,'1.','번호는 그대로');
  assert.equal(spots[0].querySelector('.spotIdentity').title,'Mediodía Hotel','전체 이름 title은 유지');
  assert.match(spots[1].querySelector('.spotIdentity').getAttribute('aria-label'),/카페/,'카테고리를 접근성 이름에 넣는다');

  // 지도 핀: 숙소도 번호를 유지하고 카테고리는 배지로
  const pin=w.eval(`(()=>{const p=mkPin('#e63946',3,false,spotCat('cafe'));return p.textContent+'|'+(p.querySelector('.pinCat')||{}).textContent;})()`);
  assert.equal(pin,'3☕|☕');
  assert.equal(w.eval(`mkPin('#e63946',2,false,null).querySelector('.pinCat')`),null,'미지정이면 배지 없음');
  w.close();
});

test('통합: 카테고리 선택지는 SPOT_CATS 하나만 보고 만든다', { skip: noJsdom }, () => {
  const w=boot();
  const sel=w.document.getElementById('spotCat');
  assert.equal(sel.options.length, w.eval('SPOT_CATS.length')+1, '미지정 + 카테고리 수');
  assert.equal(sel.options[0].value,'');
  assert.equal(sel.options[1].value,'stay');
  w.close();
});

test('통합: 하루의 끝을 숙소 복귀로 닫고, 이미 닫힌 날엔 덧붙이지 않는다', { skip: noJsdom }, () => {
  const w=boot();
  withTrip(w, `[
    {title:'D1',drive:'',note:'',spots:[
      {name:'공항',city:'M',desc:'',lat:40.49,lng:-3.56},
      {name:'호텔',city:'M',desc:'',lat:40.40,lng:-3.69,stay:true,nights:2},
      {name:'야경',city:'M',desc:'',lat:40.41,lng:-3.70}
    ]},
    {title:'D2',drive:'',note:'',spots:[{name:'박물관',city:'M',desc:'',lat:40.42,lng:-3.71}]},
    {title:'D3',drive:'',note:'',spots:[
      {name:'시내',city:'M',desc:'',lat:40.43,lng:-3.72},
      {name:'다른 호텔',city:'M',desc:'',lat:40.44,lng:-3.73,stay:true}
    ]}
  ]`);
  w.eval('activeDay=0; render()');
  const cards=[...w.document.querySelectorAll('.dayCard')];
  const back=i=>{ const el=cards[i].querySelector('.spot.back .spotName'); return el?el.textContent:null; };
  assert.equal(back(0),'호텔','숙소가 중간에 있으면 그 숙소로 복귀');
  assert.equal(back(1),'호텔','연박이면 그날 숙소가 없어도 전날 숙소로 복귀');
  assert.equal(back(2),null,'이미 숙소로 끝나는 날엔 안 붙인다');
  assert.match(cards[0].querySelector('.spot.back .spotMeta').textContent,/자동/,'자동으로 이어 붙였음을 밝힌다');

  // 복귀는 표시·계산용일 뿐 데이터에 들어가지 않는다
  assert.equal(w.eval(`store.trips.find(t=>t.id==='__it__').days[0].spots.length`),3);
  assert.equal(w.eval(`store.trips.find(t=>t.id==='__it__').days[1].spots.length`),1);

  // 하루 종료시각은 복귀 이동시간까지 포함한다
  const [withBack, withoutBack] = w.eval(`(()=>{const d=trip().days[0], a=startAnchorFor(0);
    return [dayEndMin(d,a,backLegOf(d,0,dayReturnStay(trip().days,0))), dayEndMin(d,a)];})()`);
  assert.ok(withBack>withoutBack, '복귀 이동시간만큼 종료가 늦어진다');
  w.close();
});

// 구간 조회를 캐시로 미리 채워 네트워크(=테스트 종료 후 비동기 렌더)를 막는다
function seedLegs(w, di){
  w.eval(`(()=>{
    const d=trip().days[${di}], loc=d.spots.filter(hasLoc);
    for(let i=1;i<loc.length;i++) legCache[legKey(loc[i-1],loc[i],legModeOf(d,loc[i]))]={sec:600,m:4000,est:true};
    const b=backLegOf(d,${di},dayReturnStay(trip().days,${di}));
    if(b) legCache[b.key]={sec:300,m:1500,est:true};
  })()`);
}

test('통합: 비행기 일자의 숙소 복귀는 ✈️가 아니라 근거리 수단으로 잡힌다', { skip: noJsdom }, () => {
  const w=boot();
  withTrip(w, `[{title:'도착일',drive:'',note:'',mode:'flight',startAt:'09:00',spots:[
    {name:'공항',city:'M',desc:'',lat:40.49,lng:-3.56},
    {name:'호텔',city:'M',desc:'',lat:40.40,lng:-3.69,stay:true},
    {name:'식당',city:'M',desc:'',lat:40.41,lng:-3.70}
  ]}]`);
  seedLegs(w,0); w.eval('render()');
  assert.equal(w.eval(`backLegOf(trip().days[0],0,dayReturnStay(trip().days,0)).mode`),'car');
  const meta=w.document.querySelector('.dayCard .spot.back .spotMeta').textContent;
  assert.doesNotMatch(meta,/✈️/,'복귀에 비행기 아이콘이 붙지 않는다');
  assert.match(meta,/🚗/);
  w.close();
});

test('통합: 🏠 아이콘이 붙으면 "숙소" 글자는 빼고 연박 수만 남긴다', { skip: noJsdom }, () => {
  const w=boot();
  withTrip(w, `[{title:'D1',drive:'',note:'',spots:[
    {name:'1박 호텔',city:'M',desc:'',lat:40.40,lng:-3.69,stay:true},
    {name:'연박 호텔',city:'M',desc:'',lat:40.41,lng:-3.70,stay:true,nights:3},
    {name:'명소로 지정한 숙소',city:'M',desc:'',lat:40.42,lng:-3.71,stay:true,cat:'sight'}
  ]}]`);
  seedLegs(w,0); w.eval('render()');
  const spots=[...w.document.querySelectorAll('.spot[data-si]')];
  const meta=i=>{ const el=spots[i].querySelector('.stayMeta'); return el?el.textContent:null; };
  assert.equal(meta(0),null,'1박이면 아이콘만으로 충분 — 칩 자체가 없다');
  assert.equal(meta(1),'3박','연박 수는 아이콘이 못 전달하므로 남긴다');
  assert.equal(meta(2),'🏠 숙소','아이콘이 🏠가 아니면 숙소임을 계속 알려준다');
  assert.equal(spots[2].querySelector('.spotCat').textContent,'🏛');
  w.close();
});

test('통합: 렌터카 예약이 픽업일·반납일 일정에 나타나고, 동선·ETA는 건드리지 않는다', { skip: noJsdom }, () => {
  const w=boot();
  withTrip(w, `[
    {title:'D1',drive:'',note:'',spots:[
      {name:'공항',city:'M',desc:'',lat:40.49,lng:-3.56},
      {name:'호텔',city:'M',desc:'',lat:40.40,lng:-3.69,stay:true,nights:2}
    ]},
    {title:'D2',drive:'',note:'',spots:[{name:'박물관',city:'M',desc:'',lat:40.42,lng:-3.71}]},
    {title:'D3',drive:'',note:'',spots:[{name:'시내',city:'M',desc:'',lat:40.43,lng:-3.72}]}
  ]`);
  // 예약 전 기준값 — 렌터카 항목이 동선·도착 예상을 바꾸지 않는지 비교하기 위해
  w.eval('activeDay=0; render()');
  const etasBefore=w.eval(`JSON.stringify(trip().days.map((d,i)=>dayEtas(d,startAnchorFor(i))))`);

  // 트립 start=2026-08-01 → Day1=08-01, Day2=08-02, Day3=08-03
  w.eval(`trip().bookings=[{id:'car1',type:'car',title:'Fiat 500 · RecordGo',price:300000,
    start:'2026-08-01',end:'2026-08-03',carPickup:'Madrid Airport',carPickupCode:'MAD',
    carPickupTime:'11:30',carReturnTime:'08:00'}]; render()`);
  const cards=[...w.document.querySelectorAll('.dayCard')];
  const rows=i=>[...cards[i].querySelectorAll('.spot.carbk')];

  assert.equal(rows(0).length,1,'픽업일에 한 줄');
  assert.equal(rows(1).length,0,'대여 중인 날엔 아무것도 붙지 않는다');
  assert.equal(rows(2).length,1,'반납일에 한 줄');
  assert.match(rows(0)[0].textContent,/Madrid Airport \(MAD\)/,'장소와 공항코드를 함께 보여준다');
  assert.match(rows(0)[0].textContent,/픽업 · 11:30/,'입력한 픽업 시각을 보여준다');
  // 시각은 ETA 칸(그날 계산된 도착 예상 순서)에 들어가면 안 된다 — 이 항목은 그 순서에 속하지 않는다
  assert.equal(rows(0)[0].querySelector('.spotTime').textContent.trim(),'🚗');
  assert.match(rows(0)[0].textContent,/픽업/);
  assert.match(rows(2)[0].textContent,/반납/);
  assert.match(rows(2)[0].textContent,/Madrid Airport/,'반납 장소를 비우면 픽업과 같은 곳');

  // 읽는 순서: 픽업은 장소 목록 앞, 반납은 뒤 (차를 받고 → 다니고 → 반납)
  const order=el=>[...cards[0].querySelectorAll('.dayBody > *')].indexOf(el);
  assert.ok(order(rows(0)[0]) < order(cards[0].querySelector('.spotList')), '픽업은 장소 목록 앞');
  const order2=el=>[...cards[2].querySelectorAll('.dayBody > *')].indexOf(el);
  assert.ok(order2(rows(2)[0]) > order2(cards[2].querySelector('.spotList')), '반납은 장소 목록 뒤');

  // 표시 전용 — 좌표가 없으므로 장소 데이터·동선·도착 예상에 섞이지 않는다
  assert.equal(w.eval(`trip().days[0].spots.length`),2,'데이터에 장소로 추가되지 않는다');
  assert.equal(w.eval(`JSON.stringify(trip().days.map((d,i)=>dayEtas(d,startAnchorFor(i))))`),etasBefore,'도착 예상이 그대로');
  assert.equal(cards[0].querySelectorAll('.spotList .spot').length,2,'드래그 가능한 장소 목록 밖에 있다');

  // 탭하면 그 예약 상세로
  assert.match(rows(0)[0].querySelector('button.spotIdentity').getAttribute('onclick'),/openBookingModal\('car1'\)/);

  // 읽기전용 공유 보기에서는 편집 진입점을 주지 않는다
  w.eval('viewMode=trip(); render()');   // #v= 읽기전용 보기 — viewMode는 플래그가 아니라 그 여행 객체다
  const ro=w.document.querySelector('.dayCard .spot.carbk');
  assert.ok(ro && !ro.querySelector('button.spotIdentity'), '읽기전용에선 버튼이 아니라 텍스트로');
  assert.match(ro.textContent,/Madrid Airport/,'내용은 그대로 보인다');
  w.close();
});

test('통합: 당일 대여는 한 날에 픽업·반납이 모두 나오고, 편도 반납 장소를 따로 쓴다', { skip: noJsdom }, () => {
  const w=boot();
  withTrip(w, `[{title:'D1',drive:'',note:'',spots:[{name:'시내',city:'M',desc:'',lat:40.43,lng:-3.72}]}]`);
  w.eval(`trip().bookings=[{id:'car1',type:'car',title:'경차',price:80000,
    start:'2026-08-01',end:'2026-08-01',carPickup:'제주공항',carPickupCode:'CJU',
    carReturn:'서귀포점',carPickupTime:'09:00',carReturnTime:'19:00'}]; activeDay=0; render()`);
  const rows=[...w.document.querySelectorAll('.dayCard .spot.carbk')];
  assert.equal(rows.length,2);
  assert.match(rows[0].textContent,/제주공항 \(CJU\)[\s\S]*픽업 · 09:00/);
  assert.match(rows[1].textContent,/서귀포점[\s\S]*반납 · 19:00/);
  assert.doesNotMatch(rows[1].textContent,/CJU/,'반납 장소를 따로 넣었으면 픽업 공항코드를 빌려 쓰지 않는다');
  w.close();
});

test('통합: 편도 반납 시세 조회에 픽업 공항코드를 물려주지 않는다', { skip: noJsdom }, async () => {
  const w=boot();
  const day=(d)=>new Date(Date.now()+d*86400000).toISOString().slice(0,10);
  withTrip(w, `[{mode:'car',startAt:'09:00',spots:[{name:'X',lat:39.5,lng:2.7,city:'Palma'}]}]`);
  // /api/car-offers로 실제로 나가는 본문을 잡아 둔다 (요청 조건이 곧 조회 대상이라 표시보다 중요하다)
  w.eval(`window.__req=[]; window.fetch=(u,o)=>{ window.__req.push({u:String(u), body:JSON.parse(o.body)});
    return Promise.resolve({ok:true, json:async()=>({status:'OK',offers:[]})}); };`);
  const send=async(fields)=>{
    w.eval(`trip().bookings=[Object.assign({id:'c1',type:'car',title:'RecordGo Compact',price:320,
      start:'${day(30)}',end:'${day(34)}',carPickup:'Palma Airport',carPickupCode:'PMI'}, ${JSON.stringify(fields)})];
      window.__req.length=0;`);
    await w.eval(`CarMarketProvider.searchOffers(trip().bookings[0])`);
    return w.eval(`JSON.parse(JSON.stringify(window.__req[0].body))`);
  };

  // 편도 — 반납 장소만 넣었으면 픽업 공항코드(PMI)로 조회하면 안 된다
  const oneWay=await send({carReturn:'Barcelona Airport'});
  assert.equal(oneWay['return'],'Barcelona Airport');
  assert.equal(oneWay.returnCode,'','다른 도시 반납인데 PMI로 조회하면 엉뚱한 곳의 시세가 온다');

  // 편도 — 반납 공항코드만 넣었으면 픽업 장소를 물려주지 않는다
  const codeOnly=await send({carReturnCode:'BCN'});
  assert.equal(codeOnly.returnCode,'BCN');
  assert.equal(codeOnly['return'],'','코드가 있으면 그게 기준 — 픽업 장소명을 얹지 않는다');

  // 왕복(반납 비움) — 지금까지처럼 픽업과 같은 지점으로
  const roundTrip=await send({});
  assert.equal(roundTrip['return'],'Palma Airport');
  assert.equal(roundTrip.returnCode,'PMI');

  // 픽업 장소·코드가 모두 비면 예약 이름으로 폴백 (기존 동작 유지)
  w.eval(`trip().bookings=[{id:'c1',type:'car',title:'RecordGo Compact',price:320,
    start:'${day(30)}',end:'${day(34)}'}]; window.__req.length=0;`);
  await w.eval(`CarMarketProvider.searchOffers(trip().bookings[0])`);
  const bare=w.eval(`JSON.parse(JSON.stringify(window.__req[0].body))`);
  assert.equal(bare.pickup,'RecordGo Compact');
  assert.equal(bare['return'],'RecordGo Compact');
  w.close();
});

test('통합: 픽업을 일정 장소와 연결하면 그 장소 행에 붙고 독립 행은 사라진다', { skip: noJsdom }, async () => {
  const w=boot();
  // "비행기로 도착한 뒤 그 공항에서 렌터카 픽업" — 픽업이 도착보다 위에 오면 안 된다
  withTrip(w, `[
    {title:'D1',drive:'',note:'',mode:'transit',spots:[{name:'Madrid 호텔',city:'M',desc:'',lat:40.42,lng:-3.70,stay:true}]},
    {title:'D2',drive:'',note:'',mode:'car',spots:[
      {name:'Palma Airport',city:'P',desc:'',lat:39.5517,lng:2.7388,legMode:'flight'},
      {name:'팔마 대성당',city:'P',desc:'',lat:39.5674,lng:2.6478},
      {name:'Cap Rocat',city:'P',desc:'',lat:39.5023,lng:2.6957,stay:true}
    ]}
  ]`);
  w.eval(`trip().bookings=[{id:'c1',type:'car',title:'Fiat 500X',price:420000,
    start:'2026-08-02',end:'2026-08-02',carPickup:'Palma Airport',carPickupCode:'PMI',
    carPickupTime:'11:30',carReturnTime:'19:00'}]; activeDay=0; render()`);
  const d2=()=>[...w.document.querySelectorAll('.dayCard')][1];

  // 연결 전 — 날짜 기준 독립 행 (픽업이 목록 앞, 반납이 뒤)
  assert.equal(d2().querySelectorAll('.spot.carbk').length, 2);
  assert.equal(d2().querySelectorAll('.carbkChip').length, 0);

  // 모달에서 픽업을 Day2 공항에, 반납을 Day2 숙소에 연결
  w.eval(`openBookingModal('c1')`);
  const opts=[...w.document.getElementById('bkCarPickupSpot').options].map(o=>o.value);
  assert.ok(opts.includes('1.0'), '일정의 모든 장소가 후보 (숙소가 아니어도)');
  w.document.getElementById('bkCarPickupSpot').value='1.0';
  w.document.getElementById('bkCarReturnSpot').value='1.2';
  w.document.getElementById('bkSave').click();

  // 연결 후 — 독립 행은 사라지고 그 장소 행에 칩으로 붙는다
  assert.equal(d2().querySelectorAll('.spot.carbk').length, 0, '독립 행 제거');
  const spots=[...d2().querySelectorAll('.spotList .spot')];
  assert.match(spots[0].textContent, /Palma Airport[\s\S]*렌터카 픽업 11:30/, '내린 그 자리에 픽업');
  assert.match(spots[2].textContent, /Cap Rocat[\s\S]*렌터카 반납 19:00/);
  assert.doesNotMatch(spots[1].textContent, /렌터카/, '연결 안 한 장소엔 안 붙는다');
  assert.match(spots[0].querySelector('.carbkChip').getAttribute('onclick'), /openBookingModal\('c1'\)/);

  // 연결은 여행 데이터에 저장돼 공유·동기화를 따라간다
  assert.equal(w.eval(`trip().days[1].spots[0].carPickupId`), 'c1');
  assert.equal(w.eval(`trip().days[1].spots[2].carReturnId`), 'c1');

  // 장소 복사가 연결까지 복제하면 픽업 칩이 두 곳에 뜬다
  w.eval(`copySpot(1,0); render()`);
  assert.equal(d2().querySelectorAll('.carbkChip').length, 2, '복사본에는 안 붙는다 (픽업 1 + 반납 1)');

  // 연결 해제하면 다시 독립 행으로
  w.eval(`openBookingModal('c1')`);
  w.document.getElementById('bkCarPickupSpot').value='';
  w.document.getElementById('bkSave').click();
  assert.equal(w.eval(`trip().days[1].spots[0].carPickupId`), undefined);
  assert.equal(d2().querySelectorAll('.spot.carbk').length, 1, '픽업만 독립 행으로 돌아옴');
  await new Promise(res=>setTimeout(res,20));   // 저장이 발사한 자동 시세 조회(no-net 실패) 정리 후 닫기
  w.close();
});

test('통합: 예약을 지우면 일정에 남은 픽업·반납 연결도 함께 정리된다', { skip: noJsdom }, () => {
  const w=boot();
  withTrip(w, `[{title:'D1',drive:'',note:'',mode:'car',spots:[{name:'공항',city:'P',desc:'',lat:39.55,lng:2.73}]}]`);
  w.eval(`trip().bookings=[{id:'c1',type:'car',title:'차',price:1,start:'2026-08-01',end:'2026-08-01'}];
    trip().days[0].spots[0].carPickupId='c1'; activeDay=0; render();
    window.confirm=()=>true; openBookingModal('c1'); document.getElementById('bkDelBtn').click();`);
  assert.equal(w.eval(`trip().days[0].spots[0].carPickupId`), undefined, '끊어진 연결이 남으면 안 된다');
  assert.equal(w.document.querySelectorAll('.carbkChip').length, 0);
  w.close();
});

test('통합: 당일 대여를 예약 화면에서 저장할 수 있다 (체크아웃 규칙을 렌터카에 쓰지 않는다)', { skip: noJsdom }, async () => {
  const w=boot();
  withTrip(w, `[{title:'D1',drive:'',note:'',mode:'car',spots:[{name:'공항',city:'P',desc:'',lat:39.55,lng:2.73}]}]`);
  const set=(id,v)=>{ w.document.getElementById(id).value=v; };
  const save=(fields)=>{
    w.eval('openBookingModal(null)'); set('bkType','car'); w.eval('toggleBkFields()');
    set('bkTitle','경차'); set('bkPrice','80000');
    Object.keys(fields).forEach(k=>set(k,fields[k]));
    w.document.getElementById('bkSave').click();
    return w.eval(`(trip().bookings||[]).length`);
  };
  // 같은 날 픽업·반납 — 렌터카에선 정상이다
  assert.equal(save({bkStart:'2026-08-01',bkEnd:'2026-08-01',bkCarPickupTime:'09:00',bkCarReturnTime:'19:00'}), 1);
  const b=w.eval(`JSON.parse(JSON.stringify(trip().bookings[0]))`);
  assert.equal(b.start,'2026-08-01'); assert.equal(b.end,'2026-08-01');

  // 같은 날인데 반납이 픽업보다 이르거나 시각이 없으면 막는다 (시세 조회가 거부되는 조건)
  assert.equal(save({bkStart:'2026-08-01',bkEnd:'2026-08-01',bkCarPickupTime:'19:00',bkCarReturnTime:'09:00'}), 1, '역순 거부');
  assert.equal(save({bkStart:'2026-08-01',bkEnd:'2026-08-01',bkCarPickupTime:'',bkCarReturnTime:''}), 1, '시각 없으면 거부');
  assert.equal(save({bkStart:'2026-08-03',bkEnd:'2026-08-01'}), 1, '반납일이 앞서면 거부');

  // 숙박은 지금까지처럼 같은 날을 막는다
  w.eval('openBookingModal(null)'); set('bkType','hotel'); w.eval('toggleBkFields()');
  set('bkTitle','H'); set('bkPrice','100000'); set('bkStart','2026-08-01'); set('bkEnd','2026-08-01');
  w.document.getElementById('bkSave').click();
  assert.equal(w.eval(`trip().bookings.length`), 1, '숙박 당일 체크아웃은 여전히 거부');
  await new Promise(res=>setTimeout(res,20));   // 저장이 발사한 자동 시세 조회 정리 후 닫기
  w.close();
});

test('통합: 하루 비용에 예약 하루치가 들어가고, 하루 합계가 전체 비용과 맞는다', { skip: noJsdom }, () => {
  const w=boot();
  // 트립 start=2026-08-01 → Day1=08-01 … Day4=08-04
  withTrip(w, `[
    {title:'D1',drive:'',note:'',mode:'transit',spots:[{name:'미술관',city:'M',desc:'',lat:40.41,lng:-3.69,cost:18000}]},
    {title:'D2',drive:'',note:'',mode:'transit',spots:[{name:'대성당',city:'P',desc:'',lat:39.56,lng:2.64,cost:12000}]},
    {title:'D3',drive:'',note:'',mode:'transit',spots:[{name:'Valldemossa',city:'S',desc:'',lat:39.70,lng:2.62,cost:9000}]},
    {title:'D4',drive:'',note:'',mode:'transit',spots:[{name:'Es Trenc',city:'P',desc:'',lat:39.34,lng:2.97}]}
  ]`);
  w.eval(`trip().bookings=[
    {id:'c1',type:'car',   title:'Fiat',  price:420000, start:'2026-08-02', end:'2026-08-04'},
    {id:'h1',type:'hotel', title:'Hotel', price:600000, start:'2026-08-02', end:'2026-08-04'},
    {id:'f1',type:'flight',title:'IB3800',price:180000, start:'2026-08-02', end:'2026-08-02'}
  ]; activeDay=0; render()`);

  const dayCosts=()=>[...w.document.querySelectorAll('.dayCard')].map(c=>{
    const el=[...c.querySelectorAll('.dist')].find(x=>x.textContent.includes('하루 비용'));
    return el? +el.textContent.replace(/\s+/g,'').match(/하루비용약₩([\d,]+)/)[1].replace(/,/g,'') : 0;
  });
  // 렌터카 3일(양끝 포함) 140,000/일 · 숙박 2박 300,000/박 · 항공 1일 180,000
  assert.deepEqual(dayCosts(), [18000, 632000, 449000, 140000]);
  assert.equal(w.eval(`(()=>{const e=[...document.querySelectorAll('.dayCard')][3].querySelectorAll('.dist');
    return [...e].find(x=>x.textContent.includes('하루 비용')).textContent.includes('숙박')})()`), false,
    '체크아웃 날엔 숙박비가 붙지 않는다');

  // 필터바 전체 비용 — 예약은 총액 기준
  const cb=w.eval(`JSON.parse(JSON.stringify(tripCostBreakdown()))`);
  assert.deepEqual(cb, {spots:39000, taxi:0, hotel:600000, car:420000, flight:180000, total:1239000});
  assert.match(w.document.querySelector('.costMenu summary').textContent, /₩1,239,000/);
  assert.match(w.document.querySelector('.costMenu').textContent, /렌터카/);

  // 예약 기간이 일정 안에 다 들어오면 하루 합계 = 전체 (날수로 나눠도 새는 돈이 없다)
  assert.equal(dayCosts().reduce((a,x)=>a+x,0), cb.total);

  // 비용이 하나도 없으면 칩 자체를 띄우지 않는다
  w.eval(`trip().bookings=[]; trip().days.forEach(d=>d.spots.forEach(s=>delete s.cost)); render()`);
  assert.equal(w.document.querySelector('.costMenu'), null);
  assert.equal([...w.document.querySelectorAll('.dist')].filter(x=>x.textContent.includes('하루 비용')).length, 0);
  w.close();
});

test('통합: 예약 통화가 달라도 원화로 환산해 합산한다', { skip: noJsdom }, () => {
  const w=boot();
  withTrip(w, `[{title:'D1',drive:'',note:'',mode:'transit',spots:[{name:'A',city:'P',desc:'',lat:39.5,lng:2.7}]}]`);
  w.eval(`fxRates.EUR=1500; trip().bookings=[{id:'c1',type:'car',title:'C',price:300,cur:'EUR',
    start:'2026-08-01',end:'2026-08-01'}]; activeDay=0; render()`);
  assert.equal(w.eval(`tripCostBreakdown().car`), 450000, '€300 × 1500');
  assert.equal(w.eval(`dayBookingCost('2026-08-01')`), 450000);
  w.close();
});
