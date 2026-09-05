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
  inject('adaptive.js');
  inject('intake.js');
  inject('collab.js');
  inject('api.js');
  inject('auth.js');
  inject('app.js');
  // 안전장치: 테스트가 진짜 네트워크를 때리면 즉시 실패한다(가짜를 빠뜨린 것을 조용히 넘기지 않는다)
  const boom = async () => { throw new Error('테스트에서 실제 네트워크 호출'); };
  window.TC_API.configure({ fetchImpl: boom });
  window.TC_AUTH.configure({ fetchImpl: boom });
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
  w.eval(`user={id:'u1'}; sb={}; TC_API.sync.save=async()=>{ throw new Error('offline'); };`);
  await w.eval(`syncTripCloud({id:'retry1',name:'R',days:[{spots:[]}]})`);
  assert.equal(w.eval(`syncMeta.retry1.status`),'error');
  w.eval(`clearTimeout(cloudRetryT); TC_API.sync.save=async()=>({applied:true,conflict:false,revision:2,data:null,deleted_at:null});`);
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
  // 상세 박스 — 판매처 비교에 매칭·검증 두 축 구분 표시 (P0-3: 미검증 확정은 '검증 필요'를 함께)
  w.eval(`editingBooking='bk1'; renderBookingStatusBox(bookingOf('bk1'))`);
  const boxText = w.document.getElementById('bkStatus').textContent;
  assert.match(boxText, /조건상 동일해 보임 · 판매처 검증 필요/, '메타서치 확정가는 검증 필요를 명시');
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
    sb={}; TC_API.sync.save=async()=>({applied:false,conflict:true,revision:9,data:{id:'c1',name:'cloud',days:[{spots:[]}]},deleted_at:null});`);
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
    sb={from:()=>q};
    TC_API.sync.save=async(tripId)=>{ window.__sent.push(tripId); return {applied:true,conflict:false,revision:2,data:null,deleted_at:null}; };
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
    user={id:'u1'}; TC_API.sync.save=async()=>{ window.__synced++; return {applied:true,conflict:false,revision:2,data:null,deleted_at:null}; };`);
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
      {name:'다른 호텔',city:'M',desc:'',lat:40.44,lng:-3.73,stay:true,nights:2}
    ]},
    {title:'D4',drive:'',note:'',spots:[
      {name:'공항',city:'M',desc:'',lat:40.49,lng:-3.56}
    ]}
  ]`);
  w.eval('activeDay=0; render()');
  const cards=[...w.document.querySelectorAll('.dayCard')];
  const back=i=>{ const el=cards[i].querySelector('.spot.back .spotName'); return el?el.textContent:null; };
  assert.equal(back(0),'호텔','숙소가 중간에 있으면 그 숙소로 복귀');
  assert.equal(back(1),'호텔','연박이면 그날 숙소가 없어도 전날 숙소로 복귀');
  assert.equal(back(2),null,'이미 숙소로 끝나는 날엔 안 붙인다');
  // 마지막 날은 돌아가는 날이 아니라 떠나는 날이다 — 연박이 그날까지 이어져도 붙이지 않는다
  assert.equal(back(3),null,'일정의 마지막 날엔 숙소 복귀가 없다');
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
  ]},{title:'다음날',drive:'',note:'',spots:[]}]`);   // 마지막 날에는 복귀가 없다
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

test('통합: 장소를 편집해도 예약·렌터카 연결은 그대로 남는다', { skip: noJsdom }, () => {
  const w=boot();
  withTrip(w, `[{title:'D1',drive:'',note:'',mode:'car',spots:[{name:'공항',city:'P',desc:'',lat:39.55,lng:2.73}]}]`);
  w.eval(`trip().bookings=[
      {id:'c1',type:'car',title:'차',price:1,start:'2026-08-01',end:'2026-08-01',carPickupTime:'11:30',carReturnTime:'19:00'},
      {id:'h1',type:'hotel',title:'호텔',price:1,start:'2026-08-01',end:'2026-08-02'}];
    const s=trip().days[0].spots[0]; s.carPickupId='c1'; s.carReturnId='c1'; s.bookingId='h1';
    activeDay=0; render(); openSpotModal(0,0);`);
  // 메모만 고쳐 저장 — 연결을 건드리는 조작이 아니다
  w.document.getElementById('spotDesc').value='터미널 2';
  w.document.getElementById('spotSave').click();

  const s = () => w.eval(`JSON.stringify(trip().days[0].spots[0])`);
  assert.equal(w.eval(`trip().days[0].spots[0].desc`), '터미널 2', '편집은 반영된다');
  assert.equal(w.eval(`trip().days[0].spots[0].carPickupId`), 'c1', `픽업 연결 유지: ${s()}`);
  assert.equal(w.eval(`trip().days[0].spots[0].carReturnId`), 'c1', '반납 연결 유지');
  assert.equal(w.eval(`trip().days[0].spots[0].bookingId`), 'h1', '숙박 예약 연결 유지');
  // 연결이 살아 있으니 픽업·반납은 독립 행으로 되돌아가지 않는다
  assert.equal(w.document.querySelectorAll('.spot.carbk').length, 0, '독립 행으로 되돌아가면 안 된다');
  assert.equal(w.document.querySelectorAll('.carbkChip').length, 2, '그 장소 행에 픽업·반납 칩이 그대로');
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

test('통합: 연결된 숙박은 일정 카드 금액이 예산 기준 (이중 계산 없음)', { skip: noJsdom }, () => {
  // 제보: 숙소 금액이 일정 카드와 예약 추적 양쪽에 잡혀 예산이 두 배로 보였다.
  // 예약 편집기에서 장소를 고르면 spot.bookingId가 걸리므로 연결된 둘은 같은 숙박이다.
  const w=boot();
  withTrip(w, `[
    {title:'D1',drive:'',note:'',mode:'transit',spots:[
      {name:'호텔',city:'P',desc:'',lat:39.5,lng:2.7,stay:true,bookingId:'h1',cost:180000}]},
    {title:'D2',drive:'',note:'',mode:'transit',spots:[
      {name:'해변',city:'P',desc:'',lat:39.34,lng:2.97,cost:12000}]}
  ]`);
  w.eval(`trip().bookings=[{id:'h1',type:'hotel',title:'호텔',price:200000,
    start:'2026-08-01',end:'2026-08-02'}]; activeDay=0; render()`);

  const cb=()=>w.eval(`JSON.parse(JSON.stringify(tripCostBreakdown()))`);
  assert.deepEqual(cb(), {spots:192000, taxi:0, hotel:0, car:0, flight:0, total:192000},
    '연결된 숙박 예약(200,000)은 예산에서 빠지고 장소 금액(180,000)이 기준');

  const dayCosts=()=>[...w.document.querySelectorAll('.dayCard')].map(c=>{
    const el=[...c.querySelectorAll('.dist')].find(x=>x.textContent.includes('하루 비용'));
    return el? +el.textContent.replace(/\s+/g,'').match(/하루비용약₩([\d,]+)/)[1].replace(/,/g,'') : 0;
  });
  assert.deepEqual(dayCosts(), [180000, 12000], '하루 비용에서도 두 번 잡히지 않는다');

  // 장소에 비용을 안 적었으면 예약 금액을 쓴다 — 돈이 사라지지 않게
  w.eval(`delete trip().days[0].spots[0].cost; render()`);
  assert.equal(cb().hotel, 200000);
  assert.equal(cb().total, 212000);

  // 연결을 떼면 일정에 대응하는 장소가 없으므로 그대로 센다
  w.eval(`trip().days[0].spots[0].cost=180000; delete trip().days[0].spots[0].bookingId; render()`);
  assert.equal(cb().hotel, 200000);
  assert.equal(cb().total, 392000, '연결이 없으면 둘 다 센다(같은 숙박인지 알 수 없다)');
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

test('통합: 새 장소는 선택한 장소 바로 뒤에 들어간다', { skip: noJsdom }, () => {
  const w=boot();
  withTrip(w, `[
    {title:'D1',drive:'',note:'',mode:'car',spots:[
      {name:'A',city:'S',desc:'',lat:37.5,lng:127.0},
      {name:'B',city:'S',desc:'',lat:37.6,lng:127.1},
      {name:'C',city:'S',desc:'',lat:37.7,lng:127.2}
    ]},
    {title:'D2',drive:'',note:'',mode:'car',spots:[{name:'Z',city:'S',desc:'',lat:37.8,lng:127.3}]}
  ]`);
  w.eval('activeDay=0; render()');
  const names=(di)=>w.eval(`trip().days[${di}].spots.map(s=>s.name)`);
  const addSpot=(di,name)=>{
    w.eval(`openSpotModal(${di},-1)`);
    w.document.getElementById('spotName').value=name;
    w.document.getElementById('spotLat').value='37.9';
    w.document.getElementById('spotLng').value='127.9';
    w.document.getElementById('spotSave').click();
  };

  // 선택이 없으면 지금까지처럼 맨 뒤
  addSpot(0,'끝');
  assert.deepEqual(names(0), ['A','B','C','끝']);

  // A(0번)를 탭해 선택 → 바로 뒤에
  w.eval('selectSpotCard(0,0)');
  addSpot(0,'A뒤');
  assert.deepEqual(names(0), ['A','A뒤','B','C','끝']);

  // 방금 넣은 게 선택되어, 연달아 추가하면 계속 뒤로 이어붙는다
  assert.deepEqual(w.eval('JSON.parse(JSON.stringify(selectedSpot))'), {di:0,si:1});
  addSpot(0,'그다음');
  assert.deepEqual(names(0), ['A','A뒤','그다음','B','C','끝']);

  // 버튼이 어디에 들어갈지 밝힌다 (선택 위치는 눈에 안 보이므로)
  const btn=[...w.document.querySelectorAll('.dayCard')][0].querySelector('.addSpotBtn');
  assert.match(btn.textContent, /3번 뒤에 장소 추가/);

  // 장소를 탭하면 render() 없이 선택만 바뀐다 → 라벨이 그 자리에서 따라와야 한다
  w.eval('selectSpotCard(0,4)');
  assert.match(btn.textContent, /5번 뒤에 장소 추가/, 'render 없이도 갱신');
  w.eval('selectSpotCard(null)');
  assert.equal(btn.textContent.trim(), '＋ 장소 추가', '선택 해제하면 원래대로');
  w.eval('selectSpotCard(0,2)');

  // 다른 날 버튼은 그 날 선택이 없으므로 맨 뒤 (라벨도 그대로)
  const btn2=[...w.document.querySelectorAll('.dayCard')][1].querySelector('.addSpot');
  assert.equal(btn2.textContent.trim(), '＋ 장소 추가');
  addSpot(1,'D2끝');
  assert.deepEqual(names(1), ['Z','D2끝']);
  w.close();
});

test('통합: 모달에서 일자를 바꿔 추가하면 그 날 맨 뒤로 간다', { skip: noJsdom }, () => {
  const w=boot();
  withTrip(w, `[
    {title:'D1',drive:'',note:'',mode:'car',spots:[{name:'A',city:'S',desc:'',lat:37.5,lng:127.0},{name:'B',city:'S',desc:'',lat:37.6,lng:127.1}]},
    {title:'D2',drive:'',note:'',mode:'car',spots:[{name:'Z',city:'S',desc:'',lat:37.8,lng:127.3}]}
  ]`);
  w.eval('activeDay=0; render(); selectSpotCard(0,0)');   // Day1의 A를 선택한 채로
  w.eval('openSpotModal(0,-1)');
  w.document.getElementById('spotName').value='다른날';
  w.document.getElementById('spotLat').value='37.9';
  w.document.getElementById('spotLng').value='127.9';
  w.document.getElementById('spotDay').value='1';        // Day2로 변경
  w.document.getElementById('spotSave').click();
  assert.deepEqual(w.eval(`trip().days[0].spots.map(s=>s.name)`), ['A','B'], 'Day1은 그대로');
  assert.deepEqual(w.eval(`trip().days[1].spots.map(s=>s.name)`), ['Z','다른날'], '옮긴 날의 맨 뒤로');
  w.close();
});

test('통합: 기존 장소 편집은 제자리를 지킨다 (삽입 위치 로직에 휩쓸리지 않는다)', { skip: noJsdom }, () => {
  const w=boot();
  withTrip(w, `[{title:'D1',drive:'',note:'',mode:'car',spots:[
    {name:'A',city:'S',desc:'',lat:37.5,lng:127.0},
    {name:'B',city:'S',desc:'',lat:37.6,lng:127.1},
    {name:'C',city:'S',desc:'',lat:37.7,lng:127.2}]}]`);
  w.eval('activeDay=0; render(); selectSpotCard(0,0)');
  w.eval('openSpotModal(0,2)');                          // C를 편집
  w.document.getElementById('spotName').value='C수정';
  w.document.getElementById('spotSave').click();
  assert.deepEqual(w.eval(`trip().days[0].spots.map(s=>s.name)`), ['A','B','C수정']);
  w.close();
});

// ── Golden: P0-1 다객실 예약 — 1실 기준 시세로 절약을 단정하지 않는다 (배선 검증) ──
test('통합: 2객실 예약은 1실 시세로 🔴 절약을 만들지 않고, 1객실이면 기존대로 만든다', { skip: noJsdom }, async () => {
  const w=boot();
  withTrip(w, `[{title:'D1',drive:'',note:'',mode:'car',spots:[{name:'Cap Rocat',city:'P',desc:'',lat:39.47,lng:2.72}]}]`);
  const resp={status:'OK', property:{name:'Cap Rocat', token:'tok1', confidence:0.95},
    offers:[{seller:'Expedia', price:700000, total:700000, cur:'KRW', refundable:true}],
    basis:{rooms:1, adults:2, requestedRooms:2}, checkedAt:'2026-08-30T00:00:00Z'};
  w.eval(`window.fetch=async()=>({ok:true,status:200,json:async()=>(${JSON.stringify(resp)})})`);
  w.eval(`trip().bookings=[{id:'hb2', type:'hotel', title:'Cap Rocat', price:1400000, cur:'KRW',
    rooms:2, refundable:true, track:true, start:'2026-10-30', end:'2026-11-01'}]`);
  await w.eval(`checkBookingPrice('hb2',{force:true})`);
  assert.equal(w.eval(`priceStore.hb2.offers[0].quality`), 'UNSUPPORTED_BASIS', '기준 불일치 → 등급 강등');
  assert.equal(w.eval(`priceStore.hb2.basis.rooms`), 1, '응답 basis를 기록');
  const badge=w.eval(`bookingBadgeHtml(bookingOf('hb2'))`);
  assert.ok(!badge.includes('절약 가능'), '1실 700,000 vs 2실 1,400,000은 절약이 아니다');
  assert.ok(!badge.includes('더 저렴한 옵션'), '잠재(최대 차액)로도 단정하지 않는다');
  w.eval(`renderBookingStatusBox(bookingOf('hb2'))`);
  assert.match(w.document.getElementById('bkStatus').textContent, /1객실 기준/, '왜 판단하지 않는지 설명');

  // 대조군: 1객실 예약이면 같은 응답으로 확정 절약이 뜬다 (회귀 방지)
  w.eval(`trip().bookings=[{id:'hb1', type:'hotel', title:'Cap Rocat', price:1400000, cur:'KRW',
    rooms:1, refundable:true, track:true, start:'2026-10-30', end:'2026-11-01'}]`);
  const resp1={...resp, basis:{rooms:1, adults:2, requestedRooms:1}};
  w.eval(`window.fetch=async()=>({ok:true,status:200,json:async()=>(${JSON.stringify(resp1)})})`);
  await w.eval(`checkBookingPrice('hb1',{force:true})`);
  assert.match(w.eval(`bookingBadgeHtml(bookingOf('hb1'))`), /절약 가능/, '기준이 맞으면 기존 판단 유지');
  w.close();
});

// ── Golden: 예약 삭제 — 일정에 남은 참조(bookingId·carPickupId·carReturnId)를 깨끗이 정리한다 ──
test('통합: 예약을 삭제하면 스팟의 예약·렌터카 연결 참조가 모두 정리된다', { skip: noJsdom }, () => {
  const w=boot();
  withTrip(w, `[{title:'D1',drive:'',note:'',mode:'car',spots:[
    {name:'공항',city:'P',desc:'',lat:39.55,lng:2.73},
    {name:'호텔',city:'P',desc:'',lat:39.56,lng:2.74}]}]`);
  w.eval(`
    trip().bookings=[
      {id:'bh', type:'hotel', title:'H', price:100000, start:'2026-10-01', end:'2026-10-02'},
      {id:'bc', type:'car',   title:'C', price:80000,  start:'2026-10-01', end:'2026-10-02'}];
    trip().days[0].spots[1].bookingId='bh';
    trip().days[0].spots[0].carPickupId='bc';
    trip().days[0].spots[1].carReturnId='bc';
    priceStore.bc={obs:[{price:80000,at:'2026-08-30T00:00:00Z'}],offers:[],at:null,err:null};
    window.confirm=()=>true; render();`);
  // 렌터카 예약 삭제 → carPickupId·carReturnId 정리 + 가격 기록 제거, 호텔 연결은 유지
  w.eval(`editingBooking='bc'`);
  w.document.getElementById('bkDelBtn').click();
  assert.deepEqual(w.eval(`trip().bookings.map(b=>b.id)`), ['bh']);
  assert.equal(w.eval(`trip().days[0].spots.some(s=>s.carPickupId||s.carReturnId)`), false, '렌터카 참조 정리');
  assert.equal(w.eval(`trip().days[0].spots[1].bookingId`), 'bh', '다른 예약 연결은 보존');
  assert.equal(w.eval(`'bc' in priceStore`), false, '가격 관측 기록도 함께 제거');
  // 호텔 예약 삭제 → bookingId 정리, bookings 키 자체 제거
  w.eval(`editingBooking='bh'`);
  w.document.getElementById('bkDelBtn').click();
  assert.equal(w.eval(`trip().days[0].spots.some(s=>s.bookingId)`), false);
  assert.equal(w.eval(`trip().bookings`), undefined, '빈 배열 대신 키 제거(기존 규칙)');
  w.close();
});

// ── Adaptive Travel OS 배선 (여행 모드 = 지금 무엇을 할지 답하는 화면) ──
// 판단 자체는 test/adaptive.test.js(순수)가 검증한다. 여기서는 "그 판단이 실제 화면·데이터에 닿는지"만 본다.
// 시각 의존을 없애기 위해 todayISO/nowMinutes를 테스트에서 고정한다.
function withAdaptTrip(w, days, opts) {
  const o = opts || {};
  w.eval(`store.trips.push({id:'__ad__',name:'적응 여행',start:'2026-09-01',days:${JSON.stringify(days)}});`
    + `store.activeId='__ad__'; activeDay=0;`
    + `todayISO=()=>'${o.today || '2026-09-01'}'; nowMinutes=()=>${o.now != null ? o.now : 11 * 60};`);
}
const S = (name, lat, extra) => Object.assign({ name, city: '마드리드', lat, lng: -3.70, stayMin: 60 }, extra || {});
function cardsIn(w) { return Array.from(w.document.querySelectorAll('#travelSuggest .sgCard')); }
function buttonIn(el, label) { return Array.from(el.querySelectorAll('button')).filter((b) => b.textContent === label)[0]; }

test('통합: 여행 모드가 현재 상태로 제안을 만들고 추천 이유를 함께 보여준다', { skip: noJsdom }, () => {
  const w = boot();
  withAdaptTrip(w, [
    { startAt: '09:00', mode: 'car', spots: [S('프라도', 40.41, { stayMin: 120 }), S('저녁 예약', 40.42, { bookAt: '19:30', stayMin: 90 })] },
    { spots: [S('레티로 공원', 40.415, { stayMin: 90 })] }
  ]);
  w.eval('renderTravel(0)');
  const cards = cardsIn(w);
  assert.ok(cards.length >= 1, '제안이 최소 하나는 나온다');
  assert.ok(cards.length <= 4, '검색 결과처럼 쏟아내지 않는다');
  const host = w.document.getElementById('travelSuggest');
  assert.match(host.textContent, /레티로 공원/, '오늘 빈 시간에 넣을 수 있는 다른 날 장소를 제안한다');
  assert.ok(host.querySelectorAll('.sgWhy li').length > 0, '"AI가 추천했습니다"로 끝내지 않고 이유를 적는다');
  assert.equal(w.eval('_adapt.state.nextFixed.title'), '저녁 예약');
  assert.equal(w.eval('_adapt.state.live'), true);
  w.close();
});

test('통합: 거절한 제안은 같은 날 다시 올라오지 않는다', { skip: noJsdom }, () => {
  const w = boot();
  withAdaptTrip(w, [
    { startAt: '09:00', mode: 'car', spots: [S('프라도', 40.41, { stayMin: 120 }), S('저녁 예약', 40.42, { bookAt: '19:30', stayMin: 90 })] },
    { spots: [S('레티로 공원', 40.415, { stayMin: 90 })] }
  ]);
  w.eval('renderTravel(0)');
  const card = cardsIn(w).filter((c) => /레티로 공원/.test(c.textContent))[0];
  assert.ok(card, '레티로 공원 제안이 있다');
  buttonIn(card, '건너뛰기').click();
  assert.ok(!/레티로 공원/.test(w.document.getElementById('travelSuggest').textContent), '건너뛴 제안은 사라진다');
  w.eval('renderTravel(0)');
  assert.ok(!/레티로 공원/.test(w.document.getElementById('travelSuggest').textContent), '다시 그려도 올라오지 않는다');
  assert.match(w.localStorage.getItem('tripcanvas_suggest_v1') || '', /2026-09-01/, '거절은 날짜와 함께 기기에 남는다');
  assert.equal(w.eval("(trip().days[1].spots[0].name)"), '레티로 공원', '거절은 여행 데이터를 건드리지 않는다');
  w.close();
});

test('통합: 제안을 수락하면 그 장소가 오늘 일정으로 옮겨온다', { skip: noJsdom }, () => {
  const w = boot();
  withAdaptTrip(w, [
    { startAt: '09:00', mode: 'car', spots: [S('프라도', 40.41, { stayMin: 120 }), S('저녁 예약', 40.42, { bookAt: '19:30', stayMin: 90 })] },
    { spots: [S('레티로 공원', 40.415, { stayMin: 90 })] }
  ]);
  w.eval('renderTravel(0)');
  const card = cardsIn(w).filter((c) => c.dataset.type === 'MOVE_FROM_OTHER_DAY' && /레티로 공원/.test(c.textContent))[0];
  assert.equal(card.dataset.suggestionType, 'NEXT_ACTIVITY');
  assert.equal(card.querySelector('[data-action="ACCEPT"]').textContent, '오늘 일정에 넣기', '표시 문구와 별개로 수락 동작을 식별한다');
  card.querySelector('[data-action="ACCEPT"]').click();
  assert.deepEqual(w.eval("trip().days[0].spots.map(s=>s.name)"), ['프라도', '레티로 공원', '저녁 예약']);
  assert.equal(w.eval('trip().days[1].spots.length'), 0, '원래 있던 날에서는 빠진다');
  w.close();
});

test('통합: 여행 모드의 날짜 선택과 추천은 같은 주입 clock을 사용한다', { skip: noJsdom }, () => {
  const w = boot();
  withAdaptTrip(w, [
    { startAt: '09:00', mode: 'car', spots: [S('오늘 장소', 40.41)] },
    { spots: [S('내일 장소', 40.42)] }
  ], { today: '2026-09-01', now: 13 * 60 });
  w.document.getElementById('travelBtn').click();
  assert.equal(w.document.getElementById('travelDay').value, '0', '호스트 실제 날짜가 아니라 주입 날짜로 오늘을 고른다');
  assert.equal(w.eval('_adapt.state.currentDay'), 0);
  assert.equal(w.eval('_adapt.state.nowMin'), 13 * 60, '같은 스냅샷 시각이 추천 엔진까지 전달된다');
  assert.match(w.document.getElementById('travelCurrent').textContent, /현재 장소/, '현재 장소 판정도 같은 주입 날짜를 쓴다');
  w.close();
});

test('통합: 다녀온 곳을 표시하면 상태가 저장되고 "다음 장소"가 그다음으로 넘어간다', { skip: noJsdom }, () => {
  const w = boot();
  withAdaptTrip(w, [{
    startAt: '09:00', mode: 'car',
    spots: [S('첫 곳', 40.41), S('둘째 곳', 40.42), S('셋째 곳', 40.43)]
  }], { now: 9 * 60 + 30 });
  w.eval('renderTravel(0)');
  const first = w.document.querySelectorAll('#travelList .tSpot')[0];
  buttonIn(first, '다녀왔어요').click();
  assert.equal(w.eval("trip().days[0].spots[0].status"), 'COMPLETED');
  assert.ok(w.document.querySelectorAll('#travelList .tSpot')[0].classList.contains('done'), '다녀온 카드는 시각적으로 구분된다');
  assert.match(w.document.getElementById('travelNext').textContent, /둘째 곳/);
  const second = w.document.querySelectorAll('#travelList .tSpot')[1];
  buttonIn(second, '건너뛰기').click();
  assert.equal(w.eval("trip().days[0].spots[1].status"), 'SKIPPED');
  assert.match(w.document.getElementById('travelNext').textContent, /셋째 곳/, '건너뛴 곳은 "다음"이 아니다');
  w.close();
});

test('통합: 지연이 생기면 재구성 미리보기를 보여주고, 수락해야만 일정이 바뀐다', { skip: noJsdom }, () => {
  const w = boot();
  withAdaptTrip(w, [
    {
      startAt: '09:00', mode: 'car',
      spots: [S('Museum', 40.41, { stayMin: 120 }), S('Cafe', 40.44, { opt: true }), S('Park', 40.47, { stayMin: 90, must: true }),
        S('Dinner', 40.50, { bookAt: '19:00', stayMin: 90 })]
    },
    { spots: [] }
  ], { now: 16 * 60 + 30 });
  w.eval('renderTravel(0)');
  const card = cardsIn(w).filter((c) => c.dataset.type === 'REPLAN')[0];
  assert.ok(card, '지연 상황에서는 재구성 제안이 가장 먼저 온다');
  assert.match(card.textContent, /기존/, '기존 → 제안을 먼저 보여준다');
  assert.match(card.textContent, /Dinner/, '고정 예약은 제안에도 남아 있다');
  assert.deepEqual(w.eval("trip().days[0].spots.map(s=>s.name)"), ['Museum', 'Cafe', 'Park', 'Dinner'], '미리보기 단계에서는 아직 바뀌지 않는다');
  buttonIn(card, '이대로 변경').click();
  const today = w.eval("trip().days[0].spots.map(s=>s.name)");
  assert.ok(today.indexOf('Dinner') >= 0, '고정 예약은 절대 빠지지 않는다');
  assert.ok(today.indexOf('Park') >= 0, 'mustVisit은 보호한다');
  assert.equal(today.indexOf('Cafe'), -1, '(선택) 일정이 먼저 빠진다');
  assert.ok(w.eval("trip().days[1].spots.map(s=>s.name)").indexOf('Cafe') >= 0, '뺀 일정은 버리지 않고 다음 날로 옮긴다');
  w.close();
});

test('통합: 추천도 전날 숙소(dayContext.anchor)를 출발 기준점으로 공유한다', { skip: noJsdom }, () => {
  const w = boot();
  withAdaptTrip(w, [
    { startAt: '09:00', mode: 'car', spots: [S('호텔', 40.40, { stay: true, stayMin: 0 })] },
    { startAt: '09:00', mode: 'car', spots: [S('아침 일정', 40.41)] }
  ], { today: '2026-09-02', now: 8 * 60 });
  const start = w.eval('JSON.stringify(adaptState(1).startLocation)');
  assert.equal(start, JSON.stringify({ lat: 40.40, lng: -3.70 }), '전날 숙소가 오늘의 출발점이다');
  assert.equal(w.eval('adaptState(1).currentDay'), 1);
  assert.equal(w.eval('adaptState(1).live'), true);
  w.close();
});

test('통합: 남은 시간이 없으면 억지 추천 대신 쉬는 선택지를 남긴다', { skip: noJsdom }, () => {
  const w = boot();
  withAdaptTrip(w, [
    { startAt: '09:00', mode: 'car', spots: [S('호텔', 40.40, { stay: true, stayMin: 0 }), S('저녁 예약', 40.41, { bookAt: '19:00', stayMin: 90 })] },
    { spots: [S('먼 산', 41.40, { stayMin: 180 })] }
  ], { now: 18 * 60 + 40 });
  w.eval('renderTravel(0)');
  const host = w.document.getElementById('travelSuggest');
  assert.ok(!/먼 산/.test(host.textContent), '20분 남은 시간에 3시간짜리를 밀어넣지 않는다');
  assert.ok(/쉬|숙소|없습니다/.test(host.textContent), '대신 쉬거나 그대로 두라고 말한다');
  w.close();
});

test('통합: 컨디션을 낮추면 같은 상황에서도 추천이 달라진다', { skip: noJsdom }, () => {
  const w = boot();
  withAdaptTrip(w, [
    { startAt: '09:00', mode: 'car', spots: [S('호텔', 40.40, { stay: true, stayMin: 0 })] },
    { spots: [S('먼 전망대', 40.75, { stayMin: 60 })] }
  ], { now: 10 * 60 });
  w.eval('renderTravel(0)');
  const before = w.eval("_adapt.res.ranked.map(r=>r.title).join('|')");
  w.document.querySelectorAll('#travelEnergy button').forEach((b) => { if (b.textContent === '좀 지쳤어요') b.click(); });
  assert.equal(w.eval('adaptEnergy'), 'LOW');
  const after = w.eval("_adapt.res.ranked.map(r=>r.title).join('|')");
  assert.notEqual(before, after, '컨디션이 추천 순서에 반영된다');
  assert.match(w.localStorage.getItem('tripcanvas_suggest_v1') || '', /LOW/);
  w.close();
});

// ── 자연어 요청 · 하루 flow · 출발 안내 ──

test('통합: "오늘 좀 피곤해서 많이 걷기 싫어"가 추천 범위를 실제로 좁힌다', { skip: noJsdom }, () => {
  const w = boot();
  withAdaptTrip(w, [
    { startAt: '09:00', mode: 'car', spots: [S('숙소', 40.40, { stay: true, stayMin: 0 }), S('저녁 예약', 40.41, { bookAt: '19:00', stayMin: 90 })] },
    { spots: [S('가까운 골목', 40.405), S('건너편 언덕', 40.75)] }
  ], { now: 13 * 60 });
  w.eval('renderTravel(0)');
  assert.ok(w.eval('_adapt.res.ranked.map(r=>r.title).join(",")').includes('건너편 언덕'), '기본에서는 후보로 남는다');

  w.document.getElementById('travelIntent').value = '오늘 좀 피곤해서 많이 걷기 싫어';
  w.document.getElementById('travelIntentApply').click();
  assert.equal(w.eval('adaptEnergy'), 'LOW');
  assert.equal(w.eval('adaptPrefs.maxTravelMin'), 20);
  assert.equal(w.eval('adaptPrefs.walkAverse'), true);
  const echo = w.document.getElementById('travelIntentEcho');
  assert.match(echo.textContent, /이렇게 이해했어요/, '무엇으로 알아들었는지 되돌려 말한다');
  const ranked = w.eval('_adapt.res.ranked.map(r=>r.title).join(",")');
  assert.ok(ranked.includes('가까운 골목'), '가까운 곳은 남는다');
  assert.ok(!ranked.includes('건너편 언덕'), '많이 걷기 싫다고 하면 먼 곳은 후보에서 빠진다');
  assert.match(w.localStorage.getItem('tripcanvas_suggest_v1') || '', /maxTravelMin/, '선호는 기기에 남는다');
  w.close();
});

test('통합: 못 알아들은 문장은 알아들은 척하지 않는다', { skip: noJsdom }, () => {
  const w = boot();
  withAdaptTrip(w, [{ startAt: '09:00', mode: 'car', spots: [S('A', 40.41)] }], { now: 10 * 60 });
  w.eval('renderTravel(0)');
  w.document.getElementById('travelIntent').value = '음 글쎄';
  w.document.getElementById('travelIntentApply').click();
  const echo = w.document.getElementById('travelIntentEcho');
  assert.match(echo.textContent, /못 알아들었어요/);
  assert.ok(echo.classList.contains('miss'));
  assert.deepEqual(w.eval('JSON.stringify(adaptPrefs)'), '{}', '못 알아들었으면 조건을 만들어내지 않는다');
  w.close();
});

test('통합: 하루 flow를 미리보기로 만들고, 수락해야만 일정에 들어간다', { skip: noJsdom }, () => {
  const w = boot();
  withAdaptTrip(w, [
    { startAt: '09:00', mode: 'car', spots: [S('숙소', 40.40, { stay: true, stayMin: 0 }), S('저녁 예약', 40.41, { bookAt: '19:00', stayMin: 90 })] },
    { spots: [S('공원', 40.405, { stayMin: 90 }), S('미술관', 40.407, { stayMin: 120 })] }
  ], { now: 13 * 60 });
  w.eval('renderTravel(0)');
  const flowBtn = Array.from(w.document.querySelectorAll('#travelEnergy button')).filter((b) => /빈 시간 채우기|오늘 하루 추천받기/.test(b.textContent))[0];
  assert.ok(flowBtn, '하루 flow 버튼이 있다');
  flowBtn.click();

  const card = w.document.querySelector('#travelPlan .sgCard');
  assert.ok(card, '미리보기 카드가 뜬다');
  assert.match(card.textContent, /저녁 예약/, '고정 예약은 흐름에 그대로 남는다');
  assert.ok(card.querySelectorAll('.sgFlowRow').length >= 2);
  assert.match(card.textContent, /오후|점심|저녁/, '시간대 라벨로 하루를 나눈다');
  assert.deepEqual(w.eval('trip().days[1].spots.map(s=>s.name)'), ['공원', '미술관'], '미리보기 단계에서는 아직 옮기지 않는다');

  buttonIn(card, '이 일정으로 시작').click();
  const today = w.eval('trip().days[0].spots.map(s=>s.name)');
  assert.equal(today[0], '숙소');
  assert.equal(today[today.length - 1], '저녁 예약', '고정 예약은 여전히 마지막이다');
  assert.ok(today.indexOf('공원') > 0 && today.indexOf('미술관') > 0, '제안이 그 사이에 들어간다');
  assert.equal(w.eval('trip().days[1].spots.length'), 0, '가져온 날에서는 빠진다');
  assert.equal(w.eval('_dayFlow'), null, '수락하면 미리보기는 닫힌다');
  w.close();
});

test('통합: 하루 flow의 "다른 제안"은 방금 본 후보를 빼고 다시 만든다', { skip: noJsdom }, () => {
  const w = boot();
  withAdaptTrip(w, [
    { startAt: '09:00', mode: 'car', spots: [S('숙소', 40.40, { stay: true, stayMin: 0 }), S('저녁 예약', 40.41, { bookAt: '19:00', stayMin: 90 })] },
    { spots: [S('공원', 40.405, { stayMin: 240 }), S('미술관', 40.407, { stayMin: 240 })] }
  ], { now: 13 * 60 });
  w.eval('renderTravel(0)');
  Array.from(w.document.querySelectorAll('#travelEnergy button')).filter((b) => /빈 시간 채우기|오늘 하루 추천받기/.test(b.textContent))[0].click();
  const first = w.eval("_dayFlow.picks.map(p=>p.title).join(',')");
  assert.ok(first.length > 0);
  buttonIn(w.document.querySelector('#travelPlan .sgCard'), '다른 제안').click();
  const second = w.eval("_dayFlow.picks.map(p=>p.title).join(',')");
  assert.notEqual(first, second, '같은 후보를 다시 내밀지 않는다');
  assert.equal(w.eval('trip().days[1].spots.length'), 2, '데이터는 그대로다');
  w.close();
});

test('통합: 다음 장소에 "언제 나서면 되는지"를 함께 알려준다', { skip: noJsdom }, () => {
  const w = boot();
  withAdaptTrip(w, [{
    startAt: '09:00', mode: 'car',
    spots: [S('숙소', 40.40, { stay: true, stayMin: 0 }), S('저녁 예약', 40.41, { bookAt: '19:00', stayMin: 90 })]
  }], { now: 17 * 60 });
  w.eval('renderTravel(0)');
  const dep = w.document.querySelector('#travelNext .travelDepart');
  assert.ok(dep, '출발 안내가 붙는다');
  assert.match(dep.textContent, /출발/);
  w.eval('nowMinutes=()=>19*60+30; renderTravel(0)');
  const late = w.document.querySelector('#travelNext .travelDepart');
  assert.ok(late.classList.contains('late'), '이미 늦었으면 그렇게 말한다');
  assert.match(late.textContent, /늦습니다/);
  w.close();
});

// ── 함께하기 (협업) 배선 ──
// 접근 제어는 DB가 하지만, 화면이 서버가 거절할 요청을 만들지 않는지 · 권한 오류가 재시도 루프에 빠지지 않는지는 여기서 본다.

test('통합: 보기 권한(VIEWER) 여행에서는 편집 진입점이 막히고 배지·안내가 뜬다', { skip: noJsdom }, () => {
  const w = boot();
  withTrip(w, `[{title:'',drive:'',note:'',spots:[{name:'A',city:'S',lat:37.5,lng:127}]}]`);
  w.eval(`user={id:'u1',email:'me@example.com'}; tripRoles={__it__:{role:'VIEWER',count:3,owner:false}}; render();`);
  assert.equal(w.eval(`readOnly()`), true);
  assert.equal(w.eval(`myRole()`), 'VIEWER');
  assert.equal(w.document.body.classList.contains('roleViewer'), true, '편집 도구를 감추는 body 클래스');
  assert.equal(w.document.getElementById('roleBar').style.display, 'flex', '보기 권한 안내 바');
  assert.equal(w.document.getElementById('membersBtn').hidden, false);
  assert.equal(w.document.getElementById('membersBtn').textContent, '👥 3');
  // 편집 진입점: 모달이 열리지 않는다
  w.eval(`openSpotModal(0,-1)`);
  assert.equal(w.document.getElementById('spotModalBg').classList.contains('show'), false);
  w.eval(`openDayModal(0)`);
  assert.equal(w.document.getElementById('dayModalBg').classList.contains('show'), false);
  const before = w.eval(`JSON.stringify(trip().days[0].spots)`);
  w.eval(`window.confirm=()=>true; deleteSpot(0,0); copySpot(0,0); cycleMode(0);`);
  assert.equal(w.eval(`JSON.stringify(trip().days[0].spots)`), before, '장소가 지워지거나 복사되지 않는다');
  assert.equal(w.eval(`trip().days[0].mode||'car'`), 'car');
  w.close();
});

test('통합: 편집자(EDITOR)·로그아웃·로컬 전용 여행은 예전과 똑같이 편집된다(§95)', { skip: noJsdom }, () => {
  const w = boot();
  withTrip(w, `[{title:'',drive:'',note:'',spots:[]}]`);
  assert.equal(w.eval(`readOnly()`), false, '로그아웃: 소유자');
  w.eval(`user={id:'u1'}; tripRoles={};`);
  assert.equal(w.eval(`readOnly()`), false, '로그인했지만 역할 정보 없음(로컬 전용): 소유자');
  w.eval(`tripRoles={__it__:{role:'EDITOR',count:2,owner:false}}; render();`);
  assert.equal(w.eval(`readOnly()`), false);
  assert.equal(w.document.body.classList.contains('roleViewer'), false);
  w.eval(`openSpotModal(0,-1)`);
  assert.equal(w.document.getElementById('spotModalBg').classList.contains('show'), true, '편집자는 장소를 추가할 수 있다');
  w.close();
});

test('통합: 보기 권한 여행은 클라우드에 올리지 않고, 권한 오류(42501)는 재시도 없이 멈춘다', { skip: noJsdom }, async () => {
  const w = boot();
  let calls = 0;
  w.eval(`user={id:'u1'}; tripRoles={v1:{role:'VIEWER',count:2,owner:false}};`);
  w.sb = { rpc: async () => { calls++; return { data: null, error: { code: '42501', message: 'TRIP_FORBIDDEN' } }; } };
  w.SYNC_SAVE = async () => { calls++; throw Object.assign(new Error('TRIP_FORBIDDEN'), { code: '42501', status: 403 }); };
  w.eval(`sb=window.sb; TC_API.rpc=window.sb.rpc; TC_API.sync.save=window.SYNC_SAVE`);
  await w.eval(`syncTripCloud({id:'v1',name:'V',days:[{spots:[]}]})`);
  assert.equal(calls, 0, '보기 권한은 서버에 요청 자체를 보내지 않는다');
  // 편집자였는데 서버가 거절(나갔거나 내보내진 경우) → forbidden으로 멈추고 재시도 타이머를 걸지 않는다
  w.eval(`tripRoles={e1:{role:'EDITOR',count:2,owner:false}};`);
  await w.eval(`syncTripCloud({id:'e1',name:'E',days:[{spots:[]}]})`);
  assert.equal(calls, 1);
  assert.equal(w.eval(`syncMeta.e1.status`), 'forbidden');
  assert.equal(w.eval(`cloudRetryT`), null, '재시도 타이머 없음');
  await w.eval(`syncTripCloud({id:'e1',name:'E',days:[{spots:[]}]})`);
  assert.equal(calls, 1, 'forbidden 상태에서는 다시 요청하지 않는다');
  // 역할이 편집 가능으로 확인되면 다시 dirty (역할은 이제 GET /api/v1/me가 준다)
  w.TC_API.me = async () => ({
    data: { trips: [{ id: 'e1', role: 'EDITOR', memberCount: 2, owner: false, supabaseTripId: 'row-e1' }], realtime: { provider: 'SUPABASE', url: null } },
    error: null
  });
  await w.eval(`refreshTripRoles()`);
  assert.equal(w.eval(`syncMeta.e1.status`), 'dirty');
  w.close();
});

test('통합: 초대 링크(#join=)로 열면 여행 본문 없이 미리보기만 받아 참여 모달을 띄운다', { skip: noJsdom }, async () => {
  const w = boot();
  const token = 'T'.repeat(32);
  const rpc = [];
  w.sb = { rpc: async (name, args) => { rpc.push([name, args]); return { data: [{ valid: true, reason: 'OK', trip_name: '스페인 여행', start_date: '2026-10-25', day_count: 14, role: 'EDITOR', already_member: false }], error: null }; } };
  w.eval(`sb=window.sb; TC_API.rpc=window.sb.rpc; user=null;`);
  await w.eval(`startJoin(${JSON.stringify(token)})`);
  assert.deepEqual(rpc[0], ['invite_preview', { p_token: token }]);
  assert.equal(w.document.getElementById('joinModalBg').classList.contains('show'), true);
  assert.equal(w.document.getElementById('joinTripName').textContent, '스페인 여행');
  assert.match(w.document.getElementById('joinTripMeta').textContent, /10\/25 ~ 11\/7 · 14일/);
  assert.match(w.document.getElementById('joinTripMeta').textContent, /편집 권한/);
  assert.equal(w.document.getElementById('joinAccept').textContent, '로그인하고 참여하기', '로그인 전에는 먼저 로그인');
  assert.equal(w.eval(`store.trips.some(t=>t.name==='스페인 여행')`), false, '참여 전에는 여행이 내려오지 않는다');
  // 로그인하면 버튼이 참여로 바뀌고 이름이 이메일에서 채워진다
  w.eval(`user={id:'u2',email:'younghee@example.com'}`);
  await w.eval(`completePendingJoin()`);
  assert.equal(w.document.getElementById('joinAccept').textContent, '여행 참여하기');
  assert.equal(w.document.getElementById('joinName').value, 'younghee');
  w.close();
});

test('통합: 만료·취소된 초대는 참여 버튼 없이 이유를 보여준다', { skip: noJsdom }, async () => {
  const w = boot();
  w.sb = { rpc: async () => ({ data: [{ valid: false, reason: 'EXPIRED', trip_name: '스페인 여행', role: 'VIEWER' }], error: null }) };
  w.eval(`sb=window.sb; TC_API.rpc=window.sb.rpc; user={id:'u2',email:'a@b.c'};`);
  await w.eval(`startJoin('${'X'.repeat(24)}')`);
  assert.equal(w.document.getElementById('joinAccept').style.display, 'none');
  assert.match(w.document.getElementById('joinHint').textContent, /만료/);
  w.close();
});

test('통합: 형식이 어긋난 #join= 해시는 서버에 보내지 않는다', { skip: noJsdom }, () => {
  assert.equal(require('../collab.js').parseJoinHash('#join=<script>'), null);
  assert.equal(require('../collab.js').parseJoinHash('#join=' + 'a'.repeat(200)), null);
});

test('통합: 공유받은 여행의 "삭제"는 나가기가 되고 주최자만 삭제한다', { skip: noJsdom }, async () => {
  const w = boot();
  withTrip(w, `[{title:'',drive:'',note:'',spots:[]}]`);
  const rpc = [];
  w.sb = { rpc: async (name, args) => { rpc.push([name, args]); return { data: true, error: null }; } };
  w.eval(`sb=window.sb; TC_API.rpc=window.sb.rpc; user={id:'u2'}; tripRoles={__it__:{role:'EDITOR',count:2,owner:false}}; window.confirm=()=>true;`);
  assert.equal(w.eval(`deleteTrip('__it__')`), true);
  await new Promise(r => setTimeout(r, 20));
  assert.deepEqual(rpc[0], ['leave_trip', { p_client_id: '__it__' }], 'tombstone_trip이 아니라 leave_trip');
  assert.equal(w.eval(`store.trips.some(t=>t.id==='__it__')`), false, '이 기기의 사본도 지워진다');
  assert.equal(w.eval(`syncMeta.__it__`), undefined);
  w.close();
});

test('통합: 다른 멤버의 최신본 당겨오기 — 로컬이 깨끗하면 교체, 로컬 편집이 있으면 충돌로', { skip: noJsdom }, async () => {
  const w = boot();
  withTrip(w, `[{title:'',drive:'',note:'',spots:[]}]`);
  const remote = { id: '__it__', name: 'T (영희 편집)', start: '2026-08-01', days: [{ title: '', drive: '', note: '', spots: [] }] };
  w.sb = {};
  w.SYNC_LIST = async () => ({ data: [{ client_id: '__it__', data: remote, revision: 5, deleted_at: null, updated_at: '' }], error: null });
  w.eval(`sb=window.sb; TC_API.sync.list=window.SYNC_LIST; user={id:'u2'}; tripRoles={__it__:{role:'EDITOR',count:2,owner:false}};
    syncMeta.__it__={revision:4,status:'clean',op:'',hash:TC_SYNC.hashTrip(trip())};`);
  assert.equal(await w.eval(`pullTrip('__it__',{force:true})`), true);
  assert.equal(w.eval(`trip().name`), 'T (영희 편집)');
  assert.equal(w.eval(`syncMeta.__it__.revision`), 5);
  // 로컬에 미반영 편집이 있는 경우: 덮어쓰지 않고 충돌 카드
  w.eval(`trip().name='내가 바꾼 이름'; syncMeta.__it__={revision:5,status:'clean',op:'',hash:'stale-hash'};`);
  remote.name = 'T (철수 편집)';
  w.SYNC_LIST2 = async () => ({ data: [{ client_id: '__it__', data: remote, revision: 6, deleted_at: null, updated_at: '' }], error: null });
  w.eval(`TC_API.sync.list=window.SYNC_LIST2`);
  assert.equal(await w.eval(`pullTrip('__it__',{force:true})`), true);
  assert.equal(w.eval(`trip().name`), '내가 바꾼 이름', '로컬 편집은 보존된다');
  assert.equal(w.eval(`syncMeta.__it__.status`), 'conflict');
  assert.equal(w.document.getElementById('syncConflictBg').classList.contains('show'), true);
  w.close();
});

// 실시간이 붙은 뒤로 일행의 저장이 400ms 만에 도착한다. 그 사이 내 편집이 아직 디바운스(800ms)에
// 걸려 있으면 pullTrip 눈에는 '미반영 편집'으로 보여 모달이 떴다 — 서버는 아무것도 거절하지 않았는데도.
test('통합: 일행의 변경을 당기기 전에 내 편집부터 올린다 — 헛충돌 모달이 뜨지 않는다', { skip: noJsdom }, async () => {
  const w = boot();
  withTrip(w, `[{title:'',drive:'',note:'',spots:[]}]`);
  const order = [];
  const remote = { id: '__it__', name: 'T', start: '2026-08-01', days: [{ title: '', drive: '', note: '', spots: [] }] };
  w.sb = {};
  w.SYNC_SAVE = async (id, t) => { order.push('save'); remote.name = t.name; return { applied: true, conflict: false, revision: 6, data: null, deleted_at: null }; };
  w.SYNC_LIST = async () => { order.push('list'); return { data: [{ client_id: '__it__', data: remote, revision: 6, deleted_at: null, updated_at: '' }], error: null }; };
  w.eval(`sb=window.sb; user={id:'u1'}; TC_API.sync.save=window.SYNC_SAVE; TC_API.sync.list=window.SYNC_LIST;
    TC_API.rpc=async()=>({data:[],error:null});
    tripRoles={__it__:{role:'EDITOR',count:2,owner:false}};
    syncMeta.__it__={revision:5,status:'clean',op:'',hash:TC_SYNC.hashTrip(trip())};
    trip().name='내가 방금 바꾼 이름';`);   // 아직 안 올라간 편집 — 디바운스 중이다
  w.eval(`onLiveEvent('__it__',{kind:'SCHEDULE_CHANGED',actor_id:'u2'})`);
  await new Promise(r => setTimeout(r, 700));
  assert.deepEqual(order, ['save', 'list'], '당기기 전에 내 것부터 올린다');
  assert.equal(w.document.getElementById('syncConflictBg').classList.contains('show'), false, '서버가 거절하지 않았으면 물어보지 않는다');
  assert.equal(w.eval(`syncMeta.__it__.status`), 'clean');
  assert.equal(w.eval(`trip().name`), '내가 방금 바꾼 이름', '내 편집이 살아 있다');
  w.close();
});

test('통합: 서버가 거절한 진짜 충돌은 그대로 물어본다', { skip: noJsdom }, async () => {
  const w = boot();
  withTrip(w, `[{title:'',drive:'',note:'',spots:[]}]`);
  w.sb = {};
  w.SYNC_SAVE = async () => ({ applied: false, conflict: true, revision: 9, data: { id: '__it__', name: 'T (영희 편집)', days: [{ spots: [] }] }, deleted_at: null });
  w.eval(`sb=window.sb; user={id:'u1'}; TC_API.sync.save=window.SYNC_SAVE;
    TC_API.sync.list=async()=>({data:[],error:null}); TC_API.rpc=async()=>({data:[],error:null});
    tripRoles={__it__:{role:'EDITOR',count:2,owner:false}};
    syncMeta.__it__={revision:5,status:'clean',op:'',hash:'stale-hash'};`);
  w.eval(`onLiveEvent('__it__',{kind:'SCHEDULE_CHANGED',actor_id:'u2'})`);
  await new Promise(r => setTimeout(r, 700));
  assert.equal(w.eval(`syncMeta.__it__.status`), 'conflict');
  assert.equal(w.document.getElementById('syncConflictBg').classList.contains('show'), true, 'CAS가 거절한 것은 물어볼 값어치가 있다');
  w.close();
});

// render()가 Sortable 인스턴스를 재생성하므로, 끌고 있는 도중에 다시 그리면 목록이 손가락 아래에서 갈린다
test('통합: 드래그 중에는 일행의 변경을 미뤘다가 끝난 뒤 반영한다', { skip: noJsdom }, async () => {
  const w = boot();
  withTrip(w, `[{title:'',drive:'',note:'',spots:[]}]`);
  w.sb = {};
  w.eval(`sb=window.sb; user={id:'u1'}; TC_API.rpc=async()=>({data:[],error:null});
    tripRoles={__it__:{role:'EDITOR',count:2,owner:false}};
    pushLocalFirst=async()=>{};
    pullTrip=async()=>{ window.__pulls=(window.__pulls||0)+1; return true; };
    dragActive=true;`);
  w.eval(`onLiveEvent('__it__',{kind:'SCHEDULE_CHANGED',actor_id:'u2'})`);
  await new Promise(r => setTimeout(r, 700));
  assert.equal(w.eval(`window.__pulls||0`), 0, '끌고 있는 동안에는 다시 그리지 않는다');
  assert.equal(w.eval(`livePending.length`), 1, '버리지 않고 들고 있는다');
  w.eval(`dragActive=false;`);
  await new Promise(r => setTimeout(r, 800));
  assert.equal(w.eval(`window.__pulls||0`), 1, '손을 떼면 반영한다');
  w.close();
});

test('통합: 후보 보드 — 보기 권한은 담는 칸이 없고 반응은 되며, 결정 못 한 것이 맨 위에 온다', { skip: noJsdom }, async () => {
  const w = boot();
  const rpc = [];
  const rows = [
    { id: 1, title: '사그라다 파밀리아', status: 'PROPOSED', must_count: 2, ok_count: 0, pass_count: 0,
      my_reaction: null, proposed_by_label: '민수', mine: false, created_at: '2026-01-01',
      reactions: [{ name: '민수', reaction: 'MUST', me: false }, { name: '영희', reaction: 'MUST', me: false }] },
    { id: 2, title: '캄프 누', status: 'PROPOSED', must_count: 1, ok_count: 0, pass_count: 1,
      my_reaction: 'PASS', proposed_by_label: '영희', mine: false, created_at: '2026-01-02',
      reactions: [{ name: '민수', reaction: 'MUST', me: false }, { name: '나', reaction: 'PASS', me: true }] },
    { id: 3, title: '구엘 공원', status: 'SCHEDULED', scheduled_ref: '2', must_count: 1, ok_count: 0, pass_count: 0,
      my_reaction: null, proposed_by_label: '민수', mine: false, created_at: '2026-01-03', reactions: [] }
  ];
  w.eval(`user={id:'u1'}; store.trips=[{id:'t1',name:'스페인',start:'2026-10-25',days:[{spots:[]},{spots:[]}]}]; store.activeId='t1';
    syncMeta={t1:{revision:3,status:'clean'}}; tripRoles={t1:{role:'VIEWER',count:2,owner:false}};`);
  w.__rows = rows;
  w.sb = { rpc: async (name, args) => { rpc.push([name, args]); return { data: name === 'list_trip_candidates' ? w.__rows : true, error: null }; } };
  w.eval(`sb=window.sb; TC_API.rpc=window.sb.rpc; candTripId='t1';`);
  await w.eval(`renderCandidates()`);

  // 보기 권한: 후보를 담는 칸은 감춘다(서버도 42501로 막는다)
  assert.equal(w.document.getElementById('candAddSection').style.display, 'none');
  const groups = [...w.document.querySelectorAll('#candList .candGroup')].map(e => e.textContent);
  assert.equal(groups[0], '의견이 필요해요', '결정 못 한 것이 맨 위 — 보드는 어디에 한마디가 필요한지 가리킨다');
  assert.ok(groups.includes('일정에 넣었어요'));
  // 이미 정한 것은 계속 물어보지 않는다 — 일정에 넣은 후보는 따로 묶인다
  const scheduled = w.document.querySelector('#candList .candCard.scheduled');
  assert.match(scheduled.textContent, /Day 2/);
  // 보기 권한도 반응은 할 수 있다
  const cards = [...w.document.querySelectorAll('#candList .candCard')];
  const campNou = cards.find(c => c.textContent.includes('캄프 누'));
  const pressed = [...campNou.querySelectorAll('.candReact button')].filter(b => b.getAttribute('aria-pressed') === 'true');
  assert.equal(pressed.length, 1, '한 사람 한 표 — 눌린 버튼은 하나');
  assert.match(pressed[0].textContent, /이번엔 패스/);
  // 일정에 넣기·후보에서 빼기는 보기 권한에 없다 — 남는 것은 한마디(코멘트)뿐이다(의견이라 보기 권한도 남긴다)
  const actions = [...campNou.querySelectorAll('.candActions button')].map(b => b.textContent);
  assert.equal(actions.some(t => /일정에 넣기|후보에서 빼기|되돌리기/.test(t)), false);
  assert.equal(actions.filter(t => t.startsWith('💬')).length, 1);
  w.close();
});

test('통합: 반응은 탭 즉시 반영되고 서버가 거절하면 되돌아간다 — 한 사람 한 표라 옛 표는 사라진다', { skip: noJsdom }, async () => {
  const w = boot();
  let fail = false, sent = [];
  w.eval(`user={id:'u1'}; store.trips=[{id:'t1',name:'스페인',days:[{spots:[]}]}]; store.activeId='t1';
    syncMeta={t1:{revision:3,status:'clean'}}; tripRoles={t1:{role:'EDITOR',count:3,owner:false}};
    candTripId='t1';
    candRows=[{id:1,title:'사그라다 파밀리아',status:'PROPOSED',must_count:1,ok_count:0,pass_count:0,
      my_reaction:'MUST',proposed_by_label:'나',mine:true,created_at:'2026-01-01',
      reactions:[{name:'나',reaction:'MUST',me:true}]}];`);
  w.__state = () => ({ fail, sent });
  w.sb = { rpc: async (name, args) => { sent.push([name, args]); return fail ? { data: null, error: { message: 'boom' } } : { data: true, error: null }; } };
  w.eval(`sb=window.sb; TC_API.rpc=window.sb.rpc; drawCandidates();`);

  await w.eval(`reactCandidate(1,'OK')`);
  assert.deepEqual(sent[0], ['react_to_candidate', { p_candidate_id: 1, p_reaction: 'OK' }]);
  assert.equal(w.eval(`candRows[0].my_reaction`), 'OK');
  assert.equal(w.eval(`candRows[0].must_count`), 0, '옛 표는 빠진다');
  assert.equal(w.eval(`candRows[0].ok_count`), 1);
  assert.equal(w.eval(`candRows[0].reactions.filter(x=>x.me).length`), 1, '내 반응은 하나만 남는다');

  // 다시 같은 것을 누르면 의견을 거둔다
  await w.eval(`reactCandidate(1,null)`);
  assert.equal(w.eval(`candRows[0].my_reaction`), null);
  assert.equal(w.eval(`candRows[0].ok_count`), 0);
  assert.equal(w.eval(`candRows[0].reactions.length`), 0);

  // 서버가 거절하면 화면을 원래대로 되돌린다 — 저장되지 않은 것이 저장된 척하지 않는다
  fail = true;
  await w.eval(`reactCandidate(1,'MUST')`);
  assert.equal(w.eval(`candRows[0].my_reaction`), null, '거절되면 눌리기 전으로');
  assert.equal(w.eval(`candRows[0].must_count`), 0);
  w.close();
});

test('통합: 후보를 일정에 넣으면 고른 날의 맨 뒤에 붙고 후보에는 그 날이 표시된다 — 자동 배치는 없다', { skip: noJsdom }, async () => {
  const w = boot();
  const rpc = [];
  w.eval(`user={id:'u1'}; store.trips=[{id:'t1',name:'스페인',start:'2026-10-25',days:[{title:'',spots:[{name:'기존'}]},{title:'',spots:[]}]}];
    store.activeId='t1'; activeDay=0; syncMeta={t1:{revision:3,status:'clean'}};
    tripRoles={t1:{role:'EDITOR',count:2,owner:false}}; candTripId='t1'; candRows=[];`);
  w.prompt = () => '2';
  w.sb = { rpc: async (name, args) => { rpc.push([name, args]); return { data: name === 'list_trip_candidates' ? [] : true, error: null }; } };
  w.eval(`sb=window.sb; TC_API.rpc=window.sb.rpc`);
  await w.eval(`scheduleCandidate({id:7,title:'카사 바트요',note:'가우디',lat:41.39,lng:2.16})`);
  const days = w.eval(`JSON.stringify(store.trips[0].days.map(d=>d.spots.map(s=>s.name)))`);
  assert.deepEqual(JSON.parse(days), [['기존'], ['카사 바트요']], '고른 날의 맨 뒤에만 붙는다');
  assert.equal(w.eval(`store.trips[0].days[1].spots[0].lat`), 41.39);
  assert.deepEqual(rpc.find(r => r[0] === 'manage_trip_candidate')[1],
    { p_candidate_id: 7, p_action: 'SCHEDULE', p_value: '2' });
  // 일정에 없는 날을 고르면 아무것도 하지 않는다
  w.prompt = () => '9';
  rpc.length = 0;
  await w.eval(`scheduleCandidate({id:8,title:'몬주익'})`);
  assert.equal(w.eval(`store.trips[0].days.reduce((n,d)=>n+d.spots.length,0)`), 2, '없는 날짜에는 넣지 않는다');
  assert.equal(rpc.length, 0);
  w.close();
});

test('통합: 후보 한마디 — 펼치면 불러오고, 남기면 수가 오르고, 보기 권한은 제 것만 지우고, 다시 그려도 쓰던 글이 남는다', { skip: noJsdom }, async () => {
  const w = boot();
  const rpc = [];
  const tick = () => new Promise(r => setTimeout(r, 0));
  w.__comments = [
    { id: 1, body: '야경 보고 저녁 먹자', author_label: '민수', mine: false, created_at: '2026-09-02T10:00:00Z' },
    { id: 2, body: '내가 남긴 말', author_label: '나', mine: true, created_at: '2026-09-02T10:05:00Z' }
  ];
  w.eval(`user={id:'u1'}; store.trips=[{id:'t1',name:'스페인',days:[{spots:[]}]}]; store.activeId='t1';
    syncMeta={t1:{revision:3,status:'clean'}}; tripRoles={t1:{role:'VIEWER',count:3,owner:false,serverId:''}};
    candTripId='t1'; candOpen=new Set(); candComments={}; candDraft={};
    candRows=[{id:1,title:'사그라다 파밀리아',status:'PROPOSED',must_count:1,ok_count:0,pass_count:0,comment_count:2,
      my_reaction:null,proposed_by_label:'민수',mine:false,created_at:'2026-01-01',reactions:[]}];`);
  w.sb = { rpc: async (name, args) => { rpc.push([name, args]);
    if (name === 'list_candidate_comments') return { data: w.__comments, error: null };
    if (name === 'add_candidate_comment') { w.__comments = w.__comments.concat([{ id: 3, body: args.p_body, author_label: '나', mine: true, created_at: '2026-09-02T10:06:00Z' }]); return { data: 3, error: null }; }
    if (name === 'delete_candidate_comment') { w.__comments = w.__comments.filter(c => c.id !== args.p_comment_id); return { data: true, error: null }; }
    return { data: null, error: null }; } };
  w.eval(`sb=window.sb; TC_API.rpc=window.sb.rpc; drawCandidates();`);
  const card = () => w.document.querySelector('#candList .candCard');
  const cbtn = () => [...card().querySelectorAll('.candActions button')].find(b => b.textContent.startsWith('💬'));
  assert.equal(cbtn().textContent, '💬 2');
  assert.equal(card().querySelector('.candComments'), null, '접혀 있으면 불러오지 않는다');
  cbtn().click(); await tick(); await tick();
  assert.deepEqual(rpc[0], ['list_candidate_comments', { p_candidate_id: 1 }]);
  const rows = [...card().querySelectorAll('.commentRow')];
  assert.equal(rows.length, 2);
  assert.match(rows[0].textContent, /민수.*야경 보고 저녁 먹자/);
  assert.equal(rows[0].querySelector('.cx'), null, '남의 한마디는 못 지운다(보기 권한)');
  assert.ok(rows[1].querySelector('.cx'), '내 것은 지운다');
  // 쓰다 만 글은 다시 그려도 남는다(실시간 갱신이 타이핑 중에 와도)
  const inp = () => card().querySelector('.commentForm input');
  inp().value = '쓰는 중'; inp().dispatchEvent(new w.Event('input'));
  w.eval('drawCandidates()');
  assert.equal(inp().value, '쓰는 중');
  // 남기기 → RPC → 수가 오르고 목록을 다시 읽는다
  inp().value = '저녁 예약이랑 가까움'; inp().dispatchEvent(new w.Event('input'));
  card().querySelector('.commentForm').dispatchEvent(new w.Event('submit', { cancelable: true }));
  await tick(); await tick(); await tick();
  assert.deepEqual(rpc.find(r => r[0] === 'add_candidate_comment')[1], { p_candidate_id: 1, p_body: '저녁 예약이랑 가까움' });
  assert.equal(cbtn().textContent, '💬 3');
  assert.equal(card().querySelectorAll('.commentRow').length, 3);
  assert.equal(inp().value, '', '남긴 뒤 입력칸은 비운다');
  // 빈 말은 보내지 않는다
  const before = rpc.length;
  card().querySelector('.commentForm').dispatchEvent(new w.Event('submit', { cancelable: true }));
  await tick();
  assert.equal(rpc.length, before);
  // 내 것 지우기
  card().querySelectorAll('.commentRow')[1].querySelector('.cx').click();
  await tick(); await tick(); await tick();
  assert.deepEqual(rpc.find(r => r[0] === 'delete_candidate_comment')[1], { p_comment_id: 2 });
  assert.equal(cbtn().textContent, '💬 2');
  w.close();
});

test('통합: 최근 활동 — 서버 재료를 문장으로 옮기고, 같은 사람의 연속 저장은 한 줄로 묶는다(§39)', { skip: noJsdom }, async () => {
  const w = boot();
  const at = (m) => new Date(Date.UTC(2026, 8, 2, 10, m)).toISOString();
  w.eval(`user={id:'u1'}; membersTripId='t1';`);
  w.sb = { rpc: async (name) => ({ data: name === 'list_trip_activity' ? [
    { id: 5, kind: 'SCHEDULE_CHANGED', actor_label: '영희', mine: false, subject: {}, created_at: at(30) },
    { id: 4, kind: 'SCHEDULE_CHANGED', actor_label: '영희', mine: false, subject: {}, created_at: at(29) },
    { id: 3, kind: 'REACTION', actor_label: '영희', mine: false, subject: { title: '카사 바트요', candidate_id: 1, reaction: 'MUST' }, created_at: at(20) },
    { id: 2, kind: 'CANDIDATE_PROPOSED', actor_label: '주최자', mine: true, subject: { title: '카사 바트요', candidate_id: 1 }, created_at: at(10) },
    { id: 1, kind: 'MEMBER_JOINED', actor_label: '영희', member_label: '영희', mine: false, subject: {}, created_at: at(0) }
  ] : [], error: null }) };
  w.eval(`sb=window.sb; TC_API.rpc=window.sb.rpc`);
  await w.eval(`renderActivity()`);
  const lines = [...w.document.querySelectorAll('#activityList .activityRow .tx')].map(e => e.textContent);
  assert.deepEqual(lines, [
    '영희님이 일정을 바꿨어요 (2번)',
    '영희님이 카사 바트요를 "꼭 가고 싶어요"로 골랐어요',
    '내가 카사 바트요를 후보로 담았어요',
    '영희님이 함께하게 됐어요'
  ]);
  w.close();
});

test('통합: 실시간은 전달 수단이다 — 이벤트를 받으면 payload가 아니라 RPC로 다시 읽고, 여행을 바꾸거나 로그아웃하면 구독을 끊는다(§40·§41)', { skip: noJsdom }, async () => {
  const w = boot();
  const channels = [], removed = [], calls = { pull: [], cand: 0, roles: 0, toasts: [] };
  let handler = null;
  w.__mk = (name) => { const ch = { name, on: (ev, opts, cb) => { ch.opts = opts; handler = cb; return ch; }, subscribe: (cb) => { cb('SUBSCRIBED'); return ch; } }; channels.push(ch); return ch; };
  w.eval(`user={id:'u1'}; store.trips=[{id:'t1',name:'스페인',days:[{spots:[]}]},{id:'t2',name:'일본',days:[{spots:[]}]}]; store.activeId='t1';
    syncMeta={t1:{revision:3,status:'clean'},t2:{revision:1,status:'clean'}};
    tripRoles={t1:{role:'EDITOR',count:3,owner:false,serverId:'srv-1'},t2:{role:'OWNER',count:1,owner:true,serverId:'srv-2'}};`);
  w.sb = { channel: (name) => w.__mk(name), removeChannel: (ch) => { removed.push(ch.name); },
    rpc: async (name, args) => ({ data: name === 'list_trip_activity'
      ? [{ id: 9, kind: 'CANDIDATE_PROPOSED', actor_label: '영희', mine: false, subject: { title: '구엘 공원' }, created_at: '2026-09-02T10:00:00Z' }]
      : [], error: null }) };
  // 역할·인원과 '어느 실시간을 쓸지'는 GET /api/v1/me가 준다. 협업이 아직 Supabase면 내부 id(supabaseTripId)를 함께 준다
  w.TC_API_ME = async () => ({
    data: {
      trips: [{ id: 't1', role: 'EDITOR', memberCount: 4, owner: false, supabaseTripId: 'srv-1' },
              { id: 't2', role: 'OWNER', memberCount: 1, owner: true, supabaseTripId: 'srv-2' }],
      realtime: { provider: 'SUPABASE', url: null }
    }, error: null
  });
  w.eval(`sb=window.sb; TC_API.rpc=window.sb.rpc; TC_API.me=window.TC_API_ME;
    pushLocalFirst=async()=>{};   // 여기서 보는 것은 이벤트 배선이지 업로드가 아니다
    pullTrip=async(id,opts)=>{ window.__pull=(window.__pull||[]); window.__pull.push([id,!!(opts&&opts.force)]); return true; };
    renderCandidates=async()=>{ window.__cand=(window.__cand||0)+1; };
    toast=(m)=>{ window.__toasts=(window.__toasts||[]); window.__toasts.push(m); };
    updateCollabUI();`);
  assert.equal(channels.length, 1);
  assert.equal(channels[0].name, 'trip-activity-srv-1');
  assert.deepEqual(channels[0].opts, { event: 'INSERT', schema: 'public', table: 'trip_activity', filter: 'trip_id=eq.srv-1' });
  assert.match(w.document.getElementById('liveState').textContent, /실시간/);
  w.eval('updateCollabUI()');
  assert.equal(channels.length, 1, '같은 여행이면 다시 구독하지 않는다');

  const wait = () => new Promise(r => setTimeout(r, 480));
  // 남의 일정 변경 → 문서를 당겨온다(force). 내 저장은 당기지 않는다
  handler({ new: { kind: 'SCHEDULE_CHANGED', actor_id: 'u2' } });
  handler({ new: { kind: 'SCHEDULE_CHANGED', actor_id: 'u2' } });
  await wait();
  assert.deepEqual(w.eval('JSON.stringify(window.__pull||[])'), JSON.stringify([['t1', true]]), '연달아 와도 한 번만');
  handler({ new: { kind: 'SCHEDULE_CHANGED', actor_id: 'u1' } });
  await wait();
  assert.equal(w.eval('(window.__pull||[]).length'), 1, '내 저장은 이미 내 화면이다');
  // 남이 후보를 담음 → 보드가 닫혀 있으면 다시 읽지 않고, 알림 문장은 RPC 행으로 만든다
  handler({ new: { kind: 'CANDIDATE_PROPOSED', actor_id: 'u2' } });
  await wait();
  assert.equal(w.eval('window.__cand||0'), 0);
  assert.deepEqual(w.eval('JSON.stringify(window.__toasts||[])'), JSON.stringify(['영희님이 구엘 공원을 후보로 담았어요']));
  // 보드가 열려 있으면 다시 읽는다. 반응은 조용히(알림 없음)
  w.eval(`candTripId='t1'; document.getElementById('candModalBg').classList.add('show');`);
  handler({ new: { kind: 'REACTION', actor_id: 'u2' } });
  await wait();
  assert.equal(w.eval('window.__cand||0'), 1);
  assert.equal(w.eval('(window.__toasts||[]).length'), 1, '반응은 알리지 않는다(§51)');
  // 새 멤버 → 역할·인원을 다시 읽는다
  handler({ new: { kind: 'MEMBER_JOINED', actor_id: 'u3' } });
  await wait();
  assert.equal(w.eval('tripRoles.t1.count'), 4);
  // 여행을 바꾸면 갈아 끼운다
  w.eval(`store.activeId='t2'; updateCollabUI();`);
  assert.deepEqual(removed, ['trip-activity-srv-1']);
  assert.equal(channels[1].name, 'trip-activity-srv-2');
  // 로그아웃하면 끊는다
  w.eval(`user=null; tripRoles={}; updateCollabUI();`);
  assert.deepEqual(removed, ['trip-activity-srv-1', 'trip-activity-srv-2']);
  assert.equal(channels.length, 2);
  w.close();
});

test('통합: 실시간이 없어도(channel 미지원·서버 id 없음) 앱은 그대로다(§40)', { skip: noJsdom }, async () => {
  const w = boot();
  w.eval(`user={id:'u1'}; store.trips=[{id:'t1',name:'스페인',days:[{spots:[]}]}]; store.activeId='t1';
    tripRoles={t1:{role:'EDITOR',count:2,owner:false,serverId:''}};`);
  w.sb = { rpc: async () => ({ data: [], error: null }) };   // channel 없음
  w.eval(`sb=window.sb; TC_API.rpc=window.sb.rpc; updateCollabUI();`);
  assert.equal(w.eval('liveCh'), null);
  w.eval(`tripRoles.t1.serverId='srv-1'; updateCollabUI();`);
  assert.equal(w.eval('liveCh'), null, 'channel을 모르는 클라이언트면 구독하지 않고 조용히 지나간다');
  assert.match(w.document.getElementById('liveState').textContent, /새로고침으로 갱신/);
  w.close();
});

test('통합: 여행 취향 — 그룹 요약은 문장으로, 내 칩은 한 번의 탭, 저장은 정규화해 보내고 서버 응답이 이긴다(§16~§19)', { skip: noJsdom }, async () => {
  const w = boot();
  const rpc = [];
  const tick = () => new Promise(r => setTimeout(r, 0));
  w.__rows = [
    { user_id: 'u1', label: '민수', role: 'OWNER', mine: true, prefs: { pace: 'RELAXED', interests: ['미술관'] } },
    { user_id: 'u2', label: '영희', role: 'EDITOR', mine: false, prefs: { pace: 'RELAXED', walking: 'LOW', morning: false, interests: ['미술관', '야경'], dislikes: ['쇼핑'] } },
    { user_id: 'u3', label: '철수', role: 'VIEWER', mine: false, prefs: {} }
  ];
  w.eval(`user={id:'u1'}; membersTripId='t1'; tripRoles={t1:{role:'OWNER',count:3,owner:true,serverId:''}};`);
  w.sb = { rpc: async (name, args) => { rpc.push([name, args]);
    if (name === 'list_trip_preferences') return { data: w.__rows, error: null };
    if (name === 'set_trip_preference') { // 서버는 정규화한 결과를 돌려준다 — 모르는 키는 사라지고 note는 잘린다
      const saved = { pace: args.p_prefs.pace, walking: args.p_prefs.walking, interests: args.p_prefs.interests, note: '서버가 돌려준 메모' };
      w.__rows = w.__rows.map(r => r.mine ? Object.assign({}, r, { prefs: saved }) : r);
      return { data: saved, error: null };
    }
    return { data: [], error: null }; } };
  w.eval(`sb=window.sb; TC_API.rpc=window.sb.rpc`);
  await w.eval(`renderPrefs()`);
  const lines = [...w.document.querySelectorAll('#prefGroup .prefLine')].map(e => e.textContent);
  assert.deepEqual(lines, ['3명 중 2명이 취향을 남겼어요', '2명이 "여유롭게"를 원해요', '많이 걷기 싫어요 (영희) — 동선은 이 기준으로', '아침 일찍은 어려워요 (영희)', '함께 관심: 미술관']);
  assert.ok(!/\d{2,}/.test(lines.join(' ')), '점수 같은 숫자는 없다');
  const others = [...w.document.querySelectorAll('#prefOthers .prefLine')].map(e => e.textContent);
  assert.deepEqual(others, ['영희: 여유롭게 · 많이 걷기 싫어요 · 아침 일찍은 어려워요 · 관심: 미술관, 야경 · 별로: 쇼핑', '철수: 아직 안 남겼어요']);
  const chip = (k, text) => [...w.document.querySelectorAll(`#prefSection .prefChips[data-pref="${k}"] button`)].find(b => b.textContent === text);
  assert.equal(chip('pace', '여유롭게').getAttribute('aria-pressed'), 'true', '내 취향이 칩에 반영된다');
  assert.equal(chip('interests', '미술관').getAttribute('aria-pressed'), 'true');
  // 한 번의 탭: 페이스 바꾸기 · 걷기 고르기 · 관심을 별로로 옮기면 관심에서 빠진다
  chip('pace', '빡빡하게').click(); chip('walking', '많이 걷기 싫어요').click(); chip('dislikes', '미술관').click(); chip('interests', '야경').click();
  assert.equal(chip('pace', '빡빡하게').getAttribute('aria-pressed'), 'true');
  assert.equal(chip('pace', '여유롭게').getAttribute('aria-pressed'), 'false', '페이스는 하나만');
  assert.equal(chip('interests', '미술관').getAttribute('aria-pressed'), 'false', '같은 주제가 관심과 별로에 동시에 있을 수 없다');
  assert.equal(chip('dislikes', '미술관').getAttribute('aria-pressed'), 'true');
  w.document.getElementById('prefNote').value = '  이번엔 여유롭게  ';
  w.document.getElementById('prefSave').click();
  await tick(); await tick(); await tick();
  const sent = rpc.find(r => r[0] === 'set_trip_preference')[1];
  assert.deepEqual(sent, { p_client_id: 't1', p_prefs: { pace: 'PACKED', walking: 'LOW', interests: ['야경'], dislikes: ['미술관'], note: '이번엔 여유롭게' } }, '정규화해서 보낸다');
  // 서버가 돌려준 것이 이긴다 — 별로는 사라졌고 메모는 서버 것
  assert.equal(chip('dislikes', '미술관').getAttribute('aria-pressed'), 'false');
  assert.equal(w.document.getElementById('prefNote').value, '서버가 돌려준 메모');
  w.close();
});

test('통합: 후보 배지 — 두 명 이상이 말했으면 합의 문장, 아니면 무엇을 더 하면 되는지. 숫자는 없다(§21·§22)', { skip: noJsdom }, async () => {
  const w = boot();
  w.eval(`user={id:'u1'}; store.trips=[{id:'t1',name:'스페인',days:[{spots:[]}]}]; store.activeId='t1';
    syncMeta={t1:{revision:3,status:'clean'}}; tripRoles={t1:{role:'EDITOR',count:4,owner:false,serverId:''}}; candTripId='t1';
    candRows=[
      {id:1,title:'A',status:'PROPOSED',must_count:2,ok_count:1,pass_count:1,my_reaction:null,proposed_by_label:'민수',mine:false,created_at:'2026-01-01'},
      {id:2,title:'B',status:'PROPOSED',must_count:1,ok_count:3,pass_count:0,my_reaction:null,proposed_by_label:'민수',mine:false,created_at:'2026-01-02'},
      {id:3,title:'C',status:'PROPOSED',must_count:1,ok_count:0,pass_count:0,my_reaction:null,proposed_by_label:'민수',mine:false,created_at:'2026-01-03'},
      {id:4,title:'D',status:'PROPOSED',must_count:2,ok_count:1,pass_count:0,my_reaction:null,proposed_by_label:'민수',mine:false,created_at:'2026-01-04'}];
    sb={rpc:async()=>({data:[],error:null})}; drawCandidates();`);
  const badgeOf = (title) => [...w.document.querySelectorAll('#candList .candCard')].find(c => c.querySelector('.candName').textContent.startsWith(title)).querySelector('.candMood');
  assert.equal(badgeOf('A').textContent, '의견이 갈려 있어요'); assert.ok(badgeOf('A').classList.contains('split'));
  assert.equal(badgeOf('B').textContent, '괜찮아 보여요 — 반대가 없어요'); assert.ok(badgeOf('B').classList.contains('good'));
  assert.equal(badgeOf('C').textContent, '의견이 더 필요해요', '한 명만 말했으면 합의를 말하지 않는다');
  for (const t of ['A', 'B', 'C']) assert.doesNotMatch(badgeOf(t).textContent, /\d/);
  // 묶음이 먼저다 — 결정 못 한 것(A·C·D)이 위, 다들 좋아하는 것(B)이 아래. 정렬은 묶음 안에서만 바뀐다(§12 표시일 뿐 결정이 아니다)
  const order = () => [...w.document.querySelectorAll('#candList .candCard .candName')].map(e => e.textContent[0]);
  assert.deepEqual(order(), ['D', 'C', 'A', 'B'], '최근 순');
  w.document.getElementById('candSort').value = 'interest'; w.eval('drawCandidates()');
  assert.deepEqual(order(), ['D', 'A', 'C', 'B'], '관심 순 — 반대 없는 D가 갈린 A보다 위(§20), 한 명만 말한 C는 아래');
  w.close();
});

test('통합: 갈린 후보 — 자동으로 빼지 않고 선택지를 보여주며, 제외는 상태(REJECT)고 되돌린다(§23·§24)', { skip: noJsdom }, async () => {
  const w = boot();
  const rpc = [];
  const tick = () => new Promise(r => setTimeout(r, 0));
  w.__status = 'PROPOSED';
  const row = () => ({ id: 1, title: '캄프 누', status: w.__status, must_count: 1, ok_count: 0, pass_count: 1, my_reaction: null, proposed_by_label: '민수', mine: false,
    created_at: '2026-01-01', reactions: [{ name: '민수', reaction: 'MUST', me: false }, { name: '영희', reaction: 'PASS', me: false }] });
  w.eval(`user={id:'u1'}; store.trips=[{id:'t1',name:'스페인',days:[{spots:[]}]}]; store.activeId='t1';
    syncMeta={t1:{revision:3,status:'clean'}}; tripRoles={t1:{role:'EDITOR',count:3,owner:false,serverId:''}}; candTripId='t1';`);
  w.sb = { rpc: async (name, args) => { rpc.push([name, args]);
    if (name === 'list_trip_candidates') return { data: [row()], error: null };
    if (name === 'manage_trip_candidate') { w.__status = args.p_action === 'REJECT' ? 'REJECTED' : 'PROPOSED'; return { data: true, error: null }; }
    return { data: [], error: null }; } };
  w.eval(`sb=window.sb; TC_API.rpc=window.sb.rpc`);
  await w.eval(`renderCandidates()`);
  const panel = w.document.querySelector('#candList .candConflict');
  assert.ok(panel, '선택지 패널');
  assert.match(panel.textContent, /의견이 갈려 있어요/);
  const opts = [...panel.querySelectorAll('.candOption')];
  assert.deepEqual(opts.map(o => o.dataset.option), ['TOGETHER', 'SPLIT', 'SKIP']);
  // 반응에 user_id가 없는(옛 서버) 응답은 누가 어느 쪽인지 가릴 수 없어 분리를 만들지 않는다 — 안내만 남는다
  assert.equal(opts[1].querySelector('button'), null, 'id 없이는 갈라 세울 수 없다');
  assert.match(opts[1].textContent, /민수은\(는\) 캄프 누 · 영희은\(는\) 다른 곳/);
  assert.equal(w.document.querySelector('#candList .candGroup').textContent, '의견이 필요해요', '갈린 후보는 결정 못 한 묶음에 있다');
  // 제외 → REJECT RPC → '이번엔 뺐어요' 묶음으로, 의견은 그대로, 되돌리기 버튼
  opts[2].querySelector('button').click();
  await tick(); await tick(); await tick();
  assert.deepEqual(rpc.find(r => r[0] === 'manage_trip_candidate')[1], { p_candidate_id: 1, p_action: 'REJECT', p_value: null });
  const groups = [...w.document.querySelectorAll('#candList .candGroup')].map(e => e.textContent);
  assert.deepEqual(groups, ['이번엔 뺐어요']);
  assert.equal(w.document.querySelector('#candList .candMood').textContent, '이번엔 뺐어요');
  assert.equal(w.document.querySelector('#candList .candConflict'), null, '뺀 뒤엔 선택지를 묻지 않는다');
  assert.ok(w.document.querySelector('#candList .candWho'), '의견은 그대로 남는다');
  const back = [...w.document.querySelectorAll('#candList .candActions button')].find(b => b.textContent === '후보로 되돌리기');
  assert.ok(back); back.click();
  await tick(); await tick(); await tick();
  assert.equal(rpc.filter(r => r[0] === 'manage_trip_candidate').pop()[1].p_action, 'REOPEN');
  assert.equal(w.document.querySelector('#candList .candGroup').textContent, '의견이 필요해요');
  // 보기 권한: 선택지는 보이지만 고를 수 없다
  w.eval(`tripRoles.t1.role='VIEWER'; drawCandidates();`);
  assert.ok(w.document.querySelector('#candList .candConflict'));
  assert.equal(w.document.querySelectorAll('#candList .candConflict button').length, 0);
  w.close();
});

test('통합: 그룹 제안 — 반대 없는 후보를 어느 날에 넣을지 미리보기로, 수락하면 그 날 맨 뒤에 붙고 후보에 표시된다(§28·§29·§60)', { skip: noJsdom }, async () => {
  const w = boot();
  const rpc = [];
  const tick = () => new Promise(r => setTimeout(r, 0));
  w.eval(`user={id:'u1'}; store.trips=[{id:'t1',name:'스페인',start:'2026-10-25',days:[
      {title:'',spots:[{name:'광장',lat:41.387,lng:2.170},{name:'대성당',lat:41.384,lng:2.176}]},
      {title:'',spots:[{name:'해변',lat:41.378,lng:2.192}]}]}]; store.activeId='t1';
    syncMeta={t1:{revision:3,status:'clean'}}; tripRoles={t1:{role:'EDITOR',count:3,owner:false,serverId:''}}; candTripId='t1'; proposalDismissed='';
    candRows=[
      {id:1,title:'카사 바트요',status:'PROPOSED',lat:41.392,lng:2.165,must_count:3,ok_count:0,pass_count:0,my_reaction:null,proposed_by_label:'민수',mine:false,created_at:'2026-01-01'},
      {id:2,title:'바르셀로네타',status:'PROPOSED',lat:41.380,lng:2.190,must_count:1,ok_count:1,pass_count:0,my_reaction:null,proposed_by_label:'민수',mine:false,created_at:'2026-01-02'},
      {id:3,title:'갈린 곳',status:'PROPOSED',must_count:1,ok_count:0,pass_count:1,my_reaction:null,proposed_by_label:'민수',mine:false,created_at:'2026-01-03',reactions:[{name:'민수',reaction:'MUST'},{name:'영희',reaction:'PASS'}]}];`);
  w.sb = { rpc: async (name, args) => { rpc.push([name, args]); return { data: name === 'list_trip_candidates' ? w.eval('candRows') : true, error: null }; } };
  w.eval(`sb=window.sb; TC_API.rpc=window.sb.rpc; drawCandidates();`);
  const card = w.document.querySelector('#candList .proposalCard');
  assert.ok(card, '제안 카드');
  assert.match(card.querySelector('.proposalHead').textContent, /이 2곳은 다들 좋아해요/);
  const picks = [...card.querySelectorAll('.proposalPick .pt')].map(e => e.textContent);
  assert.deepEqual(picks, ['Day 1 · 카사 바트요', 'Day 2 · 바르셀로네타'], '각각 가장 가까운 날');
  assert.match(card.querySelector('.proposalPick .pr').textContent, /3명 모두 관심 있어요 · 반대 없음 · Day 1 마지막 장소\(대성당\)에서 약 \d\.\d km/);
  assert.equal(card.textContent.includes('갈린 곳'), false, '갈린 후보는 제안에 넣지 않는다');
  assert.doesNotMatch(card.textContent, /점수/);
  // 수락 → 그 날 맨 뒤에 붙고 SCHEDULE 표시
  [...card.querySelectorAll('button')].find(b => /일정으로 만들기/.test(b.textContent)).click();
  await tick(); await tick(); await tick(); await tick();
  const names = JSON.parse(w.eval(`JSON.stringify(store.trips[0].days.map(d=>d.spots.map(s=>s.name)))`));
  assert.deepEqual(names, [['광장', '대성당', '카사 바트요'], ['해변', '바르셀로네타']]);
  assert.deepEqual(rpc.filter(r => r[0] === 'manage_trip_candidate').map(r => [r[1].p_candidate_id, r[1].p_action, r[1].p_value]), [[1, 'SCHEDULE', '1'], [2, 'SCHEDULE', '2']]);
  // 넘기기: 같은 제안은 다시 보이지 않고, 후보는 그대로
  w.eval(`candRows.forEach(c=>{ c.status='PROPOSED'; }); store.trips[0].days[0].spots.pop(); store.trips[0].days[1].spots.pop(); drawCandidates();`);
  [...w.document.querySelectorAll('#candList .proposalCard button')].find(b => b.textContent === '이번엔 넘기기').click();
  assert.equal(w.document.querySelector('#candList .proposalCard'), null);
  assert.equal(w.document.querySelectorAll('#candList .candCard').length, 3);
  // 보기 권한: 제안은 보이되 수락 버튼은 없다
  w.eval(`proposalDismissed=''; tripRoles.t1.role='VIEWER'; drawCandidates();`);
  const vcard = w.document.querySelector('#candList .proposalCard');
  assert.ok(vcard);
  assert.equal([...vcard.querySelectorAll('button')].some(b => /일정으로 만들기/.test(b.textContent)), false);
  w.close();
});

test('통합: 서버가 자체 실시간을 쓰라고 하면 client_id로 구독하고 mine은 서버 값을 믿는다', { skip: noJsdom }, async () => {
  const w = boot();
  const opened = [];
  w.eval(`user={id:'u1'}; store.trips=[{id:'t1',name:'스페인',days:[{spots:[]}]}]; store.activeId='t1';
    syncMeta={t1:{revision:3,status:'clean'}};`);
  // Supabase 채널이 있어도 서버 선택이 우선이다 — 내부 id(serverId)는 아예 오지 않는다
  w.sb = { channel: () => { throw new Error('Supabase 채널을 쓰면 안 된다'); }, removeChannel: () => {}, rpc: async () => ({ data: [], error: null }) };
  w.TC_API_ME = async () => ({
    data: { trips: [{ id: 't1', role: 'EDITOR', memberCount: 3, owner: false }],
            realtime: { provider: 'TRIPCANVAS', url: 'wss://api.test/ws' } }, error: null
  });
  w.TC_API_CONNECT = (options) => { opened.push(options); options.onState(true); return { close: () => { opened.push('closed'); } }; };
  w.eval(`sb=window.sb; TC_API.me=window.TC_API_ME; TC_API.realtime={connect:window.TC_API_CONNECT};
    pushLocalFirst=async()=>{};   // 여기서 보는 것은 이벤트 배선이지 업로드가 아니다
    pullTrip=async(id,opts)=>{ window.__pull=(window.__pull||[]); window.__pull.push([id,!!(opts&&opts.force)]); return true; };`);
  await w.eval(`refreshTripRoles()`);

  assert.equal(opened.length, 1);
  assert.equal(opened[0].url, 'wss://api.test/ws');
  assert.equal(opened[0].tripId, 't1', '내부 id가 아니라 client_id로 구독한다');
  assert.equal(w.eval(`tripRoles.t1.serverId`), '', '자체 실시간이면 내부 id를 받지 않는다');
  assert.match(w.document.getElementById('liveState').textContent, /실시간/);

  // 서버가 붙여 준 mine을 그대로 믿는다 — 내 저장은 다시 당기지 않는다
  opened[0].onEvent({ type: 'ACTIVITY', tripId: 't1', id: 7, kind: 'SCHEDULE_CHANGED', mine: true });
  await new Promise((r) => setTimeout(r, 480));
  assert.equal(w.eval('(window.__pull||[]).length'), 0);
  opened[0].onEvent({ type: 'ACTIVITY', tripId: 't1', id: 8, kind: 'SCHEDULE_CHANGED', mine: false });
  await new Promise((r) => setTimeout(r, 480));
  assert.deepEqual(w.eval('JSON.stringify(window.__pull||[])'), JSON.stringify([['t1', true]]));

  // 로그아웃하면 끊는다
  w.eval(`user=null; tripRoles={}; updateCollabUI();`);
  assert.equal(opened.at(-1), 'closed');
  w.close();
});

// ── 함께 움직이지 않는 시간 (6단계 · §25~§27) ────────────────────────────────

const SU1 = '11111111-1111-4111-8111-111111111111';
const SU2 = '22222222-2222-4222-8222-222222222222';

test('통합: 갈린 후보를 자유시간으로 분리하면 같은 시간에 나란한 일정 두 개와 합류가 생긴다(§25~§27)', { skip: noJsdom }, async () => {
  const w = boot();
  const rpc = [];
  const tick = () => new Promise(r => setTimeout(r, 0));
  const row = () => ({ id: 1, title: '캄프 누', status: 'PROPOSED', lat: 41.38, lng: 2.12,
    must_count: 1, ok_count: 0, pass_count: 1, my_reaction: 'MUST', proposed_by_label: '민수', mine: true,
    created_at: '2026-01-01',
    reactions: [{ user_id: SU1, name: '민수', reaction: 'MUST', me: true },
                { user_id: SU2, name: '영희', reaction: 'PASS', me: false }] });
  w.eval(`user={id:'u1'}; store.trips=[{id:'t1',name:'스페인',days:[{title:'첫날',spots:[]}]}]; store.activeId='t1';
    syncMeta={t1:{revision:3,status:'clean'}}; tripRoles={t1:{role:'EDITOR',count:2,owner:false,serverId:''}}; candTripId='t1';
    tripMembers=[{user_id:'${SU1}',display_name:'민수',me:true},{user_id:'${SU2}',display_name:'영희',me:false}];`);
  w.sb = { rpc: async (name, args) => { rpc.push([name, args]); return { data: name === 'list_trip_candidates' ? [row()] : true, error: null }; } };
  w.eval(`sb=window.sb; TC_API.rpc=window.sb.rpc;`);
  w.prompt = () => '1';
  await w.eval(`renderCandidates()`);

  const opts = [...w.document.querySelectorAll('#candList .candOption')];
  const split = opts.find(o => o.dataset.option === 'SPLIT');
  const btn = split.querySelector('button');
  assert.ok(btn, 'user_id가 있으면 분리를 실제로 만들 수 있다');
  btn.click();
  await tick(); await tick(); await tick();

  const spots = w.eval(`JSON.stringify(store.trips[0].days[0].spots)`);
  const parsed = JSON.parse(spots);
  assert.equal(parsed.length, 3, '가는 쪽 · 자유시간 · 합류');
  assert.equal(parsed[0].name, '캄프 누');
  assert.deepEqual(parsed[0].who, [SU1], '꼭 가고 싶은 사람');
  assert.equal(parsed[1].name, '자유시간');
  assert.deepEqual(parsed[1].who, [SU2]);
  assert.equal(parsed[0].split, parsed[1].split, '같은 묶음이라 나란히 일어난다');
  assert.ok(parsed[0].split, '묶음 키가 있다');
  assert.equal(parsed[2].reunion, true);
  assert.equal(parsed[2].split, undefined, '합류는 묶음 밖 — 다 모인 뒤다');
  // 후보는 일정에 들어간 것으로 표시된다
  assert.equal(rpc.filter(r => r[0] === 'manage_trip_candidate').pop()[1].p_action, 'SCHEDULE');
  w.close();
});

test('통합: 일자 카드가 참여자와 합류를 보이고, 나란한 줄에 표시를 붙인다', { skip: noJsdom }, async () => {
  const w = boot();
  w.eval(`user={id:'u1'}; tripMembers=[{user_id:'${SU1}',display_name:'민수',me:true},{user_id:'${SU2}',display_name:'영희',me:false}];`);
  withTrip(w, JSON.stringify([{ title: '첫날', spots: [
    { name: '캄프 누', city: 'BCN', lat: 41.38, lng: 2.12, stayMin: 120, split: 'sp1', who: [SU1] },
    { name: '쇼핑', city: 'BCN', lat: 41.39, lng: 2.16, stayMin: 120, split: 'sp1', who: [SU2] },
    { name: '카탈루냐 광장', city: 'BCN', lat: 41.387, lng: 2.17, reunion: true }
  ] }]));
  w.eval(`render()`);
  const rows = [...w.document.querySelectorAll('#sidebar .spotList .spot')];
  assert.equal(rows.length, 3, '나란한 가지도 .spotList의 자식 수는 장소 수와 같다 — 드래그 인덱스가 어긋나면 안 된다');
  assert.ok(rows[0].classList.contains('inSplit'));
  assert.ok(rows[1].classList.contains('inSplit'));
  assert.equal(rows[0].dataset.split, 'sp1');
  assert.ok(rows[2].classList.contains('isReunion'));
  assert.match(rows[0].querySelector('.whoChip').textContent, /나/, '나는 "나"로 부른다');
  assert.match(rows[1].querySelector('.whoChip').textContent, /영희/);
  assert.ok(rows[2].querySelector('.reunionChip'), '합류 배지');
  // 나란한 두 줄은 같은 시각에서 시작한다 — 뒤에 줄서지 않는다
  const etas = rows.slice(0, 2).map(r => r.querySelector('.spotTime').textContent.replace(/[^\d:]/g, ''));
  assert.equal(etas[0], etas[1], '가지는 서로의 시간을 밀지 않는다');
  w.close();
});

test('통합: 참여자를 고르지 않으면 모두이고, 편집해도 분리·합류 표시가 떨어지지 않는다', { skip: noJsdom }, async () => {
  const w = boot();
  w.eval(`user={id:'u1'}; tripRoles={__it__:{role:'EDITOR',count:2,owner:false,serverId:''}};
    syncMeta={__it__:{revision:3,status:'clean'}};
    tripMembers=[{user_id:'${SU1}',display_name:'민수',me:true},{user_id:'${SU2}',display_name:'영희',me:false}];`);
  // 저장은 클라우드 동기화를 부른다 — 통하지 않는 sb를 두면 재시도 타이머가 남아 러너가 끝나지 않는다
  w.sb = { rpc: async () => ({ data: [], error: null }),
    from: () => ({ upsert: async () => ({ data: null, error: null }), select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }) };
  w.eval(`sb=window.sb; TC_API.rpc=window.sb.rpc;`);
  withTrip(w, JSON.stringify([{ title: '첫날', spots: [
    { name: '캄프 누', city: 'BCN', lat: 41.38, lng: 2.12, stayMin: 120, split: 'sp1', who: [SU1] }
  ] }]));
  w.eval(`render(); openSpotModal(0,0)`);

  const chips = [...w.document.querySelectorAll('#spotWho .whoChipBtn')];
  assert.equal(w.document.getElementById('spotWhoSection').style.display, 'block', '함께하는 여행에서만 보인다');
  assert.deepEqual(chips.map(c => c.textContent), ['👥 모두', '나', '영희']);
  assert.ok(chips[1].classList.contains('active'), '지금 참여자가 켜져 있다');

  // 메모만 고쳐 저장해도 묶음이 유지된다
  w.document.getElementById('spotDesc').value = '메모만 수정';
  w.document.getElementById('spotSave').click();
  let s = JSON.parse(w.eval(`JSON.stringify(trip().days[0].spots[0])`));
  assert.equal(s.split, 'sp1', '묶음은 이 모달에서 만들지도 지우지도 않는다');
  assert.deepEqual(s.who, [SU1]);

  // '모두'를 누르면 참여자가 비고, 그게 곧 모든 여행자다
  w.eval(`openSpotModal(0,0)`);
  w.document.querySelector('#spotWho .whoChipBtn').click();
  w.document.getElementById('spotSave').click();
  s = JSON.parse(w.eval(`JSON.stringify(trip().days[0].spots[0])`));
  assert.equal('who' in s, false, '기본값은 저장하지 않는다');
  w.eval(`render()`);
  assert.equal(w.document.querySelector('#sidebar .spot .whoChip'), null, '모두일 때는 아무 표시도 하지 않는다');
  w.close();
});
