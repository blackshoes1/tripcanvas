// `collab.js`의 **나머지 복사본 규칙**을 픽스처로 굳혀 iOS 복사본(`CollabModel`·`TripPrefs`)과 맞춘다.
//
// `liveEffects`·`forbiddenText`·`whoText`·`buildSplitPlan`은 이미 각자의 픽스처가 있다. 여기는 그 밖의
// 판정 — 후보 보드(집계·상태·합의·배지·묶음·정렬) · 활동 문장(문장·을/를·묶기·상대 시각) ·
// 초대(토큰·이유·판정·기간)와 역할 · 여행 취향(정규화·요약 문장)이다. 2026-10-02 전에는 대조가 없어
// `collab.js`를 바꿔도 CI가 초록이었다.
//
// ⚠️ 규칙을 바꾸려면 `collab.js`를 먼저 고친다. 그러면 이 테스트가 픽스처를 새로 쓰고
// iOS 테스트(`CollabRulesParityTests.swift`)가 깨진다 — 그게 목적이다(복사본은 조용히 갈라진다).
//
// ⚠️ 입력은 **서버가 실제로 보내는 모양**만 넣는다. 앱은 응답을 Swift 타입으로 디코딩하므로
//    (`CandidateView`·`ActivityView`·`InvitePreview`·`PreferenceView`) 서버가 보내지 않는 모양
//    (숫자 제목, 소문자 역할 같은 것)은 앱에 닿지도 않는다. 그런 입력에서 두 벌이 달라도 그건 계약 밖이다.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import collab from '@legacy/collab.js';

const FIXTURES = path.join(__dirname, '../../../../../ios/TripCanvasTests/Fixtures');

/**
 * 픽스처를 쓴다 — 다른 파리티 테스트와 같은 모양(2칸 들여쓰기 + 끝 LF)이고, **내용이 같으면 다시 쓰지 않는다.**
 * Windows 체크아웃은 CRLF라, 같은 내용을 LF로 덮어쓰면 아무것도 안 바뀌었는데 작업 트리가 흔들린다.
 */
function writeFixture(name: string, data: unknown) {
  const file = path.join(FIXTURES, `${name}.json`);
  const text = JSON.stringify(data, null, 2) + String.fromCharCode(10);
  const current = existsSync(file) ? readFileSync(file, 'utf8').replace(/\r\n/g, '\n') : null;
  if (current === text) return;
  mkdirSync(FIXTURES, { recursive: true });
  writeFileSync(file, text);
}

// ── 후보 보드 ─────────────────────────────────────────────────────────────

// ⚠️ `me`는 **언제나** 실린다 — 앱의 `ReactionEntry`는 `me`가 비옵셔널이다(split-plan과 같은 이유).
type Rx = { user_id?: string; name: string; reaction: string; me: boolean };

/** 서버 `list_trip_candidates` 한 줄의 모양. 집계 칸은 반응에서 세지만 `over`로 낡은 값을 넣을 수 있다. */
function candidate(id: number, reactions: Rx[], over: Record<string, unknown> = {}) {
  const count = (r: string) => reactions.filter((x) => x.reaction === r).length;
  return {
    id,
    title: '카사 바트요',
    place_id: null,
    lat: null,
    lng: null,
    addr: null,
    note: null,
    url: null,
    status: 'PROPOSED',
    scheduled_ref: null,
    proposed_by_label: '영희',
    mine: false,
    my_reaction: reactions.find((r) => r.me)?.reaction ?? null,
    must_count: count('MUST'),
    ok_count: count('OK'),
    pass_count: count('PASS'),
    reactions,
    comment_count: 0,
    created_at: '2026-09-01T00:00:00.000Z',
    ...over
  };
}

/** 반응 문자열 목록 → 반응 행. 사람마다 id가 다르다(u0, u1 …). */
function voices(...list: string[]): Rx[] {
  return list.map((reaction, i) => ({ user_id: `u${i}`, name: `멤버${i}`, reaction, me: false }));
}

const boardCases: { name: string; memberCount: number; candidate: ReturnType<typeof candidate> }[] = [
  { name: '아무도 말하지 않음', memberCount: 4, candidate: candidate(1, []) },
  { name: '한 명의 MUST로 합의를 말하지 않는다', memberCount: 4, candidate: candidate(1, voices('MUST')) },
  { name: '전원 MUST', memberCount: 3, candidate: candidate(1, voices('MUST', 'MUST', 'MUST')) },
  { name: '전원이 말했고 반대 없음 (MUST + OK)', memberCount: 3, candidate: candidate(1, voices('MUST', 'OK', 'OK')) },
  { name: '§20 A — MUST2·OK1·PASS1은 갈림', memberCount: 4, candidate: candidate(1, voices('MUST', 'MUST', 'OK', 'PASS')) },
  { name: '§20 B — MUST1·OK3은 반대 없음', memberCount: 4, candidate: candidate(1, voices('MUST', 'OK', 'OK', 'OK')) },
  { name: '전원 PASS', memberCount: 3, candidate: candidate(1, voices('PASS', 'PASS', 'PASS')) },
  { name: 'OK와 PASS — MUST 없이 반대가 있다', memberCount: 4, candidate: candidate(1, voices('OK', 'PASS')) },
  { name: '넷 중 둘만 MUST — 아직 다 말하지 않았다', memberCount: 4, candidate: candidate(1, voices('MUST', 'MUST')) },
  { name: 'OK 한 명', memberCount: 3, candidate: candidate(1, voices('OK')) },
  { name: '전원 OK — MUST가 없으면 다들 좋아한다고 하지 않는다', memberCount: 2, candidate: candidate(1, voices('OK', 'OK')) },
  { name: '둘 중 하나 MUST — 점수가 딱 .5에 걸린다', memberCount: 2, candidate: candidate(1, voices('MUST')) },
  { name: '넷 중 둘 PASS — 점수가 딱 .5에 걸린다', memberCount: 4, candidate: candidate(1, voices('PASS', 'PASS')) },
  { name: '반응 문자열이 느슨하다 — 소문자·공백·모르는 값',
    memberCount: 4, candidate: candidate(1, voices(' must ', 'ok', 'MAYBE')) },
  { name: '서버 집계가 낡아도 반응 배열로 다시 센다',
    memberCount: 3, candidate: candidate(1, voices('PASS'), { must_count: 5, ok_count: 2, pass_count: 0 }) },
  { name: '인원보다 반응이 많다 (인원 정보가 낡음)', memberCount: 2, candidate: candidate(1, voices('MUST', 'MUST', 'MUST')) },
  { name: '인원을 모른다 (0)', memberCount: 0, candidate: candidate(1, voices('MUST')) },
  { name: '내가 담은 후보', memberCount: 3,
    candidate: candidate(1, [{ user_id: 'me', name: '나야', reaction: 'MUST', me: true }], { mine: true }) },
  { name: '담은 사람 이름이 비었다', memberCount: 3, candidate: candidate(1, [], { proposed_by_label: '   ' }) },
  { name: '담은 사람 이름 앞뒤 공백', memberCount: 3, candidate: candidate(1, [], { proposed_by_label: '  지민  ' }) }
];

/** 묶음과 정렬을 한꺼번에 본다. 같은 시각의 7과 10은 **만든 순 키의 글자 순**으로 갈린다("#7" > "#10"). */
const boardList = [
  candidate(1, voices('MUST', 'MUST', 'PASS')),
  candidate(2, voices('MUST', 'MUST', 'MUST'), { created_at: '2026-09-02T00:00:00.000Z' }),
  candidate(3, voices('PASS', 'PASS'), { created_at: '2026-09-03T00:00:00.000Z' }),
  candidate(4, voices('MUST'), { status: 'SCHEDULED', scheduled_ref: '2', created_at: '2026-09-04T00:00:00.000Z' }),
  candidate(5, voices('MUST', 'PASS'), { status: 'REJECTED', created_at: '2026-09-05T00:00:00.000Z' }),
  candidate(6, [], { created_at: '2026-09-06T00:00:00.000Z' }),
  candidate(7, voices('MUST')),
  candidate(10, voices('MUST'))
];

/** 모르는 값은 '고르지 않음'(null)이다 — '기타'와 다르다. */
const categoryReads: (string | null)[] = ['cafe', ' SIGHT ', 'Restaurant\n', 'etc', 'BOGUS', '', null];

// ── 활동 문장 ─────────────────────────────────────────────────────────────

type Activity = {
  id: number; kind: string; actor_label: string; mine: boolean; member_label: string | null;
  subject: Record<string, unknown>; created_at: string;
};

function activity(over: Partial<Activity> & { kind: string }): Activity {
  return { id: 1, actor_label: '영희', mine: false, member_label: null, subject: {}, created_at: '2026-09-01T10:00:00.000Z', ...over };
}

const activityCases: { name: string; event: Activity; count?: number }[] = [
  { name: '새 멤버', event: activity({ kind: 'MEMBER_JOINED', member_label: '철수' }) },
  { name: '내가 참여', event: activity({ kind: 'MEMBER_JOINED', mine: true, member_label: '나' }) },
  { name: '이름 없는 새 멤버', event: activity({ kind: 'MEMBER_JOINED', member_label: null }) },
  { name: '멤버가 나감', event: activity({ kind: 'MEMBER_LEFT', member_label: '민수' }) },
  { name: '내가 나감', event: activity({ kind: 'MEMBER_LEFT', mine: true, member_label: '나' }) },
  { name: '내보냄', event: activity({ kind: 'MEMBER_REMOVED', member_label: '민수' }) },
  { name: '내가 내보냄', event: activity({ kind: 'MEMBER_REMOVED', mine: true, member_label: '  ' }) },
  { name: '후보 담기 — 받침 없음', event: activity({ kind: 'CANDIDATE_PROPOSED', subject: { title: '카사 바트요', candidate_id: 7 } }) },
  { name: '후보 담기 — 받침 있음', event: activity({ kind: 'CANDIDATE_PROPOSED', subject: { title: '구엘 공원', candidate_id: 8 } }) },
  { name: '후보 담기 — 제목이 없다', event: activity({ kind: 'CANDIDATE_PROPOSED', subject: { candidate_id: 9 } }) },
  { name: '후보 담기 — 제목이 공백', event: activity({ kind: 'CANDIDATE_PROPOSED', subject: { title: '   ', candidate_id: 9 } }) },
  { name: '후보를 일정에 — 날짜 있음', event: activity({ kind: 'CANDIDATE_SCHEDULED', subject: { title: '공원', candidate_id: 7, ref: '2' } }) },
  { name: '후보를 일정에 — 날짜 없음', event: activity({ kind: 'CANDIDATE_SCHEDULED', subject: { title: '공원', candidate_id: 7 } }) },
  { name: '후보를 일정에 — 날짜가 빈 문자열', event: activity({ kind: 'CANDIDATE_SCHEDULED', subject: { title: '공원', candidate_id: 7, ref: '' } }) },
  { name: '후보를 이번엔 뺌', event: activity({ kind: 'CANDIDATE_REJECTED', subject: { title: '시장', candidate_id: 7 } }) },
  { name: '반응 MUST', event: activity({ kind: 'REACTION', subject: { title: '공원', candidate_id: 7, reaction: 'MUST' } }) },
  { name: '반응 OK', event: activity({ kind: 'REACTION', subject: { title: '공원', candidate_id: 7, reaction: 'OK' } }) },
  { name: '반응 소문자 pass', event: activity({ kind: 'REACTION', subject: { title: '공원', candidate_id: 7, reaction: 'pass' } }) },
  { name: '모르는 반응', event: activity({ kind: 'REACTION', subject: { title: '공원', candidate_id: 7, reaction: 'MAYBE' } }) },
  { name: '반응 없음', event: activity({ kind: 'REACTION', subject: { title: '공원', candidate_id: 7 } }) },
  { name: '내 반응', event: activity({ kind: 'REACTION', mine: true, subject: { title: '야경', candidate_id: 7, reaction: 'MUST' } }) },
  { name: '한마디', event: activity({ kind: 'COMMENT_ADDED', subject: { title: '공원', candidate_id: 7, excerpt: '야경 보고 싶어' } }) },
  { name: '한마디 — 발췌가 공백', event: activity({ kind: 'COMMENT_ADDED', subject: { title: '공원', candidate_id: 7, excerpt: '   ' } }) },
  { name: '한마디 — 발췌 없음', event: activity({ kind: 'COMMENT_ADDED', subject: { title: '공원', candidate_id: 7 } }) },
  { name: '일정 변경 한 번', event: activity({ kind: 'SCHEDULE_CHANGED' }) },
  { name: '일정 변경 세 번 묶음', event: activity({ kind: 'SCHEDULE_CHANGED' }), count: 3 },
  { name: '일정 변경 횟수 0은 한 번', event: activity({ kind: 'SCHEDULE_CHANGED' }), count: 0 },
  { name: '예약 여러 건', event: activity({ kind: 'BOOKING_ADDED', subject: { count: 2 } }) },
  { name: '예약 한 건', event: activity({ kind: 'BOOKING_ADDED', subject: { count: 1 } }) },
  { name: '예약 건수 없음', event: activity({ kind: 'BOOKING_ADDED' }) },
  { name: '예약 건수 0은 한 건', event: activity({ kind: 'BOOKING_ADDED', subject: { count: 0 } }) },
  { name: '이름표가 비면 멤버', event: activity({ kind: 'SCHEDULE_CHANGED', actor_label: '' }) },
  { name: '이름표가 공백이면 멤버', event: activity({ kind: 'CANDIDATE_PROPOSED', actor_label: '   ', subject: { title: '숲' } }) },
  { name: '모르는 종류는 빈 문장', event: activity({ kind: 'SOMETHING_NEW' }) },
  { name: '종류가 비면 빈 문장', event: activity({ kind: '' }) }
];

/** 을/를 — 받침이 있으면 '을'. 한글이 아니면 '를'. */
const particleWords = ['공원', '카사 바트요', 'Sagrada', '', '맛집', '바', '숲', '123', '라멘🍜', '가', '힣'];

const at = (hhmmss: string) => `2026-09-01T${hhmmss}.000Z`;
/** 묶기: 입력·출력 모두 최신순. 같은 사람의 연속 일정 변경은 10분 창 안에서 한 줄, 같은 후보 반응은 마지막 것만. */
const condenseCases: { name: string; rows: Activity[] }[] = [
  {
    name: '연속 저장은 한 줄, 같은 후보 반응은 마지막 것만',
    rows: [
      activity({ id: 5, kind: 'SCHEDULE_CHANGED', created_at: at('10:05:00') }),
      activity({ id: 4, kind: 'SCHEDULE_CHANGED', created_at: at('10:04:00') }),
      activity({ id: 3, kind: 'SCHEDULE_CHANGED', created_at: at('10:03:00') }),
      activity({ id: 2, kind: 'REACTION', subject: { title: '공원', candidate_id: 7, reaction: 'MUST' }, created_at: at('10:02:00') }),
      activity({ id: 1, kind: 'REACTION', subject: { title: '공원', candidate_id: 7, reaction: 'PASS' }, created_at: at('10:01:00') })
    ]
  },
  {
    name: '다른 사람의 저장은 묶지 않는다',
    rows: [
      activity({ id: 2, kind: 'SCHEDULE_CHANGED', actor_label: '영희', created_at: at('10:02:00') }),
      activity({ id: 1, kind: 'SCHEDULE_CHANGED', actor_label: '철수', created_at: at('10:01:00') })
    ]
  },
  {
    name: '같은 이름이어도 나와 남은 묶지 않는다',
    rows: [
      activity({ id: 2, kind: 'SCHEDULE_CHANGED', actor_label: '영희', mine: true, created_at: at('10:02:00') }),
      activity({ id: 1, kind: 'SCHEDULE_CHANGED', actor_label: '영희', created_at: at('10:01:00') })
    ]
  },
  {
    name: '창은 묶인 가장 이른 저장에서 다시 잰다 — 딱 10분은 묶고 넘으면 끊는다',
    rows: [
      activity({ id: 3, kind: 'SCHEDULE_CHANGED', created_at: at('10:20:00') }),
      activity({ id: 2, kind: 'SCHEDULE_CHANGED', created_at: at('10:10:00') }),
      activity({ id: 1, kind: 'SCHEDULE_CHANGED', created_at: at('09:59:59') })
    ]
  },
  {
    name: '사이에 다른 활동이 끼면 끊긴다',
    rows: [
      activity({ id: 3, kind: 'SCHEDULE_CHANGED', created_at: at('10:03:00') }),
      activity({ id: 2, kind: 'REACTION', subject: { title: '공원', candidate_id: 7, reaction: 'OK' }, created_at: at('10:02:00') }),
      activity({ id: 1, kind: 'SCHEDULE_CHANGED', created_at: at('10:01:00') })
    ]
  },
  {
    name: '걸러진 반응은 연속을 끊지 않는다',
    rows: [
      activity({ id: 5, kind: 'REACTION', subject: { title: '공원', candidate_id: 7, reaction: 'MUST' }, created_at: at('10:05:00') }),
      activity({ id: 4, kind: 'SCHEDULE_CHANGED', created_at: at('10:04:00') }),
      activity({ id: 3, kind: 'REACTION', subject: { title: '공원', candidate_id: 7, reaction: 'PASS' }, created_at: at('10:03:00') }),
      activity({ id: 2, kind: 'SCHEDULE_CHANGED', created_at: at('10:02:00') })
    ]
  },
  {
    name: '반응은 사람마다·후보마다 따로 남는다',
    rows: [
      activity({ id: 4, kind: 'REACTION', actor_label: '영희', subject: { title: '공원', candidate_id: 7, reaction: 'MUST' }, created_at: at('10:04:00') }),
      activity({ id: 3, kind: 'REACTION', actor_label: '철수', subject: { title: '공원', candidate_id: 7, reaction: 'OK' }, created_at: at('10:03:00') }),
      activity({ id: 2, kind: 'REACTION', actor_label: '영희', subject: { title: '시장', candidate_id: 8, reaction: 'PASS' }, created_at: at('10:02:00') }),
      activity({ id: 1, kind: 'REACTION', mine: true, actor_label: '나', subject: { title: '공원', candidate_id: 7, reaction: 'OK' }, created_at: at('10:01:00') })
    ]
  },
  {
    name: '시각을 못 읽으면 묶지 않는다',
    rows: [
      activity({ id: 2, kind: 'SCHEDULE_CHANGED', created_at: '엉망' }),
      activity({ id: 1, kind: 'SCHEDULE_CHANGED', created_at: at('10:01:00') })
    ]
  }
];

/** 상대 시각 — 'M/D'(7일 이상)는 기기 시간대를 타서 넣지 않는다. */
const relativeNow = '2026-09-01T12:00:00.000Z';
const relativeCases: (string | null)[] = [
  '2026-09-01T11:59:30.000Z', '2026-09-01T11:59:00.000Z', '2026-09-01T11:30:00.000Z',
  '2026-09-01T11:00:00.000Z', '2026-09-01T11:00:00Z', '2026-09-01T09:00:00+00:00',
  '2026-08-31T12:00:00.000Z', '2026-08-25T12:00:01.000Z', '2026-09-01T12:05:00.000Z',
  '엉망', null
];

// ── 초대와 역할 ───────────────────────────────────────────────────────────

const WEB_BASE = 'https://tripcanvas-ai.vercel.app/';
const T16 = 'abcdefghijklmnop';
/**
 * 웹은 `location.hash`를, 앱은 붙여넣은 글을 읽는다. 같은 토큰 규칙(16~128자, `[A-Za-z0-9_-]`, 퍼센트 디코딩)을
 * 지나는 입력을 함께 검사한다. 해시에 추가 파라미터가 있으면 웹과 앱 모두 거절한다.
 */
const joinHashes = [
  `#join=${T16}`, '#join=abcdefghijklmno', `#join=${'a'.repeat(128)}`, `#join=${'a'.repeat(129)}`,
  '#join=Ab3_x-Y9zQ8w7v6u', '#join=ABCDEFGHIJKLMNOP_-0123456789', '#join=%41bcdefghijklmnop',
  `#join=${'a'.repeat(16)}%20`, '#join=bad$chars%%%%%%%%%%%%', '#join=가나다라마바사아자차카타파하가나',
  `#join=${T16}.`, `#join=${T16}&x=1`, `#join=${T16}%26x%3D1`,
  `#JOIN=${T16}`, '#join=', `#v=${T16}`, ''
];

const reasons: (string | null)[] = [
  'OK', 'INVALID', 'EXPIRED', 'REVOKED', 'EXHAUSTED', 'TRIP_DELETED', 'REMOVED', 'NETWORK',
  'expired', 'ok', '', '   ', 'SOMETHING_NEW', null
];

type Preview = {
  valid: boolean; reason: string; trip_name: string | null; start_date: string | null; day_count: number | null;
  role: string | null; expires_at: string | null; already_member: boolean;
};
function preview(over: Partial<Preview>): Preview {
  return { valid: true, reason: 'OK', trip_name: '바르셀로나', start_date: '2026-10-25', day_count: 14,
           role: 'EDITOR', expires_at: '2026-10-01T00:00:00.000Z', already_member: false, ...over };
}
const verdictCases: { name: string; preview: Preview | null }[] = [
  { name: '못 불러왔다', preview: null },
  { name: '유효한 초대', preview: preview({}) },
  { name: '만료', preview: preview({ valid: false, reason: 'EXPIRED', role: 'VIEWER' }) },
  { name: '이유가 비었다', preview: preview({ valid: false, reason: '' }) },
  { name: '이유가 소문자', preview: preview({ valid: false, reason: 'removed' }) },
  { name: '모르는 이유', preview: preview({ valid: false, reason: 'SOMETHING_NEW' }) },
  { name: '무효인데 이유가 OK — 빈 문장으로 두지 않는다', preview: preview({ valid: false, reason: 'OK' }) },
  { name: '이미 참여 중', preview: preview({ already_member: true, role: 'OWNER' }) },
  { name: '이미 참여 중이면 무효여도 들어간다', preview: preview({ valid: false, reason: 'EXPIRED', already_member: true }) },
  { name: '유효한데 이유가 비었다', preview: preview({ reason: '', role: null }) },
  { name: '모르는 역할은 역할 없음', preview: preview({ role: 'ADMIN' }) }
];

const ranges: { start: string | null; dayCount: number | null }[] = [
  { start: '2026-10-25', dayCount: 14 }, { start: '2026-10-25', dayCount: 1 }, { start: '2026-10-25', dayCount: 0 },
  { start: '2026-10-25', dayCount: -3 }, { start: '2026-12-30', dayCount: 5 }, { start: '2028-02-28', dayCount: 3 },
  { start: '2026-03-27', dayCount: 4 }, { start: '2026/10/25', dayCount: 3 }, { start: '', dayCount: 2 },
  { start: null, dayCount: 3 }, { start: null, dayCount: 0 }, { start: null, dayCount: null }, { start: null, dayCount: -3 }
];

/** 앱은 역할을 정확한 문자열로만 받는다(`MemberRole`) — 모르는 값은 '역할 없음'이다. */
const roleNames = ['OWNER', 'EDITOR', 'VIEWER', '', 'ADMIN'];

const memberRows = [
  { id: 1, user_id: 'u1', role: 'EDITOR', status: 'ACTIVE', display_name: '영희', joined_at: null, me: false },
  { id: 2, user_id: 'u2', role: 'OWNER', status: 'ACTIVE', display_name: '   ', joined_at: null, me: true },
  { id: 3, user_id: 'u3', role: 'VIEWER', status: 'ACTIVE', display_name: null, joined_at: null, me: false },
  { id: 4, user_id: 'u4', role: 'EDITOR', status: 'ACTIVE', display_name: '  지민  ', joined_at: null, me: false },
  { id: 5, user_id: 'u5', role: 'EDITOR', status: 'ACTIVE', display_name: '가'.repeat(45), joined_at: null, me: false },
  { id: 6, user_id: 'u6', role: 'OWNER', status: 'ACTIVE', display_name: null, joined_at: null, me: false }
];

// ── 여행 취향 ─────────────────────────────────────────────────────────────

const prefsCases: { name: string; input: Record<string, unknown> }[] = [
  { name: '비었다', input: {} },
  { name: '모르는 값·중복·빈 값·숫자·긴 메모를 거른다', input: {
    pace: 'PACKED', walking: 'NOPE', morning: false, interests: ['야경', '야경', '  ', '미술관', 3],
    note: '가'.repeat(200), unknownKey: '사라진다' } },
  { name: '소문자 페이스는 모르는 값', input: { pace: 'relaxed' } },
  { name: '별로는 다듬고 정렬한다', input: { pace: 'NORMAL', walking: 'LOW', night: true, dislikes: ['시장', ' 쇼핑 '] } },
  { name: '불리언·배열이 아니면 버린다', input: { morning: 'false', night: 2, interests: '미술관' } },
  { name: '관심은 열두 개까지 — 앞에서부터 담고 정렬한다', input: { interests: [
    '휴식', '액티비티', '공연', '건축', '시장', '쇼핑', '카페', '맛집', '야경', '자연', '박물관', '미술관', '온천', '등산'] } },
  { name: '메모는 앞뒤 줄바꿈까지 다듬는다', input: { note: '\n  아침은 느긋하게  \n', morning: true, night: false } },
  { name: '공백만 있는 메모는 없다', input: { note: '   ', walking: 'HIGH' } },
  { name: '항목은 서른 글자로 자르고, 자른 뒤 같으면 하나다', input: { interests: [
    '가'.repeat(30) + '나', '가'.repeat(30) + '다', 'Museum of Modern Art and Design 2026'] } }
];

type PrefRow = { user_id: string; label: string; role: string; mine: boolean; prefs: Record<string, unknown> };
const pref = (label: string, prefs: Record<string, unknown>, mine = false): PrefRow =>
  ({ user_id: `id-${label.trim() || 'blank'}`, label, role: 'EDITOR', mine, prefs });

const groupCases: { name: string; memberCount: number; rows: PrefRow[] }[] = [
  { name: '정리만 한다 — 페이스 갈림·가장 약한 걷기·아침·함께 관심·충돌', memberCount: 4, rows: [
    pref('영희', { pace: 'RELAXED', walking: 'LOW', morning: false, interests: ['미술관'] }),
    pref('철수', { pace: 'PACKED', walking: 'HIGH', interests: ['미술관'], dislikes: ['쇼핑'] }),
    pref('민수', { interests: ['쇼핑'] })
  ] },
  { name: '아무도 남기지 않았다', memberCount: 3, rows: [pref('영희', {})] },
  { name: '빈 목록', memberCount: 2, rows: [] },
  { name: '다수 페이스가 하나면 그걸 말한다', memberCount: 3, rows: [
    pref('영희', { pace: 'RELAXED' }), pref('철수', { pace: 'RELAXED' }), pref('민수', { pace: 'NORMAL' })
  ] },
  { name: '페이스가 동률이면 말하지 않는다', memberCount: 2, rows: [
    pref('영희', { pace: 'RELAXED' }), pref('철수', { pace: 'NORMAL' })
  ] },
  { name: '나는 나로 부르고, 이름표는 다듬는다', memberCount: 3, rows: [
    pref('나야', { walking: 'LOW', night: false }, true), pref('  지민  ', { walking: 'LOW', night: false }), pref('   ', { walking: 'NORMAL' })
  ] },
  { name: '많이 걷기 싫은 사람이 없으면 걷기 줄이 없다', memberCount: 2, rows: [
    pref('영희', { walking: 'HIGH' }), pref('철수', { walking: 'NORMAL' })
  ] },
  { name: '인원보다 답한 줄이 많다', memberCount: 1, rows: [
    pref('영희', { pace: 'PACKED' }), pref('철수', { pace: 'PACKED' }), pref('민수', {})
  ] },
  { name: '함께 관심은 많이 고른 순, 같으면 이름순 — 충돌은 주제 순', memberCount: 3, rows: [
    pref('A', { interests: ['야경', '미술관', '쇼핑', '카페'] }),
    pref('B', { interests: ['야경', '미술관', '카페'] }),
    pref('C', { interests: ['야경'], dislikes: ['쇼핑', '미술관'] })
  ] }
];

describe('collab.js의 나머지 복사본 규칙 — iOS 픽스처', () => {
  it('후보 보드 — 집계·상태·합의·배지·요약·묶음·정렬', () => {
    const cases = boardCases.map((c) => ({
      name: c.name,
      memberCount: c.memberCount,
      candidate: c.candidate,
      tally: collab.tallyReactions(c.candidate, c.memberCount),
      mood: collab.candidateMood(c.candidate, c.memberCount),
      moodText: collab.moodText(collab.candidateMood(c.candidate, c.memberCount)),
      consensus: collab.consensusOf(c.candidate, c.memberCount),
      verdict: (({ text, tone }) => ({ text, tone }))(collab.candidateVerdict(c.candidate, c.memberCount)),
      summary: collab.reactionSummary(c.candidate, c.memberCount),
      attribution: collab.candidateAttribution(c.candidate)
    }));
    const memberCount = 3;
    const ids = (list: { id: number }[]) => list.map((c) => c.id);
    const groups = collab.groupCandidates(boardList, memberCount);
    const board = {
      memberCount,
      candidates: boardList,
      groups: {
        loved: ids(groups.loved), needsOpinion: ids(groups.needsOpinion), resting: ids(groups.resting),
        scheduled: ids(groups.scheduled), rejected: ids(groups.rejected)
      },
      byInterest: ids(collab.sortCandidates(boardList, 'interest', memberCount)),
      recent: ids(collab.sortCandidates(boardList, 'recent', memberCount))
    };

    // 규칙이 실제로 무엇을 말하는지 몇 가지는 여기서도 못 박는다 — 픽스처만 있으면 둘 다 같이 틀릴 수 있다.
    const of = (name: string) => cases.find((c) => c.name === name)!;
    expect(of('§20 A — MUST2·OK1·PASS1은 갈림').consensus.status).toBe('CONFLICT');
    expect(of('§20 B — MUST1·OK3은 반대 없음').consensus.status).toBe('GOOD_MATCH');
    expect(of('넷 중 둘만 MUST — 아직 다 말하지 않았다').mood, '둘이 좋다고 넷의 마음을 말하지 않는다').toBe('QUIET');
    expect(of('한 명의 MUST로 합의를 말하지 않는다').verdict.text, '한 명이면 합의 문장이 아니다').toBe(collab.MOOD_TEXT.QUIET);
    expect(of('서버 집계가 낡아도 반응 배열로 다시 센다').tally.must).toBe(0);
    expect(of('둘 중 하나 MUST — 점수가 딱 .5에 걸린다').consensus.score, '.5는 올린다 — Swift rounded()와 같은 쪽').toBe(63);
    expect(of('넷 중 둘 PASS — 점수가 딱 .5에 걸린다').consensus.score).toBe(38);
    // 점수는 내부값이다 — 화면에 나가는 문장에는 숫자가 없다(§21·§22)
    for (const c of cases) expect(c.verdict.text).not.toMatch(/\d/);
    expect(board.groups.needsOpinion).toEqual([1, 6, 7, 10]);
    expect(board.byInterest.slice(0, 2), '반대가 있는 쪽이 위로 가지 않는다').toEqual([2, 1]);
    expect(board.recent.slice(-3), '같은 시각이면 만든 순 키의 글자 순').toEqual([7, 10, 1]);
    // ⚠️ 앱의 `ReactionEntry`는 `me`가 비옵셔널이다 — 하나라도 빠지면 픽스처 전체 디코딩이 깨진다.
    for (const c of [...cases.map((x) => x.candidate), ...boardList]) {
      for (const rx of c.reactions) expect(typeof rx.me).toBe('boolean');
    }

    writeFixture('candidate-board', {
      cases,
      board,
      reactions: collab.REACTIONS.map((id) => ({ id, label: collab.REACTION_LABEL[id], icon: collab.REACTION_ICON[id] })),
      moods: collab.MOOD_TEXT,
      consensusTexts: collab.CONSENSUS_TEXT,
      categories: {
        list: collab.CANDIDATE_CATEGORIES,
        reads: categoryReads.map((raw) => ({ raw, value: collab.candidateCategoryOf(raw) }))
      }
    });
  });

  it('활동 문장 — 문장·을/를·묶기·상대 시각', () => {
    const cases = activityCases.map((c) => ({
      name: c.name,
      event: c.event,
      count: c.count ?? null,
      text: collab.activityText(c.count == null ? c.event : { ...c.event, count: c.count })
    }));
    const particles = particleWords.map((word) => ({ word, particle: collab.objParticle(word) }));
    const condense = condenseCases.map((c) => ({
      name: c.name,
      rows: c.rows,
      lines: collab.condenseActivity(c.rows).map((ev) => ({
        id: ev.id, count: ev.count || 1, text: collab.activityText(ev)
      }))
    }));
    const now = Date.parse(relativeNow);
    const relativeTimes = {
      now: relativeNow,
      cases: relativeCases.map((iso) => ({ iso, text: collab.relativeTime(iso, now) }))
    };

    const text = (name: string) => cases.find((c) => c.name === name)!.text;
    expect(text('후보 담기 — 받침 있음')).toBe('영희님이 구엘 공원을 후보로 담았어요');
    expect(text('모르는 종류는 빈 문장'), '모르는 종류는 화면이 건너뛴다').toBe('');
    expect(condense[0].lines.map((l) => [l.id, l.count])).toEqual([[5, 3], [2, 1]]);
    expect(condense[3].lines.map((l) => [l.id, l.count]), '창은 묶인 가장 이른 저장에서 다시 잰다').toEqual([[3, 2], [1, 1]]);
    // 'M/D'는 기기 시간대를 탄다 — 이 픽스처의 답은 어느 시간대에서도 같아야 한다
    for (const c of relativeTimes.cases) expect(c.text).not.toMatch(/\//);
    // 활동 문장에 이메일이 섞이지 않는다(§69)
    expect(JSON.stringify(cases)).not.toMatch(/@/);

    writeFixture('activity-text', { cases, particles, condense, relativeTimes });
  });

  it('초대와 역할 — 토큰·이유·판정·기간·역할·이름', () => {
    const joinTokens = joinHashes.map((hash) => ({ hash, token: collab.parseJoinHash(hash) }));
    const reasonRows = reasons.map((reason) => ({ reason, text: collab.joinReasonText(reason) }));
    const verdicts = verdictCases.map((c) => {
      const v = collab.inviteVerdict(c.preview);
      return { name: c.name, preview: c.preview, ok: v.ok, text: v.text, alreadyMember: v.alreadyMember, role: v.role };
    });
    const rangeRows = ranges.map((r) => ({ ...r, text: collab.inviteRangeText(r.start, r.dayCount) }));
    const roles = roleNames.map((role) => ({
      role,
      canEdit: collab.canEdit(role), canManage: collab.canManage(role), canLeave: collab.canLeave(role),
      canDelete: collab.canDelete(role), canPropose: collab.canPropose(role), canReact: collab.canReact(role),
      canComment: collab.canComment(role), canScheduleCandidate: collab.canScheduleCandidate(role),
      canRemoveMine: collab.canRemoveCandidate(role, { mine: true }),
      canRemoveOthers: collab.canRemoveCandidate(role, { mine: false }),
      canDeleteMyComment: collab.canDeleteComment(role, { mine: true }),
      canDeleteOthersComment: collab.canDeleteComment(role, { mine: false }),
      label: collab.roleLabel(role), icon: collab.roleIcon(role)
    }));
    const memberNames = memberRows.map((member) => ({ member, name: collab.memberName(member) }));

    expect(joinTokens[0].token).toBe(T16);
    expect(joinTokens.find((j) => j.hash === `#v=${T16}`)?.token, '읽기전용 공유 링크는 초대가 아니다').toBeNull();
    // 이유를 모르면 '올바르지 않다'로 말한다 — 거절 문장이 빈 칸이 되지 않는다
    for (const r of reasonRows) expect(r.text).not.toBe('');
    expect(verdicts.find((v) => v.name === '무효인데 이유가 OK — 빈 문장으로 두지 않는다')?.text)
      .toBe(collab.JOIN_REASON.INVALID);
    expect(roles.find((r) => r.role === 'VIEWER')).toMatchObject({ canReact: true, canComment: true, canPropose: false });
    expect(roles.find((r) => r.role === 'OWNER')?.canLeave, '주최자는 나갈 수 없다(§71)').toBe(false);
    // 이름표에 계정 이메일이 나오지 않는다(§69)
    expect(JSON.stringify(memberNames)).not.toMatch(/@/);

    writeFixture('invite', {
      webBase: WEB_BASE, joinTokens, reasons: reasonRows, verdicts, ranges: rangeRows, roles, memberNames
    });
  });

  it('여행 취향 — 정규화·한 줄 요약·그룹 정리', () => {
    const normalize = prefsCases.map((c) => ({
      name: c.name, input: c.input, normalized: collab.normPrefs(c.input), text: collab.prefsText(c.input)
    }));
    const groups = groupCases.map((c) => ({
      name: c.name, memberCount: c.memberCount, rows: c.rows,
      lines: collab.groupContextText(collab.groupContext(c.rows, c.memberCount))
    }));

    expect(normalize[1].normalized).toEqual({ pace: 'PACKED', morning: false, interests: ['미술관', '야경'], note: '가'.repeat(120) });
    // 정리만 한다 — 자동으로 빼자고 하지 않는다(§23·§62)
    for (const g of groups) for (const line of g.lines) expect(line).not.toMatch(/빼/);
    expect(groups[5].lines.some((l) => l.includes('(나, 지민)')), '이름표는 다듬어서 부른다').toBe(true);

    writeFixture('trip-prefs', { normalize, groups });
  });
});
