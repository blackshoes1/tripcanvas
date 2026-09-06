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

test('normHM — 사람이 친 시각 입력을 HH:MM으로', () => {
  assert.equal(L.normHM('9:5'), '09:05');      // 한 자리 분도 받는다
  assert.equal(L.normHM('930'), '09:30');      // 숫자만 3자리
  assert.equal(L.normHM('1830'), '18:30');     // 숫자만 4자리
  assert.equal(L.normHM('7'), '07:00');        // 시만
  assert.equal(L.normHM(''), '');              // 미지정
  assert.equal(L.normHM('25:00'), '');         // 범위 밖은 미지정으로
  assert.equal(L.normHM('12:75'), '');
  assert.equal(L.normHM(undefined), '');
});

test('sortDayByTime — 고정 시각은 제자리로, 자동 시각은 직전 고정에 묶여 순서 유지', () => {
  const day = { startAt:'09:00', spots:[
    {name:'A'}, {name:'B'}, {name:'C', at:'08:00'}, {name:'D'}
  ]};
  assert.equal(L.sortDayByTime(day), true);
  // C(08:00)가 앞으로, D는 C에 묶여 따라온다. A·B는 09:00 기준으로 원래 순서 유지
  assert.deepEqual(day.spots.map(s=>s.name), ['C','D','A','B']);

  // 이미 시간순이면 순서가 바뀌지 않고 false
  const sorted = { startAt:'09:00', spots:[{name:'A', at:'09:00'},{name:'B', at:'11:00'}] };
  assert.equal(L.sortDayByTime(sorted), false);
  assert.deepEqual(sorted.spots.map(s=>s.name), ['A','B']);

  // 같은 기준 시각이면 원래 순서 유지 (안정 정렬)
  const tie = { startAt:'09:00', spots:[{name:'A', at:'10:00'},{name:'B', at:'10:00'}] };
  assert.equal(L.sortDayByTime(tie), false);
  assert.deepEqual(tie.spots.map(s=>s.name), ['A','B']);
});

test('classifySearchErr — 실패를 원인별로 가른다 (재시도할 일 vs 관리자 일)', () => {
  assert.equal(L.classifySearchErr(new Error('Failed to fetch')), 'network');
  assert.equal(L.classifySearchErr(new Error('The request timeout')), 'network');
  assert.equal(L.classifySearchErr(new Error('OVER_QUERY_LIMIT')), 'quota');
  assert.equal(L.classifySearchErr({ code: 'RESOURCE_EXHAUSTED' }), 'quota');
  assert.equal(L.classifySearchErr(new Error('This IP, site or mobile application is not authorized')), 'auth');
  assert.equal(L.classifySearchErr(new Error('RefererNotAllowedMapError')), 'auth');
  assert.equal(L.classifySearchErr(new Error('무슨 일인지 모를 오류')), 'error');
  assert.equal(L.classifySearchErr(null), 'error');
});

test('isKoreanSearch — 앵커가 있으면 좌표로, 없으면 질의 문자로 가른다', () => {
  assert.equal(L.isKoreanSearch('gyeongju', { lat: 35.8, lng: 129.2 }), true);   // 앵커가 국내면 질의 언어와 무관
  assert.equal(L.isKoreanSearch('성산일출봉', { lat: 41.9, lng: 12.5 }), false); // 앵커가 해외면 한글이어도 구글
  assert.equal(L.isKoreanSearch('성산일출봉', null), true);                       // 앵커 없으면 한글 여부로
  assert.equal(L.isKoreanSearch('Sagrada Familia'), false);
  assert.equal(L.isKoreanSearch(''), false);
});

test('cityFromKoreanAddr — 광역시는 그 자체, 도는 시·군까지', () => {
  assert.equal(L.cityFromKoreanAddr('서울특별시 중구 세종대로 110'), '서울');
  assert.equal(L.cityFromKoreanAddr('제주특별자치도 서귀포시 성산읍'), '서귀포');
  assert.equal(L.cityFromKoreanAddr('경상북도 경주시 노동동'), '경주');
  assert.equal(L.cityFromKoreanAddr('서울'), '');        // 토큰이 하나뿐이면 판단 보류
  assert.equal(L.cityFromKoreanAddr(''), '');
});

test('placeName — displayName이 문자열이든 객체든 비어도 이름을 만든다', () => {
  assert.equal(L.placeName({ displayName: 'Sagrada Família' }), 'Sagrada Família');
  assert.equal(L.placeName({ displayName: { text: 'Park Güell' } }), 'Park Güell');
  // 이름이 비면 주소 앞부분으로 폴백 — 이름 없는 결과가 조용히 빈칸으로 들어가지 않게
  assert.equal(L.placeName({ displayName: '', formattedAddress: 'Carrer de Mallorca, 401, Barcelona' }),
    'Carrer de Mallorca');
  assert.equal(L.placeName({}), '');
  assert.equal(L.placeName(null), '');
});

test('cityFromGoogle — locality 우선, 도쿄 특별구는 도쿄로 묶는다', () => {
  const comp = (types, longText) => ({ types, longText });
  assert.equal(L.cityFromGoogle([comp(['locality'], 'Barcelona')]), 'Barcelona');
  assert.equal(L.cityFromGoogle([
    comp(['locality'], 'Minato City'), comp(['administrative_area_level_1'], 'Tokyo')
  ]), 'Tokyo');
  // locality가 없으면 상위 행정구역으로 폴백
  assert.equal(L.cityFromGoogle([comp(['administrative_area_level_2'], 'Girona')]), 'Girona');
  assert.equal(L.cityFromGoogle([]), '');
  assert.equal(L.cityFromGoogle(null), '');
});

test('normHours — 구글 영업시간을 분 단위로, 상시영업은 d:-1', () => {
  assert.deepEqual(L.normHours({ periods: [
    { open: { day: 1, hour: 9, minute: 30 }, close: { day: 1, hour: 18, minute: 0 } }
  ] }), [{ d: 1, o: 570, c: 1080 }]);
  // close가 없으면 24시간 영업
  assert.deepEqual(L.normHours({ periods: [{ open: { day: 0, hour: 0, minute: 0 } }] }), [{ d: -1, o: 0, c: 1440 }]);
  assert.equal(L.normHours({ periods: [] }), null);
  assert.equal(L.normHours(null), null);
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

test('normalizeDraftDays — 자유로운 초안을 여행 스키마로 눕힌다', () => {
  // AI 응답은 필드가 빠지거나 엉뚱한 값이 오기 쉽다. 통째로 거절하면 초안 하나가
  // 필드 하나 때문에 버려지므로, 아는 값만 남기고 나머지는 기본값으로 눕힌다.
  const r = L.normalizeDraftDays([{
    title:'도착', mode:'순간이동', startAt:'9시',
    spots:[
      {name:' 경주역 ', city:' 경주 ', mode:'x', at:'10:30', bookAt:'없음', stayMin:'90', cost:'12000', cur:'GBP', lat:'35.79', lng:'129.13'},
      {name:'', city:'경주'},                                   // 이름 없는 장소는 버린다
      {name:'감포', opt:1, stay:'y', legMode:'train', stayMin:-5, cost:null}
    ]
  }, null]);
  assert.equal(r.length, 2);
  assert.equal(r[0].mode, 'car');            // 알 수 없는 수단 → 기본값
  assert.equal(r[0].startAt, '09:00');       // 형식 아닌 시각 → 기본값
  assert.equal(r[0].spots.length, 2);        // 이름 없는 장소 제외
  const a = r[0].spots[0];
  assert.equal(a.name, '경주역');             // 앞뒤 공백 제거
  assert.equal(a.city, '경주');
  assert.equal(a.at, '10:30');
  assert.equal(a.bookAt, '');                // 형식 아니면 빈 값
  assert.equal(a.stayMin, 90);               // 숫자 문자열도 받는다
  assert.equal(a.cost, 12000);
  assert.equal(a.cur, undefined);            // 모르는 통화는 떨군다(KRW 취급)
  assert.deepEqual([a.lat, a.lng], [35.79, 129.13]);
  const b = r[0].spots[1];
  assert.equal(b.opt, true);                 // 참 같은 값 → boolean
  assert.equal(b.stay, true);
  assert.equal(b.legMode, 'train');
  assert.equal(b.stayMin, null);             // 음수는 없는 것으로
  assert.equal(b.city, '기타');               // 도시 없으면 기본값
  assert.equal(b.lat, null);                 // 좌표 없음은 null (0으로 둔갑 금지)
  // 빈 일자도 모양은 갖춘다
  assert.deepEqual(r[1].spots, []);
  assert.equal(r[1].mode, 'car');
  assert.deepEqual(L.normalizeDraftDays(null), []);
  assert.deepEqual(L.normalizeDraftDays('nope'), []);
});

test('normalizeDraftDays 결과는 validateTripPayload를 통과한다', () => {
  // 눕히는 목적이 바로 이것 — 자유 입력이 검증에서 통째로 거절되지 않게
  const days = L.normalizeDraftDays([{ title:'x', spots:[{name:'A', lat:'33.5', lng:'126.5'}] }]);
  const r = L.validateTripPayload({ name:'초안', start:'2026-08-01', days });
  assert.equal(r.ok, true);
  assert.equal(r.value.days[0].spots[0].name, 'A');
});

test('extractJson — 인사말·코드펜스가 붙어도 JSON만 떼어낸다', () => {
  assert.equal(L.extractJson('네, 정리했습니다!\n```json\n{"a":1}\n```'), '{"a":1}');
  assert.equal(L.extractJson('{"a":1}'), '{"a":1}');
  assert.equal(L.extractJson('  {"a":{"b":2}} 뒤에 말 '), '{"a":{"b":2}}');
  // 중괄호가 없으면 원문 그대로 — 호출측이 JSON.parse 실패로 다룬다
  assert.equal(L.extractJson('중괄호 없음'), '중괄호 없음');
  assert.equal(L.extractJson(''), '');
  assert.equal(L.extractJson(undefined), '');
});

test('extMapLink — 국내는 카카오맵, 해외는 구글', () => {
  // 한국에서는 카카오맵만 실제 내비가 된다
  const kr = L.extMapLink({ name: '제주공항', lat: 33.5104, lng: 126.4914 });
  assert.ok(kr.href.startsWith('https://map.kakao.com/link/search/'));
  assert.match(kr.label, /카카오맵/);

  const jp = L.extMapLink({ name: 'Tokyo Tower', lat: 35.6586, lng: 139.7454 });
  assert.ok(jp.href.startsWith('https://www.google.com/maps/search/'));
  assert.match(jp.label, /Google/);

  // 이름은 URL 인코딩된다 — 공백·특수문자가 링크를 깨뜨리지 않게
  const enc = L.extMapLink({ name: '카페 & 로스터리', lat: 37.5, lng: 127.0 });
  assert.ok(!enc.href.includes(' '));
  assert.ok(enc.href.includes(encodeURIComponent('카페 & 로스터리')));

  // 문자열 좌표도 받는다 (유입 데이터) — 국내 판정만 좌표로 한다
  const str = L.extMapLink({ name: 'x', lat: '33.5', lng: '126.5' });
  assert.ok(str.href.startsWith('https://map.kakao.com/link/search/'));
});

test('extMapLink — 좌표가 아니라 이름으로 찾는다 (어긋난 좌표가 엉뚱한 곳을 열지 않게)', () => {
  // 좌표는 어느 지도를 열지만 정하고, 질의에는 들어가지 않는다
  const jp = L.extMapLink({ name: 'Tokyo Tower', city: '도쿄', lat: 35.6586, lng: 139.7454 });
  assert.ok(!jp.href.includes('35.6586'));
  assert.ok(!jp.href.includes('139.7454'));
  assert.ok(jp.href.includes(encodeURIComponent('도쿄 Tokyo Tower')));

  // 같은 상호가 여러 도시에 있으므로 도시를 앞에 붙인다
  const kr = L.extMapLink({ name: '스타벅스', city: '부산', lat: 35.1, lng: 129.0 });
  assert.ok(kr.href.endsWith(encodeURIComponent('부산 스타벅스')));

  // 이름에 이미 도시가 들어 있으면 두 번 붙이지 않는다
  const dup = L.extMapLink({ name: '부산역', city: '부산', lat: 35.115, lng: 129.04 });
  assert.ok(dup.href.endsWith(encodeURIComponent('부산역')));

  // 기본값 '기타'는 질의를 좁히지 못하므로 붙이지 않는다
  const etc = L.extMapLink({ name: '해운대해수욕장', city: '기타', lat: 35.158, lng: 129.16 });
  assert.ok(etc.href.endsWith(encodeURIComponent('해운대해수욕장')));

  // 이름이 없을 때만 좌표로 찍는다 — 그때는 그것 말고 아는 것이 없다
  const noName = L.extMapLink({ name: '', lat: 33.5, lng: 126.5 });
  assert.ok(noName.href.includes('33.5,126.5'));
  const noNameJp = L.extMapLink({ name: '', lat: 35.6, lng: 139.7 });
  assert.ok(noNameJp.href.includes('35.6,139.7'));
});

test('budgetBookings — 연결된 숙박은 일정 카드 금액이 기준 (이중 계산 방지)', () => {
  const bookings = [
    { id: 'b1', type: 'hotel', title: '제주호텔', price: 200000 },
    { id: 'b2', type: 'car', title: '렌터카', price: 90000 }
  ];
  // 숙소 장소에 비용을 적고 예약과 연결했다 → 그 예약은 예산에서 뺀다(장소 금액이 기준)
  const linkedWithCost = [{ spots: [
    { name: '제주호텔', stay: true, bookingId: 'b1', cost: 200000 }
  ] }];
  assert.deepEqual(L.budgetBookings(bookings, linkedWithCost).map(b => b.id), ['b2']);

  // 연결했지만 장소에 비용이 없으면 예약 금액을 쓴다 — 안 그러면 돈이 사라진다
  const linkedNoCost = [{ spots: [{ name: '제주호텔', stay: true, bookingId: 'b1' }] }];
  assert.deepEqual(L.budgetBookings(bookings, linkedNoCost).map(b => b.id), ['b1', 'b2']);

  // 비용이 0이면 '입력 안 함'과 같다
  const zeroCost = [{ spots: [{ name: '제주호텔', bookingId: 'b1', cost: 0 }] }];
  assert.deepEqual(L.budgetBookings(bookings, zeroCost).map(b => b.id), ['b1', 'b2']);

  // 연결이 없으면 일정에 대응하는 장소가 없다 → 그대로 센다
  const unlinked = [{ spots: [{ name: '어떤 숙소', stay: true, cost: 200000 }] }];
  assert.deepEqual(L.budgetBookings(bookings, unlinked).map(b => b.id), ['b1', 'b2']);

  // 렌터카·항공은 장소 연결(bookingId)이 없으므로 영향받지 않는다
  const carLinked = [{ spots: [{ name: '제주공항', carPickupId: 'b2', cost: 50000 }] }];
  assert.deepEqual(L.budgetBookings(bookings, carLinked).map(b => b.id), ['b1', 'b2']);

  // 방어: 이상한 입력
  assert.deepEqual(L.budgetBookings(null, null), []);
  assert.deepEqual(L.budgetBookings(bookings, [{ spots: null }, null]).map(b => b.id), ['b1', 'b2']);
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
  // 회귀: '위치 없음'(lat:null — normalizeSpot 자신의 출력)이 재정규화에서 (0,0)이 되면 안 된다
  // (+null=0이라 저장→재로드 시 위치 미지정 장소가 아프리카 앞바다 실좌표로 둔갑했다)
  const round=L.normalizeTrip(JSON.parse(JSON.stringify(
    L.normalizeTrip({days:[{spots:[{name:'위치미정'}]}]}))));
  assert.equal(round.days[0].spots[0].lat,null); assert.equal(round.days[0].spots[0].lng,null);
  const blank=L.normalizeTrip({days:[{spots:[{name:'B',lat:'',lng:' '},{name:'C',lat:true,lng:[]}]}]});
  assert.equal(blank.days[0].spots[0].lat,null); assert.equal(blank.days[0].spots[1].lat,null);
  // 숫자 문자열 좌표는 계속 인정
  const strNum=L.normalizeTrip({days:[{spots:[{name:'D',lat:'35.8',lng:'129.2'}]}]});
  assert.equal(strNum.days[0].spots[0].lat,35.8);
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

test('normalizeBooking — 시세 조회용 영문명(enName) 보존·검증', () => {
  const ok = L.normalizeTrip({ days:[{spots:[]}], bookings:[{ id:'bk1', title:'롯데호텔 서울', enName:'Lotte Hotel Seoul' }] });
  assert.equal(ok.bookings[0].enName, 'Lotte Hotel Seoul');
  const bad = L.normalizeTrip({ days:[{spots:[]}], bookings:[{ id:'bk2', title:'x', enName:{} }] });
  assert.equal('enName' in bad.bookings[0], false, '문자열 아니면 제거');
});

test('cityFromKakaoAddress — 광역시는 그 자체, 도는 시/군을 도시로', () => {
  assert.equal(L.cityFromKakaoAddress('서울 중구 을지로 12'), '서울');
  assert.equal(L.cityFromKakaoAddress('서울특별시 종로구 세종대로 175'), '서울');
  assert.equal(L.cityFromKakaoAddress('경기 성남시 분당구 판교역로 235'), '성남');
  assert.equal(L.cityFromKakaoAddress('제주특별자치도 제주시 첨단로 242'), '제주');
  assert.equal(L.cityFromKakaoAddress('강원특별자치도 춘천시 중앙로 1'), '춘천');
  assert.equal(L.cityFromKakaoAddress('충청북도 청주시 상당구'), '청주');
  assert.equal(L.cityFromKakaoAddress('전남 순천시 중앙로'), '순천');
  assert.equal(L.cityFromKakaoAddress('경북 울릉군 울릉읍'), '울릉');
  assert.equal(L.cityFromKakaoAddress(''), '');
  assert.equal(L.cityFromKakaoAddress(null), '');
});

test('장소 카테고리 — 검색 결과 분류(카카오/구글)', () => {
  assert.equal(L.catFromKakao('AD5'), 'stay');
  assert.equal(L.catFromKakao('CE7'), 'cafe');
  assert.equal(L.catFromKakao('FD6'), 'food');
  assert.equal(L.catFromKakao('SW8'), 'transport');
  assert.equal(L.catFromKakao('PK6'), null, '분류가 없는 코드는 추측하지 않는다');
  assert.equal(L.catFromKakao(undefined), null);

  assert.equal(L.catFromGoogle(['lodging','point_of_interest']), 'stay');
  assert.equal(L.catFromGoogle(['airport']), 'transport');
  assert.equal(L.catFromGoogle(['store','cafe']), 'cafe', '넓은 타입(store)은 분류에 안 쓴다');
  assert.equal(L.catFromGoogle(['store','restaurant'], 'store'), 'food', 'primaryType이 넓어도 구체적인 types가 살아난다');
  assert.equal(L.catFromGoogle(['store']), null, '그냥 store면 추측하지 않는다');
  assert.equal(L.catFromGoogle(['restaurant'], 'cafe'), 'cafe', 'primaryType이 있으면 그게 대표 성격');
  assert.equal(L.catFromGoogle(null, null), null);
});

test('장소 카테고리 — 이름 추론은 한/영 모두, 못 잡으면 null', () => {
  assert.equal(L.catFromName('Mediodía Hotel'), 'stay');
  assert.equal(L.catFromName('마드리드 바하라스 공항'), 'transport');
  assert.equal(L.catFromName('DABOV Specialty Coffee Spain'), 'cafe');
  assert.equal(L.catFromName('Restaurant Manique'), 'food');
  assert.equal(L.catFromName('세비야 대성당'), 'sight');
  assert.equal(L.catFromName('El Retiro Park'), 'nature');
  assert.equal(L.catFromName('트리아나 시장'), 'shop');
  assert.equal(L.catFromName('Riyadh Air Metropolitano Stadium'), 'activity');
  assert.equal(L.catFromName('Cháchara'), null, '모르면 추측하지 않는다');
  assert.equal(L.catFromName(''), null);
});

test('spotCatOf — 명시값 > 🏠 숙소 > 이름 추론 순', () => {
  assert.equal(L.spotCatOf({name:'아무데나', cat:'cafe'}).id, 'cafe');
  assert.equal(L.spotCatOf({name:'아무데나', stay:true}).id, 'stay', '🏠 체크만으로도 숙소 아이콘');
  assert.equal(L.spotCatOf({name:'Cap Rocat', stay:true, cat:'sight'}).id, 'sight', '명시값이 숙소 플래그를 이긴다');
  assert.equal(L.spotCatOf({name:'세비야 대성당'}).id, 'sight', '저장값이 없으면 이름으로 추론');
  assert.equal(L.spotCatOf({name:'Cháchara'}), null);
  assert.equal(L.spotCatOf(null), null);
  assert.equal(L.spotCatOf({name:'x', cat:'없는분류'}), null, '알 수 없는 분류는 무시');
  assert.ok(L.spotCatOf({name:'x', cat:'stay'}).icon, '아이콘·이름을 함께 준다');
});

test('normalizeSpot — 알 수 없는 카테고리는 버리고 유효한 값은 보존', () => {
  const t = L.normalizeTrip({days:[{spots:[
    {name:'a', lat:1, lng:1, cat:'cafe'},
    {name:'b', lat:1, lng:1, cat:'ninja'},
    {name:'c', lat:1, lng:1}
  ]}]});
  assert.equal(t.days[0].spots[0].cat, 'cafe');
  assert.equal('cat' in t.days[0].spots[1], false, '유입 데이터의 이상한 분류는 제거');
  assert.equal('cat' in t.days[0].spots[2], false);
});

test('dayReturnStay — 그날 숙소로 동선을 닫되, 이미 닫혔거나 숙소가 없으면 안 붙인다', () => {
  const P = (lat) => ({lat, lng:1});
  const tail = {title:'',spots:[Object.assign({name:'다음날'},P(7))]};   // 마지막 날에는 복귀가 없다 — 아래 별도 테스트

  // 그날 등록한 숙소가 중간에 있으면 그 숙소로 복귀
  const own = [{title:'',spots:[
    Object.assign({name:'공항'},P(1)),
    Object.assign({name:'호텔',stay:true},P(2)),
    Object.assign({name:'카페'},P(3))
  ]}, tail];
  assert.equal(L.dayReturnStay(own,0).name,'호텔');

  // 이미 숙소로 끝나면 덧붙이지 않는다
  const closed = [{title:'',spots:[
    Object.assign({name:'카페'},P(1)),
    Object.assign({name:'호텔',stay:true},P(2))
  ]}, tail];
  assert.equal(L.dayReturnStay(closed,0), null);

  // 연박 중이면 그날 숙소가 없어도 전날 숙소로 복귀
  const nights = [
    {title:'',spots:[Object.assign({name:'호텔',stay:true,nights:3},P(2))]},
    {title:'',spots:[Object.assign({name:'박물관'},P(5))]},
    tail
  ];
  assert.equal(L.dayReturnStay(nights,1).name,'호텔');

  // 숙소가 없는 날(출국일 등)엔 아무것도 안 붙인다
  const none = [{title:'',startPolicy:'none',spots:[Object.assign({name:'공항'},P(9))]}, tail];
  assert.equal(L.dayReturnStay(none,0), null);

  // 숙소가 여럿이면 마지막(=그날 실제로 묵는 곳)으로
  const moved = [{title:'',spots:[
    Object.assign({name:'전 호텔',stay:true},P(1)),
    Object.assign({name:'새 호텔',stay:true},P(2)),
    Object.assign({name:'야경'},P(3))
  ]}, tail];
  assert.equal(L.dayReturnStay(moved,0).name,'새 호텔');

  // 좌표 없는 장소만 있거나 빈 날
  assert.equal(L.dayReturnStay([{title:'',spots:[]}, tail],0), null);
  assert.equal(L.dayReturnStay([{title:'',spots:[{name:'좌표없음'}]}, tail],0), null);
  assert.equal(L.dayReturnStay(null,0), null);
});

test('dayReturnStay — 일정의 마지막 날에는 숙소 복귀를 붙이지 않는다 (떠나는 날이다)', () => {
  const P = (lat) => ({lat, lng:1});
  // 체크아웃하고 공항으로 가는 마지막 날. 예전에는 여기에 '🏠 호텔 복귀'가 따라붙어
  // 있지도 않은 이동이 하루 거리·시간·택시비에 얹혔다.
  const last = [
    {title:'',spots:[
      Object.assign({name:'호텔',stay:true,nights:2},P(2)),
      Object.assign({name:'야시장'},P(4))
    ]},
    {title:'',spots:[
      Object.assign({name:'호텔',stay:true},P(2)),
      Object.assign({name:'공항'},P(9))
    ]}
  ];
  assert.equal(L.dayReturnStay(last,1), null, '마지막 날은 돌아가지 않는다');
  assert.equal(L.dayReturnStay(last,0).name, '호텔', '마지막이 아닌 날은 그대로다');

  // 연박이 마지막 날까지 이어져도 마찬가지
  const carried = [
    {title:'',spots:[Object.assign({name:'호텔',stay:true,nights:3},P(2))]},
    {title:'',spots:[Object.assign({name:'박물관'},P(5))]},
    {title:'',spots:[Object.assign({name:'공항'},P(9))]}
  ];
  assert.equal(L.dayReturnStay(carried,2), null);
  assert.equal(L.dayReturnStay(carried,1).name, '호텔');

  // 하루짜리 일정도 그날이 마지막 날이다
  const oneDay = [{title:'',spots:[
    Object.assign({name:'호텔',stay:true},P(2)),
    Object.assign({name:'카페'},P(3))
  ]}];
  assert.equal(L.dayReturnStay(oneDay,0), null);
});

test('localMode — 비행기·기차는 근거리 구간(숙소 복귀)의 수단이 될 수 없다', () => {
  assert.equal(L.localMode('flight'), 'car', '그날 기본이 ✈️여도 호텔엔 날아가지 않는다');
  assert.equal(L.localMode('train'), 'car');
  assert.equal(L.localMode('transit'), 'transit');
  assert.equal(L.localMode('walk'), 'walk');
  assert.equal(L.localMode('taxi'), 'taxi');
  assert.equal(L.localMode(undefined), 'car');
});

test('carEventsOn — 렌터카 예약에서 그날의 픽업·반납을 파생한다', () => {
  const bk = [
    {id:'c1', type:'car', title:'Fiat 500 · RecordGo', start:'2026-09-01', end:'2026-09-05',
     carPickup:'Palma Airport', carPickupCode:'PMI', carPickupTime:'10:00', carReturnTime:'08:30'},
    {id:'h1', type:'hotel', title:'Cap Rocat', start:'2026-09-01', end:'2026-09-05'}
  ];
  const pick = L.carEventsOn(bk, '2026-09-01');
  assert.equal(pick.length, 1, '호텔 예약은 섞이지 않는다');
  assert.deepEqual(pick[0], {kind:'pickup', id:'c1', title:'Fiat 500 · RecordGo',
    place:'Palma Airport', code:'PMI', time:'10:00'});

  // 반납 장소·코드를 비우면 픽업과 같은 곳 (예약 화면·시세 조회와 같은 규칙)
  const ret = L.carEventsOn(bk, '2026-09-05');
  assert.equal(ret.length, 1);
  assert.equal(ret[0].kind, 'return');
  assert.equal(ret[0].place, 'Palma Airport');
  assert.equal(ret[0].code, 'PMI');
  assert.equal(ret[0].time, '08:30');

  // 사이에 낀 날엔 아무것도 붙지 않는다 (대여 중인 건 이벤트가 아니다)
  assert.deepEqual(L.carEventsOn(bk, '2026-09-03'), []);
});

test('carEventsOn — 반납 장소를 따로 넣으면 그걸 쓰고, 편도 반납 코드도 분리된다', () => {
  const bk = [{id:'c1', type:'car', title:'SUV', start:'2026-09-01', end:'2026-09-04',
    carPickup:'Palma Airport', carPickupCode:'PMI', carReturn:'Barcelona Airport', carReturnCode:'BCN'}];
  const ret = L.carEventsOn(bk, '2026-09-04')[0];
  assert.equal(ret.place, 'Barcelona Airport');
  assert.equal(ret.code, 'BCN');
});

test('carEventsOn — 당일 대여는 픽업·반납이 한 날에 시각 순으로 나온다', () => {
  const bk = [{id:'c1', type:'car', title:'경차', start:'2026-09-01', end:'2026-09-01',
    carPickup:'제주공항', carPickupTime:'09:00', carReturnTime:'19:00'}];
  const ev = L.carEventsOn(bk, '2026-09-01');
  assert.deepEqual(ev.map(e=>e.kind), ['pickup','return']);

  // 반납이 픽업보다 이른 시각이면 시각 순이 우선 (아침 반납 + 오후 다른 차 픽업)
  const two = [
    {id:'a', type:'car', title:'A', start:'2026-08-30', end:'2026-09-01', carPickup:'A공항', carReturnTime:'09:00'},
    {id:'b', type:'car', title:'B', start:'2026-09-01', end:'2026-09-03', carPickup:'B공항', carPickupTime:'14:00'}
  ];
  assert.deepEqual(L.carEventsOn(two,'2026-09-01').map(e=>[e.kind,e.id]), [['return','a'],['pickup','b']]);

  // 시각 미입력은 뒤로 — 시각을 아는 항목이 먼저 읽힌다
  const noTime = [
    {id:'a', type:'car', title:'A', start:'2026-09-01', end:'2026-09-02', carPickup:'A'},
    {id:'b', type:'car', title:'B', start:'2026-09-01', end:'2026-09-02', carPickup:'B', carPickupTime:'11:00'}
  ];
  assert.deepEqual(L.carEventsOn(noTime,'2026-09-01').map(e=>e.id), ['b','a']);
});

test('carEventsOn — 불량 입력 방어', () => {
  assert.deepEqual(L.carEventsOn(null,'2026-09-01'), []);
  assert.deepEqual(L.carEventsOn([{id:'c1',type:'car',start:'2026-09-01'}],'2026-9-1'), [], '날짜 형식이 아니면 빈 배열');
  assert.deepEqual(L.carEventsOn([null,undefined,'x',{type:'car'}],'2026-09-01'), [], '기간 없는 예약은 어느 날에도 걸리지 않는다');
});

test('carReturnPoint — 반납 지점은 (장소,코드) 한 쌍이라 반쪽만 물려받지 않는다', () => {
  const P = {carPickup:'제주공항', carPickupCode:'CJU'};

  // 둘 다 비면 픽업과 동일 (예약 화면의 "비우면 픽업과 동일")
  assert.deepEqual(L.carReturnPoint(Object.assign({}, P)), {place:'제주공항', code:'CJU'});
  assert.deepEqual(L.carReturnPoint(Object.assign({carReturn:'', carReturnCode:''}, P)), {place:'제주공항', code:'CJU'});

  // 장소만 넣었으면 픽업 공항코드를 빌려 쓰지 않는다 ("서귀포점 (CJU)" 방지)
  assert.deepEqual(L.carReturnPoint(Object.assign({carReturn:'서귀포점'}, P)), {place:'서귀포점', code:''});

  // 코드만 넣었으면 픽업 장소를 빌려 쓰지 않는다 ("제주공항 (BCN)" 방지)
  assert.deepEqual(L.carReturnPoint(Object.assign({carReturnCode:'BCN'}, P)), {place:'', code:'BCN'});

  // 둘 다 넣었으면 그대로
  assert.deepEqual(L.carReturnPoint(Object.assign({carReturn:'Barcelona Airport', carReturnCode:'BCN'}, P)),
    {place:'Barcelona Airport', code:'BCN'});

  assert.deepEqual(L.carReturnPoint(null), {place:'', code:''});
});

test('carEventsOn — 반납 이벤트는 carReturnPoint 규칙을 그대로 따른다', () => {
  const bk = [{id:'c1', type:'car', title:'경차', start:'2026-09-01', end:'2026-09-01',
    carPickup:'제주공항', carPickupCode:'CJU', carReturn:'서귀포점'}];
  const ret = L.carEventsOn(bk,'2026-09-01').find(e=>e.kind==='return');
  assert.equal(ret.place,'서귀포점');
  assert.equal(ret.code,'', '장소가 다른데 코드만 물려받으면 엉뚱한 곳이 된다');

  const codeOnly = [{id:'c2', type:'car', title:'SUV', start:'2026-09-01', end:'2026-09-04',
    carPickup:'Palma Airport', carPickupCode:'PMI', carReturnCode:'BCN'}];
  const r2 = L.carEventsOn(codeOnly,'2026-09-04')[0];
  assert.deepEqual([r2.place, r2.code], ['', 'BCN']);
});

test('carSpotLinks — 일정 장소에 붙은 픽업·반납 연결을 역참조한다', () => {
  const days = [
    {spots:[{name:'미술관'},{name:'호텔',stay:true}]},
    {spots:[{name:'공항',carPickupId:'c1'},{name:'대성당'},{name:'렌터카점',carReturnId:'c1'}]}
  ];
  const L1 = L.carSpotLinks(days);
  assert.deepEqual(L1.pickup.c1, {di:1,si:0});
  assert.deepEqual(L1['return'].c1, {di:1,si:2});
  assert.equal(L1.pickup.nope, undefined);

  // 같은 예약이 두 장소에 붙어 있으면(장소 복사 등) 처음 하나만
  const dup = [{spots:[{name:'A',carPickupId:'c1'},{name:'A 복사본',carPickupId:'c1'}]}];
  assert.deepEqual(L.carSpotLinks(dup).pickup.c1, {di:0,si:0});

  assert.deepEqual(L.carSpotLinks([]), {pickup:{}, 'return':{}});
  assert.deepEqual(L.carSpotLinks(null), {pickup:{}, 'return':{}});
  assert.deepEqual(L.carSpotLinks([{spots:[null,'x',{}]}]), {pickup:{}, 'return':{}});
});

test('normalizeTrip — 불량 픽업·반납 연결 id는 버린다 (유입 데이터 방어)', () => {
  const t = L.normalizeTrip({name:'T', days:[{spots:[
    {name:'A', carPickupId:'ok_id-1', carReturnId:'<script>'},
    {name:'B', carPickupId:{},        carReturnId:'also-ok'}
  ]}]});
  const [a,b] = t.days[0].spots;
  assert.equal(a.carPickupId, 'ok_id-1');
  assert.equal(a.carReturnId, undefined, 'uid 형식이 아니면 제거');
  assert.equal(b.carPickupId, undefined, '문자열이 아니면 제거');
  assert.equal(b.carReturnId, 'also-ok');
});

test('bookingShareOn — 여러 날 걸친 예약을 날수로 나눈 하루치', () => {
  const car = {id:'c1', type:'car', title:'Fiat', price:420000, start:'2026-09-02', end:'2026-09-05'};
  // 렌터카는 양끝 포함 4일 (9/2 받아서 9/5 반납 = 나흘 다 차가 있다)
  const d2 = L.bookingShareOn([car],'2026-09-02')[0];
  assert.equal(d2.days, 4);
  assert.equal(d2.amount, 105000);
  assert.equal(L.bookingShareOn([car],'2026-09-05')[0].amount, 105000, '반납일에도 배분');
  assert.deepEqual(L.bookingShareOn([car],'2026-09-06'), [], '기간 밖');
  assert.deepEqual(L.bookingShareOn([car],'2026-09-01'), []);

  // 숙박은 [체크인, 체크아웃) — 체크아웃 날엔 숙박비가 없다
  const hotel = {id:'h1', type:'hotel', title:'Cap Rocat', price:600000, start:'2026-09-01', end:'2026-09-04'};
  assert.equal(L.bookingShareOn([hotel],'2026-09-01')[0].days, 3, '3박');
  assert.equal(L.bookingShareOn([hotel],'2026-09-01')[0].amount, 200000);
  assert.equal(L.bookingShareOn([hotel],'2026-09-03').length, 1, '마지막 밤');
  assert.deepEqual(L.bookingShareOn([hotel],'2026-09-04'), [], '체크아웃 날은 숙박비 없음');
});

test('bookingShareOn — 하루치의 합이 예약 총액과 정확히 맞는다 (반올림 누수 없음)', () => {
  const b = {id:'x', type:'car', title:'C', price:100000, start:'2026-09-01', end:'2026-09-03'};   // 3일, 안 나눠떨어짐
  const days = ['2026-09-01','2026-09-02','2026-09-03'];
  const each = days.map(d=>L.bookingShareOn([b],d)[0].amount);
  assert.equal(each.reduce((a,x)=>a+x,0), 100000, `합이 총액과 같아야: ${each}`);
  assert.deepEqual(each, [33334,33333,33333], '나머지는 앞날부터 1원씩');
});

test('bookingShareOn — 기간·가격이 없으면 어느 날에도 배분하지 않는다', () => {
  assert.deepEqual(L.bookingShareOn([{id:'a',type:'car',price:1000,start:'2026-09-01'}],'2026-09-01'), [], '종료일 없음');
  assert.deepEqual(L.bookingShareOn([{id:'a',type:'car',start:'2026-09-01',end:'2026-09-02'}],'2026-09-01'), [], '가격 없음');
  assert.deepEqual(L.bookingShareOn([{id:'a',type:'hotel',price:1000,start:'2026-09-01',end:'2026-09-01'}],'2026-09-01'), [], '0박');
  assert.deepEqual(L.bookingShareOn([{id:'a',type:'car',price:1000,start:'2026-09-05',end:'2026-09-01'}],'2026-09-03'), [], '역순');
  assert.deepEqual(L.bookingShareOn(null,'2026-09-01'), []);
  assert.deepEqual(L.bookingShareOn([{id:'a',type:'car',price:1,start:'2026-09-01',end:'2026-09-01'}],'2026-9-1'), [], '날짜 형식');
});

test('sampleTrip — 저장소에 그대로 심어지므로 검증을 통과해야 한다', () => {
  const t = L.sampleTrip();
  assert.ok(L.validateTripPayload(t).ok, '유입 검증 통과');
  assert.ok(L.normalizeTrip(t), '정규화 통과');
  assert.ok(t.days.length > 0 && t.days.some(d => d.spots.length), '둘러볼 내용이 있어야');
  // 클라우드 제외가 이 id로 걸러진다 — 바뀌면 데모가 계정마다 하나씩 올라간다
  assert.equal(t.id, 'spain2026');
  assert.equal(t.sample, true);
});

test('sampleTrip — 부를 때마다 새 객체 (공유하면 한쪽 편집이 다른 쪽에 샌다)', () => {
  const a = L.sampleTrip(), b = L.sampleTrip();
  assert.notStrictEqual(a, b);
  assert.notStrictEqual(a.days, b.days);
  assert.notStrictEqual(a.days[0].spots[0], b.days[0].spots[0]);
  a.days[0].spots[0].name = '바뀐 이름';
  assert.notEqual(b.days[0].spots[0].name, '바뀐 이름');
});

test('normalizeSpot — 일정 실행 상태(status)·꼭 가야 함(must)은 알려진 값만 통과', () => {
  const ok = L.normalizeTrip({ days:[{spots:[
    { name:'A', status:'COMPLETED', must:true },
    { name:'B', status:'SKIPPED', must:false },
    { name:'C', status:'해킹', must:'yes' },
    { name:'D', status:'PLANNED' }
  ]}]});
  const s = ok.days[0].spots;
  assert.equal(s[0].status, 'COMPLETED');
  assert.equal(s[0].must, true);
  assert.equal(s[1].status, 'SKIPPED');
  assert.equal('must' in s[1], false, '기본값(false)은 저장하지 않는다 — 공유 링크 크기');
  assert.equal('status' in s[2], false, '알 수 없는 상태는 버리고 기본(PLANNED)으로 둔다');
  assert.equal(s[2].must, true, 'truthy 값은 true로 정규화');
  assert.equal('status' in s[3], false, '기본값 PLANNED는 저장하지 않는다');
});

// ── 함께 움직이지 않는 시간 (§25~§27) ────────────────────────────────────────
//
// 분리는 **타임라인의 예외**다. 그래서 여기서 가장 먼저 확인하는 것은 새 기능이 아니라
// "분리가 없을 때 예전과 완전히 같은가"다 — ETA·앵커·지도·재생이 전부 이 함수에 달려 있다.

const U1='11111111-1111-4111-8111-111111111111';
const U2='22222222-2222-4222-8222-222222222222';
const U3='33333333-3333-4333-8333-333333333333';

test('참여자·분리 정규화 — 아는 값만 남고 기본값은 저장하지 않는다', () => {
  const ok = L.normalizeTrip({ days:[{ spots:[
    { name:'A', who:[U1,U2,U1,'not-a-uuid',7] },
    { name:'B', who:[] },
    { name:'C', who:'혼자' },
    { name:'D', split:'s1', reunion:true },
    { name:'E', split:'나쁜 키!', reunion:false }
  ]}]});
  const s = ok.days[0].spots;
  assert.deepEqual(s[0].who, [U1,U2], '중복·불량 id는 버린다');
  assert.equal('who' in s[1], false, '빈 참여자는 모든 여행자 — 저장하지 않는다');
  assert.equal('who' in s[2], false, '배열이 아니면 버린다');
  assert.equal(s[3].split, 's1');
  assert.equal(s[3].reunion, true);
  assert.equal('split' in s[4], false, '불량 묶음 키는 버린다');
  assert.equal('reunion' in s[4], false, '기본값(false)은 저장하지 않는다');
});

test('참여자 상한 — 20명을 넘으면 자른다', () => {
  const many = Array.from({length:25}, (_,i)=> `${String(i).padStart(8,'0')}-1111-4111-8111-111111111111`);
  const ok = L.normalizeTrip({ days:[{ spots:[{ name:'A', who:many }] }] });
  assert.equal(ok.days[0].spots[0].who.length, 20);
});

test('whoKey — 순서가 달라도 같은 사람들이면 같은 가지, 비면 모두', () => {
  assert.equal(L.whoKey({who:[U1,U2]}), L.whoKey({who:[U2,U1]}));
  assert.equal(L.whoKey({}), '*');
  assert.equal(L.whoKey({who:[]}), '*');
  assert.notEqual(L.whoKey({who:[U1]}), L.whoKey({who:[U2]}));
});

test('computeTimeline — 분리가 없으면 예전 계산과 완전히 같다', () => {
  const day={ startAt:'09:00', spots:[
    { name:'A', lat:1, lng:1, stayMin:60 },
    { name:'B', lat:2, lng:2, stayMin:30 },
    { name:'C', lat:3, lng:3, at:'15:00' }
  ]};
  const tl=L.computeTimeline(day,{legMin:()=>40});
  // 09:00 → A는 직전 위치가 없어 이동 0 → 09:00 도착, 60분 체류 → 10:00 출발
  // B는 40분 이동 → 10:40 도착, 30분 체류 → 11:10 출발 → C는 40분 이동 → 11:50이지만 고정 15:00
  assert.deepEqual(tl.map(x=>x.eta), [540, 640, 900]);
  assert.equal(tl[2].fixed, true);
  assert.equal(tl[2].conflict, false, '고정 시각이 자연 도착보다 늦으면 충돌이 아니다');
  assert.equal(tl[2].natural, 710);
});

test('computeTimeline — 나란한 가지는 서로의 시간을 밀지 않는다', () => {
  const day={ startAt:'09:00', spots:[
    { name:'출발', lat:0, lng:0, stayMin:0 },
    { name:'캄프 누',   lat:1, lng:1, stayMin:120, split:'s1', who:[U1,U2] },
    { name:'쇼핑',      lat:2, lng:2, stayMin:90,  split:'s1', who:[U3] },
    { name:'다시 만나기', lat:3, lng:3, reunion:true }
  ]};
  const tl=L.computeTimeline(day,{legMin:()=>30});
  // 출발 09:00(이동 없음) → 09:00 끝. 두 가지 모두 09:00에서 30분 이동 → 둘 다 09:30 도착.
  assert.equal(tl[1].eta, 570, '첫 가지는 출발점에서 계산한다');
  assert.equal(tl[2].eta, 570, '둘째 가지도 **같은 출발점**에서 — 앞 가지 뒤에 줄서지 않는다');
  // 캄프 누는 09:30+120=11:30에 끝나고 쇼핑은 09:30+90=11:00에 끝난다 → 합류는 늦은 쪽 기준 11:30+30
  assert.equal(tl[3].eta, 720, '합류는 가장 늦게 끝나는 가지를 기다린다');
});

test('computeTimeline — 한 가지에 장소가 여럿이면 그 안에서는 순서대로 이어진다', () => {
  const day={ startAt:'09:00', spots:[
    { name:'경기장', lat:1, lng:1, stayMin:60, split:'s1', who:[U1] },
    { name:'맥주',   lat:2, lng:2, stayMin:60, split:'s1', who:[U1] },
    { name:'미술관', lat:3, lng:3, stayMin:30, split:'s1', who:[U2] }
  ]};
  const tl=L.computeTimeline(day,{legMin:()=>30});
  assert.equal(tl[0].eta, 540, '가지의 첫 장소는 이동 없이 09:00');
  assert.equal(tl[1].eta, 630, '같은 가지의 다음 장소는 앞 장소 뒤에 이어진다 (09:00+60+30)');
  assert.equal(tl[2].eta, 540, '다른 가지는 다시 출발점에서');
});

test('computeTimeline — 분리 묶음이 끝나면 다시 한 줄로 이어진다', () => {
  const day={ startAt:'09:00', spots:[
    { name:'A', lat:1, lng:1, stayMin:60, split:'s1', who:[U1] },
    { name:'B', lat:2, lng:2, stayMin:30, split:'s1', who:[U2] },
    { name:'C', lat:3, lng:3, stayMin:60 },
    { name:'D', lat:4, lng:4, stayMin:60 }
  ]};
  const tl=L.computeTimeline(day,{legMin:()=>30});
  assert.equal(tl[2].eta, 630, '묶음 뒤는 늦은 가지(09:00+60) + 이동 30');
  assert.equal(tl[3].eta, 720, '그 뒤로는 평소처럼 순차');
});

test('splitSegments — 화면과 타임라인이 같은 규칙으로 가른다', () => {
  const day={ spots:[
    { name:'A' },
    { name:'B', split:'s1', who:[U1] },
    { name:'C', split:'s1', who:[U2] },
    { name:'D', split:'s1', who:[U1] },
    { name:'E' }
  ]};
  const segs=L.splitSegments(day);
  assert.equal(segs.length, 3, '순차 · 분리 · 순차');
  assert.equal(segs[0].split, null);
  assert.equal(segs[1].split, 's1');
  assert.deepEqual([segs[1].from, segs[1].to], [1,4]);
  assert.equal(segs[1].branches.length, 2, '참여자가 같은 장소들이 한 가지');
  assert.deepEqual(segs[1].branches[0].idx, [1,3], '같은 가지 안에서는 원래 순서를 지킨다');
  assert.deepEqual(segs[1].branches[1].idx, [2]);
  assert.equal(segs[2].split, null);
});

test('splitSegments — 같은 키가 떨어져 있으면 각각 별개 묶음이다', () => {
  const day={ spots:[
    { name:'A', split:'s1', who:[U1] },
    { name:'B' },
    { name:'C', split:'s1', who:[U1] }
  ]};
  const segs=L.splitSegments(day);
  assert.equal(segs.length, 3);
  assert.deepEqual(segs.map(x=>x.split), ['s1', null, 's1']);
});
