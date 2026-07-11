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
