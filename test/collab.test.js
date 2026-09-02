// collab.js — 함께하기 순수 로직.
//
// 지켜야 하는 것: 혼자 쓰는 여행은 예전과 똑같이 전부 된다 / 보기 권한은 편집을 못 한다 /
// 주최자는 나갈 수 없다 / 초대 링크에는 토큰만 실린다 / 서버의 거절 이유를 사람 말로 옮긴다.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const C = require('../collab.js');

// ── 역할 ──

test('normRole: 대소문자·공백을 정리하고 모르는 값은 null', () => {
  assert.equal(C.normRole(' editor '), 'EDITOR');
  assert.equal(C.normRole('OWNER'), 'OWNER');
  assert.equal(C.normRole('admin'), null);
  assert.equal(C.normRole(null), null);
});

test('권한 판정: 편집은 OWNER·EDITOR, 관리·삭제는 OWNER, 나가기는 OWNER가 아닌 멤버', () => {
  assert.equal(C.canEdit('OWNER'), true);
  assert.equal(C.canEdit('EDITOR'), true);
  assert.equal(C.canEdit('VIEWER'), false);
  assert.equal(C.canManage('EDITOR'), false);
  assert.equal(C.canManage('OWNER'), true);
  assert.equal(C.canDelete('EDITOR'), false);
  assert.equal(C.canLeave('OWNER'), false, '주최자는 나갈 수 없다(§71)');
  assert.equal(C.canLeave('VIEWER'), true);
  assert.equal(C.canEdit('garbage'), false, '모르는 역할은 아무것도 못 한다');
});

test('roleOf: 로그아웃·역할 정보 없음(로컬 전용 여행)은 소유자 — 혼자 쓰는 여행은 예전 그대로다(§95)', () => {
  assert.equal(C.roleOf(null, 't1', false), 'OWNER');
  assert.equal(C.roleOf({}, 't1', true), 'OWNER');
  assert.equal(C.roleOf({ t1: { role: 'VIEWER' } }, 't1', true), 'VIEWER');
  assert.equal(C.roleOf({ t1: { role: 'VIEWER' } }, 't1', false), 'OWNER', '로그아웃하면 서버 역할은 의미가 없다');
  assert.equal(C.roleOf({ t1: { role: 'nonsense' } }, 't1', true), 'OWNER');
});

test('tripRoleMap: 같은 client_id가 둘이면 소유한 쪽이 이긴다', () => {
  const map = C.tripRoleMap([
    { client_id: 'x', role: 'VIEWER', member_count: 3, owner: false },
    { client_id: 'x', role: 'OWNER', member_count: 1, owner: true },
    { client_id: 'y', role: 'EDITOR', member_count: 2, owner: false },
    { client_id: '', role: 'OWNER' }, null
  ]);
  assert.equal(map.x.role, 'OWNER');
  assert.equal(map.x.count, 1);
  assert.equal(map.y.role, 'EDITOR');
  assert.equal(map.y.count, 2);
  assert.equal(Object.keys(map).length, 2);
  // 순서를 바꿔도 같다
  const rev = C.tripRoleMap([
    { client_id: 'x', role: 'OWNER', member_count: 1, owner: true },
    { client_id: 'x', role: 'VIEWER', member_count: 3, owner: false }
  ]);
  assert.equal(rev.x.role, 'OWNER');
});

// ── 멤버 표현 ──

test('memberName: 이름이 없으면 계정 정보 대신 역할로 부른다(§69)', () => {
  assert.equal(C.memberName({ display_name: ' 영희 ' }), '영희');
  assert.equal(C.memberName({ display_name: null, role: 'OWNER' }), '주최자');
  assert.equal(C.memberName({ display_name: '', role: 'EDITOR' }), '멤버');
  assert.equal(C.memberName(null), '멤버');
  assert.equal(C.memberName({ display_name: 'a'.repeat(100) }).length, C.COLLAB_CFG.nameMax);
});

test('displayNameFromEmail: 도메인은 버린다', () => {
  assert.equal(C.displayNameFromEmail('minsu@example.com'), 'minsu');
  assert.equal(C.displayNameFromEmail(''), '');
  assert.equal(C.displayNameFromEmail(null), '');
});

test('memberSummary: 활성 멤버만 세고 역할별로 나눈다', () => {
  const s = C.memberSummary([
    { role: 'OWNER', status: 'ACTIVE', display_name: '민수' },
    { role: 'EDITOR', status: 'ACTIVE', display_name: '영희' },
    { role: 'VIEWER', status: 'ACTIVE' },
    { role: 'EDITOR', status: 'LEFT', display_name: '철수' },
    null
  ]);
  assert.deepEqual([s.total, s.owners, s.editors, s.viewers], [3, 1, 1, 1]);
  assert.deepEqual(s.names, ['민수', '영희', '멤버']);
});

// ── 초대 링크 ──

test('buildInviteLink: 토큰만 싣고 기존 해시는 버린다', () => {
  const link = C.buildInviteLink('https://tripcanvas-ai.vercel.app/#v=abc', 'tok_ABC-123_xyz789');
  assert.equal(link, 'https://tripcanvas-ai.vercel.app/#join=tok_ABC-123_xyz789');
  assert.ok(!/tripId|role|expires/.test(link), '여행 id·역할·만료는 URL에 넣지 않는다');
});

test('parseJoinHash: 형식이 맞는 토큰만 꺼낸다 — 아무 문자열이나 서버에 보내지 않는다', () => {
  const token = 'Ab-_' + 'x'.repeat(28);
  assert.equal(C.parseJoinHash('#join=' + token), token);
  assert.equal(C.parseJoinHash('#join=' + encodeURIComponent(token)), token);
  assert.equal(C.parseJoinHash('#join=short'), null, '16자 미만');
  assert.equal(C.parseJoinHash('#join=' + 'a'.repeat(129)), null, '128자 초과');
  assert.equal(C.parseJoinHash('#join=bad$chars%%%%%%%%%%%%'), null);
  assert.equal(C.parseJoinHash('#v=' + token), null, '읽기전용 공유 링크는 초대가 아니다');
  assert.equal(C.parseJoinHash('#join=' + token + '&x=1'), null);
  assert.equal(C.parseJoinHash(''), null);
  assert.equal(C.parseJoinHash(null), null);
});

test('buildInviteLink → parseJoinHash 왕복', () => {
  const token = 'Q'.repeat(20) + '-_';
  const link = C.buildInviteLink('https://example.test/app/', token);
  assert.equal(C.parseJoinHash(link.slice(link.indexOf('#'))), token);
});

// ── 초대 판정 ──

test('inviteVerdict: 서버의 이유 코드를 사람 말로 옮기고 이미 멤버면 참여 대신 열기', () => {
  assert.deepEqual(C.inviteVerdict({ valid: true, reason: 'OK', role: 'EDITOR' }),
    { ok: true, reason: 'OK', text: '', alreadyMember: false, role: 'EDITOR' });
  const expired = C.inviteVerdict({ valid: false, reason: 'EXPIRED', role: 'VIEWER' });
  assert.equal(expired.ok, false);
  assert.match(expired.text, /만료/);
  assert.match(C.inviteVerdict({ valid: false, reason: 'REVOKED' }).text, /취소/);
  assert.match(C.inviteVerdict({ valid: false, reason: 'REMOVED' }).text, /내보내/);
  assert.match(C.inviteVerdict({ valid: false, reason: 'WHATEVER' }).text, /올바르지 않아요/, '모르는 이유는 무효로');
  const member = C.inviteVerdict({ valid: false, reason: 'EXPIRED', already_member: true, role: 'EDITOR' });
  assert.equal(member.ok, true, '이미 멤버면 링크가 만료됐어도 열 수 있다');
  assert.equal(member.alreadyMember, true);
  assert.equal(C.inviteVerdict(null).reason, 'NETWORK');
});

test('joinReasonText: 알 수 없는 코드는 무효 안내', () => {
  assert.equal(C.joinReasonText('EXPIRED'), C.JOIN_REASON.EXPIRED);
  assert.equal(C.joinReasonText('???'), C.JOIN_REASON.INVALID);
});

test('inviteRangeText: 시작일·일수로 기간 한 줄', () => {
  assert.equal(C.inviteRangeText('2026-10-25', 14), '10/25 ~ 11/7 · 14일');
  assert.equal(C.inviteRangeText('2026-10-25', 1), '10/25 · 1일');
  assert.equal(C.inviteRangeText('', 3), '3일');
  assert.equal(C.inviteRangeText(null, 0), '');
  assert.equal(C.inviteRangeText('2026-12-31', 2), '12/31 ~ 1/1 · 2일', '연도를 넘어가도 맞다');
});

// ── 오류 판별 ──

test('isForbiddenError: 42501·403·TRIP_FORBIDDEN 메시지를 권한 오류로 본다', () => {
  assert.equal(C.isForbiddenError({ code: '42501', message: 'TRIP_FORBIDDEN' }), true);
  assert.equal(C.isForbiddenError({ status: 403 }), true);
  assert.equal(C.isForbiddenError({ message: 'permission denied for table trips' }), true);
  assert.equal(C.isForbiddenError({ code: 'PGRST301', message: 'JWT expired' }), false);
  assert.equal(C.isForbiddenError(new Error('offline')), false);
  assert.equal(C.isForbiddenError(null), false);
});

test('forbiddenText: 서버 hint를 우선하고, 보기 권한이면 편집 권한 요청을 안내한다', () => {
  assert.match(C.forbiddenText({ message: 'OWNER_CANNOT_LEAVE' }, 'OWNER'), /주최자는 여행을 나갈 수 없어요/);
  assert.match(C.forbiddenText({ message: 'TRIP_FORBIDDEN', hint: '이 여행에서 나갔거나 내보내졌다' }, 'EDITOR'), /나갔거나 내보내졌어요/);
  assert.match(C.forbiddenText({ message: 'TRIP_FORBIDDEN' }, 'VIEWER'), /편집 권한을 요청/);
  assert.match(C.forbiddenText({}, 'EDITOR'), /권한이 없어요/);
});

// ── 후보 장소와 반응 (2단계) ──

test('normReaction: 아는 반응만 통과시킨다', () => {
  assert.equal(C.normReaction(' must '), 'MUST');
  assert.equal(C.normReaction('ok'), 'OK');
  assert.equal(C.normReaction('LOVE'), null);
  assert.equal(C.normReaction(null), null);
  assert.equal(C.reactionLabel('PASS'), '이번엔 패스');
  assert.equal(C.reactionLabel('???'), '의견 없음');
  assert.equal(C.reactionIcon('MUST'), '❤️');
});

test('후보 권한: 보기 권한은 의견만 낸다 — 후보를 만들거나 일정에 넣지는 못한다', () => {
  assert.equal(C.canPropose('EDITOR'), true);
  assert.equal(C.canPropose('VIEWER'), false, '보기 권한은 여행에 내용을 만들지 않는다');
  assert.equal(C.canReact('VIEWER'), true, '의견을 내는 것은 일정을 바꾸는 것이 아니다');
  assert.equal(C.canReact('nonsense'), false);
  assert.equal(C.canScheduleCandidate('VIEWER'), false);
  assert.equal(C.canScheduleCandidate('OWNER'), true);
});

test('canRemoveCandidate: 역할이 아니라 누가 냈는가로 갈린다', () => {
  assert.equal(C.canRemoveCandidate('EDITOR', { mine: true }), true);
  assert.equal(C.canRemoveCandidate('EDITOR', { mine: false }), false, '편집자도 남의 후보는 못 지운다');
  assert.equal(C.canRemoveCandidate('OWNER', { mine: false }), true);
  assert.equal(C.canRemoveCandidate('VIEWER', { mine: true }), true, '내가 낸 것은 내가 거둔다');
  assert.equal(C.canRemoveCandidate('OWNER', null), true);
});

test('tallyReactions: 반응 목록이 있으면 그걸 세고, 없으면 서버 집계를 쓴다', () => {
  const byList = C.tallyReactions({ reactions: [
    { reaction: 'MUST' }, { reaction: 'MUST' }, { reaction: 'OK' }, { reaction: 'PASS' }, { reaction: '???' }
  ] }, 5);
  assert.deepEqual([byList.must, byList.ok, byList.pass, byList.voted, byList.silent], [2, 1, 1, 4, 1]);
  const byCount = C.tallyReactions({ must_count: 3, ok_count: 1, pass_count: 0 }, 4);
  assert.deepEqual([byCount.must, byCount.voted, byCount.silent], [3, 4, 0]);
  // 멤버 수를 모르면 표를 낸 사람 수가 하한 — 침묵을 지어내지 않는다
  assert.equal(C.tallyReactions({ must_count: 2 }).silent, 0);
  assert.equal(C.tallyReactions(null).voted, 0);
  assert.equal(C.tallyReactions({ must_count: -5 }).must, 0, '음수는 0으로');
});

test('candidateMood(§91 fixture): 전원 MUST · MUST+OK · MUST+PASS · 전원 PASS · 의견 없음 · 2명 split', () => {
  const m = (must, ok, pass, members) => C.candidateMood({ must_count: must, ok_count: ok, pass_count: pass }, members);
  assert.equal(m(4, 0, 0, 4), 'LOVED', '전원 MUST');
  assert.equal(m(2, 2, 0, 4), 'LOVED', 'MUST + OK — 아무도 패스하지 않았다');
  assert.equal(m(2, 0, 2, 4), 'SPLIT', 'MUST + PASS');
  assert.equal(m(0, 0, 4, 4), 'COOL', '전원 PASS');
  assert.equal(m(0, 0, 0, 4), 'NONE', '의견 없음');
  assert.equal(m(1, 0, 1, 2), 'SPLIT', '2명 split');
  // 아직 다 말하지 않았으면 '다들 좋아해요'라고 하지 않는다 — 둘의 마음으로 넷을 말하지 않는다
  assert.equal(m(2, 0, 0, 4), 'QUIET');
  assert.equal(m(1, 0, 0, 1), 'LOVED', '혼자 쓰는 여행이면 내 한 표가 전원이다');
  assert.equal(C.moodText('SPLIT'), C.MOOD_TEXT.SPLIT);
  assert.equal(C.moodText('???'), C.MOOD_TEXT.QUIET, '모르는 상태는 의견을 더 받는 쪽으로');
});

test('groupCandidates: 일정에 들어간 것은 따로 빼고, 결정 못 한 것만 "의견 필요"로 모은다(§57·§58)', () => {
  const g = C.groupCandidates([
    { id: 1, must_count: 3, ok_count: 0, pass_count: 0 },              // LOVED
    { id: 2, must_count: 1, ok_count: 0, pass_count: 2 },              // SPLIT
    { id: 3, must_count: 0, ok_count: 0, pass_count: 0 },              // NONE
    { id: 4, must_count: 0, ok_count: 0, pass_count: 3 },              // COOL
    { id: 5, must_count: 3, ok_count: 0, pass_count: 0, status: 'SCHEDULED' },
    null
  ], 3);
  assert.deepEqual(g.loved.map(c => c.id), [1]);
  assert.deepEqual(g.needsOpinion.map(c => c.id), [2, 3], '갈리는 것과 아직 안 낸 것은 같이 묶는다');
  assert.deepEqual(g.resting.map(c => c.id), [4]);
  assert.deepEqual(g.scheduled.map(c => c.id), [5], '이미 정한 것을 계속 물어보지 않는다');
  assert.deepEqual(C.groupCandidates(null).loved, []);
});

test('reactionSummary: 0인 반응은 쓰지 않는다', () => {
  assert.equal(C.reactionSummary({ must_count: 3, ok_count: 1, pass_count: 0 }), '❤️ 3 · 👍 1');
  assert.equal(C.reactionSummary({ must_count: 0, ok_count: 0, pass_count: 2 }), '👋 2');
  assert.equal(C.reactionSummary({ must_count: 0, ok_count: 0, pass_count: 0 }), '');
});

test('candidateAttribution: 가볍게 — 책임을 묻는 말이 되지 않게(§13)', () => {
  assert.equal(C.candidateAttribution({ mine: true, proposed_by_label: '민수' }), '내가 추가');
  assert.equal(C.candidateAttribution({ proposed_by_label: '영희' }), '영희가 추가');
  assert.equal(C.candidateAttribution({ proposed_by_label: '' }), '멤버가 추가');
  assert.equal(C.candidateAttribution(null), '');
});

test('sortCandidates: 정렬은 표시일 뿐 — 같은 값이면 순서가 흔들리지 않는다', () => {
  const list = [
    { id: 'a', created_at: '2026-01-01', must_count: 1 },
    { id: 'b', created_at: '2026-01-03', must_count: 1 },
    { id: 'c', created_at: '2026-01-02', must_count: 3 }
  ];
  assert.deepEqual(C.sortCandidates(list, 'recent').map(c => c.id), ['b', 'c', 'a']);
  assert.deepEqual(C.sortCandidates(list, 'interest', 3).map(c => c.id), ['c', 'b', 'a']);
  // 같은 입력이면 언제나 같은 순서 — 원본을 건드리지 않는다
  assert.deepEqual(C.sortCandidates(list, 'interest', 3).map(c => c.id), ['c', 'b', 'a']);
  assert.equal(list[0].id, 'a', '원본 배열은 그대로');
  // PASS가 많으면 뒤로
  const withPass = C.sortCandidates([
    { id: 'x', created_at: '2026-01-01', must_count: 2, pass_count: 2 },
    { id: 'y', created_at: '2026-01-01', must_count: 2, pass_count: 0 }
  ], 'interest', 4);
  assert.deepEqual(withPass.map(c => c.id), ['y', 'x']);
});

// ── 코멘트 · 활동 기록 · 실시간 (3단계) ──

test('코멘트 권한: 의견이라 활성 멤버 전원이 남기고, 지우기는 쓴 사람이나 주최자만', () => {
  assert.equal(C.canComment('VIEWER'), true);
  assert.equal(C.canComment('nope'), false);
  assert.equal(C.canDeleteComment('EDITOR', { mine: false }), false);
  assert.equal(C.canDeleteComment('EDITOR', { mine: true }), true);
  assert.equal(C.canDeleteComment('OWNER', { mine: false }), true);
  assert.equal(C.canDeleteComment('VIEWER', null), false);
});

test('objParticle: 받침에 따라 을/를, 한글이 아니면 를', () => {
  assert.equal(C.objParticle('사그라다 파밀리아'), '를');
  assert.equal(C.objParticle('구엘 공원'), '을');
  assert.equal(C.objParticle('Camp Nou'), '를');
  assert.equal(C.objParticle(''), '를');
});

test('activityText: 종류마다 사람 말 한 줄(§37) — 내 것은 "내가", 모르는 종류는 빈 문자열', () => {
  const t = (kind, extra) => C.activityText(Object.assign({ kind, actor_label: '영희', mine: false }, extra));
  assert.equal(t('MEMBER_JOINED', { member_label: '영희' }), '영희님이 함께하게 됐어요');
  assert.equal(t('MEMBER_JOINED', { member_label: '영희', mine: true }), '내가 함께하게 됐어요');
  assert.equal(t('MEMBER_LEFT', { member_label: '철수' }), '철수님이 여행에서 나갔어요');
  assert.equal(t('MEMBER_REMOVED', { actor_label: '주최자', member_label: '영희', mine: true }), '내가 영희님을 내보냈어요');
  assert.equal(t('CANDIDATE_PROPOSED', { subject: { title: '카사 바트요' } }), '영희님이 카사 바트요를 후보로 담았어요');
  assert.equal(t('CANDIDATE_PROPOSED', { subject: { title: '구엘 공원' }, mine: true }), '내가 구엘 공원을 후보로 담았어요');
  assert.equal(t('CANDIDATE_SCHEDULED', { subject: { title: '구엘 공원', ref: '2' } }), '영희님이 구엘 공원을 Day 2에 넣었어요');
  assert.equal(t('CANDIDATE_SCHEDULED', { subject: { title: '구엘 공원' } }), '영희님이 구엘 공원을 일정에 넣었어요');
  assert.equal(t('REACTION', { subject: { title: '카사 바트요', reaction: 'MUST' } }), '영희님이 카사 바트요를 "꼭 가고 싶어요"로 골랐어요');
  assert.equal(t('COMMENT_ADDED', { subject: { title: '카사 바트요', excerpt: '야경 보고 싶어' } }), '영희님이 카사 바트요에 한마디: “야경 보고 싶어”');
  assert.equal(t('SCHEDULE_CHANGED', {}), '영희님이 일정을 바꿨어요');
  assert.equal(t('SCHEDULE_CHANGED', { count: 4 }), '영희님이 일정을 바꿨어요 (4번)');
  assert.equal(t('BOOKING_ADDED', { subject: { count: 1 } }), '영희님이 예약을 추가했어요');
  assert.equal(t('BOOKING_ADDED', { subject: { count: 2 } }), '영희님이 예약 2건을 추가했어요');
  assert.equal(t('WHATEVER', {}), '', '모르는 종류는 화면이 건너뛴다');
  assert.equal(C.activityText({ kind: 'CANDIDATE_PROPOSED', actor_label: '', subject: {} }), '멤버님이 후보를 후보로 담았어요', '이름표·제목이 비어도 깨지지 않는다');
  assert.equal(C.activityText(null), '');
});

test('condenseActivity: 같은 사람의 연속 일정 변경은 한 줄로, 같은 후보에 대한 반응은 마지막 것만(§38·§39)', () => {
  const at = (m) => new Date(Date.UTC(2026, 8, 2, 10, m)).toISOString();
  const rows = [   // 최신순
    { id: 9, kind: 'SCHEDULE_CHANGED', actor_label: '영희', created_at: at(30) },
    { id: 8, kind: 'SCHEDULE_CHANGED', actor_label: '영희', created_at: at(28) },
    { id: 7, kind: 'SCHEDULE_CHANGED', actor_label: '영희', created_at: at(25) },
    { id: 6, kind: 'REACTION', actor_label: '영희', subject: { candidate_id: 1, reaction: 'MUST' }, created_at: at(20) },
    { id: 5, kind: 'SCHEDULE_CHANGED', actor_label: '주최자', mine: true, created_at: at(18) },
    { id: 4, kind: 'REACTION', actor_label: '영희', subject: { candidate_id: 1, reaction: 'OK' }, created_at: at(15) },
    { id: 3, kind: 'REACTION', actor_label: '영희', subject: { candidate_id: 2, reaction: 'PASS' }, created_at: at(14) },
    { id: 2, kind: 'SCHEDULE_CHANGED', actor_label: '영희', created_at: at(0) },
    { id: 1, kind: 'CANDIDATE_PROPOSED', actor_label: '영희', subject: { title: 'x' }, created_at: at(0) }
  ];
  const out = C.condenseActivity(rows);
  assert.deepEqual(out.map(e => e.id), [9, 6, 5, 3, 2, 1]);
  assert.equal(out[0].count, 3, '연속 세 번의 저장이 한 줄');
  assert.equal(out[0].first_at, at(25));
  assert.equal(out[4].count, 1, '다른 사람의 변경이 사이에 있으면 묶지 않는다');
  assert.equal(rows.length, 9, '원본은 그대로');
  // 창 밖이면 묶지 않는다
  const far = C.condenseActivity([
    { id: 2, kind: 'SCHEDULE_CHANGED', actor_label: '영희', created_at: at(30) },
    { id: 1, kind: 'SCHEDULE_CHANGED', actor_label: '영희', created_at: at(0) }
  ]);
  assert.equal(far.length, 2);
  assert.deepEqual(C.condenseActivity(null), []);
});

test('relativeTime: 방금 · N분 전 · N시간 전 · N일 전 · 그 뒤엔 날짜', () => {
  const now = Date.UTC(2026, 8, 2, 12, 0, 0);
  const ago = (ms) => new Date(now - ms).toISOString();
  assert.equal(C.relativeTime(ago(10e3), now), '방금');
  assert.equal(C.relativeTime(ago(5 * 60e3), now), '5분 전');
  assert.equal(C.relativeTime(ago(3 * 3600e3), now), '3시간 전');
  assert.equal(C.relativeTime(ago(2 * 86400e3), now), '2일 전');
  assert.match(C.relativeTime(ago(30 * 86400e3), now), /^\d{1,2}\/\d{1,2}$/);
  assert.equal(C.relativeTime('garbage', now), '');
  assert.equal(C.relativeTime(ago(-60e3), now), '방금', '미래 시각(시계 어긋남)도 방금으로');
});

test('liveEffects: 이벤트 종류가 무엇을 다시 읽을지 정한다 — payload를 믿지 않는다(§41)', () => {
  const e = (kind, mine) => C.liveEffects({ kind, mine });
  assert.deepEqual(e('CANDIDATE_PROPOSED', false), { candidates: true, members: false, pull: false, activity: true, notify: true });
  assert.deepEqual(e('CANDIDATE_PROPOSED', true), { candidates: true, members: false, pull: false, activity: true, notify: false }, '내가 한 일은 알리지 않는다');
  assert.deepEqual(e('REACTION', false), { candidates: true, members: false, pull: false, activity: true, notify: false }, '반응은 조용히(§51)');
  assert.deepEqual(e('COMMENT_ADDED', false), { candidates: true, members: false, pull: false, activity: true, notify: false });
  assert.deepEqual(e('MEMBER_JOINED', false), { candidates: false, members: true, pull: false, activity: true, notify: true });
  assert.deepEqual(e('MEMBER_LEFT', false), { candidates: false, members: true, pull: false, activity: true, notify: false });
  assert.deepEqual(e('SCHEDULE_CHANGED', false), { candidates: false, members: false, pull: true, activity: true, notify: false });
  assert.deepEqual(e('SCHEDULE_CHANGED', true), { candidates: false, members: false, pull: false, activity: true, notify: false }, '내 저장은 이미 내 화면이다');
  assert.deepEqual(e('BOOKING_ADDED', false).pull, true);
  assert.deepEqual(e('???', false), { candidates: false, members: false, pull: false, activity: false, notify: false });
  assert.deepEqual(C.liveEffects(null).activity, false);
});

test('tripRoleMap: 서버 id(trip_id)를 문자열로 든다 — 실시간 구독 필터에 쓴다', () => {
  const map = C.tripRoleMap([{ client_id: 'x', trip_id: 'a1b2-uuid', role: 'EDITOR', member_count: 2, owner: false }, { client_id: 'y', trip_id: 42, role: 'OWNER', owner: true }]);
  assert.equal(map.x.serverId, 'a1b2-uuid');
  assert.equal(map.y.serverId, '42');
  assert.equal(C.tripRoleMap([{ client_id: 'z', role: 'OWNER' }]).z.serverId, '', '없으면 빈 문자열 — 구독하지 않는다');
});
