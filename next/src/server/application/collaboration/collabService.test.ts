// 협업 use case — PGlite(진짜 PostgreSQL) 위에서. 기대값은 test/rls/collaboration.sql과 같은 결론이다:
// 초대 전엔 아무것도 안 보임 · 토큰은 한 번만 · 수락은 멱등 · 보기 권한은 의견만 · 후보 빼기는 제안자/주최자 · 결정은 상태 ·
// 활동 기록은 의미 있는 것만(소유자 참여·자동 MUST·거두기·빼기·REOPEN·혼자 쓰는 여행의 저장은 없음).
import { beforeEach, describe, expect, it } from 'vitest';

import { ApiError } from '../../api/errors';
import type { RequestContext } from '../../auth/types';
import { createTestDatabase, type TestDatabase } from '../../infrastructure/database/testDb';
import { PgCollabRepository } from '../../infrastructure/database/pgCollabRepository';
import { PgTripRepository } from '../../infrastructure/database/pgTripRepository';
import { PgUserRepository } from '../../infrastructure/database/pgUserRepository';
import { CollabService } from './collabService';
import type { CandidateInput } from './types';

const ctx = (userId: string): RequestContext => ({ userId, legacySupabaseUserId: userId, email: `${userId.slice(-1)}@example.com`, sessionId: null, tokenSource: 'supabase' });
const A = ctx('00000000-0000-0000-0000-00000000000a');
const B = ctx('00000000-0000-0000-0000-00000000000b');
const C = ctx('00000000-0000-0000-0000-00000000000c');
const doc = (name: string, bookings = 0) => ({
  id: 'trip1', name, start: '2026-10-25', days: [{ spots: [] }, { spots: [] }],
  ...(bookings ? { bookings: Array.from({ length: bookings }, (_, i) => ({ id: `b${i}`, type: 'hotel', title: '호텔', price: 1, cur: 'KRW' })) } : {})
});

let db: TestDatabase;
let trips: PgTripRepository;
let service: CollabService;

async function code(p: Promise<unknown>): Promise<string> {
  try { await p; return 'OK'; } catch (e) { return e instanceof ApiError ? e.code : `THROWN:${String(e)}`; }
}
async function kinds(who: RequestContext): Promise<string[]> {
  return (await service.listActivity(who, 'trip1', 200)).map((a) => a.kind).reverse();
}

beforeEach(async () => {
  db = await createTestDatabase();
  const users = new PgUserRepository(db.db);
  for (const u of [A, B, C]) await users.ensure({ id: u.userId, email: u.email });
  trips = new PgTripRepository(db.db);
  service = new CollabService({ trips, collab: new PgCollabRepository(db.db) });
  await trips.create({ ownerId: A.userId, clientId: 'trip1', data: doc('스페인') });
});

describe('초대와 참여', () => {
  it('초대 전에는 B가 아무것도 못 본다 — 멤버·초대·후보·활동 전부 NOT_FOUND', async () => {
    expect(await code(service.listMembers(B, 'trip1'))).toBe('NOT_FOUND');
    expect(await code(service.listInvites(B, 'trip1'))).toBe('NOT_FOUND');
    expect(await code(service.listCandidates(B, 'trip1'))).toBe('NOT_FOUND');
    expect(await code(service.createInvite(B, 'trip1', 'EDITOR', null, null))).toBe('NOT_FOUND');
    expect((await service.listMembers(A, 'trip1')).map((m) => [m.role, m.me])).toEqual([['OWNER', true]]);
  });

  it('토큰은 32자 URL-safe로 한 번만 돌아오고, 저장은 해시뿐이다', async () => {
    const inv = await service.createInvite(A, 'trip1', 'EDITOR', 24, null);
    expect(inv.token).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(inv.role).toBe('EDITOR');
    const rows = (await db.db.execute(`select token_hash from trip_invites`)) as { rows: { token_hash: string }[] };
    expect(rows.rows[0].token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(rows.rows[0].token_hash).not.toBe(inv.token);
    expect(await code(service.createInvite(A, 'trip1', 'OWNER', null, null))).toBe('VALIDATION_ERROR');
  });

  it('미리보기는 로그인 전에도 이름·시작일·일수·역할까지만. 엉터리 토큰은 INVALID', async () => {
    const inv = await service.createInvite(A, 'trip1', 'EDITOR', null, null);
    const p = await service.previewInvite(inv.token, null);
    expect(p).toMatchObject({ valid: true, reason: 'OK', trip_name: '스페인', start_date: '2026-10-25', day_count: 2, role: 'EDITOR', already_member: false });
    expect((await service.previewInvite('garbage', null)).reason).toBe('INVALID');
    expect((await service.previewInvite(inv.token, A)).already_member).toBe(true);
    // 토큰을 알아도 참여 전에는 본문을 못 본다
    expect(await code(service.listCandidates(C, 'trip1'))).toBe('NOT_FOUND');
  });

  it('수락은 멱등 — 두 번째는 already_member, 사용 횟수는 그대로. 수락 뒤 역할이 보인다', async () => {
    const inv = await service.createInvite(A, 'trip1', 'EDITOR', null, null);
    const first = await service.acceptInvite(B, inv.token, '  영희  ');
    expect(first).toMatchObject({ ok: true, reason: 'OK', client_id: 'trip1', trip_name: '스페인', role: 'EDITOR', already_member: false });
    const again = await service.acceptInvite(B, inv.token, null);
    expect(again).toMatchObject({ ok: true, already_member: true });
    expect((await service.listInvites(A, 'trip1'))[0].use_count).toBe(1);
    expect((await service.listMembers(A, 'trip1')).map((m) => [m.display_name, m.role, m.me])).toEqual([[null, 'OWNER', true], ['영희', 'EDITOR', false]]);
    expect((await trips.findVisible(B.userId, 'trip1'))?.role).toBe('EDITOR');
    expect(await kinds(A)).toEqual(['MEMBER_JOINED']);   // 소유자 행은 기록되지 않는다
  });

  it('소유자가 제 링크를 열면 OWNER로 already_member', async () => {
    const inv = await service.createInvite(A, 'trip1', 'VIEWER', null, null);
    expect(await service.acceptInvite(A, inv.token, null)).toMatchObject({ ok: true, role: 'OWNER', already_member: true });
  });

  it('취소·만료·소진된 링크는 거절되고, 이미 멤버면 만료돼도 그대로 들어온다', async () => {
    const revoked = await service.createInvite(A, 'trip1', 'EDITOR', null, null);
    expect(await service.revokeInvite(A, 'trip1', revoked.id)).toBe(true);
    expect(await service.revokeInvite(A, 'trip1', revoked.id)).toBe(true);
    expect((await service.previewInvite(revoked.token, null)).reason).toBe('REVOKED');
    expect((await service.acceptInvite(C, revoked.token, null)).reason).toBe('REVOKED');
    expect((await service.listInvites(A, 'trip1')).map((i) => i.active)).toEqual([false]);

    const once = await service.createInvite(A, 'trip1', 'VIEWER', null, 1);
    expect((await service.acceptInvite(B, once.token, null)).ok).toBe(true);
    expect((await service.acceptInvite(C, once.token, null)).reason).toBe('EXHAUSTED');
    expect((await service.acceptInvite(B, once.token, null)).already_member).toBe(true);

    const expiring = await service.createInvite(A, 'trip1', 'EDITOR', null, null);
    await db.db.execute(`update trip_invites set expires_at = now() - interval '1 minute' where id = ${expiring.id}`);
    expect((await service.previewInvite(expiring.token, null)).reason).toBe('EXPIRED');
    expect((await service.acceptInvite(C, expiring.token, null)).reason).toBe('EXPIRED');
    expect(await code(service.revokeInvite(B, 'trip1', expiring.id))).toBe('FORBIDDEN');
  });

  it('내보내진 사람은 그 전에 만든 링크로 못 돌아오고 새 링크로는 된다', async () => {
    const old = await service.createInvite(A, 'trip1', 'EDITOR', null, null);
    await service.acceptInvite(B, old.token, '영희');
    const member = (await service.listMembers(A, 'trip1')).find((m) => !m.me)!;
    expect(await service.manageMember(A, 'trip1', member.id, 'REMOVE', null)).toBe(true);
    expect(await code(service.listMembers(B, 'trip1'))).toBe('NOT_FOUND');
    expect((await service.acceptInvite(B, old.token, null)).reason).toBe('REMOVED');
    await new Promise((r) => setTimeout(r, 5));
    const fresh = await service.createInvite(A, 'trip1', 'EDITOR', null, null);
    expect((await service.acceptInvite(B, fresh.token, null)).ok).toBe(true);
    expect(await kinds(A)).toEqual(['MEMBER_JOINED', 'MEMBER_REMOVED', 'MEMBER_JOINED']);
    const removed = (await service.listActivity(A, 'trip1', 10)).find((a) => a.kind === 'MEMBER_REMOVED')!;
    expect(removed.actor_label).toBe('주최자');
    expect(removed.member_label).toBe('영희');
  });
});

describe('멤버 관리', () => {
  let memberId: number;
  beforeEach(async () => {
    const inv = await service.createInvite(A, 'trip1', 'EDITOR', null, null);
    await service.acceptInvite(B, inv.token, '영희');
    memberId = (await service.listMembers(A, 'trip1')).find((m) => !m.me)!.id;
  });

  it('편집자는 소유권을 못 가져가고(SET_ROLE·REMOVE는 소유자만) 본인 이름은 바꾼다', async () => {
    const ownerRow = (await service.listMembers(A, 'trip1')).find((m) => m.me)!.id;
    expect(await code(service.manageMember(B, 'trip1', ownerRow, 'REMOVE', null))).toBe('FORBIDDEN');
    expect(await code(service.manageMember(B, 'trip1', memberId, 'SET_ROLE', 'VIEWER'))).toBe('FORBIDDEN');
    expect(await service.manageMember(B, 'trip1', memberId, 'RENAME', ' 영희(수정) ')).toBe(true);
    expect(await code(service.manageMember(C, 'trip1', memberId, 'RENAME', 'x'))).toBe('NOT_FOUND');
    expect((await service.listMembers(A, 'trip1'))[1].display_name).toBe('영희(수정)');
    expect(await code(service.manageMember(A, 'trip1', ownerRow, 'SET_ROLE', 'VIEWER'))).toBe('FORBIDDEN');   // OWNER_LOCKED
    expect(await code(service.manageMember(A, 'trip1', memberId, 'SET_ROLE', 'OWNER'))).toBe('VALIDATION_ERROR');
    expect(await service.manageMember(A, 'trip1', 999, 'RENAME', 'x')).toBe(false);
  });

  it('보기 권한으로 내리면 저장은 막히고 의견은 남긴다', async () => {
    expect(await service.manageMember(A, 'trip1', memberId, 'SET_ROLE', 'VIEWER')).toBe(true);
    expect((await trips.findVisible(B.userId, 'trip1'))?.role).toBe('VIEWER');
    expect(await code(service.addCandidate(B, 'trip1', { title: '몰래' }))).toBe('FORBIDDEN');
    const id = await service.addCandidate(A, 'trip1', { title: '사그라다 파밀리아' });
    expect(await service.reactToCandidate(B, 'trip1', id, 'PASS')).toBe(true);
    expect(await code(service.manageCandidate(B, 'trip1', id, 'SCHEDULE', '2'))).toBe('FORBIDDEN');
    expect(await service.addComment(B, 'trip1', id, '보기 권한의 한마디')).toBeGreaterThan(0);
  });

  it('나가기는 멱등이고 소유자는 못 나간다. 나간 사람의 취향·반응은 막힌다', async () => {
    expect(await code(service.leave(A, 'trip1'))).toBe('FORBIDDEN');
    expect(await service.leave(B, 'trip1')).toBe(true);
    expect(await service.leave(B, 'trip1')).toBe(true);
    expect(await service.leave(C, 'trip1')).toBe(true);
    expect(await code(service.listMembers(B, 'trip1'))).toBe('NOT_FOUND');
    expect(await kinds(A)).toEqual(['MEMBER_JOINED', 'MEMBER_LEFT']);
  });
});

describe('후보 · 반응 · 코멘트 · 결정', () => {
  beforeEach(async () => {
    const inv = await service.createInvite(A, 'trip1', 'EDITOR', null, null);
    await service.acceptInvite(B, inv.token, '영희');
  });

  it('낸 사람에게 MUST가 자동으로 붙고, 이름표에는 이메일이 없다', async () => {
    const id = await service.addCandidate(A, 'trip1', { title: '  사그라다 파밀리아  ', note: 'x'.repeat(400) });
    await service.addCandidate(B, 'trip1', { title: '카사 바트요' });
    const list = await service.listCandidates(B, 'trip1');
    expect(list.map((c) => c.title)).toEqual(['카사 바트요', '사그라다 파밀리아']);   // 최근 순
    const first = list.find((c) => c.id === id)!;
    expect(first).toMatchObject({ must_count: 1, my_reaction: null, mine: false, proposed_by_label: '주최자', comment_count: 0 });
    expect(first.note?.length).toBe(300);
    // ⚠️ user_id는 분리 일정(§25~§27)이 누가 어느 쪽인지 가르는 데 쓴다 — 이름으로 가르면 동명이인이 섞인다.
    expect(first.reactions).toEqual([{ user_id: A.userId, name: '주최자', reaction: 'MUST', me: false }]);
    // 이메일은 여전히 어디에도 나오지 않는다(§69) — 이름표는 tc_member_label이 만든다.
    expect(JSON.stringify(list)).not.toMatch(/@example\.com/);
    expect(await code(service.addCandidate(A, 'trip1', { title: '   ' }))).toBe('VALIDATION_ERROR');
    expect(await kinds(A)).toEqual(['MEMBER_JOINED', 'CANDIDATE_PROPOSED', 'CANDIDATE_PROPOSED']);   // 자동 MUST는 기록 없음
  });

  it('카카오 원본 ID와 링크를 저장하고 Google place_id와 구분해 다시 읽는다', async () => {
    const id = await service.addCandidate(A, 'trip1', {
      title: '제주 카페', provider: 'kakao', providerId: '12345678', lat: 33.5, lng: 126.5,
      addr: '제주시 연동', url: 'https://place.map.kakao.com/12345678'
    });
    const [candidate] = await service.listCandidates(B, 'trip1');
    expect(candidate).toMatchObject({ id, title: '제주 카페', provider: 'kakao', provider_id: '12345678',
      place_id: null, lat: 33.5, lng: 126.5, addr: '제주시 연동', url: 'https://place.map.kakao.com/12345678' });
  });

  it('Google 원본 ID는 구형 앱의 place_id에도 보존하고 구형 입력은 그대로 지원한다', async () => {
    const id = await service.addCandidate(A, 'trip1', { title: '박물관', provider: 'google', providerId: 'ChIJ_test_place' });
    const oldId = await service.addCandidate(A, 'trip1', { title: '구형 앱 장소', place_id: 'ChIJ_old_place' });
    const candidates = await service.listCandidates(A, 'trip1');
    expect(candidates.find(c => c.id === id)).toMatchObject({ provider: 'google', provider_id: 'ChIJ_test_place', place_id: 'ChIJ_test_place' });
    expect(candidates.find(c => c.id === oldId)).toMatchObject({ provider: null, provider_id: null, place_id: 'ChIJ_old_place', lat: null, lng: null });
  });

  it('같은 제공자 ID의 동시 담기는 하나로 저장하고 기존 내용과 활동을 중복 변경하지 않는다', async () => {
    const input = { title: '제주 카페', provider: 'kakao' as const, providerId: '12345678', note: '처음 메모' };
    const ids = await Promise.all(Array.from({ length: 5 }, () => service.addCandidate(A, 'trip1', input)));
    expect(new Set(ids).size).toBe(1);
    await service.reactToCandidate(A, 'trip1', ids[0], 'PASS');
    const again = await service.addCandidate(A, 'trip1', { ...input, title: '바뀐 검색 이름', note: '덮어쓰면 안 됨' });
    expect(again).toBe(ids[0]);
    const candidates = await service.listCandidates(A, 'trip1');
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({ title: '제주 카페', note: '처음 메모', my_reaction: 'PASS' });
    expect((await kinds(A)).filter(kind => kind === 'CANDIDATE_PROPOSED')).toHaveLength(1);
  });

  it('다른 편집자가 같은 장소를 담으면 원래 후보에만 의견을 추가한다', async () => {
    const input = { title: '제주 카페', provider: 'kakao' as const, providerId: '12345678' };
    const first = await service.addCandidate(A, 'trip1', input);
    const second = await service.addCandidate(B, 'trip1', input);
    expect(second).toBe(first);
    const [candidate] = await service.listCandidates(B, 'trip1');
    expect(candidate).toMatchObject({ must_count: 2, mine: false, my_reaction: 'MUST' });
    expect((await kinds(A)).filter(kind => kind === 'CANDIDATE_PROPOSED')).toHaveLength(1);
  });

  it('좌표·제공자 없는 장소도 같은 clientKey의 동시 재시도는 후보와 활동 하나다', async () => {
    const input = { title: '직접 입력한 곳', clientKey: 'abcdefab-1111-4111-8111-111111111111', lat: null, lng: null };
    const ids = await Promise.all(Array.from({ length: 5 }, () => service.addCandidate(A, 'trip1', input)));
    expect(new Set(ids).size).toBe(1);
    const again = await service.addCandidate(A, 'trip1', { ...input, title: '재시도 때 바뀐 제목', clientKey: input.clientKey.toUpperCase() });
    expect(again).toBe(ids[0]);
    expect(await service.listCandidates(A, 'trip1')).toHaveLength(1);
    expect((await service.listCandidates(A, 'trip1'))[0]).toMatchObject({ title: input.title, lat: null, lng: null });
    expect((await kinds(A)).filter(kind => kind === 'CANDIDATE_PROPOSED')).toHaveLength(1);
  });

  it('제공자 ID와 clientKey 어느 쪽이 충돌해도 기존 ID를 반환한다', async () => {
    const base = { title: '카카오 원본', provider: 'kakao' as const, providerId: '12345' };
    const key1 = '11111111-1111-4111-8111-111111111111', key2 = '22222222-2222-4222-8222-222222222222';
    const first = await service.addCandidate(A, 'trip1', { ...base, clientKey: key1 });
    expect(await service.addCandidate(A, 'trip1', { ...base, clientKey: key2 })).toBe(first);
    expect(await service.addCandidate(A, 'trip1', { ...base, clientKey: key2 })).toBe(first);
    expect(await service.addCandidate(A, 'trip1', { ...base, clientKey: key1 })).toBe(first);
    expect(await service.listCandidates(A, 'trip1')).toHaveLength(1);
    expect((await kinds(A)).filter(kind => kind === 'CANDIDATE_PROPOSED')).toHaveLength(1);
  });

  it('다른 요청 키와 다른 여행을 이름·좌표가 같다고 합치지 않는다', async () => {
    const input = { title: '동일 이름', lat: null, lng: null, clientKey: '11111111-1111-4111-8111-111111111111' };
    const first = await service.addCandidate(A, 'trip1', input);
    const second = await service.addCandidate(A, 'trip1', { ...input, clientKey: '22222222-2222-4222-8222-222222222222' });
    await trips.create({ ownerId: A.userId, clientId: 'trip2', data: { ...doc('두 번째'), id: 'trip2' } });
    const third = await service.addCandidate(A, 'trip2', input);
    expect(new Set([first, second, third]).size).toBe(3);
  });

  it('잘못된 clientKey는 저장하지 않고 재사용 키에도 권한을 확인한다', async () => {
    for (const clientKey of ['', 'same-name', true, 123, '11111111-1111-4111-8111-111111111111x']) {
      expect(await code(service.addCandidate(A, 'trip1', { title: '무효', clientKey } as CandidateInput))).toBe('VALIDATION_ERROR');
    }
    const input = { title: '유효', clientKey: '11111111-1111-4111-8111-111111111111' };
    await service.addCandidate(A, 'trip1', input);
    expect(await code(service.addCandidate(C, 'trip1', input))).toBe('NOT_FOUND');
    const member = (await service.listMembers(A, 'trip1')).find(m => m.user_id === B.userId)!;
    await service.manageMember(A, 'trip1', member.id, 'SET_ROLE', 'VIEWER');
    expect(await code(service.addCandidate(B, 'trip1', input))).toBe('FORBIDDEN');
    expect(await service.listCandidates(A, 'trip1')).toHaveLength(1);
  });

  it('동명이점·다른 제공자·ID 미상·다른 여행을 좌표만으로 합치지 않는다', async () => {
    const input = { title: '같은 이름', lat: 33.5, lng: 126.5 };
    const ids = [];
    ids.push(await service.addCandidate(A, 'trip1', { ...input, provider: 'kakao', providerId: '12345' }));
    ids.push(await service.addCandidate(A, 'trip1', { ...input, provider: 'kakao', providerId: '67890' }));
    ids.push(await service.addCandidate(A, 'trip1', { ...input, provider: 'google', providerId: '12345' }));
    ids.push(await service.addCandidate(A, 'trip1', input));
    ids.push(await service.addCandidate(A, 'trip1', input));
    await trips.create({ ownerId: A.userId, clientId: 'trip2', data: { ...doc('다른 여행'), id: 'trip2' } });
    ids.push(await service.addCandidate(A, 'trip2', { ...input, provider: 'kakao', providerId: '12345' }));
    expect(new Set(ids).size).toBe(6);
    expect(await service.listCandidates(A, 'trip1')).toHaveLength(5);
  });

  it('위치 없음과 실제 0 좌표를 구분하고 부적절한 숫자는 저장하지 않는다', async () => {
    const nilId = await service.addCandidate(A, 'trip1', { title: '위치 없음', lat: null, lng: null });
    const zeroId = await service.addCandidate(A, 'trip1', { title: '좌표 0', lat: 0, lng: 0 });
    for (const fields of [
      { lat: '', lng: '' }, { lat: true, lng: false }, { lat: '33.5', lng: '126.5' },
      { lat: 91, lng: 126.5 }, { lat: 33.5, lng: -181 }, { lat: 33.5 }, { lat: NaN, lng: 1 }, { lat: 0, lng: Infinity }
    ]) {
      expect(await code(service.addCandidate(A, 'trip1', { title: '잘못된 좌표', ...fields } as CandidateInput))).toBe('VALIDATION_ERROR');
    }
    const candidates = await service.listCandidates(A, 'trip1');
    expect(candidates).toHaveLength(2);
    expect(candidates.find(c => c.id === nilId)).toMatchObject({ lat: null, lng: null });
    expect(candidates.find(c => c.id === zeroId)).toMatchObject({ lat: 0, lng: 0 });
  });

  it('제공자 ID의 혼용·유실된 제공자·불량 식별자는 저장하지 않는다', async () => {
    for (const fields of [
      { providerId: '12345' }, { provider: 'other', providerId: '12345' },
      { provider: 'kakao', providerId: 'ChIJ_google' }, { provider: 'kakao', providerId: '12345', place_id: '12345' },
      { provider: 'google', providerId: 'ChIJ_first', place_id: 'ChIJ_second' }, { provider: 'google', providerId: '' }
    ]) {
      expect(await code(service.addCandidate(A, 'trip1', { title: '불량 식별자', ...fields } as CandidateInput))).toBe('VALIDATION_ERROR');
    }
    expect(await service.listCandidates(A, 'trip1')).toEqual([]);
  });

  it('지도 후보 담기와 기존 ID 재사용에도 여행과 편집 권한을 확인한다', async () => {
    const input = { title: '제주 카페', provider: 'kakao' as const, providerId: '12345678' };
    await service.addCandidate(A, 'trip1', input);
    expect(await code(service.addCandidate(C, 'trip1', input))).toBe('NOT_FOUND');
    const member = (await service.listMembers(A, 'trip1')).find(m => m.user_id === B.userId)!;
    await service.manageMember(A, 'trip1', member.id, 'SET_ROLE', 'VIEWER');
    expect(await code(service.addCandidate(B, 'trip1', input))).toBe('FORBIDDEN');
    expect(await service.listCandidates(A, 'trip1')).toHaveLength(1);
  });

  it('한 사람 한 표 — 두 번 눌러도, 마음이 바뀌어도 행은 하나. 거두기는 기록하지 않는다', async () => {
    const id = await service.addCandidate(A, 'trip1', { title: '사그라다 파밀리아' });
    await service.reactToCandidate(B, 'trip1', id, 'MUST');
    await service.reactToCandidate(B, 'trip1', id, 'must');
    let [c] = await service.listCandidates(A, 'trip1');
    expect([c.must_count, c.ok_count, c.pass_count]).toEqual([2, 0, 0]);
    expect(c.reactions.map((r) => r.name)).toEqual(['주최자', '영희']);
    // user_id가 이름과 짝이 맞는다 — 순서까지 같아야 분리가 엉뚱한 사람을 보내지 않는다
    expect(c.reactions.map((r) => r.user_id)).toEqual([A.userId, B.userId]);
    await service.reactToCandidate(B, 'trip1', id, 'OK');
    await service.reactToCandidate(B, 'trip1', id, null);
    [c] = await service.listCandidates(B, 'trip1');
    expect([c.must_count, c.ok_count, c.my_reaction]).toEqual([1, 0, null]);
    expect(await code(service.reactToCandidate(B, 'trip1', id, 'MAYBE'))).toBe('VALIDATION_ERROR');
    expect(await code(service.reactToCandidate(C, 'trip1', id, 'OK'))).toBe('NOT_FOUND');
    expect(await kinds(A)).toEqual(['MEMBER_JOINED', 'CANDIDATE_PROPOSED', 'REACTION', 'REACTION']);
  });

  it('후보를 빼는 기준은 역할이 아니라 누가 냈는가 — 반응·코멘트도 함께 사라진다', async () => {
    const mine = await service.addCandidate(B, 'trip1', { title: 'B의 후보' });
    const theirs = await service.addCandidate(A, 'trip1', { title: 'A의 후보' });
    await service.addComment(A, 'trip1', mine, '한마디');
    expect(await code(service.manageCandidate(B, 'trip1', theirs, 'REMOVE', null))).toBe('FORBIDDEN');
    expect(await service.manageCandidate(B, 'trip1', mine, 'REMOVE', null)).toBe(true);
    expect(await service.manageCandidate(A, 'trip1', theirs, 'REMOVE', null)).toBe(true);
    expect(await service.listCandidates(A, 'trip1')).toEqual([]);
    expect(await service.manageCandidate(A, 'trip1', mine, 'REMOVE', null)).toBe(false);
    const reactions = (await db.db.execute(`select count(*)::int as n from candidate_reactions`)) as { rows: { n: number }[] };
    expect(reactions.rows[0].n).toBe(0);
  });

  it('일정에 넣는 것과 제외는 상태다 — 되돌릴 수 있고, 결정은 활동에 한 번만 남는다', async () => {
    const id = await service.addCandidate(A, 'trip1', { title: '사그라다 파밀리아' });
    expect(await service.manageCandidate(B, 'trip1', id, 'SCHEDULE', ' 2 ')).toBe(true);
    let [c] = await service.listCandidates(A, 'trip1');
    expect([c.status, c.scheduled_ref]).toEqual(['SCHEDULED', '2']);
    expect(await service.manageCandidate(B, 'trip1', id, 'UNSCHEDULE', null)).toBe(true);
    expect(await service.manageCandidate(B, 'trip1', id, 'REJECT', null)).toBe(true);
    [c] = await service.listCandidates(A, 'trip1');
    expect([c.status, c.scheduled_ref]).toEqual(['REJECTED', null]);
    expect(await service.manageCandidate(B, 'trip1', id, 'REOPEN', null)).toBe(true);
    expect((await service.listCandidates(A, 'trip1'))[0].status).toBe('PROPOSED');
    expect(await code(service.manageCandidate(A, 'trip1', id, 'BOGUS' as never, null))).toBe('VALIDATION_ERROR');
    expect(await kinds(A)).toEqual(['MEMBER_JOINED', 'CANDIDATE_PROPOSED', 'CANDIDATE_SCHEDULED', 'CANDIDATE_REJECTED']);
    const scheduled = (await service.listActivity(A, 'trip1', 10)).find((a) => a.kind === 'CANDIDATE_SCHEDULED')!;
    expect(scheduled.subject).toEqual({ ref: '2', title: '사그라다 파밀리아', candidate_id: id });
  });

  it('코멘트는 의견이라 멤버면 남기고, 지우기는 쓴 사람이나 주최자만', async () => {
    const id = await service.addCandidate(A, 'trip1', { title: '사그라다 파밀리아' });
    const c1 = await service.addComment(B, 'trip1', id, '야경 보고 저녁 먹자');
    const c2 = await service.addComment(A, 'trip1', id, '주최자 코멘트');
    expect(await code(service.addComment(B, 'trip1', id, '   '))).toBe('VALIDATION_ERROR');
    expect(await code(service.addComment(C, 'trip1', id, 'x'))).toBe('NOT_FOUND');
    expect((await service.listComments(B, 'trip1', id)).map((c) => [c.author_label, c.body, c.mine])).toEqual([['영희', '야경 보고 저녁 먹자', true], ['주최자', '주최자 코멘트', false]]);
    expect((await service.listCandidates(A, 'trip1'))[0].comment_count).toBe(2);
    expect(await code(service.deleteComment(B, 'trip1', c2))).toBe('FORBIDDEN');
    expect(await service.deleteComment(B, 'trip1', c1)).toBe(true);
    expect(await service.deleteComment(B, 'trip1', c1)).toBe(false);
    expect(await service.deleteComment(A, 'trip1', c2)).toBe(true);
    const added = (await service.listActivity(A, 'trip1', 10)).filter((a) => a.kind === 'COMMENT_ADDED');
    expect(added).toHaveLength(2);
    expect(added[0].subject).toMatchObject({ candidate_id: id, excerpt: '주최자 코멘트' });
  });
});

describe('취향', () => {
  beforeEach(async () => {
    const inv = await service.createInvite(A, 'trip1', 'VIEWER', null, null);
    await service.acceptInvite(B, inv.token, '영희');
  });

  it('보기 권한도 취향은 남기고, 모르는 값은 버리며, 활동 기록에 남지 않는다', async () => {
    const saved = await service.setPreference(B, 'trip1', { pace: 'RELAXED', walking: 'LOW', night: true, morning: false, interests: ['야경', '미술관', '야경'], dislikes: ['쇼핑'], note: '신혼여행이라 여유롭게', junk: 1 });
    expect(saved).toEqual({ pace: 'RELAXED', walking: 'LOW', morning: false, night: true, interests: ['미술관', '야경'], dislikes: ['쇼핑'], note: '신혼여행이라 여유롭게' });
    expect(await service.setPreference(B, 'trip1', { pace: 'FAST', walking: 'LOW' })).toEqual({ walking: 'LOW' });
    expect(await code(service.setPreference(C, 'trip1', { pace: 'NORMAL' }))).toBe('NOT_FOUND');
    const list = await service.listPreferences(A, 'trip1');
    expect(list.map((p) => [p.label, p.role, p.mine, p.prefs])).toEqual([['주최자', 'OWNER', true, {}], ['영희', 'VIEWER', false, { walking: 'LOW' }]]);
    expect(await kinds(A)).toEqual(['MEMBER_JOINED']);
  });
});

describe('여행 문서 저장의 활동 기록', () => {
  it('다른 활성 멤버가 있을 때만, 예약이 늘면 BOOKING_ADDED 아니면 SCHEDULE_CHANGED', async () => {
    const t = (await trips.findVisible(A.userId, 'trip1'))!.record;
    await trips.updateCas(t.id, doc('혼자 편집'), 1);
    expect(await kinds(A)).toEqual([]);   // 혼자 쓰는 여행의 저장은 기록하지 않는다
    const inv = await service.createInvite(A, 'trip1', 'EDITOR', null, null);
    await service.acceptInvite(B, inv.token, '영희');
    await trips.updateCas(t.id, doc('예약 추가', 1), 2, { actorId: A.userId });
    await trips.updateCas(t.id, doc('일정 변경', 1), 3, { actorId: A.userId });
    expect(await kinds(A)).toEqual(['MEMBER_JOINED', 'BOOKING_ADDED', 'SCHEDULE_CHANGED']);
    const acts = await service.listActivity(B, 'trip1', 10);
    expect(acts[0]).toMatchObject({ kind: 'SCHEDULE_CHANGED', actor_label: '주최자', mine: false, subject: { revision: 4 } });
    expect(acts[1].subject).toEqual({ count: 1 });
    expect(await service.listActivity(A, 'trip1', 2)).toHaveLength(2);
  });
});
