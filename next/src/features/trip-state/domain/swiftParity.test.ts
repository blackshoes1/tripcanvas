// contract.ts ↔ iOS Contract.swift 정합성.
//
// 계약이 갈라지는 사고는 조용히 일어난다: 서버가 필드 이름을 바꿔도 웹은 TypeScript가 잡아주지만
// Swift는 다음 빌드까지 아무도 모른다. 여기서 **실제 Today 응답**을 만들어 Swift 구조체의
// 프로퍼티 이름과 맞춰 본다. Swift를 컴파일하지 않고도 이름이 어긋난 것은 잡힌다.
//
// 이 테스트가 깨지면 둘 중 하나다: contract.ts를 고치고 Swift를 안 고쳤거나, 그 반대.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { computeToday } from './todayView';
import type { TripDoc } from './todayView';
import { buildBookings } from './bookingsView';
import { buildTravelState } from './travelState';
import { buildImportPreview } from './intakeView';
import { buildDayPlanView } from './dayPlanView';
import { buildGroupProposalView } from './groupProposalView';

const SWIFT = readFileSync(path.join(__dirname, '../../../../../ios/TripCanvas/Core/Models/Contract.swift'), 'utf8');

/** Contract.swift에서 struct 하나의 저장 프로퍼티 이름을 뽑는다 (계산 프로퍼티 `var x: T { ... }`는 제외). */
function swiftProperties(structName: string): Set<string> {
  const start = SWIFT.indexOf(`struct ${structName}:`);
  if (start < 0) throw new Error(`Contract.swift에 struct ${structName}이 없습니다`);
  // 중괄호 깊이로 struct 본문 끝을 찾는다 (중첩 struct 대응).
  let depth = 0;
  let i = SWIFT.indexOf('{', start);
  const bodyStart = i + 1;
  for (; i < SWIFT.length; i++) {
    if (SWIFT[i] === '{') depth++;
    else if (SWIFT[i] === '}') { depth--; if (depth === 0) break; }
  }
  const body = SWIFT.slice(bodyStart, i);
  const names = new Set<string>();
  for (const line of body.split('\n')) {
    const m = /^\s*(?:let|var)\s+([A-Za-z_][A-Za-z0-9_]*)\s*:/.exec(line);
    if (!m) continue;
    if (line.includes('{')) continue;   // 계산 프로퍼티는 JSON 키가 아니다
    names.add(m[1]);
  }
  return names;
}

const trip: TripDoc = {
  id: 'parity', name: '정합성', start: '2026-09-01', timeZone: 'Asia/Seoul',
  days: [
    {
      title: '첫날', mode: 'car', startAt: '09:00', spots: [
        { name: '숙소', city: '마드리드', stay: true, stayMin: 0, lat: 40.40, lng: -3.70 },
        { name: '저녁 예약', city: '마드리드', bookAt: '19:00', stayMin: 90, lat: 40.41, lng: -3.70, bookUrl: 'https://example.com', bookingId: 'bk1' }
      ]
    },
    { title: '이튿날', mode: 'car', spots: [{ name: '공원', city: '마드리드', stayMin: 90, lat: 40.405, lng: -3.70 }] }
  ],
  bookings: [{ id: 'bk1', type: 'hotel', title: '호텔', provider: 'Booking', price: 100000, cur: 'KRW', start: '2026-09-01', end: '2026-09-03' }]
};

const today = computeToday({
  tripId: 'parity', trip, revision: 2, updatedAt: '2026-08-31T00:00:00Z',
  todayISO: '2026-09-01', nowMinutes: 13 * 60, generatedAt: '2026-09-01T04:00:00Z'
}).response;

/** JSON 객체의 키가 Swift 프로퍼티에 전부 있는지 (Swift에만 있는 여분은 허용 — 옵셔널일 수 있다) */
function expectCovered(structName: string, value: Record<string, unknown>) {
  const swift = swiftProperties(structName);
  const missing = Object.keys(value).filter((k) => !swift.has(k));
  expect(missing, `${structName}에 없는 필드`).toEqual([]);
}

describe('iOS Contract.swift가 실제 응답을 전부 담는다', () => {
  it('TodayResponse와 그 안의 모든 구조체', () => {
    expectCovered('TodayResponse', today as unknown as Record<string, unknown>);
    expectCovered('TripSummary', today.trip as unknown as Record<string, unknown>);
    expectCovered('DaySummary', today.day as unknown as Record<string, unknown>);
    expectCovered('TripStateSummary', today.currentState as unknown as Record<string, unknown>);
    expectCovered('ReplanPreview', today.replan as unknown as Record<string, unknown>);
    expectCovered('TravelActivityState', today.activityState as unknown as Record<string, unknown>);
    expect(today.activities.length).toBeGreaterThan(0);
    expectCovered('ActivitySummary', today.activities[0] as unknown as Record<string, unknown>);
    expect(today.fixedCommitments.length).toBeGreaterThan(0);
    expectCovered('FixedCommitmentSummary', today.fixedCommitments[0] as unknown as Record<string, unknown>);
    expect(today.nextAction).toBeTruthy();
    expectCovered('NextAction', today.nextAction as unknown as Record<string, unknown>);
    expectCovered('DepartureAdvice', today.nextAction!.departure as unknown as Record<string, unknown>);
    expect(today.suggestions.length).toBeGreaterThan(0);
    expectCovered('TripSuggestion', today.suggestions[0] as unknown as Record<string, unknown>);
    expectCovered('SuggestionAction', today.suggestions[0].action as unknown as Record<string, unknown>);
  });

  /**
   * 일자 계획 — 일정 화면이 쓰는 하루치. 값(분·km)만 싣고 문장은 앱이 만든다.
   * 계약이 갈라지면 앱이 조용히 빈 하루를 그리게 되므로 여기서 이름을 맞춰 본다.
   */
  it('DayPlanResponse와 그 안의 구조체', () => {
    const plan = buildDayPlanView({
      trip, di: 0, summary: today.trip, generatedAt: '2026-09-01T04:00:00Z'
    });
    expect(plan).toBeTruthy();
    expectCovered('DayPlanResponse', plan as unknown as Record<string, unknown>);
    expectCovered('DayPlanDay', plan!.day as unknown as Record<string, unknown>);
    expectCovered('DayPlanTotals', plan!.day.totals as unknown as Record<string, unknown>);
    expectCovered('DayPlanCost', plan!.day.totals.cost as unknown as Record<string, unknown>);
    expect(plan!.day.spots.length).toBeGreaterThan(0);
    expectCovered('DayPlanSpot', plan!.day.spots[0] as unknown as Record<string, unknown>);
    const leg = plan!.day.spots.map((s) => s.incomingLeg).find(Boolean);
    expect(leg, '구간이 하나는 있어야 계약을 맞춰 볼 수 있다').toBeTruthy();
    expectCovered('DayPlanLeg', leg as unknown as Record<string, unknown>);
    expectCovered('DayPlanSplit', { key: 's', from: 0, to: 1, branches: [] });
    expectCovered('DayPlanSplitBranch', { participants: [], spotIndexes: [] });
    expect(plan!.days.length).toBe(plan!.dayCount);
    expectCovered('DayPlanStripEntry', plan!.days[0] as unknown as Record<string, unknown>);
  });

  /**
   * 그룹 제안(§35) — 판정은 서버 하나(`collab.js`)가 하고 앱은 그린다.
   * 계약이 갈라지면 앱이 조용히 빈 카드를 그리게 되므로 여기서 이름을 맞춰 본다.
   */
  it('GroupProposalView와 그 안의 구조체', () => {
    const reactions = [
      { user_id: 'u1', name: '민수', reaction: 'MUST', me: true },
      { user_id: 'u2', name: '영희', reaction: 'MUST', me: false }
    ];
    const proposal = buildGroupProposalView({
      candidates: [
        { id: 1, title: '카사 바트요', status: 'PROPOSED', lat: 40.41, lng: -3.70, must_count: 2, ok_count: 0, pass_count: 0, reactions },
        { id: 2, title: '공원 산책', status: 'PROPOSED', must_count: 2, ok_count: 0, pass_count: 0, reactions }
      ],
      days: trip.days ?? [],
      memberCount: 2,
      preferences: [{ mine: true, label: '나', prefs: { pace: 'RELAXED', walking: 'LOW' } }]
    });
    expect(proposal, '제안이 만들어져야 이름을 맞춰 볼 수 있다').toBeTruthy();
    expectCovered('GroupProposalView', proposal as unknown as Record<string, unknown>);
    expectCovered('GroupProposalPick', proposal!.picks[0] as unknown as Record<string, unknown>);
    expectCovered('GroupProposalImpact', proposal!.impact as unknown as Record<string, unknown>);
    expectCovered('GroupProposalOption', proposal!.options[0] as unknown as Record<string, unknown>);

    // 좌표를 모르는 후보는 거리도 null이다 — 0으로 채우지 않는다
    const noCoord = proposal!.picks.find((p) => p.title === '공원 산책');
    expect(noCoord?.distanceKm).toBeNull();

    // ⚠️ 점수는 내부값이다(§21·§22) — 앱에 내려가는 JSON 어디에도 없다
    expect(JSON.stringify(proposal)).not.toContain('score');
  });

  it('BookingSummary와 PriceStatus', () => {
    const bookings = buildBookings(trip, [{
      booking_id: 'bk1', seller: 'Agoda', price: 90000, currency: 'KRW', quality: 'EXACT', verified: true,
      offers: [{ seller: 'Agoda', price: 90000, cur: 'KRW', quality: 'EXACT', verified: true }],
      observed_at: '2026-08-31T21:00:00Z'
    }], '2026-09-01');
    expect(bookings).toHaveLength(1);
    expectCovered('BookingSummary', bookings[0] as unknown as Record<string, unknown>);
    expect(bookings[0].priceStatus).toBeTruthy();
    expectCovered('PriceStatus', bookings[0].priceStatus as unknown as Record<string, unknown>);
  });

  it('Swift enum이 서버가 실제로 보내는 값을 전부 안다', () => {
    // 서버가 새 값을 보내도 앱이 죽지 않도록 .unknown 폴백을 두었지만,
    // '지금 보내는 값'까지 unknown으로 떨어지면 화면이 "상태 확인 필요"만 반복한다.
    const statuses = ['NO_PLAN', 'UPCOMING', 'READY_TO_LEAVE', 'TRAVELING', 'ARRIVED', 'IN_PROGRESS', 'DELAYED', 'COMPLETED'];
    statuses.forEach((s) => expect(SWIFT, `TravelStatus.${s}`).toContain(`"${s}"`));
    ['FIXED', 'SEMI_FIXED', 'FLEXIBLE'].forEach((s) => expect(SWIFT).toContain(`"${s}"`));
    ['PLANNED', 'READY', 'IN_PROGRESS', 'COMPLETED', 'SKIPPED', 'CANCELLED'].forEach((s) => expect(SWIFT).toContain(`"${s}"`));
    ['FLIGHT', 'TRAIN', 'HOTEL', 'RESTAURANT', 'TOUR', 'CAR', 'OTHER'].forEach((s) => expect(SWIFT).toContain(`"${s}"`));
    ['NEXT_ACTIVITY', 'REPLAN', 'PRICE_SAVING', 'REST'].forEach((s) => expect(SWIFT).toContain(`"${s}"`));
    ['VISIT_PLACE', 'CHECK_IN', 'MOVE_TO_TODAY', 'RETURN_TO_HOTEL', 'EAT', 'OPEN_BOOKING'].forEach((s) => expect(SWIFT).toContain(`"${s}"`));
    ['SAVING_AVAILABLE', 'CHEAPER_UNVERIFIED', 'GOOD_PRICE', 'WATCHING', 'ERROR', 'UNTRACKED'].forEach((s) => expect(SWIFT).toContain(`"${s}"`));
    ['STRAIGHT_LINE_ESTIMATE', 'ROUTED'].forEach((s) => expect(SWIFT).toContain(`"${s}"`));
    ['MANUAL', 'ASSISTED', 'DELEGATED'].forEach((s) => expect(SWIFT).toContain(`"${s}"`));
    ['LOW', 'NORMAL', 'HIGH'].forEach((s) => expect(SWIFT).toContain(`"${s}"`));
    ['EARLY', 'NOW', 'LATE'].forEach((s) => expect(SWIFT).toContain(`"${s}"`));
    ['OWNER', 'EDITOR', 'VIEWER'].forEach((s) => expect(SWIFT, `MemberRole.${s}`).toContain(`"${s}"`));
  });

  it('iOS 테스트 픽스처를 실제 응답으로 갱신한다', () => {
    // 픽스처를 손으로 쓰면 반드시 실제 응답과 갈라진다. 여기서 매번 다시 쓴다 —
    // generatedAt까지 고정된 결정적 값이라 diff가 생기면 계약이 바뀐 것이다.
    const dir = path.join(__dirname, '../../../../../ios/TripCanvasTests/Fixtures');
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'today.json'), JSON.stringify(today, null, 2) + String.fromCharCode(10));
    const plan = buildDayPlanView({ trip, di: 0, summary: today.trip, generatedAt: '2026-09-01T04:00:00Z' });
    writeFileSync(path.join(dir, 'day-plan.json'), JSON.stringify(plan, null, 2) + String.fromCharCode(10));
    expect(today.schemaVersion).toBe(1);
    expect(plan!.schemaVersion).toBe(1);
  });
});

const travel = buildTravelState({
  tripId: 'parity', trip, revision: 2, updatedAt: '2026-08-31T00:00:00Z',
  todayISO: '2026-09-01', nowMinutes: 18 * 60 + 55, generatedAt: '2026-09-01T09:55:00Z',
  travelMode: true
});

describe('Travel State도 Swift가 전부 담는다', () => {
  it('TravelStateResponse와 그 안의 구조체', () => {
    expectCovered('TravelStateResponse', travel as unknown as Record<string, unknown>);
    expectCovered('TripPulse', travel.pulse as unknown as Record<string, unknown>);
    expect(travel.departure).toBeTruthy();
    expectCovered('DeparturePlan', travel.departure as unknown as Record<string, unknown>);
    expectCovered('LiveActivityState', travel.liveActivity as unknown as Record<string, unknown>);
    expectCovered('WidgetSnapshot', travel.widget as unknown as Record<string, unknown>);
    expect(travel.widget.nextActivity).toBeTruthy();
    expectCovered('WidgetActivity', travel.widget.nextActivity as unknown as Record<string, unknown>);
    expect(travel.notifications.length).toBeGreaterThan(0);
    expectCovered('NotificationPlanItem', travel.notifications[0] as unknown as Record<string, unknown>);
  });

  it('Travel State enum도 Swift가 안다', () => {
    ['NO_PLAN', 'ON_TRACK', 'AHEAD', 'DELAYED', 'FREE_TIME', 'NEEDS_ATTENTION', 'RESTING', 'DAY_COMPLETE']
      .forEach((s) => expect(SWIFT, `TripPulseCode.${s}`).toContain(`"${s}"`));
    ['UPCOMING', 'READY_TO_LEAVE', 'LATE_RISK'].forEach((s) => expect(SWIFT).toContain(`"${s}"`));
    ['DEVICE', 'SERVER'].forEach((s) => expect(SWIFT).toContain(`"${s}"`));
    // 알림 종류는 Swift에서 case 이름 그대로 쓴다(rawValue 생략)
    ['departureReminder', 'fixedCommitmentReminder', 'scheduleDelay', 'replanSuggestion', 'emptySlotSuggestion', 'priceSaving']
      .forEach((s) => expect(SWIFT, `NotificationKind.${s}`).toContain(s));
  });

  it('잠금화면·위젯 압축본에 민감한 값이 들어가지 않는다 (§54)', () => {
    const serialized = JSON.stringify(travel.liveActivity) + JSON.stringify(travel.widget);
    ['confirmation', 'bookUrl', 'placeId', 'bookingId'].forEach((key) => {
      expect(serialized, `${key}는 잠금화면에 나가면 안 된다`).not.toContain(key);
    });
    expect(travel.widget.upcoming.length).toBeLessThanOrEqual(3);
  });

  it('iOS 테스트 픽스처(travel-state)도 실제 응답으로 갱신한다', () => {
    const dir = path.join(__dirname, '../../../../../ios/TripCanvasTests/Fixtures');
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'travel-state.json'), JSON.stringify(travel, null, 2) + String.fromCharCode(10));
    expect(travel.stateVersion).toBe(travel.liveActivity.stateVersion);
  });
});

const preview = buildImportPreview(
  {
    url: 'https://www.booking.com/hotel/es/cap-rocat.html',
    title: 'Cap Rocat | Booking.com',
    text: '예약 번호: ABC12345\n체크인 2026-09-02\n체크아웃 2026-09-04\n총액 EUR 1,420'
  },
  [{ client_id: 'parity', data: trip }],
  { year: 2026 }
);

describe('유입·기록 계약도 Swift가 전부 담는다', () => {
  it('ImportPreviewResponse와 BookingCandidate', () => {
    expectCovered('ImportPreviewResponse', preview as unknown as Record<string, unknown>);
    expect(preview.candidate).toBeTruthy();
    expectCovered('BookingCandidate', preview.candidate as unknown as Record<string, unknown>);
    expect(preview.tripMatches.length).toBeGreaterThan(0);
    expectCovered('TripMatch', preview.tripMatches[0] as unknown as Record<string, unknown>);
  });

  it('유입 enum도 Swift가 안다', () => {
    ['BOOKING', 'PLACE', 'TRANSPORT', 'NOTE', 'UNKNOWN'].forEach((s) => expect(SWIFT, `ShareKind.${s}`).toContain(`"${s}"`));
    ['HOTEL', 'FLIGHT', 'TRAIN', 'CAR', 'RESTAURANT', 'TOUR', 'OTHER'].forEach((s) => expect(SWIFT).toContain(`"${s}"`));
    ['AUTO', 'REVIEW', 'MANUAL'].forEach((s) => expect(SWIFT, `CandidateDisposition.${s}`).toContain(`"${s}"`));
    ['PHOTO', 'NOTE', 'VISIT', 'MOMENT'].forEach((s) => expect(SWIFT, `MemoryType.${s}`).toContain(`"${s}"`));
  });

  it('공유 키 규칙이 앱과 서버에서 같다 — 다르면 같은 공유가 두 번 처리된다', () => {
    // Swift의 SharedTravelInput.makeId와 같은 알고리즘이어야 한다(djb2 xor, UTF-16 단위, base36).
    const swiftSource = readFileSync(
      path.join(__dirname, '../../../../../ios/TripCanvasShared/ShareQueue.swift'), 'utf8');
    expect(swiftSource).toContain('hash = ((hash &* 33) ^ UInt32(unit))');
    expect(swiftSource).toContain('radix: 36');
    expect(swiftSource).toContain('prefix(500)');
    expect(preview.idempotencyKey).toMatch(/^sh[0-9a-z]+$/);
  });

  it('예약 후보를 미리보기 없이 저장하는 경로가 없다', () => {
    // disposition이 AUTO여도 저장은 별도 요청(commit)이다.
    expect(['AUTO', 'REVIEW', 'MANUAL']).toContain(preview.candidate!.disposition);
    expect(preview).not.toHaveProperty('bookingId');
    expect(preview).not.toHaveProperty('saved');
  });

  it('iOS 테스트 픽스처(import-preview)도 실제 응답으로 갱신한다', () => {
    const dir = path.join(__dirname, '../../../../../ios/TripCanvasTests/Fixtures');
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'import-preview.json'), JSON.stringify(preview, null, 2) + String.fromCharCode(10));
    expect(preview.schemaVersion).toBe(1);
  });
});
