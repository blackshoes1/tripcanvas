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
import legacyLib from '@legacy/lib.js';

import { computeToday } from './todayView';
import type { TripDoc } from './todayView';
import { buildBookings } from './bookingsView';
import { buildTravelState } from './travelState';
import { buildImportPreview, buildMemoryTimeline } from './intakeView';
import { buildDayPlanView } from './dayPlanView';
import { buildGroupProposalView } from './groupProposalView';
import { buildTripRoutes } from './tripRoutesView';
import type {
  BookingListResponse, GroupProposalResponse, ImportCommitResponse, ItineraryParseResponse,
  MemoryCreateResponse, MemoryEvent, MemoryListResponse, MutationResponse, TripListResponse
} from './contract';

const SWIFT = readFileSync(path.join(__dirname, '../../../../../ios/TripCanvas/Core/Models/Contract.swift'), 'utf8');

/** Contract.swift에서 struct 하나의 저장 프로퍼티를 `이름 → 타입`으로 뽑는다 (계산 프로퍼티 `var x: T { ... }`는 제외). */
function swiftPropertyTypes(structName: string): Map<string, string> {
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
  const props = new Map<string, string>();
  for (const line of body.split('\n')) {
    const m = /^\s*(?:let|var)\s+([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([^=]+?)\s*(?:=.*)?$/.exec(line);
    if (!m) continue;
    if (line.includes('{')) continue;   // 계산 프로퍼티는 JSON 키가 아니다
    props.set(m[1], m[2].trim());
  }
  return props;
}

/** 이름만 필요할 때. */
function swiftProperties(structName: string): Set<string> {
  return new Set(swiftPropertyTypes(structName).keys());
}

/** Contract.swift가 선언한 모든 struct 이름. */
const SWIFT_STRUCTS = new Set(
  [...SWIFT.matchAll(/^\s*(?:public\s+)?struct\s+([A-Za-z0-9_]+)\s*:/gm)].map((m) => m[1])
);

/** `[Foo]?` · `Foo?` · `[Foo]` → `Foo`. 딕셔너리·제네릭은 따라가지 않는다. */
function elementStruct(type: string | undefined): string | null {
  if (!type) return null;
  let t = type.trim();
  while (t.endsWith('?') || t.endsWith('!')) t = t.slice(0, -1).trim();
  while (t.startsWith('[') && t.endsWith(']')) {
    t = t.slice(1, -1).trim();
    if (t.includes(':')) return null;   // [String: X] — JSON 키가 프로퍼티 이름이 아니다
    while (t.endsWith('?') || t.endsWith('!')) t = t.slice(0, -1).trim();
  }
  return SWIFT_STRUCTS.has(t) ? t : null;
}

/** 이번 파일에서 실제로 들여다본 struct — 점호(아래)가 이 집합을 본다. */
const visited = new Set<string>();

const trip: TripDoc = {
  id: 'parity', name: '정합성', start: '2026-09-01', timeZone: 'Asia/Seoul',
  days: [
    {
      title: '첫날', mode: 'car', startAt: '09:00',
      flight: { code: 'IB3100', dep: 'MAD', arr: 'SVQ', depAt: '08:05', arrAt: '09:00' },
      spots: [
        { name: '숙소', city: '마드리드', stay: true, stayMin: 0, lat: 40.40, lng: -3.70 },
        { name: '저녁 예약', city: '마드리드', bookAt: '19:00', stayMin: 90, lat: 40.41, lng: -3.70, bookUrl: 'https://example.com', bookingId: 'bk1' }
      ]
    },
    { title: '이튿날', mode: 'car', spots: [{ name: '공원', city: '마드리드', stayMin: 90, lat: 40.405, lng: -3.70 }] }
  ],
  bookings: [{ id: 'bk1', type: 'hotel', title: '호텔', provider: 'Booking', price: 100000, cur: 'KRW', start: '2026-09-01', end: '2026-09-03' }]
};

// 자연어 요청을 함께 보낸다 — 그래야 `intent` 에코가 응답에 실려 파리티가 그 구조체까지 본다.
const today = computeToday({
  tripId: 'parity', trip, revision: 2, updatedAt: '2026-08-31T00:00:00Z',
  todayISO: '2026-09-01', nowMinutes: 13 * 60, generatedAt: '2026-09-01T04:00:00Z',
  intent: '오늘 좀 피곤해서 많이 걷기 싫어'
}).response;

/**
 * JSON 값의 키가 Swift 프로퍼티에 전부 있는지. Swift에만 있는 여분은 허용한다(옵셔널일 수 있다).
 *
 * ⚠️ **중첩 구조체까지 따라 들어간다**(2026-09-21). 전에는 한 겹만 봤고, 그래서 중첩된 구조체는
 * 호출을 하나씩 손으로 더해 줘야 coverage에 들어왔다 — 75개 중 32개가 아무도 안 보는 채로 남아
 * 있었다. 지금은 Swift가 선언한 **타입**을 따라 내려가므로, 표본에 값이 있으면 저절로 덮인다.
 */
function cover(structName: string, value: unknown, at = structName): void {
  if (value === null || value === undefined) return;
  if (Array.isArray(value)) {
    value.forEach((item, i) => cover(structName, item, `${at}[${i}]`));
    return;
  }
  if (typeof value !== 'object') return;
  visited.add(structName);
  const props = swiftPropertyTypes(structName);
  const missing = Object.keys(value).filter((k) => !props.has(k));
  expect(missing, `${at}(${structName})에 없는 필드`).toEqual([]);
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const nested = elementStruct(props.get(key));
    if (nested) cover(nested, child, `${at}.${key}`);
  }
}

function expectCovered(structName: string, value: unknown) {
  cover(structName, value);
}

describe('iOS Contract.swift가 실제 응답을 전부 담는다', () => {
  it('TodayResponse와 그 안의 모든 구조체', () => {
    expectCovered('TodayResponse', today);
    expectCovered('TripSummary', today.trip);
    expectCovered('DaySummary', today.day);
    expectCovered('TripStateSummary', today.currentState);
    expectCovered('ReplanPreview', today.replan);
    expectCovered('TravelActivityState', today.activityState);
    expect(today.activities.length).toBeGreaterThan(0);
    expectCovered('ActivitySummary', today.activities[0]);
    expect(today.fixedCommitments.length).toBeGreaterThan(0);
    expectCovered('FixedCommitmentSummary', today.fixedCommitments[0]);
    expect(today.nextAction).toBeTruthy();
    expectCovered('NextAction', today.nextAction);
    expectCovered('DepartureAdvice', today.nextAction!.departure);
    expect(today.suggestions.length).toBeGreaterThan(0);
    expectCovered('TripSuggestion', today.suggestions[0]);
    expectCovered('SuggestionAction', today.suggestions[0].action);
    // 중첩 구조체는 `expectCovered`가 따라 들어가지 않는다 — 해석 에코는 따로 맞춰 본다.
    expect(today.intent, '파리티 요청에 문장이 있어야 에코를 맞춰 볼 수 있다').toBeTruthy();
    expectCovered('IntentEcho', today.intent);
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
    expectCovered('DayPlanResponse', plan);
    expectCovered('DayPlanDay', plan!.day);
    expectCovered('DayPlanTotals', plan!.day.totals);
    // 중첩 구조체는 `expectCovered`가 따라 들어가지 않는다 — 항공편은 따로 맞춰 본다.
    expect(plan!.day.flight, '파리티 여행에 항공편이 있어야 계약을 맞춰 볼 수 있다').toBeTruthy();
    expectCovered('DayPlanFlight', plan!.day.flight);
    expectCovered('DayPlanCost', plan!.day.totals.cost);
    expect(plan!.day.spots.length).toBeGreaterThan(0);
    expectCovered('DayPlanSpot', plan!.day.spots[0]);
    const leg = plan!.day.spots.map((s) => s.incomingLeg).find(Boolean);
    expect(leg, '구간이 하나는 있어야 계약을 맞춰 볼 수 있다').toBeTruthy();
    expectCovered('DayPlanLeg', leg);
    expectCovered('DayPlanSplit', { key: 's', from: 0, to: 1, branches: [] });
    expectCovered('DayPlanSplitBranch', { participants: [], spotIndexes: [] });
    expect(plan!.days.length).toBe(plan!.dayCount);
    expectCovered('DayPlanStripEntry', plan!.days[0]);
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
    expectCovered('GroupProposalView', proposal);
    expectCovered('GroupProposalPick', proposal!.picks[0]);
    expectCovered('GroupProposalImpact', proposal!.impact);
    expectCovered('GroupProposalOption', proposal!.options[0]);

    // 좌표를 모르는 후보는 거리도 null이다 — 0으로 채우지 않는다
    const noCoord = proposal!.picks.find((p) => p.title === '공원 산책');
    expect(noCoord?.distanceKm).toBeNull();

    // ⚠️ 점수는 내부값이다(§21·§22) — 앱에 내려가는 JSON 어디에도 없다
    expect(JSON.stringify(proposal)).not.toContain('score');
  });

  it('일정 예약의 추가 필드도 Swift가 읽는다', () => {
    const rows = buildBookings({ days: [{ spots: [{ name: '식당', bookAt: '19:00', desc: '창가 좌석' }] }] }, [], '2026-09-25');
    expect(rows).toHaveLength(1);
    expectCovered('BookingSummary', rows[0]);
  });

  it('BookingSummary와 PriceStatus', () => {
    const bookings = buildBookings(trip, [{
      booking_id: 'bk1', seller: 'Agoda', price: 90000, currency: 'KRW', quality: 'EXACT', verified: true,
      offers: [{ seller: 'Agoda', price: 90000, cur: 'KRW', quality: 'EXACT', verified: true }],
      observed_at: '2026-08-31T21:00:00Z'
    }], '2026-09-01');
    expect(bookings).toHaveLength(1);
    expectCovered('BookingSummary', bookings[0]);
    expect(bookings[0].priceStatus).toBeTruthy();
    expectCovered('PriceStatus', bookings[0].priceStatus);
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

  it('유효한 큰 비용 합계도 Int64 범위에 자르지 않고 실제 Swift 디코딩 픽스처로 보낸다', () => {
    const checked = legacyLib.validateTripPayload({
      id: 'extreme-cost', name: '합성 비용 경계값', start: '2026-09-01',
      days: [{ budget: { amount: 0, cur: 'KRW' }, spots: Array.from({ length: 64 }, (_, i) => ({
        name: `합성 장소 ${i + 1}`, cost: 1e12, cur: 'EUR', costBasis: 'PER_PERSON', costPeople: 100
      })) }]
    });
    expect(checked.ok).toBe(true);
    if (!checked.ok) throw new Error('유효한 비용 입력이 거절되었습니다');
    const plan = buildDayPlanView({ trip: checked.value as TripDoc, di: 0,
      summary: today.trip, generatedAt: '2026-09-01T04:00:00Z' });
    const cost = plan!.day.totals.cost;
    expect(cost.total).toBe(9.6e18);
    expect(cost.total).toBeGreaterThan(2 ** 63);
    expect(cost.parts[0].amount).toBe(cost.total);
    expect(cost.details?.budget?.differenceKRW).toBe(-cost.total);
    expect(cost.details?.items[0].totalKRW).toBe(1.5e17);
    expect(cost.details?.fxSource).toBe('FALLBACK');
    // 예산·항목까지 따라 들어간다 — 큰 값이 실리는 자리가 바로 여기다
    expectCovered('DayPlanCost', cost);
    const dir = path.join(__dirname, '../../../../../ios/TripCanvasTests/Fixtures');
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'day-cost-extreme.json'), JSON.stringify(cost, null, 2) + String.fromCharCode(10));
  });
});

const travel = buildTravelState({
  tripId: 'parity', trip, revision: 2, updatedAt: '2026-08-31T00:00:00Z',
  todayISO: '2026-09-01', nowMinutes: 18 * 60 + 55, generatedAt: '2026-09-01T09:55:00Z',
  travelMode: true
});

describe('Travel State도 Swift가 전부 담는다', () => {
  it('TravelStateResponse와 그 안의 구조체', () => {
    expectCovered('TravelStateResponse', travel);
    expectCovered('TripPulse', travel.pulse);
    expect(travel.departure).toBeTruthy();
    expectCovered('DeparturePlan', travel.departure);
    expectCovered('LiveActivityState', travel.liveActivity);
    expectCovered('WidgetSnapshot', travel.widget);
    expect(travel.widget.nextActivity).toBeTruthy();
    expectCovered('WidgetActivity', travel.widget.nextActivity);
    expect(travel.notifications.length).toBeGreaterThan(0);
    expectCovered('NotificationPlanItem', travel.notifications[0]);
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
    expectCovered('ImportPreviewResponse', preview);
    expect(preview.candidate).toBeTruthy();
    expectCovered('BookingCandidate', preview.candidate);
    expect(preview.tripMatches.length).toBeGreaterThan(0);
    expectCovered('TripMatch', preview.tripMatches[0]);
  });

  it('유입 enum도 Swift가 안다', () => {
    ['BOOKING', 'PLACE', 'TRANSPORT', 'NOTE', 'UNKNOWN'].forEach((s) => expect(SWIFT, `ShareKind.${s}`).toContain(`"${s}"`));
    ['HOTEL', 'FLIGHT', 'TRAIN', 'CAR', 'RESTAURANT', 'TOUR', 'OTHER'].forEach((s) => expect(SWIFT).toContain(`"${s}"`));
    ['AUTO', 'REVIEW', 'MANUAL'].forEach((s) => expect(SWIFT, `CandidateDisposition.${s}`).toContain(`"${s}"`));
    ['PHOTO', 'NOTE', 'VISIT', 'MOMENT'].forEach((s) => expect(SWIFT, `MemoryType.${s}`).toContain(`"${s}"`));
  });

  // 공유 키가 앱과 **같은 값**인지는 `shareKeyParity.test.ts`가 픽스처로 대조한다.
  // ⚠️ 여기에 있던 Swift 소스 grep은 알고리즘이 적혀 있는지만 봐서, 실제로 갈라져 있던
  //    두 군데(본문 자르기 단위 · 앞뒤 공백 집합)를 놓쳤다.
  it('실제 응답의 공유 키도 같은 모양이다', () => {
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

it('여행 전체 비용 계약과 Swift 필드 및 실제 디코딩 fixture가 일치한다', async () => {
  const { buildTripCosts } = await import('./tripCostsView');
  const response = buildTripCosts(trip, {}, 2);
  expect(new Set(Object.keys(response))).toEqual(swiftProperties('TripCostsResponse'));
  expect(new Set(Object.keys(response.days[0]))).toEqual(swiftProperties('TripCostDay'));
  expect(new Set(Object.keys(response.categories[0]))).toEqual(swiftProperties('TripCostCategory'));
  const item = response.categories.flatMap(c => c.items)[0];
  expect(new Set(Object.keys(item))).toEqual(swiftProperties('TripCostLine'));
  // 위 셋은 '정확히 같은 집합'을 본다. 순회에도 넣어 중첩(TripCostGroup·TripCostPrep)까지 따라간다.
  expectCovered('TripCostsResponse', response);
  writeFileSync(path.join(__dirname, '../../../../../ios/TripCanvasTests/Fixtures/trip-costs.json'), JSON.stringify(response, null, 2) + '\n');
});

// ── 나머지 계약도 전부 본다 (§파리티 사각지대) ───────────────────────────────
//
// 위의 세 응답(Today · DayPlan · TravelState)만 순회하면 앱이 실제로 디코딩하는 계약의
// 절반쯤만 본다. 여기서 나머지를 만들어 같은 순회에 넣는다. 작은 응답 래퍼는 **타입을 붙인
// 표본**으로 적는다 — `contract.ts`가 바뀌면 TypeScript가 먼저 막고, Swift가 갈라지면
// `cover`가 막는다.

describe('응답 래퍼·유입·동선·기록 계약', () => {
  it('작은 응답 래퍼', () => {
    const list: TripListResponse = { schemaVersion: 1, trips: [today.trip] };
    expectCovered('TripListResponse', list);

    const mutation: MutationResponse = {
      schemaVersion: 1, applied: true, alreadyApplied: false, revision: 3, today
    };
    expectCovered('MutationResponse', mutation);

    const bookings = buildBookings(trip, [], '2026-09-01');
    const bookingList: BookingListResponse = { schemaVersion: 1, bookings };
    expectCovered('BookingListResponse', bookingList);

    const commit: ImportCommitResponse = {
      schemaVersion: 1, bookingId: 'bk1', revision: 3, replan: today.replan, today
    };
    expectCovered('ImportCommitResponse', commit);

    // 제안이 없을 수도 있다는 것이 계약이다(§23 — 없으면 억지로 만들지 않는다)
    const proposal: GroupProposalResponse = { schemaVersion: 1, proposal: null };
    expectCovered('GroupProposalResponse', proposal);

    // `contract.ts`에 인터페이스가 없고 라우트가 직접 만드는 응답 — 그 자리의 모양을 그대로 적는다
    // (`services/routes/devices.ts`의 registerDevice·unregisterDevice)
    expectCovered('DeviceRegistrationResponse', { schemaVersion: 1, registered: true, deviceId: 'd1' });
  });

  /**
   * 오류 봉투는 계약(`contract.ts`)이 아니라 `server/api/errors.ts` 소관이라 순회에 넣지 않는다.
   * 대신 **방향을 뒤집어** 본다: Swift가 읽는 필드가 서버가 보내는 것 안에 있는가.
   * (`code`는 Swift가 일부러 안 읽는다 — 화면은 서버가 쓴 문장을 쓴다, §거절 문구)
   */
  it('오류 봉투 — Swift가 읽는 필드는 서버가 보내는 것이다', () => {
    const server = new Set(['code', 'error', 'message', 'revision']);
    const missing = [...swiftProperties('APIErrorBody')].filter((k) => !server.has(k));
    expect(missing, '서버가 보내지 않는 필드를 앱이 읽고 있다').toEqual([]);
  });

  it('여행 전체 동선 — TripRoutesResponse', () => {
    const routes = buildTripRoutes({ trip, summary: today.trip, generatedAt: '2026-09-01T04:00:00Z' });
    expect(routes.days.length).toBeGreaterThan(0);
    expect(routes.days[0].legs.length, '구간이 있어야 TripRouteLeg까지 따라간다').toBeGreaterThan(0);
    expect(routes.days[0].spots.length, '좌표 있는 장소가 있어야 Spot까지 따라간다').toBeGreaterThan(0);
    expectCovered('TripRoutesResponse', routes);
  });

  it('기록 — MemoryEvent·타임라인·만들기 응답', () => {
    const event: MemoryEvent = {
      id: 'm1', dayIndex: 0, activityId: 'a1', type: 'PHOTO', caption: '광장',
      assetRefs: ['ph-1'], location: { lat: 40.41, lng: -3.70 }, atMinutes: 13 * 60,
      capturedAt: '2026-09-01T04:00:00Z', clientKey: 'ck1'
    };
    const timeline = buildMemoryTimeline([event], [{ id: 'a1', name: '저녁 예약', startMinutes: 13 * 60 }]);
    expect(timeline.length, '묶음이 있어야 MemoryTimelineGroup까지 따라간다').toBeGreaterThan(0);
    const list: MemoryListResponse = { schemaVersion: 1, events: [event], timeline };
    expectCovered('MemoryListResponse', list);

    const created: MemoryCreateResponse = {
      schemaVersion: 1, event, association: { activityId: 'a1', reason: '시각이 가깝습니다' }, alreadyExists: false
    };
    expectCovered('MemoryCreateResponse', created);
  });

  it('붙여넣은 일정 읽기 — ItineraryParseResponse', async () => {
    const { createItineraryRoutes } = await import('@/server/api/itineraryRoutes');
    const ctx = {
      userId: 'u1', legacySupabaseUserId: null, email: 'a@example.com',
      sessionId: null, tokenSource: 'tripcanvas' as const
    };
    const routes = createItineraryRoutes({
      verifier: { verify: async () => ctx }, now: () => new Date('2026-09-07T00:00:00Z')
    });
    const response = await routes.parse(new Request('https://x/api/v1/itineraries/parse', {
      method: 'POST',
      headers: { authorization: 'Bearer good', 'content-type': 'application/json' },
      body: JSON.stringify({
        text: ['[day1] 9월 2일(수) — 마드리드 도착', '* 09:00~10:00｜프라도 미술관', '게르니카는 레이나 소피아에 있다'].join('\n'),
        year: 2026
      })
    }));
    expect(response.status).toBe(200);
    const body = (await response.json()) as ItineraryParseResponse;
    expect(body.draft.days[0].items.length, '읽은 줄이 있어야 ItineraryDraftItem까지 따라간다').toBeGreaterThan(0);
    expectCovered('ItineraryParseResponse', body);
  });

  it('겹치는 예약 — DuplicateBookingMatch', () => {
    const already: TripDoc = {
      ...trip,
      bookings: [{ id: 'bk9', type: 'hotel', title: 'Cap Rocat', price: 1420, cur: 'EUR',
                   start: '2026-09-02', end: '2026-09-04', confirmation: 'ABC12345' }]
    };
    const dupe = buildImportPreview(
      { url: 'https://www.booking.com/hotel/es/cap-rocat.html', title: 'Cap Rocat | Booking.com',
        text: '예약 번호: ABC12345\n체크인 2026-09-02\n체크아웃 2026-09-04\n총액 EUR 1,420' },
      [{ client_id: 'parity', data: already }],
      { year: 2026 }
    );
    // 중복은 **확신이 있을 때만** 말한다(§밖에서 들어온 것) — 예약번호가 같으니 여기서는 말해야 한다
    expect(dupe.duplicate, '예약번호가 같으면 겹친다고 말한다').toBeTruthy();
    expectCovered('ImportPreviewResponse', dupe);
  });

  it('하루 계획의 이월 숙소와 렌터카 — DayPlanCarriedStay·DayPlanCarEvent', () => {
    // 파리티 여행(위)의 픽스처를 흔들지 않으려고 따로 만든다.
    const carTrip: TripDoc = {
      id: 'car', name: '렌터카', start: '2026-09-01', timeZone: 'Asia/Seoul',
      days: [
        { title: '첫날', mode: 'car', startAt: '09:00',
          spots: [{ name: '숙소', city: '마드리드', stay: true, nights: 2, stayMin: 0, lat: 40.40, lng: -3.70 }] },
        { title: '이튿날', mode: 'car', startAt: '09:00',
          spots: [{ name: '공원', city: '마드리드', stayMin: 60, lat: 40.41, lng: -3.70 }] },
        { title: '사흘째', mode: 'car', spots: [{ name: '공항', city: '마드리드', lat: 40.47, lng: -3.56 }] }
      ],
      bookings: [{ id: 'car1', type: 'car', title: '소형차', price: 200000, cur: 'KRW',
                   start: '2026-09-02', end: '2026-09-03',
                   carPickup: '바라하스 공항', carPickupTime: '10:00',
                   carReturn: '아토차역', carReturnTime: '18:00' }]
    };
    const summary = computeToday({
      tripId: 'car', trip: carTrip, revision: 1, updatedAt: '2026-08-31T00:00:00Z',
      todayISO: '2026-09-02', nowMinutes: 10 * 60, generatedAt: '2026-09-02T01:00:00Z'
    }).response.trip;
    const plan = buildDayPlanView({ trip: carTrip, di: 1, summary, generatedAt: '2026-09-02T01:00:00Z' });
    expect(plan!.day.carriedStay, '연박 숙소는 다음 날로 이월된다').toBeTruthy();
    expect(plan!.day.carPickups.length, '픽업일에는 픽업이 뜬다').toBeGreaterThan(0);
    const back = buildDayPlanView({ trip: carTrip, di: 1, summary, generatedAt: '2026-09-02T01:00:00Z' })!.day.back;
    expect(back, '마지막 날이 아니면 숙소 복귀가 붙는다').toBeTruthy();
    expectCovered('DayPlanResponse', plan);

    const returnDay = buildDayPlanView({ trip: carTrip, di: 2, summary, generatedAt: '2026-09-02T01:00:00Z' });
    expect(returnDay!.day.carReturns.length, '반납일에는 반납이 뜬다').toBeGreaterThan(0);
    expectCovered('DayPlanResponse', returnDay);
  });
});

/**
 * 점호 — `Contract.swift`가 선언한 모든 struct가 위의 순회 어딘가에 닿았는가.
 *
 * ⚠️ **이 파일의 맨 끝에 있어야 한다.** `visited`는 위 테스트들이 도는 동안 채워진다.
 *
 * 새 계약을 만들고 여기에 넣지 않으면 그 구조체는 아무도 보지 않는다 — 2026-09-21에 세어 보니
 * 75개 중 32개가 그 상태였다. 빠뜨릴 수 없게 여기서 이름을 점호한다.
 */
it('계약 점호 — Contract.swift의 모든 struct가 실제 응답으로 대조됐다', () => {
  /** 순회에 넣지 못하는 것과 그 이유. 이유 없이 늘리지 않는다. */
  const excused: Record<string, string> = {
    APIErrorBody: '계약이 아니라 server/api/errors.ts의 오류 봉투 — 위에서 방향을 뒤집어 본다'
  };
  const unseen = [...SWIFT_STRUCTS].filter((name) => !visited.has(name) && !(name in excused));
  expect(unseen, '아무도 대조하지 않는 계약 구조체 — 응답을 만들어 expectCovered에 넣는다').toEqual([]);
  // 면제 목록이 죽은 이름을 들고 있으면 안 된다
  Object.keys(excused).forEach((name) =>
    expect(SWIFT_STRUCTS.has(name), `${name}은 Contract.swift에 없다 — 면제 목록에서 지운다`).toBe(true));
});
