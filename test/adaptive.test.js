// adaptive.js — Adaptive Travel OS 도메인 순수 로직 테스트.
// 핵심 안전장치: 고정 예약을 침범하지 않는다 / 불가능한 장소를 추천하지 않는다 /
// 완료·건너뛴 장소를 다시 권하지 않는다 / 같은 상태면 같은 결과를 낸다.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const TC = require('../lib.js');
const A = require('../adaptive.js');

// 2분/km — 좌표만 보고 이동시간을 예측할 수 있게 고정한 테스트용 이동 모델
const LEG = (a, b) => Math.round(TC.haversine({ lat: +a.lat, lng: +a.lng }, { lat: +b.lat, lng: +b.lng }) * 2);
const P = (lat) => ({ lat, lng: -3.70 });

/** 여행 하나 + 그날의 실제 타임라인으로 TripState를 만든다 (app.js가 하는 것과 같은 순서). */
function stateOf(trip, opts) {
  const o = Object.assign({ dayIndex: 0, legMin: LEG }, opts || {});
  const day = trip.days[o.dayIndex];
  const timeline = TC.computeTimeline(day, { legMin: o.legMin, startAnchor: o.startAnchor });
  return A.buildTripState(trip, Object.assign({ timeline }, o));
}
function tripOf(days, extra) {
  return Object.assign({ id: 't1', name: '테스트 여행', start: '2026-09-01', days }, extra || {});
}
// 2026-09-01은 화요일(getUTCDay()=2)
const TODAY = '2026-09-01';

test('currentDayIndex: 여행 시작일 기준으로 오늘이 몇 일차인지 — 기간 밖은 -1', () => {
  const t = tripOf([{ spots: [] }, { spots: [] }, { spots: [] }]);
  assert.equal(A.currentDayIndex(t, '2026-09-01'), 0);
  assert.equal(A.currentDayIndex(t, '2026-09-03'), 2);
  assert.equal(A.currentDayIndex(t, '2026-09-04'), -1);
  assert.equal(A.currentDayIndex(t, '2026-08-31'), -1);
  assert.equal(A.currentDayIndex(tripOf([{ spots: [] }], { start: '' }), '2026-09-01'), -1);
});

test('commitmentOf: 상대가 정한 시각·항공·기차는 FIXED, 내가 정한 시각·숙소는 SEMI_FIXED', () => {
  const day = { mode: 'car', spots: [] };
  assert.deepEqual(A.commitmentOf({ name: '공원' }, day, []), { type: 'OTHER', flexibility: 'FLEXIBLE', bookingId: null });
  assert.equal(A.commitmentOf({ name: '식당', bookAt: '19:30' }, day, []).flexibility, 'FIXED');
  assert.equal(A.commitmentOf({ name: '미술관', at: '10:00' }, day, []).flexibility, 'SEMI_FIXED');
  assert.equal(A.commitmentOf({ name: '호텔', stay: true }, day, []).type, 'HOTEL');
  assert.equal(A.commitmentOf({ name: '호텔', stay: true }, day, []).flexibility, 'SEMI_FIXED');
  assert.equal(A.commitmentOf({ name: '공항', legMode: 'flight' }, day, []).flexibility, 'FIXED');
  assert.equal(A.commitmentOf({ name: '역', legMode: 'train' }, day, []).type, 'TRAIN');
  const bk = [{ id: 'bk1', type: 'car' }];
  assert.equal(A.commitmentOf({ name: '렌터카', bookingId: 'bk1' }, day, bk).type, 'CAR');
});

test('priorityOf/planningModeHint: 보호 우선순위와 계획 성향 추정', () => {
  assert.equal(A.priorityOf({ must: true, opt: true }, 'FLEXIBLE'), 3);   // mustVisit이 (선택)보다 우선
  assert.equal(A.priorityOf({}, 'FIXED'), 3);
  assert.equal(A.priorityOf({ opt: true }, 'FLEXIBLE'), 1);
  assert.equal(A.priorityOf({}, 'FLEXIBLE'), 2);
  const full = tripOf([{ spots: [{}, {}] }, { spots: [{}, {}] }]);
  const partial = tripOf([{ spots: [{}, {}] }, { spots: [] }, { spots: [] }]);
  assert.equal(A.planningModeHint(full), 'MANUAL');
  assert.equal(A.planningModeHint(partial), 'ASSISTED');
  assert.equal(A.planningModeHint(tripOf([{ spots: [] }, { spots: [] }])), 'DELEGATED');
});

test('TripState: 현재/다음/고정 예약/남은 시간을 한 번에 계산한다', () => {
  const trip = tripOf([{
    startAt: '09:00', mode: 'walk', spots: [
      Object.assign({ name: '프라도', city: '마드리드', stayMin: 120 }, P(40.41)),
      Object.assign({ name: '저녁 예약', city: '마드리드', bookAt: '19:30', stayMin: 90 }, P(40.42))
    ]
  }]);
  const s = stateOf(trip, { todayISO: TODAY, nowMin: 11 * 60, live: true });
  assert.equal(s.currentDay, 0);
  assert.equal(s.live, true);
  assert.equal(s.items.length, 2);
  assert.equal(s.items[0].eta, 540);
  assert.equal(s.items[0].end, 660);
  assert.equal(s.items[1].flexibility, 'FIXED');
  assert.equal(s.fixedCommitments.length, 1);
  assert.equal(s.nextFixed.startMin, 19 * 60 + 30);
  assert.equal(s.availableMin, 19 * 60 + 30 - 11 * 60);
  assert.equal(s.remainingItems.length, 2);
  assert.equal(s.weekday, 2);
});

test('빈 시간 탐지: 고정 예약을 기다리는 시간만 창으로 잡고, 이동시간은 빈 시간이 아니다', () => {
  const trip = tripOf([{
    startAt: '09:00', mode: 'walk', spots: [
      Object.assign({ name: '프라도', city: '마드리드', stayMin: 120 }, P(40.41)),
      Object.assign({ name: '저녁 예약', city: '마드리드', bookAt: '19:30', stayMin: 90 }, P(40.42))
    ]
  }]);
  const wins = A.findFreeWindows(stateOf(trip, { todayISO: TODAY, nowMin: 11 * 60, live: true }));
  assert.equal(wins.length, 1);
  assert.equal(wins[0].startMin, 660);
  assert.equal(wins[0].beforeFixed, true);
  assert.ok(wins[0].minutes > 480 && wins[0].minutes < 510, '이동시간(2분)을 뺀 대기시간만 창이다');

  // 이동만 끼어 있는 일정은 빈 시간이 아니다 — 55km(=110분) 이동이 창으로 잡히면 안 된다
  const moving = tripOf([{
    startAt: '09:00', mode: 'car', spots: [
      Object.assign({ name: 'A', city: '마드리드', stayMin: 60 }, P(40.40)),
      Object.assign({ name: 'B', city: '마드리드', stayMin: 60 }, P(40.90))
    ]
  }]);
  const s2 = stateOf(moving, { todayISO: TODAY, nowMin: 9 * 60, live: true });
  assert.equal(A.findFreeWindows(s2).filter((w) => w.beforeId === 'd0s1').length, 0);
});

test('추천 제외: 이동시간 때문에 못 들어오는 장소는 후보에서 빠진다', () => {
  const trip = tripOf([
    {
      startAt: '09:00', mode: 'car', spots: [
        Object.assign({ name: '오전 일정', city: '마드리드', stayMin: 120 }, P(40.40)),
        Object.assign({ name: '점심 예약', city: '마드리드', bookAt: '12:30', stayMin: 60 }, P(40.405))
      ]
    },
    {
      spots: [
        Object.assign({ name: '가까운 공원', city: '마드리드', stayMin: 60 }, P(40.41)),
        Object.assign({ name: '먼 산', city: '마드리드', stayMin: 60 }, P(40.90))   // 편도 110분
      ]
    }
  ]);
  const s = stateOf(trip, { todayISO: TODAY, nowMin: 11 * 60, live: true });
  const win = A.findFreeWindows(s)[0];
  assert.ok(win && win.minutes >= 45, '11:00~12:30 사이가 빈 시간으로 잡힌다');
  const ranked = A.rankNextActions(s, A.buildCandidates(trip, s, { window: win }), { window: win, legMin: LEG });
  const names = ranked.map((r) => r.title);
  assert.ok(names.indexOf('가까운 공원') >= 0, '90분 창에 들어오는 곳은 후보로 남는다');
  assert.equal(names.indexOf('먼 산'), -1, '왕복 220분짜리는 추천하지 않는다');
});

test('추천 제외: 도착 시각에 문을 닫는 장소는 추천하지 않는다', () => {
  const trip = tripOf([
    { startAt: '09:00', mode: 'walk', spots: [Object.assign({ name: '숙소', city: '마드리드', stay: true, stayMin: 0 }, P(40.40))] },
    {
      spots: [
        Object.assign({ name: '야간 개장 미술관', city: '마드리드', stayMin: 60, hours: [{ d: 2, o: 600, c: 1320 }] }, P(40.405)),
        Object.assign({ name: '오전만 여는 시장', city: '마드리드', stayMin: 60, hours: [{ d: 2, o: 360, c: 720 }] }, P(40.405))
      ]
    }
  ]);
  const s = stateOf(trip, { todayISO: TODAY, nowMin: 17 * 60, live: true });
  const ranked = A.rankNextActions(s, A.buildCandidates(trip, s, {}), { legMin: LEG });
  const names = ranked.map((r) => r.title);
  assert.ok(names.indexOf('야간 개장 미술관') >= 0);
  assert.equal(names.indexOf('오전만 여는 시장'), -1, '17시에 이미 닫은 곳은 제외');
});

test('추천 제외: 완료·건너뛴 장소는 다시 권하지 않는다', () => {
  const trip = tripOf([{
    startAt: '09:00', mode: 'walk', spots: [
      Object.assign({ name: '다녀온 곳', city: '마드리드', stayMin: 60, status: 'COMPLETED' }, P(40.40)),
      Object.assign({ name: '건너뛴 곳', city: '마드리드', stayMin: 60, status: 'SKIPPED' }, P(40.405)),
      Object.assign({ name: '아직 안 간 곳', city: '마드리드', stayMin: 60 }, P(40.41))
    ]
  }]);
  const s = stateOf(trip, { todayISO: TODAY, nowMin: 11 * 60, live: true });
  assert.deepEqual(s.completedItems, ['d0s0']);
  assert.deepEqual(s.skippedItems, ['d0s1']);
  const titles = A.rankNextActions(s, A.buildCandidates(trip, s, {}), { legMin: LEG }).map((r) => r.title);
  assert.equal(titles.indexOf('다녀온 곳'), -1);
  assert.equal(titles.indexOf('건너뛴 곳'), -1);
  assert.ok(titles.indexOf('아직 안 간 곳') >= 0);
});

test('추천 우선순위: 조건이 같으면 mustVisit이 앞선다', () => {
  const trip = tripOf([
    { startAt: '09:00', mode: 'walk', spots: [Object.assign({ name: '숙소', city: '마드리드', stay: true, stayMin: 0 }, P(40.40))] },
    {
      spots: [
        Object.assign({ name: '그냥 가볼 곳', city: '마드리드', stayMin: 60 }, P(40.41)),
        Object.assign({ name: '꼭 갈 곳', city: '마드리드', stayMin: 60, must: true }, P(40.41))
      ]
    }
  ]);
  const s = stateOf(trip, { todayISO: TODAY, nowMin: 10 * 60, live: true });
  const ranked = A.rankNextActions(s, A.buildCandidates(trip, s, {}), { legMin: LEG });
  assert.equal(ranked[0].title, '꼭 갈 곳');
  assert.ok(ranked[0].reasons.some((r) => /꼭 가려고/.test(r)), '이유를 설명할 수 있어야 한다');
});

test('추천 안정성: 같은 상태에서는 같은 순서를 낸다', () => {
  const trip = tripOf([
    { startAt: '09:00', mode: 'walk', spots: [Object.assign({ name: '숙소', city: '마드리드', stay: true, stayMin: 0 }, P(40.40))] },
    {
      spots: [
        Object.assign({ name: 'A', city: '마드리드', stayMin: 60 }, P(40.41)),
        Object.assign({ name: 'B', city: '마드리드', stayMin: 60 }, P(40.42)),
        Object.assign({ name: 'C', city: '마드리드', stayMin: 90 }, P(40.43))
      ]
    }
  ]);
  const once = () => {
    const s = stateOf(trip, { todayISO: TODAY, nowMin: 10 * 60, live: true });
    return A.buildSuggestions(trip, s, { legMin: LEG }).suggestions.map((x) => x.id);
  };
  assert.deepEqual(once(), once());
});

test('재구성: 고정 예약을 침범하지 않고 우선순위 낮은 일정부터 뺀다', () => {
  const trip = tripOf([{
    startAt: '09:00', mode: 'car', spots: [
      Object.assign({ name: 'Museum', city: '마드리드', stayMin: 120 }, P(40.41)),
      Object.assign({ name: 'Cafe', city: '마드리드', stayMin: 60, opt: true }, P(40.44)),
      Object.assign({ name: 'Park', city: '마드리드', stayMin: 90, must: true }, P(40.47)),
      Object.assign({ name: 'Dinner', city: '마드리드', bookAt: '19:00', stayMin: 90 }, P(40.50))
    ]
  }]);
  const s = stateOf(trip, { todayISO: TODAY, nowMin: 16 * 60 + 30, live: true, currentLocation: P(40.40) });
  const plan = A.generateReplan(s, { legMin: LEG });
  assert.equal(plan.needed, true, '19:00 예약에 늦으므로 재구성이 필요하다');
  assert.ok(plan.lateBy > 0);
  assert.equal(plan.feasible, true);
  assert.equal(plan.drop.indexOf('d0s3'), -1, '고정 예약은 절대 빼지 않는다');
  assert.equal(plan.drop.indexOf('d0s2'), -1, 'mustVisit은 보호한다');
  assert.equal(plan.dropNames[0], 'Cafe', '(선택) 표시된 낮은 우선순위부터 뺀다');
  assert.ok(plan.keep.indexOf('d0s3') >= 0 && plan.keep.indexOf('d0s2') >= 0);
  assert.deepEqual(plan.impact.removedActivities, plan.dropNames);
});

test('재구성: 여유가 있으면 아무것도 바꾸지 않는다', () => {
  const trip = tripOf([{
    startAt: '09:00', mode: 'walk', spots: [
      Object.assign({ name: 'Museum', city: '마드리드', stayMin: 60 }, P(40.41)),
      Object.assign({ name: 'Dinner', city: '마드리드', bookAt: '19:00', stayMin: 90 }, P(40.42))
    ]
  }]);
  const plan = A.generateReplan(stateOf(trip, { todayISO: TODAY, nowMin: 10 * 60, live: true }), { legMin: LEG });
  assert.equal(plan.needed, false);
  assert.deepEqual(plan.drop, []);
});

test('완료 일정은 재구성에서 유지하고, 남은 일정만 다시 굴린다', () => {
  const trip = tripOf([{
    startAt: '09:00', mode: 'walk', spots: [
      Object.assign({ name: '완료한 곳', city: '마드리드', stayMin: 60, status: 'COMPLETED' }, P(40.40)),
      Object.assign({ name: '남은 곳', city: '마드리드', stayMin: 60 }, P(40.41))
    ]
  }]);
  const s = stateOf(trip, { todayISO: TODAY, nowMin: 11 * 60, live: true });
  const plan = A.generateReplan(s, { legMin: LEG });
  assert.equal(plan.before.indexOf('완료한 곳'), -1, '완료 일정은 재구성 대상이 아니다');
  assert.deepEqual(plan.before, ['남은 곳']);
});

test('제안: 한 번에 보여주는 수를 제한하고, 거절한 제안은 반복하지 않는다', () => {
  const many = [];
  for (let i = 0; i < 8; i++) many.push(Object.assign({ name: '장소' + i, city: '마드리드', stayMin: 30 }, P(40.40 + i * 0.005)));
  const trip = tripOf([
    { startAt: '09:00', mode: 'walk', spots: [Object.assign({ name: '숙소', city: '마드리드', stay: true, stayMin: 0 }, P(40.40))] },
    { spots: many }
  ]);
  const s = stateOf(trip, { todayISO: TODAY, nowMin: 10 * 60, live: true });
  const first = A.buildSuggestions(trip, s, { legMin: LEG });
  assert.ok(first.suggestions.length <= A.ADAPT_CFG.maxSuggest + 1, '검색 결과처럼 쏟아내지 않는다');
  assert.ok(first.suggestions.length >= 1);
  const dropped = first.suggestions[0].key;
  const second = A.buildSuggestions(trip, s, { legMin: LEG, dismissed: [dropped] });
  assert.equal(second.suggestions.filter((x) => x.key === dropped).length, 0, '거절한 제안은 다시 올라오지 않는다');
});

test('제안: 넣을 만한 장소가 없으면 억지로 만들지 않고 쉬는 선택지를 남긴다', () => {
  const trip = tripOf([{
    startAt: '09:00', mode: 'car', spots: [
      Object.assign({ name: '숙소', city: '마드리드', stay: true, stayMin: 0 }, P(40.40)),
      Object.assign({ name: '저녁 예약', city: '마드리드', bookAt: '19:00', stayMin: 90 }, P(40.41))
    ]
  }]);
  const s = stateOf(trip, { todayISO: TODAY, nowMin: 18 * 60 + 40, live: true, energyLevel: 'LOW' });
  const res = A.buildSuggestions(trip, s, { legMin: LEG });
  assert.ok(res.suggestions.length > 0);
  assert.ok(res.suggestions.every((x) => x.type !== 'NEXT_ACTIVITY' || /쉬기|숙소/.test(x.title)), '남은 20분에 관광지를 밀어넣지 않는다');
  assert.ok(res.suggestions.some((x) => x.type === 'REST'), '쉬기/숙소 복귀가 정상 선택지로 남는다');
});

test('제안: 가격 절약도 같은 제안 목록에 같은 형태로 들어온다', () => {
  const trip = tripOf([{ startAt: '09:00', spots: [Object.assign({ name: 'A', city: '마드리드', stayMin: 60 }, P(40.40))] }]);
  const s = stateOf(trip, { todayISO: TODAY, nowMin: 10 * 60, live: true });
  const res = A.buildSuggestions(trip, s, {
    legMin: LEG,
    priceSuggestions: [{ bookingId: 'bk1', title: '호텔 12만원 절약 가능', description: '동일 조건', reasons: ['취소 수수료 반영'], impact: { costChange: -120000 } }]
  });
  const px = res.suggestions.filter((x) => x.type === 'PRICE_SAVING')[0];
  assert.ok(px, '가격 제안이 일정 제안과 한 목록에 있다');
  assert.equal(px.action.kind, 'OPEN_BOOKING');
  assert.equal(px.impact.costChange, -120000);
});

test('추천 이유는 항상 사람이 읽을 문장으로 제공된다 (점수는 내부값)', () => {
  const trip = tripOf([
    { startAt: '09:00', mode: 'walk', spots: [Object.assign({ name: '숙소', city: '마드리드', stay: true, stayMin: 0 }, P(40.40))] },
    { spots: [Object.assign({ name: '공원', city: '마드리드', stayMin: 60 }, P(40.41))] }
  ]);
  const s = stateOf(trip, { todayISO: TODAY, nowMin: 10 * 60, live: true });
  const ranked = A.rankNextActions(s, A.buildCandidates(trip, s, {}), { legMin: LEG });
  ranked.forEach((r) => {
    assert.ok(Array.isArray(r.reasons) && r.reasons.length > 0, r.title + '의 추천 이유가 있다');
    assert.equal(typeof r.score, 'number');
  });
});

test('feedbackEntry: 추천 반응 기록 구조 (알 수 없는 값은 DISMISSED)', () => {
  const sug = { id: 'x|y', key: 'x|y', type: 'NEXT_ACTIVITY' };
  assert.equal(A.feedbackEntry(sug, 'ACCEPTED', '2026-09-01T10:00:00Z').action, 'ACCEPTED');
  assert.equal(A.feedbackEntry(sug, '이상한값', '').action, 'DISMISSED');
  assert.equal(A.feedbackEntry(sug, 'SKIPPED', '2026-09-01T10:00:00Z').recommendationId, 'x|y');
});

test('여행 기간 밖(계획 중)에는 live가 아니고 일자 시작 시각을 기준으로 본다', () => {
  const trip = tripOf([{ startAt: '10:00', spots: [Object.assign({ name: 'A', city: '마드리드', stayMin: 60 }, P(40.40))] }]);
  const s = stateOf(trip, { todayISO: '2026-12-25' });
  assert.equal(s.live, false);
  assert.equal(s.nowMin, 600);
  assert.equal(s.items[0].status, 'PLANNED', '지나간 시각이어도 자동 완료 처리하지 않는다');
});
