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
