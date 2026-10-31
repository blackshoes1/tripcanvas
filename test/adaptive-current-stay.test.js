'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const lib = require('../lib.js');
const adapt = require('../adaptive.js');

function state(nowMin, opts = {}, changes = {}) {
  const trip = { id: 'stay', start: '2026-10-31', days: [{ startAt: '09:00', spots: [
    { name: '카페', at: '09:00', stayMin: 60, lat: 40.4, lng: -3.7, ...changes },
    { name: '예약', bookAt: '15:00', stayMin: 60, lat: 40.5, lng: -3.7 }
  ] }] };
  return adapt.buildTripState(trip, { todayISO: '2026-10-31', nowMin,
    timeline: lib.computeTimeline(trip.days[0], { legMin: () => 30 }), ...opts });
}

test('예정 종료 뒤의 실제 머무름은 현재 장소로만 남고 다음 일정을 붙잡지 않는다', () => {
  const s = state(660, { arrivedActivityId: 'd0s0' });
  assert.equal(s.currentStay?.id, 'd0s0');
  assert.equal(s.arrivedActivityId, null);
  assert.equal(s.nextItem.id, 'd0s1');
  const focus = adapt.buildNowFocus(s, { legMin: () => 30 });
  assert.equal(focus.kind, 'CURRENT_STAY');
  assert.equal(focus.next.id, 'd0s1');
  assert.equal(focus.departure.leaveMin, 855); // 15:00 − 이동30 − 식당 준비15
  assert.equal(focus.switchMin, 843); // 출발 준비12분 전
});

test('현재 일정이 진행 중이어도 다음 장소의 이동과 준비 여유로 전환한다', () => {
  const s = state(843, { arrivedActivityId: 'd0s0' }, { stayMin: 360 });
  assert.equal(s.nextItem.id, 'd0s0', '기존 현재 일정 선택은 바꾸지 않는다');
  const focus = adapt.buildNowFocus(s, { legMin: () => 30 });
  assert.equal(focus.kind, 'DEPARTURE');
  assert.equal(focus.currentStay.id, 'd0s0');
  assert.equal(focus.next.id, 'd0s1');
});

test('실제 근거가 없으면 지난 장소를 추정하지 않고 중립적인 여유 시간으로 둔다', () => {
  const s = state(660);
  const focus = adapt.buildNowFocus(s, { legMin: () => 30 });
  assert.equal(focus.kind, 'FREE_TIME');
  assert.equal(focus.currentStay, null);
  assert.equal(focus.next.id, 'd0s1');
  assert.equal(adapt.buildNowFocus(state(600, {}, { stayMin: 120 }), { legMin: () => 30 }).kind, 'SCHEDULE');
});

test('밖으로 나온 실제 위치·종결 상태·다른 날은 현재 머무름을 되살리지 않는다', () => {
  assert.equal(state(660, { arrivedActivityId: 'd0s0', currentLocation: { lat: 41, lng: -3.7 } }).currentStay, null);
  for (const status of ['COMPLETED', 'SKIPPED', 'CANCELLED']) {
    assert.equal(state(660, { arrivedActivityId: 'd0s0' }, { status }).currentStay, null);
  }
  assert.equal(state(660, { arrivedActivityId: 'd0s0', todayISO: '2026-11-01' }).currentStay, null);
});

test('마지막 일정이 끝나면 과거 머무름 증거가 있어도 표시를 부활시키지 않는다', () => {
  const s = state(960, { arrivedActivityId: 'd0s0' });
  assert.equal(s.nextItem, null);
  assert.equal(adapt.buildNowFocus(s, { legMin: () => 30 }), null);
});

test('추정 시각만 있는 다음 장소는 출발 표시로 전환해도 늦음 경고를 만들지 않는다', () => {
  const s = state(660, { arrivedActivityId: 'd0s0' });
  const next = s.items[1];
  next.fixedAt = null; next.eta = 680; next.depart = 680; next.end = 740;
  const focus = adapt.buildNowFocus(s, { legMin: () => 30 });
  assert.equal(focus.kind, 'DEPARTURE');
  assert.equal(focus.departure.lateByMin, 0);
  assert.equal(focus.departure.stage, 'UPCOMING');
  assert.doesNotMatch(focus.departure.text, /늦|지연/);
  assert.match(focus.departure.text, /도착/);
});
