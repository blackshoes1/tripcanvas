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
import { buildActivity, buildCandidateBoard, buildComments, buildPreferences } from './candidatesView';

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
    expect(today.schemaVersion).toBe(1);
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

// ─────────────────────────────────────────────────────────────────────────────
// 함께하기 — 후보 보드 · 코멘트 · 취향 · 활동
//
// 웹과 iOS가 **같은 판단 결과**를 그리는지 여기서 잡는다. 특히 점수: 합의 점수는 내부값이라
// 계약에 필드가 없어야 하고, 화면에 나가는 문장에도 숫자가 없어야 한다(§21·§22).

const boardRows = [
  {
    id: 11, title: '프라도 미술관', place_id: null, lat: 40.4138, lng: -3.6921,
    addr: null, note: null, url: null, status: 'PROPOSED', scheduled_ref: null,
    proposed_by_label: '지민', mine: false, my_reaction: 'MUST',
    must_count: 2, ok_count: 1, pass_count: 0,
    reactions: [
      { name: '지민', reaction: 'MUST', me: false },
      { name: '나', reaction: 'MUST', me: true },
      { name: '현우', reaction: 'OK', me: false }
    ],
    comment_count: 2, created_at: '2026-08-30T10:00:00Z'
  },
  {
    id: 12, title: '벼룩시장', place_id: null, lat: null, lng: null,
    addr: null, note: null, url: null, status: 'PROPOSED', scheduled_ref: null,
    proposed_by_label: '나', mine: true, my_reaction: 'MUST',
    must_count: 1, ok_count: 0, pass_count: 1,
    reactions: [
      { name: '나', reaction: 'MUST', me: true },
      { name: '현우', reaction: 'PASS', me: false }
    ],
    comment_count: 0, created_at: '2026-08-30T11:00:00Z'
  }
];
const prefRows = [
  { label: '나', mine: true, prefs: { pace: 'RELAXED', walking: 'NORMAL', interests: ['미술관'] } },
  { label: '현우', mine: false, prefs: { walking: 'LOW', night: false, dislikes: ['쇼핑'] } }
];
const boardResponse = buildCandidateBoard({
  tripId: 'parity', rows: boardRows, prefRows,
  days: [{ spots: [{ name: '숙소', lat: 40.40, lng: -3.70 }] }, { spots: [] }],
  role: 'EDITOR', memberCount: 3
});

describe('함께하기 계약도 Swift가 전부 담는다', () => {
  it('CandidateBoardResponse와 그 안의 구조체', () => {
    expectCovered('CandidateBoardResponse', boardResponse as unknown as Record<string, unknown>);
    expect(boardResponse.groups.length).toBeGreaterThan(0);
    expectCovered('CandidateGroup', boardResponse.groups[0] as unknown as Record<string, unknown>);
    const candidate = boardResponse.groups.flatMap((g) => g.candidates)[0];
    expectCovered('TripCandidate', candidate as unknown as Record<string, unknown>);
    expect(candidate.reactors.length).toBeGreaterThan(0);
    expectCovered('CandidateReactor', candidate.reactors[0] as unknown as Record<string, unknown>);
    expectCovered('CandidateVerdict', candidate.verdict as unknown as Record<string, unknown>);
    const split = boardResponse.groups.flatMap((g) => g.candidates).find((c) => c.conflict);
    expect(split, '갈린 후보가 있어야 충돌 계약을 검사한다').toBeTruthy();
    expectCovered('CandidateConflict', split!.conflict as unknown as Record<string, unknown>);
    expectCovered('ConflictOption', split!.conflict!.options[0] as unknown as Record<string, unknown>);
    expect(boardResponse.proposal, '반대 없는 후보가 있으면 제안이 나온다').toBeTruthy();
    expectCovered('GroupProposal', boardResponse.proposal as unknown as Record<string, unknown>);
    expectCovered('GroupProposalPick', boardResponse.proposal!.picks[0] as unknown as Record<string, unknown>);
  });

  it('코멘트·취향·활동 계약', () => {
    const comments = buildComments('11', [
      { id: 5, body: '여기 저녁이 좋대요', author_label: '지민', mine: false, created_at: '2026-08-31T02:00:00Z' }
    ], 'EDITOR');
    expectCovered('CommentListResponse', comments as unknown as Record<string, unknown>);
    expectCovered('CandidateComment', comments.comments[0] as unknown as Record<string, unknown>);

    const prefs = buildPreferences(prefRows, 3);
    expectCovered('PreferenceResponse', prefs as unknown as Record<string, unknown>);
    expectCovered('MemberPreference', prefs.mine as unknown as Record<string, unknown>);
    expectCovered('MemberPreferenceRow', prefs.members[0] as unknown as Record<string, unknown>);

    const activity = buildActivity([
      { id: 7, kind: 'CANDIDATE_PROPOSED', mine: false, actor_label: '지민', subject: { title: '프라도' }, created_at: '2026-09-01T03:59:00Z' }
    ], Date.parse('2026-09-01T04:00:00Z'));
    expectCovered('ActivityListResponse', activity as unknown as Record<string, unknown>);
    expect(activity.entries.length).toBeGreaterThan(0);
    expectCovered('ActivityEntry', activity.entries[0] as unknown as Record<string, unknown>);
  });

  it('함께하기 enum도 Swift가 안다', () => {
    ['PROPOSED', 'SCHEDULED', 'REJECTED'].forEach((s) => expect(SWIFT, `CandidateStatus.${s}`).toContain(`"${s}"`));
    ['MUST', 'OK', 'PASS'].forEach((s) => expect(SWIFT, `ReactionKind.${s}`).toContain(`"${s}"`));
    ['LOVED', 'NEEDS_OPINION', 'RESTING'].forEach((s) => expect(SWIFT, `CandidateGroupKey.${s}`).toContain(`"${s}"`));
    ['RELAXED', 'PACKED'].forEach((s) => expect(SWIFT, `PacePreference.${s}`).toContain(`"${s}"`));
    // tone은 소문자 그대로 나간다 — Swift도 같은 철자여야 한다
    ['good', 'split', 'mixed', 'quiet'].forEach((s) => expect(SWIFT, `VerdictTone.${s}`).toContain(s));
    // 충돌 선택지의 key는 화면이 분기에 쓴다
    ['TOGETHER', 'SPLIT', 'SKIP'].forEach((s) =>
      expect(JSON.stringify(boardResponse), `ConflictOption.${s}`).toContain(`"${s}"`));
  });

  it('합의 점수가 계약 밖으로 새지 않는다 (§21·§22 — 점수는 내부값이다)', () => {
    const json = JSON.stringify(boardResponse);
    expect(json).not.toContain('"score"');
    expect(json).not.toContain('strongSupportCount');
    // 화면에 그대로 나가는 문장에는 숫자가 없다
    for (const c of boardResponse.groups.flatMap((g) => g.candidates)) {
      expect(c.verdict.text, `배지 문장: ${c.verdict.text}`).not.toMatch(/\d/);
    }
  });

  it('iOS 테스트 픽스처(candidate-board)도 실제 응답으로 갱신한다', () => {
    const dir = path.join(__dirname, '../../../../../ios/TripCanvasTests/Fixtures');
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'candidate-board.json'), JSON.stringify(boardResponse, null, 2) + String.fromCharCode(10));
    expect(boardResponse.schemaVersion).toBe(1);
  });
});
