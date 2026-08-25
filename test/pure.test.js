// 순수 로직 유닛 테스트 (Node 내장 test 러너, 의존성 0)
const test = require('node:test');
const assert = require('node:assert');
const L = require('../lib.js');

test('parseHM / hm 왕복·경계', () => {
  assert.equal(L.parseHM('09:30'), 570);
  assert.equal(L.parseHM('9:5'), 9*60);      // 형식 불일치 → 기본 09:00
  assert.equal(L.parseHM(''), 540);
  assert.equal(L.hm(570), '09:30');
  assert.equal(L.hm(1566), '02:06');         // 익일로 래핑
  assert.equal(L.hm(-30), '23:30');          // 음수 방어
});

test('haversine 근사 (경주역→감포 ~30km)', () => {
  const d = L.haversine({lat:35.7965,lng:129.1349},{lat:35.8093,lng:129.5015});
  assert.ok(d>28 && d<36, `got ${d}`);
  assert.equal(Math.round(L.haversine({lat:0,lng:0},{lat:0,lng:0})), 0);
});

test('legId / legKey — 4자리 반올림·수단 접미사', () => {
  const a={lat:35.79651,lng:129.13488}, b={lat:35.83480,lng:129.22649};
  assert.equal(L.legId(a,b), '35.7965,129.1349>35.8348,129.2265');
  assert.equal(L.legKey(a,b), L.legId(a,b)+'#car');
  assert.equal(L.legKey(a,b,'transit'), L.legId(a,b)+'#transit');
});

test('ringPts — 8방위·반경 근사', () => {
  const pts=L.ringPts({lat:35.83,lng:129.22}, 1000);
  assert.equal(pts.length, 8);
  const dists=pts.map(p=>L.haversine({lat:35.83,lng:129.22},p));
  dists.forEach(d=>assert.ok(Math.abs(d-1)<0.05, `~1km, got ${d}`));
});

test('inKorea — 국내/해외 경계', () => {
  assert.equal(L.inKorea({lat:35.83,lng:129.22}), true);   // 경주
  assert.equal(L.inKorea({lat:40.41,lng:-3.70}), false);   // 마드리드
  assert.equal(L.inKorea(null), false);
});

test('simplifyName — 괄호·서술 꼬리말 제거', () => {
  assert.equal(L.simplifyName('감포 바다'), '감포');
  assert.equal(L.simplifyName('경주역 (KTX)'), '경주역');
  assert.equal(L.simplifyName('레티로 공원 (선택)'), '레티로 공원');
  assert.equal(L.simplifyName('불국사'), '불국사');
});

test('polyline 코덱 — 왕복 무손실 + 구글 호환 문자열', () => {
  const pts=[{lat:35.7965,lng:129.1349},{lat:35.8093,lng:129.5015},{lat:35.8348,lng:129.2265}];
  const dec=L.decodePolyline(L.encodePolyline(pts));
  pts.forEach((p,i)=>{ assert.ok(Math.abs(p.lat-dec[i].lat)<1e-5 && Math.abs(p.lng-dec[i].lng)<1e-5); });
  // 구글 인코딩 예제(precision 5): (38.5,-120.2)(40.7,-120.95)(43.252,-126.453) → "_p~iF~ps|U_ulLnnqC_mqNvxq`@"
  const g=L.decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@');
  assert.equal(g.length,3);
  assert.ok(Math.abs(g[0].lat-38.5)<1e-5 && Math.abs(g[0].lng+120.2)<1e-5);
  assert.ok(Math.abs(g[2].lat-43.252)<1e-5 && Math.abs(g[2].lng+126.453)<1e-5);
  assert.equal(L.encodePolyline([{lat:38.5,lng:-120.2},{lat:40.7,lng:-120.95},{lat:43.252,lng:-126.453}]), '_p~iF~ps|U_ulLnnqC_mqNvxq`@');
});
test('optimizeRoute — 비효율 순서를 개선, 끝점 고정 존중', () => {
  // 일부러 왕복 낭비하는 순서: 좌(0)→우끝(1)→중(2)→중우(3)
  const coords=[{lat:35.80,lng:129.13},{lat:35.81,lng:129.50},{lat:35.83,lng:129.23},{lat:35.84,lng:129.29}];
  const before=L.routeLength(coords);
  const order=L.optimizeRoute(coords,{fixStart:true});
  const after=L.routeLength(coords,order);
  assert.equal(order[0],0);                     // 시작 고정
  assert.ok(after<before, `개선: ${before.toFixed(1)}→${after.toFixed(1)}`);
  assert.deepEqual([...order].sort(), [0,1,2,3]);// 모든 인덱스 보존(순열)
  // fixEnd: 마지막 지점(숙소) 고정
  const o2=L.optimizeRoute(coords,{fixStart:true,fixEnd:true});
  assert.equal(o2[0],0); assert.equal(o2[o2.length-1],3);
  // 2점 이하는 그대로
  assert.deepEqual(L.optimizeRoute([{lat:1,lng:1}]), [0]);
});
test('isOpenAt — 요일/시각 영업 판정 + 자정넘김 + 24h + 정보없음', () => {
  // 월(1)~금(5) 09:00~18:00
  const wk=[1,2,3,4,5].map(d=>({d,o:540,c:1080}));
  assert.equal(L.isOpenAt(wk,3,600), true);    // 수 10:00 영업
  assert.equal(L.isOpenAt(wk,3,1140), false);  // 수 19:00 종료
  assert.equal(L.isOpenAt(wk,0,600), false);   // 일 휴무
  assert.equal(L.isOpenAt(null,3,600), null);  // 정보 없음
  assert.equal(L.isOpenAt([],3,600), null);
  // 금 22:00~토 02:00 (자정 넘김)
  const night=[{d:5,o:1320,c:120}];
  assert.equal(L.isOpenAt(night,5,1380), true);  // 금 23:00
  assert.equal(L.isOpenAt(night,6,60), true);    // 토 01:00 (전날 개장분)
  assert.equal(L.isOpenAt(night,6,180), false);  // 토 03:00
  // 24/7
  assert.equal(L.isOpenAt([{d:-1,o:0,c:1440}],0,0), true);
});
test('toISO — 로컬 날짜 포맷', () => {
  assert.equal(L.toISO(new Date(2026,6,5)), '2026-07-05');   // 월 0-기반
});

test('IANA 시간대 — 마드리드 DST와 도쿄 비DST를 정확히 UTC로 변환',()=>{
  assert.equal(L.zonedMinutesToISOString('2026-01-15',12*60,'Europe/Madrid'),'2026-01-15T11:00:00Z');
  assert.equal(L.zonedMinutesToISOString('2026-07-15',12*60,'Europe/Madrid'),'2026-07-15T10:00:00Z');
  assert.equal(L.zonedMinutesToISOString('2026-01-15',12*60,'Asia/Tokyo'),'2026-01-15T03:00:00Z');
  assert.equal(L.zonedMinutesToISOString('2026-07-15',12*60,'Asia/Tokyo'),'2026-07-15T03:00:00Z');
});

test('IANA 시간대 — DST gap·자정 넘김·서로 다른 시간대',()=>{
  assert.equal(L.zonedMinutesToISOString('2026-03-29',150,'Europe/Madrid'),null); // 02:30은 존재하지 않음
  assert.equal(L.zonedMinutesToISOString('2026-01-01',25*60,'Asia/Tokyo'),'2026-01-01T16:00:00Z');
  const madrid=L.zonedMinutesToISOString('2026-07-15',9*60,'Europe/Madrid');
  const tokyo=L.zonedMinutesToISOString('2026-07-15',9*60,'Asia/Tokyo');
  assert.notEqual(madrid,tokyo);
  assert.equal(L.validTimeZone('Mars/Olympus'),false);
});

test('normalizeTrip — IANA 시간대 보존과 기존 무시간대 호환',()=>{
  const valid=L.normalizeTrip({timeZone:'Europe/Madrid',days:[{timeZone:'Asia/Tokyo',spots:[]}]});
  assert.equal(valid.timeZone,'Europe/Madrid');
  assert.equal(valid.days[0].timeZone,'Asia/Tokyo');
  const legacy=L.normalizeTrip({days:[{spots:[]}]});
  assert.equal(legacy.timeZone,undefined);
  const invalid=L.normalizeTrip({timeZone:'Mars/Olympus',days:[{timeZone:'Bad/Zone',spots:[]}]});
  assert.equal(invalid.timeZone,undefined);
  assert.equal(invalid.days[0].timeZone,undefined);
});

test('parseDirect — 여행/일자/장소/옵션/숙소/좌표', () => {
  const r = L.parseDirect(`여행이름: 경주 1박2일
시작일: 2026-08-01

[Day 1] 도착
이동: 🚄 서울 → 경주
메모: 오후 도착
- 경주역 | 경주 | KTX | 35.7965,129.1349
- (선택) 감포 바다 | 경주
- (숙소) 힐튼 경주 | 경주

# 둘째날
- 불국사 | 경주 | 유네스코`);
  assert.equal(r.name, '경주 1박2일');
  assert.equal(r.start, '2026-08-01');
  assert.equal(r.days.length, 2);
  assert.equal(r.days[0].title, '도착');
  assert.equal(r.days[0].drive, '🚄 서울 → 경주');
  assert.equal(r.days[0].note, '오후 도착');
  assert.equal(r.days[0].spots.length, 3);
  assert.deepEqual([r.days[0].spots[0].lat, r.days[0].spots[0].lng], [35.7965,129.1349]);
  assert.equal(r.days[0].spots[1].opt, true);
  assert.equal(r.days[0].spots[2].stay, true);
  assert.equal(r.days[1].title, '둘째날');          // # 헤더
  assert.equal(r.days[1].spots[0].city, '경주');
  // 도시 미기입 시 직전 도시(lastCity) 상속
  const r2=L.parseDirect('- A | 부산\n- B');
  assert.equal(r2.days[0].spots[1].city, '부산');
});

test('parseMoney — 통화 기호·접미사 (유로 포함)', () => {
  assert.deepEqual(L.parseMoney('입장료 €80'), {cost:80,cur:'EUR',raw:'€80'});
  assert.deepEqual(L.parseMoney('120,000 유로'), {cost:120000,cur:'EUR',raw:'120,000 유로'});
  assert.equal(L.parseMoney('$50').cur, 'USD');
  assert.equal(L.parseMoney('5000엔').cur, 'JPY');
  assert.equal(L.parseMoney('元300').cur, 'CNY');
  assert.equal(L.parseMoney('20000원').cur, 'KRW');
  assert.equal(L.parseMoney('메모만 있음'), null);
  // 유로 금액이 붙은 장소 줄이 직접 형식에서 EUR로 파싱되는지
  const t=L.parseDirect('[Day 1]\n- 알카사르 | 세비야 | 입장 €14.5');
  assert.equal(t.days[0].spots[0].cost, 14);
  assert.equal(t.days[0].spots[0].cur, 'EUR');
});

test('normalizeTrip — EUR 통화 유지, 알 수 없는 통화는 제거', () => {
  const ok=L.normalizeTrip({days:[{spots:[{name:'A',cost:80,cur:'EUR'}]}]});
  assert.equal(ok.days[0].spots[0].cur, 'EUR');
  const bad=L.normalizeTrip({days:[{spots:[{name:'A',cost:80,cur:'GBP'}]}]});
  assert.equal('cur' in bad.days[0].spots[0], false);
});

test('dayAnchor — 숙소 우선·마지막 숙소·폴백·빈날', () => {
  // 1. 숙소가 마지막 항목인 날 → 숙소
  assert.equal(L.dayAnchor({spots:[{lat:1,lng:1},{lat:2,lng:2,stay:true,name:'h'}]}).name, 'h');
  // 2. 숙소 뒤에 저녁 일정이 있어도 숙소를 앵커로
  assert.equal(L.dayAnchor({spots:[{lat:1,lng:1,stay:true,name:'hotel'},{lat:3,lng:3,name:'dinner'}]}).name, 'hotel');
  // 3. 숙소가 여러 개면 마지막 숙소
  assert.equal(L.dayAnchor({spots:[{lat:1,lng:1,stay:true,name:'h1'},{lat:2,lng:2},{lat:5,lng:5,stay:true,name:'h2'}]}).name, 'h2');
  // 4. 숙소 없는 날 → 마지막 위치 장소
  assert.equal(L.dayAnchor({spots:[{lat:1,lng:1},{lat:9,lng:9,name:'last'}]}).name, 'last');
  // 5. 빈 일자·좌표 없는 장소만 → null (앱은 이 경우 이전 유효 기준점을 유지)
  assert.equal(L.dayAnchor({spots:[]}), null);
  assert.equal(L.dayAnchor({spots:[{name:'noloc'}]}), null);
  assert.equal(L.dayAnchor({}), null);
});

test('computeTimeline — 숙소→첫 장소 이동시간·고정시각 충돌·좌표없는 첫 장소', () => {
  const anchor={lat:2,lng:2,stay:true};
  const leg40={legMin:()=>40};   // 모든 구간 40분(결정적)
  // 6. 전날 숙소 → 첫 장소 이동시간 반영: 09:00 출발 + 40분 = 09:40
  const t6=L.computeTimeline({startAt:'09:00',spots:[{lat:1,lng:1}]},{legMin:()=>40,startAnchor:anchor});
  assert.equal(t6[0].eta, L.parseHM('09:40'));
  // startAnchor 없으면 이동시간 안 더함 → 첫 장소 = 시작시각
  const t6b=L.computeTimeline({startAt:'09:00',spots:[{lat:1,lng:1}]},leg40);
  assert.equal(t6b[0].eta, L.parseHM('09:00'));
  // 7. 첫 장소 고정 도착시각(09:20)이 자연 도착(09:40)보다 이르면 충돌
  const t7=L.computeTimeline({startAt:'09:00',spots:[{lat:1,lng:1,at:'09:20'}]},{legMin:()=>40,startAnchor:anchor});
  assert.equal(t7[0].fixed, true);
  assert.equal(t7[0].conflict, true);
  assert.equal(t7[0].eta, L.parseHM('09:20'));
  // 8. 좌표 없는 첫 장소는 이동 구간에서 제외 → 첫 '유효' 장소에 숙소 이동시간 반영
  const t8=L.computeTimeline({startAt:'09:00',spots:[{name:'noloc',stayMin:0},{lat:1,lng:1}]},{legMin:()=>40,startAnchor:anchor});
  assert.equal(t8[0].eta, L.parseHM('09:00'));   // 좌표없는 첫 장소: 이동 없음
  assert.equal(t8[1].eta, L.parseHM('09:40'));   // 첫 유효 장소: 숙소→여기 40분
});

test('anchor 단일 기준 — 지도·재생·타임라인 공용 (숙소 뒤 일정 있어도 숙소)', () => {
  // 완료조건: 숙소 뒤에 다른 일정이 있어도 다음날 연결선/재생/거리/ETA가 모두 숙소에서 시작
  const day={spots:[{lat:1,lng:1,name:'lunch'},{lat:2,lng:2,stay:true,name:'stay'},{lat:3,lng:3,name:'night'}]};
  const a=L.dayAnchor(day);
  assert.equal(a.name, 'stay');                          // 마지막 장소(night)가 아니라 숙소
  // 같은 anchor를 startAnchor로 넘기면 다음날 첫 장소 ETA도 숙소 기준
  const next=L.computeTimeline({startAt:'08:00',spots:[{lat:9,lng:9}]},{legMin:()=>30,startAnchor:a});
  assert.equal(next[0].eta, L.parseHM('08:30'));
});

test('dayStartAnchor — 이월 정책(previous/none)·빈 일자 건너뜀·첫날', () => {
  const stayDay={spots:[{lat:1,lng:1},{lat:2,lng:2,stay:true,name:'hotel'}]};
  const spotDay={spots:[{lat:3,lng:3,name:'A'}]};
  const empty={spots:[]};
  // 기본(정책 없음): 직전 일자의 dayAnchor(숙소)
  assert.equal(L.dayStartAnchor([stayDay, spotDay], 1).name, 'hotel');
  // 'none' 정책: 이월 없음
  assert.equal(L.dayStartAnchor([stayDay, {spots:[{lat:3,lng:3}],startPolicy:'none'}], 1), null);
  // 첫날은 이월 대상 없음
  assert.equal(L.dayStartAnchor([stayDay, spotDay], 0), null);
  // 중간 빈 일자는 건너뛰고 그 이전 유효 일자 기준 유지
  assert.equal(L.dayStartAnchor([stayDay, empty, spotDay], 2).name, 'hotel');
  // 직전 유효 일자에 숙소가 없으면 마지막 위치 장소
  assert.equal(L.dayStartAnchor([spotDay, {spots:[{lat:9,lng:9}]}], 1).name, 'A');
});

test('연박(nights) — 한 번 등록한 숙소가 묵는 동안 계속 출발 기준', () => {
  // 세비야 4박: Day0 체크인, Day1~3은 관광만 (숙소 재등록 없음)
  const checkIn={spots:[{lat:1,lng:1,name:'도착'},{lat:2,lng:2,stay:true,nights:4,name:'세비야숙소'}]};
  const sight=(/**@type{string}*/n)=>({spots:[{lat:3,lng:3,name:n+'-1'},{lat:4,lng:4,name:n+'-2'}]});
  const days=[checkIn, sight('D1'), sight('D2'), sight('D3'), sight('D4')];
  // 4박 = 이후 4일 아침(Day1~4)이 모두 숙소에서 출발
  for(const di of [1,2,3,4]) assert.equal(L.dayStartAnchor(days,di).name, '세비야숙소', 'day'+di);
  // 5일째(체크아웃 다음날)는 더 이상 숙소가 아님 → 직전 일자 마지막 위치
  assert.equal(L.dayStartAnchor(days.concat([sight('D5')]),5).name, 'D4-2');
  // 미지정(nights 없음)은 1박 = 기존 동작 유지
  const one=[{spots:[{lat:2,lng:2,stay:true,name:'1박'}]}, sight('X'), sight('Y')];
  assert.equal(L.dayStartAnchor(one,1).name, '1박');
  assert.equal(L.dayStartAnchor(one,2).name, 'X-2');
  // 연박 중 새 숙소를 등록하면 그때부터 새 숙소가 기준 (가까운 날 우선)
  const moved=[checkIn, sight('D1'), {spots:[{lat:7,lng:7,stay:true,name:'새숙소'}]}, sight('D3')];
  assert.equal(L.dayStartAnchor(moved,3).name, '새숙소');
  // stayNights: 미지정·비정상 → 1, 상한 60
  assert.equal(L.stayNights({}), 1);
  assert.equal(L.stayNights({nights:'x'}), 1);
  assert.equal(L.stayNights({nights:0}), 1);
  assert.equal(L.stayNights({nights:4}), 4);
  assert.equal(L.stayNights({nights:999}), 60);
});

test('비숙소 전날 마지막 장소도 다음날 ETA에 반영 (anchor 배선 회귀 방지)', () => {
  const prevDay={spots:[{lat:1,lng:1,name:'A'},{lat:2,lng:2,name:'last'}]};   // 숙소 없음
  const today={startAt:'09:00', spots:[{lat:3,lng:3,name:'first'}]};
  const anchor=L.dayStartAnchor([prevDay, today], 1);
  assert.equal(anchor.name, 'last');                                          // 마지막 위치 장소(비숙소)
  // 앵커를 넘기면 숙소가 아니어도 이동시간이 첫 장소 ETA에 반영돼야 한다
  assert.equal(L.computeTimeline(today, {legMin:()=>20, startAnchor:anchor})[0].eta, L.parseHM('09:20'));
  // 앵커가 없으면(none 정책 등) 이동 미반영 → 시작시각 그대로
  assert.equal(L.computeTimeline(today, {legMin:()=>20})[0].eta, L.parseHM('09:00'));
});

test('normalizeTrip — 유입 데이터 검증·기본값·크래시 방어', () => {
  // 복구 불가 → null
  assert.equal(L.normalizeTrip(null), null);
  assert.equal(L.normalizeTrip('x'), null);
  assert.equal(L.normalizeTrip({}), null);
  assert.equal(L.normalizeTrip({days:[]}), null);
  // 정상: schemaVersion 부여·id 보존·누락 mode 기본값
  const ok=L.normalizeTrip({id:'abc',name:'여행',start:'2026-08-01',days:[{spots:[{name:'A',lat:35.8,lng:129.2,city:'경주'}]}]});
  assert.equal(ok.id,'abc'); assert.equal(ok.schemaVersion,2);
  assert.equal(ok.days[0].mode,'car'); assert.equal(ok.days[0].spots[0].lat,35.8);
  // 잘못된 좌표 → null
  const bad=L.normalizeTrip({days:[{spots:[{name:'X',lat:'zz',lng:999}]}]});
  assert.equal(bad.days[0].spots[0].lat,null); assert.equal(bad.days[0].spots[0].lng,null);
  // 알 수 없는 mode·통화·구간수단·정책·시각·값 → 제거/기본
  const cl=L.normalizeTrip({start:'nope',days:[{mode:'zzz',startPolicy:'weird',startAt:'25:99',spots:[{name:'Y',cur:'GBP',legMode:'rocket',at:'9:5',stayMin:'x',cost:-5}]}]});
  assert.equal(cl.start,'');                    // 잘못된 날짜 → ''
  assert.equal(cl.days[0].mode,'car');
  assert.equal('startPolicy' in cl.days[0], false);
  assert.equal('startAt' in cl.days[0], false);   // 25:99 거부
  const s=cl.days[0].spots[0];
  assert.equal('cur' in s,false); assert.equal('legMode' in s,false);
  assert.equal('at' in s,false); assert.equal('stayMin' in s,false);
  assert.equal(s.cost,0);                          // 음수 → 0
  // startPolicy:'none'·정상 시각·통화는 유지
  const keep=L.normalizeTrip({days:[{startPolicy:'none',startAt:'08:30',spots:[{name:'Z',cur:'USD',legMode:'flight',at:'14:00'}]}]});
  assert.equal(keep.days[0].startPolicy,'none'); assert.equal(keep.days[0].startAt,'08:30');
  assert.equal(keep.days[0].spots[0].cur,'USD'); assert.equal(keep.days[0].spots[0].legMode,'flight');
  // 쓰레기 day/spot 섞여도 크래시 없이
  const g=L.normalizeTrip({days:[null,'x',{spots:['bad',null,{name:'W',lat:1,lng:1}]}]});
  assert.equal(g.days.length,3); assert.equal(g.days[2].spots[2].name,'W');
});

test('validateTripPayload — 제한·위험 키·URL을 전체 거부하고 알 수 없는 필드는 보존',()=>{
  const base={name:'안전한 여행',futureField:{kept:true},days:[{spots:[{name:'A',lat:37.5,lng:127,bookUrl:'https://example.com/ticket'}]}]};
  const ok=L.validateTripPayload(base);
  assert.equal(ok.ok,true); assert.equal(ok.value.futureField.kept,true); assert.equal(ok.value.schemaVersion,2);
  assert.equal(L.validateTripPayload({...base,days:Array.from({length:L.TC_LIMITS.days+1},()=>({spots:[]}))}).ok,false);
  assert.equal(L.validateTripPayload({...base,days:[{spots:[{name:'A',lat:999,lng:127}]}]}).ok,false);
  assert.equal(L.validateTripPayload({...base,days:[{spots:[{name:'A',lat:null,lng:null,bookUrl:'javascript:alert(1)'}]}]}).ok,false);
  assert.equal(L.validateTripPayload({...base,schemaVersion:L.TC_SCHEMA+1}).ok,false);
  const dangerous=JSON.parse('{"days":[{"spots":[]}],"__proto__":{"polluted":true}}');
  assert.equal(L.validateTripPayload(dangerous).ok,false);
});

test('parseTripPayload/parseStorePayload — 크기와 모든 여행을 원자적으로 검증',()=>{
  const trip={id:'one',days:[{spots:[]}]};
  assert.equal(L.parseTripPayload(JSON.stringify(trip)).ok,true);
  assert.equal(L.parseTripPayload('x'.repeat(L.TC_LIMITS.jsonBytes+1)).ok,false);
  const good=L.parseStorePayload(JSON.stringify({activeId:'missing',trips:[trip]}));
  assert.equal(good.ok,true); assert.equal(good.value.activeId,'one');
  const bad=L.parseStorePayload(JSON.stringify({activeId:'one',trips:[trip,{days:[{spots:[{lat:0}]}]}]}));
  assert.equal(bad.ok,false);
});

test('normalizeBooking / normalizeTrip.bookings — 예약(가격 추적) 유입 방어', () => {
  // 정상: 기본값 채움 (type 기본 hotel, track 기본 on)
  const ok=L.normalizeBooking({id:'bk1', title:' Cap Rocat ', price:1350000.4, cur:'EUR', start:'2026-10-30', end:'2026-11-01', freeCancelUntil:'2026-10-20', cancelFee:100000});
  assert.equal(ok.type,'hotel'); assert.equal(ok.title,'Cap Rocat');
  assert.equal(ok.price,1350000); assert.equal(ok.cur,'EUR'); assert.equal(ok.track,true);
  assert.equal(ok.cancelFee,100000); assert.equal(ok.freeCancelUntil,'2026-10-20');
  // track:false는 유지
  assert.equal(L.normalizeBooking({id:'bk2', track:false}).track, false);
  // 조건 매칭 필드: 인원·객실 clamp, 객실명 trim, 조식 bool, ptoken/saved 검증
  const cond=L.normalizeBooking({id:'bk9', adults:12, rooms:0, roomName:'  Deluxe Double  ', breakfast:1, ptoken:'tok_ABC-123', saved:70000.6, refundable:false});
  assert.equal(cond.adults,8); assert.equal(cond.rooms,1);
  assert.equal(cond.roomName,'Deluxe Double'); assert.equal(cond.breakfast,true);
  assert.equal(cond.ptoken,'tok_ABC-123'); assert.equal(cond.saved,70001);
  assert.equal(cond.refundable,false);
  assert.equal('ptoken' in L.normalizeBooking({id:'bk9', ptoken:'bad token!'}), false);
  // 구버전 호환: refundable 미지정 + 무료취소 기한 있음 → refundable=true 유도
  assert.equal(L.normalizeBooking({id:'bk8', freeCancelUntil:'2026-10-20'}).refundable, true);
  assert.equal('refundable' in L.normalizeBooking({id:'bk7'}), false);   // 아무 정보 없으면 '모름' 유지
  // 스팟 placeId: 형식 밖이면 제거
  const sp=L.normalizeTrip({days:[{spots:[{name:'A',placeId:'ChIJd8BlQ2BZwokRAFUEcm_qrcA'},{name:'B',placeId:'<bad>'}]}]});
  assert.equal(sp.days[0].spots[0].placeId,'ChIJd8BlQ2BZwokRAFUEcm_qrcA');
  assert.equal('placeId' in sp.days[0].spots[1], false);
  // 불량 id(형식 밖 문자)는 항목째 버림 — inline onclick 인자로 쓰여 안전해야 함
  assert.equal(L.normalizeBooking({id:"a'b", price:1}), null);
  assert.equal(L.normalizeBooking({id:'', price:1}), null);
  assert.equal(L.normalizeBooking({price:1}), null);
  assert.equal(L.normalizeBooking('x'), null);
  // 알 수 없는 type·통화·잘못된 날짜·음수 수수료 → 기본/제거
  const bad=L.normalizeBooking({id:'bk3', type:'yacht', cur:'GBP', start:'10/30', freeCancelUntil:'soon', cancelFee:-5, price:'x'});
  assert.equal(bad.type,'hotel'); assert.equal('cur' in bad,false);
  assert.equal('start' in bad,false); assert.equal('freeCancelUntil' in bad,false);
  assert.equal(bad.cancelFee,0); assert.equal(bad.price,0);
  // normalizeTrip: 불량 항목만 걸러내고, 전부 불량이면 필드 생략. 스팟의 불량 bookingId도 제거
  const t=L.normalizeTrip({days:[{spots:[{name:'A',bookingId:'bk1'},{name:'B',bookingId:'<x>'}]}],
    bookings:[{id:'bk1',price:1000}, {id:'no way!'}, null]});
  assert.equal(t.bookings.length,1); assert.equal(t.bookings[0].id,'bk1');
  assert.equal(t.days[0].spots[0].bookingId,'bk1');
  assert.equal('bookingId' in t.days[0].spots[1],false);
  const none=L.normalizeTrip({days:[{spots:[]}], bookings:['x']});
  assert.equal('bookings' in none,false);
});
