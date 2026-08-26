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
