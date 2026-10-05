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
  // 여유는 다음 **남은** 일정을 떠나야 하는 시각까지다 — 이동은 빈 시간이 아니다(2026-10-03)
  assert.equal(s.freeBefore.name, '저녁 예약');
  assert.equal(s.availableMin, (19 * 60 + 30 - s.items[1].travelIn) - 11 * 60);
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

// ⚠️ 2026-10-03부터 시각상 이미 지났어야 할 곳(다녀왔다는 표시만 안 한 곳)은 다시 굴리지 않는다('다음'과 같은 규칙).
//    그래서 아래 하루는 오후에 시작하고, 남은 곳이 실제로 앞에 있다.
test('재구성: 고정 예약을 침범하지 않고 우선순위 낮은 일정부터 뺀다', () => {
  const trip = tripOf([{
    startAt: '14:00', mode: 'car', spots: [
      Object.assign({ name: 'Museum', city: '마드리드', stayMin: 120, status: 'COMPLETED' }, P(40.41)),
      Object.assign({ name: 'Cafe', city: '마드리드', stayMin: 60, opt: true }, P(40.44)),
      Object.assign({ name: 'Park', city: '마드리드', stayMin: 90, must: true }, P(40.47)),
      Object.assign({ name: 'Dinner', city: '마드리드', bookAt: '18:30', stayMin: 90 }, P(40.50))
    ]
  }]);
  const s = stateOf(trip, { todayISO: TODAY, nowMin: 16 * 60 + 5, live: true, currentLocation: P(40.40) });
  const plan = A.generateReplan(s, { legMin: LEG });
  assert.equal(plan.needed, true, '18:30 예약에 늦으므로 재구성이 필요하다');
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

// ── 자연어 요청 · 출발 안내 · 빈칸 채우기 · 하루 flow ──

test('parseIntent: "오늘 좀 피곤해서 많이 걷기 싫어"를 옵션으로 바꾼다', () => {
  const r = A.parseIntent('오늘 좀 피곤해서 많이 걷기 싫어');
  assert.equal(r.energyLevel, 'LOW');
  assert.equal(r.prefs.walkAverse, true);
  assert.equal(r.prefs.maxTravelMin, 20);
  assert.ok(r.reasons.length >= 2, '무엇으로 알아들었는지 말할 수 있어야 한다');
  assert.equal(r.understood, true);

  const near = A.parseIntent('가까운 곳으로만 보고 싶어');
  assert.equal(near.prefs.maxTravelMin, 15);
  const both = A.parseIntent('걷기 싫고 가까운 데만');
  assert.equal(both.prefs.maxTravelMin, 15, '더 좁은 요구를 따른다');
  const high = A.parseIntent('오늘 쌩쌩해서 더 보고 싶어');
  assert.equal(high.energyLevel, 'HIGH');

  const none = A.parseIntent('음');
  assert.equal(none.understood, false, '못 알아들으면 알아들은 척하지 않는다');
  assert.deepEqual(none.prefs, {});
  assert.equal(A.parseIntent('').understood, false);
});

// 2026-10-02: 규칙이 낱말만 보고 부정을 못 봐서 정반대로 읽었다 —
// "하나도 안 피곤해"가 LOW, "배고프지 않아"가 식사 먼저, "걷는 건 괜찮아"가 걷기 제한 + HIGH.
// 반대로 읽는 것은 못 알아듣는 것보다 나쁘다: 못 알아들으면 화면이 그렇다고 말하고 버튼을 권한다.
test('parseIntent: 부정문을 반대로 읽지 않는다', () => {
  for (const said of ['하나도 안 피곤해', '안 피곤해', '안피곤해', '피곤하지 않아', '피곤하진 않은데', '피곤한 건 아니야', '전혀 안 지쳤어', '지쳤지는 않아']) {
    const r = A.parseIntent(said);
    assert.equal(r.energyLevel, null, `"${said}"는 피곤하다는 말이 아니다`);
    assert.equal(r.understood, false, `"${said}" — 알아들은 척하지 않는다`);
  }
  for (const said of ['배고프지 않아', '배고픈 건 아니야', '밥 생각 없어', '밥은 안 먹어도 돼', '밥 말고 다른 거']) {
    assert.equal(A.parseIntent(said).prefs.mealFocus, undefined, `"${said}"는 식사를 먼저 챙기라는 말이 아니다`);
  }
  assert.equal(A.parseIntent('더 보고 싶지 않아').energyLevel, null);
  assert.equal(A.parseIntent('쌩쌩하진 않아').energyLevel, null);
  assert.equal(A.parseIntent('걷기 싫진 않아').prefs.walkAverse, undefined);
  assert.equal(A.parseIntent('쉬고 싶은 건 아니고').energyLevel, null);
  assert.equal(A.parseIntent('숙소는 안 가도 돼').prefs.wantRest, undefined);
  assert.equal(A.parseIntent('가까운 데 말고').prefs.maxTravelMin, undefined);
  // '기운'은 좋다는 말이지만 '기운이 없다'는 피곤하다는 말이다
  assert.equal(A.parseIntent('기운이 없어').energyLevel, 'LOW');
  assert.equal(A.parseIntent('기운 넘쳐').energyLevel, 'HIGH');
});

// 부정과 그 말 사이에 정도 부사·보조 용언이 끼어도 같은 말이다 — 바로 붙은 꼴만 보면 반대로 읽는다
test('parseIntent: 사이에 낀 부사·보조 용언 때문에 반대로 읽지 않는다', () => {
  for (const said of ['기운이 하나도 없어', '기운이 너무 없어', '기운이 별로 없어', '기운 전혀 없어', '기운이 좀 없어', '오늘 기운이 영 없다', '기운이 안 나', '기운이 나질 않아']) {
    assert.equal(A.parseIntent(said).energyLevel, 'LOW', `"${said}"는 기운이 없다는 말이다`);
  }
  assert.equal(A.resolveIntent('기운이 좀 없어', { energyLevel: 'HIGH' }).energyLevel, 'LOW', '버튼 값을 반대 컨디션으로 덮어쓰지 않는다');
  for (const said of ['기운이 나', '기운이 좋아', '기운이 펄펄', '기운이 있어']) {
    assert.equal(A.parseIntent(said).energyLevel, 'HIGH', `"${said}"`);
  }
  assert.equal(A.parseIntent('더 보고 싶은 건 아니야').energyLevel, null);
  for (const said of ['밥 먹고 싶지 않아', '먹고 싶은 건 아니야', '밥 먹을 생각이 별로 없어']) {
    assert.equal(A.parseIntent(said).prefs.mealFocus, undefined, `"${said}"는 식사를 먼저 챙기라는 말이 아니다`);
  }
  // 이어지는 다른 말의 부정은 여전히 끌어오지 않는다
  assert.equal(A.parseIntent('밥 먹고 쉬고 싶어').prefs.mealFocus, true);
  assert.equal(A.parseIntent('피곤해서 걷지 말자').energyLevel, 'LOW');
});

// '안·못 먹었다'는 먹지 않겠다는 말이 아니라 아직 못 먹었다는 말이다 — 배고프다는 뜻이다
test('parseIntent: 아직 못 먹었다는 말은 식사를 먼저 챙기라는 말이다', () => {
  for (const said of ['밥 못 먹었어', '아직 점심 안 먹었어', '식사 못 했어']) {
    const r = A.parseIntent(said);
    assert.equal(r.prefs.mealFocus, true, `"${said}"`);
    assert.equal(r.understood, true);
  }
  const tired = A.parseIntent('피곤해 죽겠는데 밥도 못 먹었어');
  assert.equal(tired.energyLevel, 'LOW');
  assert.equal(tired.prefs.mealFocus, true);
  assert.equal(A.parseIntent('점심 안 먹었는데 근처에서').prefs.mealFocus, true);
  // 앞으로 안 먹겠다는 말은 그대로 부정이다
  assert.equal(A.parseIntent('밥 안 먹을래').prefs.mealFocus, undefined);
});

// 걷기 제한은 싫다·힘들다·무리다·하지 말자가 붙은 말이다 — 사이에 '좀'이 끼거나 '-지 말자'로 말해도 같다
test('parseIntent: 걷기를 줄여 달라는 여러 말투를 놓치지 않는다', () => {
  for (const said of ['많이 걷고 싶지 않아', '오늘은 많이 걷지 말자', '걷는 건 좀 싫어', '걷는 건 좀 힘들어', '많이 걷는 건 무리야', '많이 걷는 건 좀 힘들어', '걷기가 힘들어', '오래 걷기 힘들어']) {
    const r = A.parseIntent(said);
    assert.equal(r.prefs.walkAverse, true, `"${said}"`);
    assert.equal(r.prefs.maxTravelMin, 20, `"${said}"`);
  }
  // 반대 뜻은 그대로 걷기 제한이 아니다
  for (const said of ['많이 걷고 싶어', '걷는 건 괜찮아', '걷기 싫진 않아']) {
    assert.equal(A.parseIntent(said).prefs.walkAverse, undefined, `"${said}"`);
  }
});

// '무리하지 말자'는 '무리'의 부정이 아니라 쉬자는 말이다
test('parseIntent: 무리하지 말자는 쉬자는 말이다', () => {
  for (const said of ['오늘은 무리하지 말자', '너무 무리하지 않게', '무리 안 해도 돼']) {
    assert.equal(A.parseIntent(said).energyLevel, 'LOW', `"${said}"`);
  }
});

// '괜찮다'가 다른 것(가까운 데면·택시 타면·걷는 건)에 붙으면 컨디션 이야기가 아니다 — 피곤하다는 말을 지우지 않는다
test('parseIntent: 다른 것이 괜찮다는 말은 컨디션과 엇갈리지 않는다', () => {
  for (const said of ['피곤해서 가까운 데면 괜찮아', '피곤해, 택시 타면 괜찮아', '피곤한데 걷는 건 괜찮아', '피곤한데 근처면 괜찮아']) {
    assert.equal(A.parseIntent(said).energyLevel, 'LOW', `"${said}"`);
  }
  assert.equal(A.resolveIntent('피곤해서 가까운 데면 괜찮아', { energyLevel: 'HIGH' }).energyLevel, 'LOW');
  // 컨디션이 괜찮다는 말은 여전히 엇갈림이다
  assert.equal(A.parseIntent('피곤하긴 한데 괜찮아').energyLevel, null);
  assert.equal(A.parseIntent('나는 괜찮아, 좀 피곤하긴 해').energyLevel, null);
});

test('parseIntent: 부정은 그 말에 붙은 것만 본다 — 이어지는 다른 말의 부정을 끌어오지 않는다', () => {
  // '해서'·'는데'로 넘어간 뒤의 부정은 다른 말의 것이다
  assert.equal(A.parseIntent('피곤해서 안 갈래').energyLevel, 'LOW');
  assert.equal(A.parseIntent('피곤해서 힘이 없어').energyLevel, 'LOW');
  const mixed = A.parseIntent('피곤하지 않은데 배고파');
  assert.equal(mixed.energyLevel, null);
  assert.equal(mixed.prefs.mealFocus, true, '부정된 말만 버리고 나머지는 알아듣는다');
  const again = A.parseIntent('안 피곤하다고 했지만 사실 피곤해');
  assert.equal(again.energyLevel, 'LOW', '같은 말이 부정 없이 한 번 더 나오면 그쪽을 듣는다');
  // 낱말 안에 있는 '안'은 부정이 아니다
  assert.equal(A.parseIntent('숙소 안에서 쉬고 싶어').prefs.wantRest, true);
});

test('parseIntent: 범용 낱말만으로 조건을 만들지 않는다', () => {
  // '걷는 건' 뒤에 무엇이 오는지 봐야 한다 — 괜찮다면 걷기 제한이 아니다
  const ok = A.parseIntent('걷는 건 괜찮아');
  assert.equal(ok.prefs.walkAverse, undefined);
  assert.equal(ok.prefs.maxTravelMin, undefined);
  assert.equal(ok.energyLevel, null, "'괜찮아'는 컨디션이 좋다는 말이 아니다 — 무엇이 괜찮은지 모른다");
  assert.equal(A.parseIntent('괜찮아').understood, false);
  assert.equal(A.parseIntent('많이 걷고 싶어').prefs.walkAverse, undefined, '많이 걷고 싶다는 건 걷기 싫다는 말의 반대다');
  // 싫다는 말이 붙으면 그때 걷기 제한이다
  assert.equal(A.parseIntent('걷는 건 싫어').prefs.walkAverse, true);
  assert.equal(A.parseIntent('걷는 게 힘들어').prefs.walkAverse, true);
  assert.equal(A.parseIntent('안 걷고 싶어').prefs.walkAverse, true);
});

test('parseIntent: 컨디션이 엇갈리면 정하지 않는다', () => {
  // 나중 규칙이 이기면 "피곤하긴 한데 괜찮아"가 HIGH가 된다 — 어느 쪽으로도 단정하지 않는다
  for (const said of ['피곤하긴 한데 괜찮아', '좀 힘들지만 괜찮아', '피곤한데 더 보고 싶어']) {
    const r = A.parseIntent(said);
    assert.equal(r.energyLevel, null, `"${said}" — 컨디션을 단정하지 않는다`);
    assert.ok(!r.reasons.some((x) => /쉬고 싶다|컨디션이 좋다/.test(x)), `"${said}" — 단정하지 않은 컨디션을 이유로 말하지 않는다`);
  }
  // 엇갈리지 않으면 그대로다
  assert.equal(A.parseIntent('오늘 쌩쌩해서 괜찮아').energyLevel, 'HIGH');
  assert.equal(A.parseIntent('안 피곤해, 더 보고 싶어').energyLevel, 'HIGH');
  // 컨디션이 엇갈려도 다른 조건은 알아듣는다
  const walk = A.parseIntent('피곤하긴 한데 괜찮아, 많이 걷기 싫어');
  assert.equal(walk.energyLevel, null);
  assert.equal(walk.prefs.walkAverse, true);
  assert.equal(walk.understood, true);
});

test('선호(prefs)는 추천 범위를 실제로 좁힌다', () => {
  const trip = tripOf([
    { startAt: '09:00', mode: 'walk', spots: [Object.assign({ name: '숙소', city: '마드리드', stay: true, stayMin: 0 }, P(40.40))] },
    { spots: [Object.assign({ name: '가까운 골목', city: '마드리드', stayMin: 60 }, P(40.405)),
      Object.assign({ name: '건너편 언덕', city: '마드리드', stayMin: 60 }, P(40.60))] }   // 편도 44분
  ]);
  const base = stateOf(trip, { todayISO: TODAY, nowMin: 10 * 60, live: true });
  const wide = A.rankNextActions(base, A.buildCandidates(trip, base, {}), { legMin: LEG }).map((r) => r.title);
  assert.ok(wide.indexOf('건너편 언덕') >= 0, '기본에서는 후보로 남는다');

  const near = stateOf(trip, { todayISO: TODAY, nowMin: 10 * 60, live: true, prefs: { maxTravelMin: 15 } });
  const narrow = A.rankNextActions(near, A.buildCandidates(trip, near, {}), { legMin: LEG }).map((r) => r.title);
  assert.ok(narrow.indexOf('가까운 골목') >= 0);
  assert.equal(narrow.indexOf('건너편 언덕'), -1, '"가까운 데만"이면 먼 곳은 후보에서 뺀다');
});

test('departureAdvice: 언제 나서면 되는지 문장으로 답한다', () => {
  const trip = tripOf([{
    startAt: '09:00', mode: 'walk', spots: [
      Object.assign({ name: '숙소', city: '마드리드', stay: true, stayMin: 0 }, P(40.40)),
      Object.assign({ name: '저녁 예약', city: '마드리드', bookAt: '19:00', stayMin: 90 }, P(40.42))]
  }]);
  const at = (min) => stateOf(trip, { todayISO: TODAY, nowMin: min, live: true });
  const early = A.departureAdvice(at(18 * 60 + 20), at(18 * 60 + 20).items[1], 20);
  assert.equal(early.level, 'EARLY');
  assert.match(early.text, /18:40/);
  assert.equal(early.slackMin, 20);
  const now = A.departureAdvice(at(18 * 60 + 35), at(18 * 60 + 35).items[1], 20);
  assert.equal(now.level, 'NOW');
  assert.match(now.text, /지금 출발하면 약 5분 여유/);
  const late = A.departureAdvice(at(18 * 60 + 50), at(18 * 60 + 50).items[1], 20);
  assert.equal(late.level, 'LATE');
  assert.match(late.text, /약 10분 늦어요/);
  assert.equal(A.departureAdvice(at(600), null, 10), null);
});

test('fillGaps: 빈 시간을 한 칸이 아니라 있는 만큼 채운다 (저장은 하지 않는다)', () => {
  const trip = tripOf([
    {
      startAt: '09:00', mode: 'walk', spots: [
        Object.assign({ name: '숙소', city: '마드리드', stay: true, stayMin: 0 }, P(40.40)),
        Object.assign({ name: '저녁 예약', city: '마드리드', bookAt: '19:00', stayMin: 90 }, P(40.42))]
    },
    {
      spots: [Object.assign({ name: '공원', city: '마드리드', stayMin: 90 }, P(40.405)),
        Object.assign({ name: '미술관', city: '마드리드', stayMin: 120 }, P(40.41)),
        Object.assign({ name: '카페', city: '마드리드', stayMin: 60 }, P(40.415))]
    }
  ]);
  const s = stateOf(trip, { todayISO: TODAY, nowMin: 13 * 60, live: true });
  const fill = A.fillGaps(trip, s, { legMin: LEG });
  assert.ok(fill.slots.length >= 2, '13:00~19:00 사이를 여러 칸으로 채운다 — got ' + fill.slots.length);
  const titles = fill.slots.map((x) => x.pick.title);
  assert.equal(new Set(titles).size, titles.length, '같은 곳을 두 번 넣지 않는다');
  assert.equal(titles.indexOf('저녁 예약'), -1, '이미 오늘 일정에 있는 곳은 채우기 대상이 아니다');
  let cursor = -1;
  fill.slots.forEach((x) => { assert.ok(x.startMin >= cursor, '시간이 겹치지 않는다'); cursor = x.endMin; });
  assert.ok(fill.slots.every((x) => x.endMin <= 19 * 60), '고정 예약 시각을 넘겨 채우지 않는다');
  assert.deepEqual(trip.days[1].spots.map((x) => x.name), ['공원', '미술관', '카페'], '미리보기일 뿐 데이터를 바꾸지 않는다');
});

test('planDayFlow: "오늘 하루 추천해줘" — 고정 예약을 자리에 두고 오전/점심/오후/저녁 흐름을 만든다', () => {
  const trip = tripOf([
    {
      startAt: '09:00', mode: 'walk', spots: [
        Object.assign({ name: '숙소', city: '마드리드', stay: true, stayMin: 0 }, P(40.40)),
        Object.assign({ name: '저녁 예약', city: '마드리드', bookAt: '19:00', stayMin: 90 }, P(40.42))]
    },
    {
      spots: [Object.assign({ name: '공원', city: '마드리드', stayMin: 90 }, P(40.405)),
        Object.assign({ name: '미술관', city: '마드리드', stayMin: 120 }, P(40.41))]
    }
  ]);
  const s = stateOf(trip, { todayISO: TODAY, nowMin: 10 * 60, live: true });
  const flow = A.planDayFlow(trip, s, { legMin: LEG });
  assert.equal(flow.empty, false);
  const fixed = flow.blocks.filter((b) => b.kind === 'FIXED');
  assert.equal(fixed.length, 1);
  assert.equal(fixed[0].title, '저녁 예약');
  assert.equal(fixed[0].segment, '저녁');
  const suggested = flow.blocks.filter((b) => b.kind === 'SUGGESTED');
  assert.ok(suggested.length >= 1);
  assert.ok(suggested.every((b) => b.startMin < fixed[0].startMin), '제안은 고정 예약 앞에만 놓인다');
  let cursor = -1;
  flow.blocks.forEach((b) => { assert.ok(b.startMin >= cursor, '시간순으로 정렬된다'); cursor = b.startMin; });
  assert.ok(['오전', '점심', '오후'].indexOf(suggested[0].segment) >= 0);
  assert.deepEqual(A.planDayFlow(trip, s, { legMin: LEG }).blocks.map((b) => b.title),
    flow.blocks.map((b) => b.title), '같은 상태면 같은 하루를 만든다');
});

test('planDayFlow invariant: bookAt이 있는 FIXED 일정은 빈칸을 채워도 결과와 원본에 유지된다', () => {
  const trip = tripOf([
    { startAt: '09:00', mode: 'walk', spots: [
      Object.assign({ name: '숙소', stay: true, stayMin: 0 }, P(40.40)),
      Object.assign({ name: '저녁 예약', bookAt: '19:00', stayMin: 90 }, P(40.42))] },
    { spots: [Object.assign({ name: '공원', stayMin: 90 }, P(40.405))] }
  ]);
  const before = JSON.stringify(trip);
  const state = stateOf(trip, { todayISO: TODAY, nowMin: 13 * 60, live: true });
  const flow = A.planDayFlow(trip, state, { legMin: LEG });
  const fixedTitles = flow.blocks.filter((b) => b.kind === 'FIXED').map((b) => b.title);
  assert.deepEqual(fixedTitles, ['저녁 예약'], 'bookAt 일정은 빈 시간 안내로 대체되지 않는다');
  assert.equal(JSON.stringify(trip), before, '미리보기 계산은 FIXED 일정과 원본 여행을 변경하지 않는다');
});

test('planDayFlow: 채울 것이 없으면 빈 계획을 그대로 알린다', () => {
  const trip = tripOf([{
    startAt: '09:00', mode: 'walk', spots: [
      Object.assign({ name: '숙소', city: '마드리드', stay: true, stayMin: 0 }, P(40.40)),
      Object.assign({ name: '저녁 예약', city: '마드리드', bookAt: '19:00', stayMin: 90 }, P(40.42))]
  }]);
  const s = stateOf(trip, { todayISO: TODAY, nowMin: 18 * 60 + 40, live: true });
  const flow = A.planDayFlow(trip, s, { legMin: LEG });
  assert.equal(flow.empty, true, '없는 일정을 지어내지 않는다');
  assert.ok(flow.blocks.some((b) => b.kind === 'FIXED'), '남은 고정 예약은 그대로 보여준다');
});

// ── Travel State: 출발 계획 · Trip Pulse · 알림 계획 ──

/** 고정 예약 하나만 있는 하루 — 출발 계산의 기준 fixture (숙소 → 22.2km 떨어진 식당) */
function dinnerTrip() {
  return tripOf([{
    startAt: '09:00', mode: 'car', spots: [
      Object.assign({ name: '숙소', city: '마드리드', stay: true, stayMin: 0 }, P(40.40)),
      Object.assign({ name: '저녁 예약', city: '마드리드', bookAt: '19:00', stayMin: 90 }, P(40.60))
    ]
  }]);
}

test('safetyBufferFor: 열차·항공은 관광지와 다른 여유를 가진다', () => {
  const at = (type, spot) => ({ type, spot: spot || {} });
  assert.equal(A.safetyBufferFor(at('FLIGHT')), 120);
  assert.equal(A.safetyBufferFor(at('TRAIN')), 30);
  assert.equal(A.safetyBufferFor(at('RESTAURANT')), 15);
  assert.equal(A.safetyBufferFor(at('OTHER')), 10);
  assert.equal(A.safetyBufferFor(at('CAR')), 20);
  assert.equal(A.safetyBufferFor(at('OTHER', { bufferMin: 45 })), 45, '사용자가 정한 값이 이긴다');
  assert.equal(A.safetyBufferFor(at('TRAIN'), { buffers: { TRAIN: 50 } }), 50, '설정으로 덮어쓸 수 있다');
});

test('departurePlan: 권장 출발 = 약속 − 이동 − 여유, 단계는 상태 변화에만 반응한다', () => {
  const trip = dinnerTrip();
  const state = (min) => stateOf(trip, { todayISO: TODAY, nowMin: min, live: true, startAnchor: P(40.40) });
  const item = (min) => state(min).items[1];

  const early = A.departurePlan(state(14 * 60), item(14 * 60), 44);
  assert.equal(early.bufferMin, 15, 'bookAt이 있는 약속은 TOUR로 분류돼 15분');
  assert.equal(early.leaveMin, 19 * 60 - 44 - 15);
  assert.equal(early.stage, 'UPCOMING');
  assert.equal(early.level, 'EARLY');
  assert.match(early.text, /18:01/);

  const ready = A.departurePlan(state(17 * 60 + 55), item(17 * 60 + 55), 44);
  assert.equal(ready.stage, 'READY_TO_LEAVE');
  assert.equal(ready.level, 'NOW');
  assert.match(ready.text, /이제 출발하면/);
  assert.ok(!/출발하세요/.test(ready.text), '명령형을 쓰지 않는다');

  const late = A.departurePlan(state(18 * 60 + 30), item(18 * 60 + 30), 44);
  assert.equal(late.stage, 'LATE_RISK');
  assert.equal(late.level, 'LATE');
  assert.equal(late.lateByMin, 14, '18:30 + 44분 = 19:14 → 14분 지각');
  assert.match(late.text, /14분/);
});

test('departurePlan: 여유를 못 지키는 것과 약속에 늦는 것은 다르다', () => {
  const s = stateOf(dinnerTrip(), { todayISO: TODAY, nowMin: 18 * 60 + 10, live: true, startAnchor: P(40.40) });
  const plan = A.departurePlan(s, s.items[1], 44);
  assert.equal(plan.level, 'NOW', '18:54 도착 — 15분 여유는 못 지키지만');
  assert.equal(plan.lateByMin, 0, '19:00 약속에 늦지는 않는다');
  assert.ok(plan.slackMin < 0);
});

test('departurePlan: 계획 중(여행 기간 밖)에는 재촉하지 않는다', () => {
  const s = stateOf(dinnerTrip(), { todayISO: '2026-12-25' });
  const plan = A.departurePlan(s, s.items[1], 44);
  assert.equal(plan.stage, 'UPCOMING');
  assert.match(plan.text, /쯤 출발하는 일정/);
});

test('tripPulse: 하루 상태를 규칙으로 한 마디로 요약한다', () => {
  const empty = stateOf(tripOf([{ startAt: '09:00', spots: [] }]), { todayISO: TODAY, nowMin: 600, live: true });
  assert.equal(A.tripPulse(empty, { needed: false }).code, 'NO_PLAN');

  const doneTrip = tripOf([{ startAt: '09:00', spots: [Object.assign({ name: 'A', city: 'M', stayMin: 60, status: 'COMPLETED' }, P(40.40))] }]);
  assert.equal(A.tripPulse(stateOf(doneTrip, { todayISO: TODAY, nowMin: 700, live: true }), { needed: false }).code, 'DAY_COMPLETE');

  const s = stateOf(dinnerTrip(), { todayISO: TODAY, nowMin: 13 * 60, live: true, startAnchor: P(40.40) });
  assert.equal(A.tripPulse(s, { needed: true, lateBy: 40, dropNames: ['Cafe'] }).code, 'NEEDS_ATTENTION');
  assert.equal(A.tripPulse(s, { needed: false }, { level: 'LATE', lateByMin: 20 }).code, 'DELAYED');
  assert.equal(A.tripPulse(s, { needed: false }).code, 'FREE_TIME', '저녁까지 6시간 — 빈 시간이다');

  const tired = stateOf(dinnerTrip(), { todayISO: TODAY, nowMin: 13 * 60, live: true, energyLevel: 'LOW', startAnchor: P(40.40) });
  assert.equal(A.tripPulse(tired, { needed: false }).code, 'RESTING');
});

test('tripPulse: 내부 코드가 사용자 문구로 새지 않는다', () => {
  const s = stateOf(dinnerTrip(), { todayISO: TODAY, nowMin: 13 * 60, live: true, startAnchor: P(40.40) });
  const cases = [
    A.tripPulse(s, { needed: false }),
    A.tripPulse(s, { needed: true, lateBy: 10, dropNames: ['Cafe'] }),
    A.tripPulse(s, { needed: false }, { level: 'LATE', lateByMin: 10 })
  ];
  cases.forEach((pulse) => {
    assert.ok(pulse.text.length > 0, '항상 사람이 읽을 문장이 있다');
    assert.ok(!/[A-Z_]{4,}/.test(pulse.text), '내부 enum이 문구에 새지 않는다');
  });
});

test('stateVersion: 같은 상태면 같은 지문, 하나라도 바뀌면 달라진다', () => {
  const trip = dinnerTrip();
  const a = stateOf(trip, { todayISO: TODAY, nowMin: 13 * 60, live: true });
  const b = stateOf(trip, { todayISO: TODAY, nowMin: 13 * 60 + 7, live: true });
  assert.equal(A.stateVersion(a), A.stateVersion(b), '시간만 흘러선 바뀌지 않는다 (분마다 갱신하지 않기 위해)');

  const changed = JSON.parse(JSON.stringify(trip));
  changed.days[0].spots[0].status = 'COMPLETED';
  const c = stateOf(changed, { todayISO: TODAY, nowMin: 13 * 60, live: true });
  assert.notEqual(A.stateVersion(a), A.stateVersion(c), '일정 상태가 바뀌면 지문도 바뀐다');
  assert.notEqual(A.stateVersion(a), A.stateVersion(a, { stage: 'READY_TO_LEAVE' }));
});

test('notificationPlan: 상태가 바뀔 때만 나오고, 같은 단계는 다시 나가지 않는다', () => {
  const trip = dinnerTrip();
  const at = (min) => stateOf(trip, { todayISO: TODAY, nowMin: min, live: true, startAnchor: P(40.40) });

  const calm = at(13 * 60);
  const calmPlan = A.notificationPlan(calm, { departure: A.departurePlan(calm, calm.items[1], 44), replan: { needed: false } });
  assert.equal(calmPlan.filter((n) => n.kind === 'departureReminder').length, 0, '아직 한참 남았으면 조용하다');

  const ready = at(17 * 60 + 55);
  const readyPlan = A.notificationPlan(ready, { departure: A.departurePlan(ready, ready.items[1], 44), replan: { needed: false } });
  const dep = readyPlan.filter((n) => n.kind === 'departureReminder')[0];
  assert.ok(dep, '출발할 때가 되면 알린다');
  assert.equal(dep.origin, 'DEVICE', '현재 위치가 필요한 판단은 기기가 한다');
  assert.match(dep.deepLink, /\/today\?focus=d0s1/, '홈이 아니라 그 일정으로 바로 간다');
  assert.match(dep.dedupeKey, /READY_TO_LEAVE/);

  assert.deepEqual(
    A.pendingNotifications(readyPlan, [dep.dedupeKey]).filter((n) => n.kind === 'departureReminder'), [],
    '같은 단계에서는 다시 보내지 않는다');

  const late = at(18 * 60 + 30);
  const latePlan = A.notificationPlan(late, { departure: A.departurePlan(late, late.items[1], 44), replan: { needed: false } });
  const delay = latePlan.filter((n) => n.kind === 'scheduleDelay')[0];
  assert.ok(delay);
  assert.notEqual(delay.dedupeKey, dep.dedupeKey, '단계가 바뀌면 새 알림이다');
  assert.equal(A.pendingNotifications(latePlan, [dep.dedupeKey]).length, latePlan.length);
});

test('notificationPlan: 여행 중이 아니면 먼저 말을 걸지 않는다', () => {
  const s = stateOf(dinnerTrip(), { todayISO: '2026-12-25' });
  assert.deepEqual(A.notificationPlan(s, { replan: { needed: true, lateBy: 40, dropNames: ['A'], drop: ['d0s0'] } }), []);
});

test('notificationPlan: 빈 시간 제안은 Travel Mode에서만, 쉬겠다고 하면 보내지 않는다', () => {
  const trip = dinnerTrip();
  const s = stateOf(trip, { todayISO: TODAY, nowMin: 13 * 60, live: true, startAnchor: P(40.40) });
  const suggestions = [{ id: 's1', type: 'NEXT_ACTIVITY', title: '레티로 공원', description: '8분 거리' }];
  const kinds = (opts) => A.notificationPlan(s, opts).filter((n) => n.kind === 'emptySlotSuggestion').length;

  assert.equal(kinds({ suggestions }), 0, 'Travel Mode를 안 켰으면 조용하다');
  assert.equal(kinds({ suggestions, travelMode: true }), 1);
  assert.equal(kinds({ suggestions, travelMode: true, suppressUntilMin: 18 * 60 }), 0, '"오늘은 쉬기" 뒤에는 참견하지 않는다');
  assert.equal(kinds({ suggestions, travelMode: true, quiet: true }), 0);

  const tired = stateOf(trip, { todayISO: TODAY, nowMin: 13 * 60, live: true, energyLevel: 'LOW', startAnchor: P(40.40) });
  assert.equal(A.notificationPlan(tired, { suggestions, travelMode: true }).filter((n) => n.kind === 'emptySlotSuggestion').length, 0);
});

test('notificationPlan: 재구성·가격은 서버가, 출발은 기기가 판단한다 (중복 판단 금지)', () => {
  const s = stateOf(dinnerTrip(), { todayISO: TODAY, nowMin: 17 * 60 + 55, live: true, startAnchor: P(40.40) });
  const input = {
    departure: A.departurePlan(s, s.items[1], 44),
    replan: { needed: true, lateBy: 40, dropNames: ['Cafe'], drop: ['d0s2'] },
    suggestions: [{ id: 'px1', type: 'PRICE_SAVING', title: '호텔 12만원 절약 가능', description: '동일 조건' }]
  };
  const plan = A.notificationPlan(s, input);
  const byKind = {};
  plan.forEach((n) => { byKind[n.kind] = n; });
  assert.equal(byKind.departureReminder.origin, 'DEVICE');
  assert.equal(byKind.replanSuggestion.origin, 'SERVER');
  assert.equal(byKind.priceSaving.origin, 'SERVER');
  assert.match(byKind.replanSuggestion.deepLink, /\/replan$/);
  assert.match(byKind.priceSaving.deepLink, /\/bookings$/);
  assert.ok(plan[0].priority >= plan[plan.length - 1].priority, '급한 것이 위로');
  assert.deepEqual(A.notificationPlan(s, input).map((n) => n.dedupeKey), plan.map((n) => n.dedupeKey), '같은 상태면 같은 결과');
});

test('suggestionExpiryMin: 위치·시각 기반 제안은 다음 고정 일정 전에 만료된다', () => {
  const s = stateOf(dinnerTrip(), { todayISO: TODAY, nowMin: 13 * 60, live: true, startAnchor: P(40.40) });
  assert.equal(A.suggestionExpiryMin(s), 13 * 60 + 90, 'TTL 90분이 가장 이르다');
  const near = stateOf(dinnerTrip(), { todayISO: TODAY, nowMin: 18 * 60 + 30, live: true, startAnchor: P(40.40) });
  assert.equal(A.suggestionExpiryMin(near), 19 * 60, '저녁 예약 시작이 더 이르면 그때 만료');
});

// 2026-09-06: 체류 기본값을 60 → 0으로 바꾸면서 **두 가지 일을 나눴다.**
//   defaultStayMin  — 내가 계획한 장소가 시간을 안 정했으면 머무르지 않는다(0)
//   suggestStayMin  — 제안할 활동의 예상 소요. 여기도 0으로 두면 어떤 빈 시간에도 무한히 들어간다
test('체류 기본값: 계획된 장소는 0분이지만, 제안 후보의 소요는 여전히 1시간으로 본다', () => {
  const trip = tripOf([
    { title: '오늘', mode: 'walk', startAt: '09:00', spots: [
      Object.assign({ name: '오늘 장소', city: 'M' }, P(40.40))
    ] },
    { title: '내일', mode: 'walk', startAt: '09:00', spots: [
      Object.assign({ name: '옮겨올 후보', city: 'M' }, P(40.41))   // stayMin 없음
    ] }
  ]);
  const state = stateOf(trip, { todayISO: TODAY, nowMinutes: 10 * 60 });

  // 계획된 장소: 시간을 안 정했으니 머무르지 않는다 — 도착과 출발이 같다
  const planned = state.items.find((it) => it.name === '오늘 장소');
  assert.equal(planned.stayMin, 0, '안 정한 체류는 0분이다');
  assert.equal(planned.end - planned.depart, 0, '머무르지 않으므로 도착과 출발이 같다');

  // 제안 후보: 소요를 0으로 보면 **어떤 빈 시간에도 들어간다** — 그러면 무한히 채운다
  const candidates = A.buildCandidates(trip, state, {});
  assert.equal(candidates.find((c) => c.title === '옮겨올 후보').durationMin, 60,
               '다른 날에서 옮겨올 후보의 소요를 모르면 한 시간쯤으로 본다');
  assert.equal(candidates.find((c) => c.title === '오늘 장소').durationMin, 60,
               '오늘 장소도 마찬가지 — 계획 체류가 0이어도 제안 기준으로는 0을 쓰지 않는다');
});

// 다른 날의 후보가 '들렀다 바로 이동'(stayMin:0)이면 계획 체류는 0이지만 제안 소요는 0이 아니다.
// 오늘 장소와 같은 규칙이어야 한다 — 0분 후보는 어떤 빈 시간에도 들어가 빈칸 채우기가 끝없이 그걸 넣는다.
test('체류 기본값: 다른 날 후보의 체류가 0분이어도 제안 소요는 한 시간으로 본다', () => {
  const trip = tripOf([
    { title: '오늘', mode: 'walk', startAt: '09:00', spots: [
      Object.assign({ name: '오늘 장소', city: 'M' }, P(40.40))
    ] },
    { title: '내일', mode: 'walk', startAt: '09:00', spots: [
      Object.assign({ name: '잠깐 들를 곳', city: 'M', stayMin: 0 }, P(40.41)),
      Object.assign({ name: '숫자 아닌 체류', city: 'M', stayMin: 'x' }, P(40.42)),
      Object.assign({ name: '정한 체류', city: 'M', stayMin: 45 }, P(40.43))
    ] }
  ]);
  const state = stateOf(trip, { todayISO: TODAY, nowMinutes: 10 * 60 });
  const candidates = A.buildCandidates(trip, state, {});
  const dur = (title) => candidates.find((c) => c.title === title).durationMin;
  assert.equal(dur('잠깐 들를 곳'), 60, '계획 체류 0은 제안 소요 0이 아니다');
  assert.equal(dur('숫자 아닌 체류'), 60);
  assert.equal(dur('정한 체류'), 45, '정해 둔 체류는 그대로 쓴다');
});

// D-day는 '오늘 → 출발일'이고, 시작 전에만 값이 있다.
// ⚠️ todayIndex === -1은 **시작 전과 끝난 뒤 둘 다**다 — 둘을 가르는 것이 이 값이다.
test('daysUntilStart: 시작 전에만 값이 있고, currentDayIndex와 같은 날짜 규칙을 쓴다', () => {
  const trip = tripOf([{ title: '1', mode: 'walk', spots: [] }, { title: '2', mode: 'walk', spots: [] }],
                      { start: '2026-10-01' });

  assert.equal(A.daysUntilStart(trip, '2026-09-19'), 12);
  assert.equal(A.daysUntilStart(trip, '2026-09-30'), 1, '전날은 D-1');

  // 출발일에는 이미 시작이다 — D-0을 말하지 않는다
  assert.equal(A.daysUntilStart(trip, '2026-10-01'), null);
  assert.ok(A.currentDayIndex(trip, '2026-10-01') >= 0, '같은 날을 두 함수가 다르게 보면 안 된다');

  assert.equal(A.daysUntilStart(trip, '2026-10-02'), null, '진행 중');
  assert.equal(A.daysUntilStart(trip, '2026-11-01'), null, '끝난 뒤');
  assert.equal(A.currentDayIndex(trip, '2026-11-01'), -1, '끝난 뒤도 -1이다 — 그래서 이 값이 필요하다');

  // 날짜 없는 여행은 셀 것이 없다
  assert.equal(A.daysUntilStart(tripOf([{ title: '', mode: 'walk', spots: [] }], { start: '' }), '2026-09-19'), null);
  assert.equal(A.daysUntilStart(null, '2026-09-19'), null);
});

// ── resolveIntent — 문장과 '이미 고른 컨디션'을 합치는 규칙 ──
//
// 웹(applyIntent)과 서버(/api/v1/.../today)가 이 함수를 같이 쓴다. 갈리면 같은 문장에
// 웹과 앱의 추천이 달라진다.

test('resolveIntent: 컨디션은 문장이 말했을 때만 덮어쓴다', () => {
  // "가까운 데만"에는 컨디션이 없다 — 버튼으로 고른 값이 남아야 한다
  assert.equal(A.resolveIntent('가까운 데만', { energyLevel: 'HIGH' }).energyLevel, 'HIGH');
  // 문장이 말하면 그쪽이 이긴다
  assert.equal(A.resolveIntent('너무 피곤해', { energyLevel: 'HIGH' }).energyLevel, 'LOW');
  assert.equal(A.resolveIntent('오늘 쌩쌩해', { energyLevel: 'LOW' }).energyLevel, 'HIGH');
  // 부정했거나 엇갈린 컨디션은 '말하지 않은 것'이다 — 고른 값이 남는다
  assert.equal(A.resolveIntent('하나도 안 피곤해', { energyLevel: 'HIGH' }).energyLevel, 'HIGH');
  assert.equal(A.resolveIntent('피곤하긴 한데 괜찮아', { energyLevel: 'LOW' }).energyLevel, 'LOW');
});

test('resolveIntent: 조건은 문장이 통째로 정한다', () => {
  // 앞 문장의 조건이 남으면 "밥 먹자"에 걷기 제한이 따라붙는다
  const walk = A.resolveIntent('많이 걷기 싫어', {});
  assert.equal(walk.prefs.walkAverse, true);
  const meal = A.resolveIntent('배고파', {});
  assert.equal(meal.prefs.walkAverse, undefined, '앞 문장의 조건이 남지 않는다');
  assert.equal(meal.prefs.mealFocus, true);
});

test('resolveIntent: 빈 문장은 해석하지 않고 고른 컨디션만 남긴다', () => {
  const r = A.resolveIntent('', { energyLevel: 'LOW' });
  assert.equal(r.energyLevel, 'LOW');
  assert.deepEqual(r.prefs, {});
  assert.equal(r.understood, false, '아무 말도 안 했으면 알아들은 것이 아니다');
  assert.equal(A.resolveIntent(null, {}).energyLevel, 'NORMAL');
  assert.equal(A.resolveIntent('   ', {}).understood, false);
});

test('resolveIntent: 못 알아들은 문장은 알아들은 척하지 않는다', () => {
  const r = A.resolveIntent('asdfgh 뭐라고 쓴 건지', { energyLevel: 'HIGH' });
  assert.equal(r.understood, false);
  assert.deepEqual(r.reasons, []);
  assert.equal(r.energyLevel, 'HIGH', '못 알아들었다고 고른 값을 버리지 않는다');
});

test('resolveIntent: 계약 밖의 컨디션은 보통으로 떨어진다', () => {
  // 쿼리로 아무 문자열이나 올 수 있다 — 그게 점수 계산에 들어가면 안 된다
  assert.equal(A.resolveIntent('가까운 데만', { energyLevel: '왜이런값' }).energyLevel, 'NORMAL');
  assert.equal(A.resolveIntent('가까운 데만', {}).energyLevel, 'NORMAL');
  assert.equal(A.resolveIntent('가까운 데만', { energyLevel: 'low' }).energyLevel, 'LOW', '대소문자는 봐준다');
});

// ── '한 곳 더' 제안은 새 장소만 (2026-10-02 UX 검토) ──────────────────
// 샘플 여행 Day 1에 그날 일정의 공항·광장이 "지금 한 곳 더 들를 수 있어요"로 올라왔다.
// 그날 일정에 있는 곳은 '다음' 카드와 재구성(REPLAN)의 몫이고, 추가 방문 제안이 아니다.
function previewDay() {
  return tripOf([
    {
      startAt: '09:00', mode: 'car', spots: [
        Object.assign({ name: '공항 (MAD)', city: '마드리드', cat: 'transport' }, P(40.47)),
        Object.assign({ name: '광장', city: '마드리드', stayMin: 45 }, P(40.416)),
        Object.assign({ name: '경기장', city: '마드리드', stayMin: 60 }, P(40.436))
      ]
    },
    {
      startAt: '09:00', mode: 'car', spots: [
        Object.assign({ name: '미술관', city: '마드리드', stayMin: 60 }, P(40.414)),
        Object.assign({ name: '기차역', city: '마드리드', cat: 'transport' }, P(40.406))
      ]
    }
  ]);
}

test('제안: 그날 일정에 이미 있는 곳은 "한 곳 더"로 다시 권하지 않는다 (여행 전 미리보기)', () => {
  const trip = previewDay();
  const s = stateOf(trip, { todayISO: '2026-08-01', nowMin: 14 * 60 });
  assert.equal(s.live, false);
  const res = A.buildSuggestions(trip, s, { legMin: LEG });
  const planned = trip.days[0].spots.map((x) => x.name);
  const visits = res.suggestions.filter((x) => x.type === 'NEXT_ACTIVITY' && x.action.si != null);
  assert.ok(visits.length > 0, '다른 날의 새 장소는 여전히 제안된다');
  visits.forEach((x) => {
    assert.ok(planned.indexOf(x.title) < 0, x.title + '은(는) 이미 그날 일정에 있다');
    assert.notEqual(x.action.fromDay, null, '그날 일정의 장소(fromDay 없음)는 추가 방문 제안이 아니다');
  });
});

test('제안: 여행 중에도 현재·완료·남은 그날 장소는 "한 곳 더" 후보가 아니다', () => {
  const trip = previewDay();
  trip.days[0].spots[1].status = 'COMPLETED';
  const s = stateOf(trip, { todayISO: TODAY, nowMin: 10 * 60, live: true });
  const res = A.buildSuggestions(trip, s, { legMin: LEG });
  const planned = trip.days[0].spots.map((x) => x.name);
  res.suggestions.filter((x) => x.type === 'NEXT_ACTIVITY').forEach((x) => {
    assert.ok(planned.indexOf(x.title) < 0, x.title + '은(는) 그날 일정의 장소다');
  });
});

test('제안: 공항·역 같은 교통 장소는 다른 날에서 옮겨올 관광 후보가 아니다', () => {
  const trip = previewDay();
  const s = stateOf(trip, { todayISO: '2026-08-01', nowMin: 14 * 60 });
  const titles = A.buildCandidates(trip, s, {}).map((x) => x.title);
  assert.ok(titles.indexOf('미술관') >= 0, '옮겨올 수 있는 관광지는 남는다');
  assert.ok(titles.indexOf('기차역') < 0, '역을 둘러볼 곳으로 권하지 않는다');
});

test('제안: 일정 조정(REPLAN)은 그날 장소를 다루므로 그대로 남는다', () => {
  const trip = tripOf([{
    startAt: '16:00', mode: 'car', spots: [
      Object.assign({ name: 'Museum', city: '마드리드', stayMin: 120 }, P(40.41)),
      Object.assign({ name: 'Cafe', city: '마드리드', stayMin: 60, opt: true }, P(40.44)),
      Object.assign({ name: 'Dinner', city: '마드리드', bookAt: '19:00', stayMin: 90 }, P(40.50))
    ]
  }]);
  const s = stateOf(trip, { todayISO: TODAY, nowMin: 17 * 60 + 30, live: true, currentLocation: P(40.40) });
  const res = A.buildSuggestions(trip, s, { legMin: LEG });
  assert.ok(res.suggestions.some((x) => x.type === 'REPLAN'), '지연이면 기존 장소를 조정하는 제안은 유지된다');
});

test('제안: 미리보기에서는 "현재 위치에서"라고 말하지 않는다 — 앞 일정에서의 이동이다', () => {
  const trip = previewDay();
  const s = stateOf(trip, { todayISO: '2026-08-01', nowMin: 14 * 60 });
  const res = A.buildSuggestions(trip, s, { legMin: LEG });
  res.suggestions.forEach((x) => (x.reasons || []).forEach((r) => assert.ok(!/현재 위치/.test(r), r)));
});

// 2026-10-03 UX 검토 — 08:53에 열었더니 "점심 시간이 비어 있어요 · 09:41부터 비어 있어요"와 "조금 더 쉬기"가 나왔다.
test('제안: 식사 제안은 식사 시간대의 시작을 말한다(빈 시간의 시작이 아니라)', () => {
  const trip = tripOf([{ startAt: '09:00', mode: 'walk', spots: [Object.assign({ name: 'A', city: '도쿄', stayMin: 30 }, P(40.40))] }]);
  const s = stateOf(trip, { todayISO: TODAY, nowMin: 8 * 60 + 53, live: true });
  const res = A.buildSuggestions(trip, s, { legMin: LEG });
  const eat = res.suggestions.find((x) => x.action && x.action.kind === 'EAT');
  assert.ok(eat, '점심이 걸치는 빈 시간이면 식사 제안이 있다');
  assert.match(eat.description, /^11:30부터/, eat.description);
  assert.equal(eat.action.startMin, 11 * 60 + 30, '식사 장소 추가가 채우는 시각도 식사 시간대다');
});

test('제안: 하루가 시작되기 전에는 "조금 더 쉬기"를 권하지 않는다(컨디션이 낮다고 했으면 권한다)', () => {
  const trip = tripOf([{ startAt: '09:00', mode: 'walk', spots: [Object.assign({ name: 'A', city: '도쿄', stayMin: 30 }, P(40.40))] }]);
  const before = A.buildSuggestions(trip, stateOf(trip, { todayISO: TODAY, nowMin: 8 * 60 + 53, live: true }), { legMin: LEG });
  assert.ok(!before.suggestions.some((x) => x.type === 'REST'), '아무것도 하지 않았는데 쉬자고 하지 않는다');
  const tired = A.buildSuggestions(trip, stateOf(trip, { todayISO: TODAY, nowMin: 8 * 60 + 53, live: true, energyLevel: 'LOW' }), { legMin: LEG });
  assert.ok(tired.suggestions.some((x) => x.type === 'REST'), '지쳤다고 했으면 쉬는 선택지가 있다');
  const after = A.buildSuggestions(trip, stateOf(trip, { todayISO: TODAY, nowMin: 15 * 60, live: true }), { legMin: LEG });
  assert.ok(after.suggestions.some((x) => x.type === 'REST'), '하루가 진행된 뒤에는 쉬는 선택지가 정상이다');
  const preview = A.buildSuggestions(trip, stateOf(trip, { todayISO: '2026-08-01', nowMin: 15 * 60 }), { legMin: LEG });
  assert.ok(!preview.suggestions.some((x) => x.type === 'REST'), '여행 전 미리보기에서 "지금 쉬어도"라고 하지 않는다');
});

// ── 2026-10-03 3차 UX 검토: 여행 중 판단 엔진 ──────────────────────────────
// 서울 하루: 경복궁(09:00 도착 고정·2시간) → 북촌 → 광장시장(예약 12:30, 메모 '점심') → 남산 → 명동교자(예약 19:00, 메모 '저녁')
// → 롯데호텔(🏠 분류만 — 숙소 체크는 안 켰다). 붙여넣은 일정이 실제로 이런 모양이다.
function seoulTrip(mod) {
  const t = tripOf([
    { title: '고궁과 시장', mode: 'car', startAt: '09:00', spots: [
      { name: '경복궁', city: '서울', at: '09:00', stayMin: 120, lat: 37.5796, lng: 126.977 },
      { name: '북촌한옥마을', city: '서울', stayMin: 60, lat: 37.5826, lng: 126.985 },
      { name: '광장시장', city: '서울', desc: '점심 빈대떡', stayMin: 60, bookAt: '12:30', lat: 37.57, lng: 126.9996 },
      { name: '남산서울타워', city: '서울', stayMin: 90, lat: 37.5512, lng: 126.9882 },
      { name: '명동교자', city: '서울', desc: '저녁', stayMin: 60, bookAt: '19:00', lat: 37.5627, lng: 126.9852 },
      { name: '롯데호텔 서울', city: '서울', desc: '숙소', lat: 37.5651, lng: 126.981 }] },
    { title: '창덕궁과 인사동', mode: 'car', startAt: '09:00', spots: [
      { name: '창덕궁', city: '서울', stayMin: 120, lat: 37.5794, lng: 126.991 },
      { name: '인사동', city: '서울', stayMin: 90, lat: 37.5743, lng: 126.985 },
      { name: '서울숲', city: '서울', stayMin: 90, opt: true, lat: 37.5444, lng: 127.0374 }] }
  ]);
  if (mod) mod(t.days[0].spots);
  return t;
}
const seoulAt = (trip, min, extra) => stateOf(trip, Object.assign({ todayISO: TODAY, nowMin: min, live: true }, extra || {}));
const HM = (h, m) => h * 60 + (m || 0);

test('재구성: 머무는 중인 곳은 남은 체류만 더한다 — 제때 가고 있으면 늦는다고 하지 않는다', () => {
  const trip = seoulTrip();
  const s = seoulAt(trip, HM(10, 56));
  assert.equal(s.items[0].status, 'IN_PROGRESS', '경복궁에 머무는 중');
  assert.equal(A.generateReplan(s, { legMin: LEG }).needed, false, '광장시장 12:30에 제때 닿는다 — 경복궁 두 시간을 처음부터 다시 더하지 않는다');
  assert.ok(!A.buildSuggestions(trip, s, { legMin: LEG }).suggestions.some((x) => x.type === 'REPLAN'));
  assert.equal(A.departureAdvice(s, s.items[0], 0), null, '머무는 곳을 두고 "지금 출발해도 늦어요"라고 하지 않는다');
  assert.equal(A.departurePlan(s, s.items[0], 0), null);
  // 진짜로 늦는 약속은 그대로 잡는다
  const tight = seoulTrip((sp) => { sp[2].bookAt = '11:45'; });
  const late = A.generateReplan(seoulAt(tight, HM(10, 56)), { legMin: LEG });
  assert.equal(late.needed, true);
  assert.deepEqual(late.dropNames, ['북촌한옥마을'], '머무는 곳보다 아직 안 간 곳을 먼저 뺀다');
});

test('재구성: 시각상 지나온 곳(다녀왔다는 표시만 안 한 곳)을 다시 굴려 거짓 지연을 만들지 않는다', () => {
  const trip = seoulTrip();
  const s = seoulAt(trip, HM(16, 0));   // 아무것도 누르지 않은 오후 — 남산까지 지나왔고 명동교자 19:00이 남았다
  const plan = A.generateReplan(s, { legMin: LEG });
  assert.equal(plan.needed, false);
  assert.ok(plan.before.indexOf('경복궁') < 0, '지나온 곳은 남은 일정이 아니다');
});

test('재구성: 늦는 예약 앞의 장소만, 필요한 만큼만 뺀다 — 뒤 일정과 오늘 밤 숙소는 그대로', () => {
  const trip = seoulTrip((sp) => { sp[0].status = 'COMPLETED'; sp[2].bookAt = '11:45'; });
  const s = seoulAt(trip, HM(11, 5));
  const plan = A.generateReplan(s, { legMin: LEG });
  assert.equal(plan.needed, true);
  assert.equal(plan.feasible, true);
  assert.deepEqual(plan.dropNames, ['북촌한옥마을'], '북촌만 빼면 11:45에 맞춘다 — 남산·숙소는 그 예약과 상관없다');
  assert.ok(plan.after.indexOf('롯데호텔 서울') >= 0 && plan.after.indexOf('남산서울타워') >= 0);
  const res = A.buildSuggestions(trip, s, { legMin: LEG });
  const rp = res.suggestions.find((x) => x.type === 'REPLAN');
  assert.ok(rp, '조정 카드가 있다');
  assert.match(rp.title, /광장시장 11:45 예약에 \d+분 늦어요/, rp.title);
  assert.ok(!/지연|밀렸/.test(rp.title + ' ' + rp.reasons.join(' ')), '아직 늦지 않았다 — 지연·밀렸어요라고 하지 않는다');
  assert.match(rp.description, /^북촌한옥마을을 빼면 /, '조사는 받침에 맞춘다 — 을(를)을 쓰지 않는다');
  assert.ok(!res.suggestions.some((x) => x.type === 'NEXT_ACTIVITY'), '빼자는 카드 옆에서 한 곳 더 가자고 하지 않는다');
  assert.equal(res.notice, null, '카드가 있으면 따로 안내하지 않는다');
});

test('일정 조정: 🏠로 보이는 숙소·공항은 빼지 않고, 바꿀 것이 없으면 카드 대신 한 줄로 말한다', () => {
  const trip = tripOf([{ startAt: '14:00', mode: 'car', spots: [
    Object.assign({ name: '롯데호텔 서울', city: '서울', desc: '숙소', stayMin: 60 }, P(40.40)),
    Object.assign({ name: '바라하스 공항 (MAD)', city: '마드리드', stayMin: 30 }, P(40.45)),
    Object.assign({ name: 'Dinner', city: '마드리드', bookAt: '15:00', stayMin: 60 }, P(40.50))] }]);
  const s = stateOf(trip, { todayISO: TODAY, nowMin: 14 * 60 + 10, live: true });
  assert.equal(s.items[0].type, 'HOTEL', '목록이 🏠로 그리는 곳은 엔진도 숙소로 본다');
  assert.equal(A.commitmentOf({ name: '롯데호텔 서울', cat: 'food' }, {}, []).type, 'OTHER', '사람이 고른 분류가 이긴다');
  const plan = A.generateReplan(s, { legMin: LEG });
  assert.equal(plan.needed, true);
  assert.deepEqual(plan.drop, [], '숙소·공항은 뺄 후보가 아니다');
  const res = A.buildSuggestions(trip, s, { legMin: LEG });
  assert.ok(!res.suggestions.some((x) => x.type === 'REPLAN'), '기존과 제안이 같은 조정 카드는 띄우지 않는다');
  assert.match(res.notice, /Dinner 15:00 예약에 .+ 늦어요/, '늦는다는 사실은 사라지지 않는다');
  assert.match(A.tripPulse(s, plan).detail, /Dinner 15:00 예약에/, '하루 한 마디도 어느 약속인지 말한다');
});

test('출발 안내: 약속이 없는 곳에는 늦음·여유를 말하지 않고, 있는 곳은 시간으로 말한다', () => {
  const trip = seoulTrip((sp) => { sp[0].status = 'COMPLETED'; });
  const s = seoulAt(trip, HM(11, 1));
  const bukchon = s.items[1];
  assert.equal(bukchon.fixedAt, null);
  const adv = A.departureAdvice(s, bukchon, 2);
  assert.equal(adv.level, 'NOW');
  assert.equal(adv.text, '지금 출발하면 11:03 도착이에요', '예약도 정한 시각도 없는 곳은 사실만 말한다');
  const plan = A.departurePlan(s, bukchon, 2);
  assert.equal(plan.stage, 'UPCOMING', '약속이 없는 곳 때문에 출발·지연 알림을 보내지 않는다');
  assert.equal(plan.lateByMin, 0);
  assert.equal(A.notificationPlan(s, { departure: plan, replan: { needed: false } }).length, 0);

  // 앞서 끝낸 사람에게: 예약까지 남은 시간을 '분'으로 쌓지 않고, 기다리라는 말 대신 여유가 있다고 한다
  const ahead = seoulTrip((sp) => { sp[0].status = 'COMPLETED'; sp[1].status = 'COMPLETED'; });
  const sa = seoulAt(ahead, HM(10, 59));
  const early = A.departureAdvice(sa, sa.items[2], 4);
  assert.equal(early.level, 'EARLY');
  assert.match(early.text, /12:26쯤 출발하면 12:30 예약에 맞춰요/);
  assert.match(early.text, /1시간 27분 여유/);
  assert.ok(!/\d{2,}분 남음/.test(early.text), early.text);
  const s2 = seoulAt(ahead, HM(12, 26));
  assert.match(A.departureAdvice(s2, s2.items[2], 4).text, /^지금 바로 나서야 12:30 예약에 맞춰요/, '여유 0분을 "약 0분 여유"라고 하지 않는다');
});

test('여유는 다음 남은 일정까지다 — 쉬기 카드가 남은 계획을 없는 셈 치지 않는다', () => {
  const trip = seoulTrip((sp) => { sp[0].status = 'COMPLETED'; delete sp[2].bookAt; });
  const s = seoulAt(trip, HM(11, 0));
  assert.equal(s.freeBefore.name, '북촌한옥마을');
  assert.ok(s.availableMin < 30, '북촌으로 바로 가야 한다 — 명동교자까지 8시간이 아니다: ' + s.availableMin);
  const res = A.buildSuggestions(trip, s, { legMin: LEG });
  assert.ok(!res.suggestions.some((x) => x.type === 'REST'), '쉴 틈이 없는데 쉬어도 괜찮다고 하지 않는다');
  const tired = A.buildSuggestions(trip, seoulAt(trip, HM(11, 0), { energyLevel: 'LOW' }), { legMin: LEG });
  const rest = tired.suggestions.find((x) => x.title === '조금 더 쉬기');
  assert.ok(rest, '지쳤다고 하면 쉬기를 권한다');
  assert.ok(rest.reasons.some((r) => /북촌한옥마을이 늦어져요/.test(r)), '대신 그 대가를 말한다: ' + rest.reasons.join(' / '));
  assert.ok(!/여유가 있어요/.test(rest.description), rest.description);
  assert.notEqual(A.tripPulse(s, { needed: false }).code, 'FREE_TIME', '남은 곳이 있는데 "N시간 여유"라 하지 않는다');
});

test('하루 흐름: 남은 계획을 함께 그리고, 식사를 챙긴 시간대에는 식사를 또 넣지 않는다', () => {
  const trip = seoulTrip((sp) => { sp[0].status = 'COMPLETED'; delete sp[2].bookAt; });
  const s = seoulAt(trip, HM(11, 0));
  const flow = A.planDayFlow(trip, s, { legMin: LEG });
  const titles = flow.blocks.map((b) => b.title);
  ['북촌한옥마을', '광장시장', '남산서울타워', '명동교자'].forEach((n) => assert.ok(titles.indexOf(n) >= 0, n + '이(가) 흐름에 남는다'));
  assert.ok(titles.indexOf('경복궁') < 0, '다녀온 곳은 흐름에 없다');
  assert.ok(flow.blocks.filter((b) => b.kind === 'PLANNED').length >= 3, '남은 계획은 PLANNED로 그린다');
  assert.ok(!flow.blocks.some((b) => b.kind === 'SUGGESTED' && b.pick.type === 'EAT'), '메모가 저녁인 19:00 예약이 있으면 저녁을 또 넣지 않는다');
  let cursor = -1;
  flow.blocks.forEach((b) => { assert.ok(b.startMin >= cursor, '시간순'); cursor = b.startMin; });
  // 이대로면 늦는 날에는 더 넣지 않는다
  const late = seoulTrip((sp) => { sp[0].status = 'COMPLETED'; sp[2].bookAt = '11:45'; });
  const blocked = A.planDayFlow(late, seoulAt(late, HM(11, 5)), { legMin: LEG });
  assert.equal(blocked.blocked, 'REPLAN');
  assert.equal(blocked.picks.length, 0);
});

test('같은 화면의 카드는 같은 제외 목록을 쓴다 — 흐름에서 물린 곳은 제안에도, 제안에서 거절한 곳은 흐름에도 없다', () => {
  const trip = seoulTrip((sp) => { sp[0].status = 'COMPLETED'; });
  const s = seoulAt(trip, HM(11, 0));
  const flow = A.planDayFlow(trip, s, { legMin: LEG });
  const pickedIds = flow.picks.map((p) => p.id);
  assert.ok(pickedIds.length > 0);
  A.buildSuggestions(trip, s, { legMin: LEG, exclude: pickedIds }).suggestions
    .forEach((x) => assert.ok(pickedIds.indexOf(x.action.candidateId) < 0, x.title + '은(는) 흐름에서 물렸다'));
  const first = A.buildSuggestions(trip, s, { legMin: LEG }).suggestions.filter((x) => x.type === 'NEXT_ACTIVITY');
  const again = A.planDayFlow(trip, s, { legMin: LEG, dismissed: first.map((x) => x.key) });
  again.picks.forEach((p) => assert.ok(first.every((x) => x.title !== p.title), p.title + '은(는) 제안에서 거절했다'));
});

test('제안: "다른 제안 보기"는 거절한 자리를 비우지 않고 다음 후보를 보여 준다', () => {
  const many = [];
  for (let i = 0; i < 8; i++) many.push(Object.assign({ name: '장소' + i, city: '마드리드', stayMin: 30 }, P(40.40 + i * 0.005)));
  const trip = tripOf([
    { startAt: '09:00', mode: 'walk', spots: [Object.assign({ name: '숙소', city: '마드리드', stay: true, stayMin: 0 }, P(40.40))] },
    { spots: many }
  ]);
  const s = stateOf(trip, { todayISO: TODAY, nowMin: 10 * 60, live: true });
  const first = A.buildSuggestions(trip, s, { legMin: LEG }).suggestions.filter((x) => x.type === 'NEXT_ACTIVITY');
  const next = A.buildSuggestions(trip, s, { legMin: LEG, dismissed: first.map((x) => x.key) }).suggestions.filter((x) => x.type === 'NEXT_ACTIVITY');
  assert.equal(next.length, first.length, '거절한 만큼 다른 후보가 채운다');
  next.forEach((x) => assert.ok(first.every((f) => f.key !== x.key)));
});

test('말한 것이 제안을 실제로 바꾼다 — 지쳤어요·배고파·숙소로·쌩쌩해요', () => {
  const trip = seoulTrip((sp) => { sp[0].status = 'COMPLETED'; });
  const at = (intent, energy) => {
    const r = A.resolveIntent(intent, { energyLevel: energy });
    return A.buildSuggestions(trip, seoulAt(trip, HM(13, 40), { energyLevel: r.energyLevel, prefs: r.prefs }), { legMin: LEG }).suggestions;
  };
  const base = at('', 'NORMAL');
  const tired = at('오늘 좀 피곤해서 많이 걷기 싫어', 'NORMAL');
  assert.equal(tired[0].type, 'REST', '지쳤다고 하면 쉬기가 맨 위다');
  assert.ok(!tired.some((x) => x.type === 'NEXT_ACTIVITY' && x.impact.timeChangeMinutes >= 120), '두 시간짜리 방문은 권하지 않는다');
  assert.notDeepEqual(tired.map((x) => x.title), base.map((x) => x.title));
  const hungry = at('배고파', 'NORMAL');
  assert.equal(hungry[0].action.kind, 'EAT', '배고프다고 하면 식사가 맨 위다');
  const home = at('숙소로 들어가고 싶어', 'NORMAL');
  assert.equal(home[0].action.kind, 'RETURN_TO_HOTEL', '숙소로 가고 싶다고 하면 🏠로 보이는 롯데호텔로 가는 카드가 맨 위다');
  const lively = at('', 'HIGH');
  assert.ok(lively.some((x) => x.reasons.some((r) => /컨디션이 좋을 때/.test(r))), '쌩쌩하다고 해도 무엇이 달라졌는지 말한다');
});

test('"가는 길" 이유는 그 빈 시간 바로 뒤의 일정이 기준이다 — 이미 지난 약속·반대 방향을 기준으로 삼지 않는다', () => {
  const trip = seoulTrip();
  const s = seoulAt(trip, HM(10, 56));   // 다음 고정 일정은 광장시장 12:30이지만 빈 시간은 남산 뒤(15시대)다
  const res = A.buildSuggestions(trip, s, { legMin: LEG });
  const visits = res.suggestions.filter((x) => x.type === 'NEXT_ACTIVITY');
  assert.ok(visits.length > 0);
  visits.forEach((x) => assert.ok(!x.reasons.some((r) => /광장시장/.test(r)), x.title + ': ' + x.reasons.join(' / ')));
  const forest = visits.find((x) => x.title === '서울숲');
  if (forest) assert.ok(!forest.reasons.some((r) => /가는 길/.test(r)), '명동교자와 다른 방향인 서울숲은 가는 길이 아니다');
});

test('옮겨올 곳이 너무 멀면 "한 곳 더"로 권하지 않는다', () => {
  const trip = tripOf([
    { startAt: '09:00', mode: 'car', spots: [{ name: '성산일출봉', city: '제주', stayMin: 60, lat: 33.4581, lng: 126.9425 }] },
    { startAt: '09:00', mode: 'car', spots: [{ name: '협재해수욕장', city: '제주', stayMin: 60, lat: 33.394, lng: 126.2397 },
      { name: '섭지코지 카페', city: '제주', stayMin: 60, lat: 33.43, lng: 126.93 }] }]);
  const s = stateOf(trip, { todayISO: '2026-08-01', nowMin: 9 * 60 });
  const flow = A.planDayFlow(trip, s, { legMin: LEG });
  assert.ok(!flow.picks.some((p) => p.title === '협재해수욕장'), '섬 반대편을 끌어오지 않는다');
  assert.ok(flow.picks.some((p) => p.title === '섭지코지 카페'), '가까운 곳은 여전히 채운다');
});

test('메모가 가벼운 하루라고 하면 빈칸을 한 곳만 채우고, 이동 시간에는 "약"을 붙인다', () => {
  const trip = TC.sampleTrip();   // Day 1 메모: '07:00 착륙. 시차적응 겸 가벼운 일정'
  const day = trip.days[0];
  const s = A.buildTripState(trip, { dayIndex: 0, todayISO: '2026-10-01', nowMin: 600, timeline: TC.computeTimeline(day, { legMin: LEG }), legMin: LEG });
  const flow = A.planDayFlow(trip, s, { legMin: LEG });
  assert.equal(flow.light, true);
  assert.ok(flow.picks.length <= 1, '가벼운 날에 다음 날 명소를 줄줄이 당겨 오지 않는다');
  const res = A.buildSuggestions(trip, s, { legMin: LEG });
  res.suggestions.filter((x) => x.type === 'NEXT_ACTIVITY' && x.action.si != null)
    .forEach((x) => assert.match(x.description, /^약 \d/, x.description));
  res.suggestions.forEach((x) => x.reasons.forEach((r) => assert.ok(!/공항/.test(r), '07:00 공항을 "가는 길" 기준으로 삼지 않는다: ' + r)));
});

test('숫자와 조사: 한 시간이 넘으면 시간으로, 조사는 받침에 맞춘다', () => {
  assert.equal(A.durText(445), '7시간 25분');
  assert.equal(A.durText(480), '8시간');
  assert.equal(A.durText(45), '45분');
  assert.equal(A.durText(0), '0분');
  assert.equal(A.josa('북촌한옥마을', '은', '는'), '은');
  assert.equal(A.josa('롯데호텔 서울', '을', '를'), '을');
  assert.equal(A.josa('남산서울타워', '을', '를'), '를');
  assert.equal(A.josa('바라하스 공항 (MAD)', '을', '를'), '를', '한글로 끝나지 않으면 받침 없는 쪽');
  assert.equal(A.josa('금', '이라고', '라고'), '이라고');
  assert.equal(A.josa('토', '이라고', '라고'), '라고');
  assert.equal(A.josa('서울', '으로', '로'), '로', 'ㄹ 받침은 로');
  const s = stateOf(dinnerTrip(), { todayISO: TODAY, nowMin: 9 * 60, live: true, startAnchor: P(40.40) });
  assert.ok(!/\d{3,}분/.test(A.departurePlan(s, s.items[1], 44).text), '세 자리 분으로 말하지 않는다');
});

test('엔진이 묻는 이동의 수단은 일정 화면과 같다 — 비행기로 도착한 날의 시내 제안을 비행기 속도로 재지 않는다', () => {
  const trip = {
    days: [
      { mode: 'flight', spots: [{ name: '바라하스 공항', lat: 40.49, lng: -3.57 }, { name: '호텔', lat: 40.42, lng: -3.70, legMode: 'taxi' }] },
      { mode: 'transit', spots: [{ name: '프라도', lat: 40.414, lng: -3.692 }, { name: '레티로', lat: 40.415, lng: -3.684, legMode: 'walk' }] },
      { mode: 'train', spots: [] }
    ]
  };
  const day0 = trip.days[0];
  assert.equal(A.moveModeTo(trip, day0, { lat: 40.49, lng: -3.57 }), 'flight', '그날 일정의 공항은 일정 화면처럼 일자 수단(✈️)');
  assert.equal(A.moveModeTo(trip, day0, { lat: 40.42, lng: -3.70 }), 'taxi', '구간 수단을 정한 곳은 그 수단');
  assert.equal(A.moveModeTo(trip, day0, { lat: 40.414, lng: -3.692 }), 'transit', '다른 날에서 옮겨올 곳은 그날 그곳으로 가던 수단');
  assert.equal(A.moveModeTo(trip, day0, { lat: 40.415, lng: -3.684 }), 'walk');
  assert.equal(A.moveModeTo(trip, day0, { lat: 40.5, lng: -3.6 }), 'transit', '모르는 곳은 비행기·기차가 아닌 여행의 도시 안 수단');
  assert.equal(A.moveModeTo(trip, trip.days[1], { lat: 40.5, lng: -3.6 }), 'transit', '도시 안 수단의 날은 그날 수단');
  assert.equal(A.moveModeTo({ days: [{ mode: 'flight', spots: [] }] }, { mode: 'flight', spots: [] }, { lat: 1, lng: 1 }), 'car', '아무것도 없으면 자차');
});

// ── 2026-10-03 3차 UX 검토 반박 검토 ──────────────────────────────────────
test('배고프다고 해도 하루 흐름은 빈 시간 안에만 넣는다 — 머무는 곳·남은 일정 위에 겹치지 않는다', () => {
  const trip = seoulTrip();
  const r = A.resolveIntent('배고파', { energyLevel: 'NORMAL' });
  const s = seoulAt(trip, HM(10, 0), { energyLevel: r.energyLevel, prefs: r.prefs });   // 경복궁에 머무는 중
  const flow = A.planDayFlow(trip, s, { legMin: LEG });
  assert.ok(!flow.picks.some((p) => p.id === 'c-eat-now'), "'지금 식사부터 하기'는 빈 시간이 아니라 지금의 일이다");
  const sug = flow.blocks.filter((b) => b.kind === 'SUGGESTED');
  const planned = flow.blocks.filter((b) => b.kind !== 'SUGGESTED');
  sug.forEach((b) => planned.forEach((p) => assert.ok(b.endMin <= p.startMin || b.startMin >= p.endMin,
    b.title + ' ' + TC.hm(b.startMin) + '–' + TC.hm(b.endMin) + '이 ' + p.title + ' ' + TC.hm(p.startMin) + '–' + TC.hm(p.endMin) + '과 겹친다')));
  // 제안 카드는 '지금'에 답한다 — 식사 카드는 하나다
  const cards = A.buildSuggestions(trip, s, { legMin: LEG }).suggestions;
  assert.equal(cards[0].action.candidateId, 'c-eat-now');
  assert.equal(cards.filter((x) => x.action.kind === 'EAT').length, 1, '같은 말(식사)을 두 장으로 하지 않는다');
});

test('출발 안내: 내가 정한 도착 시각은 "그 시각에 도착해요"로 말한다', () => {
  const s = seoulAt(seoulTrip(), HM(8, 30));
  const adv = A.departureAdvice(s, s.items[0], 5);
  assert.equal(adv.level, 'EARLY');
  assert.equal(adv.text, '08:55쯤 출발하면 09:00에 도착해요 · 그 전까지 25분 여유가 있어요');
});

// ── ux3 남은 것 ──
test('가벼운 날은 제안 카드도 들를 곳을 한 곳만 권한다 — 하루 흐름과 같은 규칙', () => {
  const count = (light) => {
    const trip = TC.sampleTrip(), day = trip.days[0];
    if (!light) { day.note = ''; day.title = '도착'; }
    const s = A.buildTripState(trip, { dayIndex: 0, todayISO: '2026-10-01', nowMin: 600, timeline: TC.computeTimeline(day, { legMin: LEG }), legMin: LEG });
    return A.buildSuggestions(trip, s, { legMin: LEG }).suggestions.filter((x) => x.action.kind === 'VISIT_PLACE').length;
  };
  assert.ok(count(false) > 1, '보통 날은 여럿을 권한다(이 테스트가 뜻이 있으려면)');
  assert.equal(count(true), 1);
});

test('일정 조정에서 빼는 곳의 문장 — 조사를 이름에 맞추고, 웹과 앱이 같은 말을 쓴다', () => {
  assert.equal(A.replanDropNote(['경복궁', '북촌한옥마을'], true), '경복궁, 북촌한옥마을은 다음 날 앞쪽으로 옮겨요');
  assert.equal(A.replanDropNote(['Sagrada'], false), "Sagrada는 '건너뜀'으로 표시해요");
  assert.equal(A.replanDropNote([], true), null);
});
