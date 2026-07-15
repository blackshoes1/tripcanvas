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
