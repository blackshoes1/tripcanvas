// Trip use case(§31) — 목록·상세·생성·수정(CAS)·삭제(tombstone). 인가는 여기서 판정하고 저장 규칙은 Repository가 낸다.
// Golden behavior(§81): 보기 권한의 저장 거절 · 나간 사람의 저장은 복제가 아니라 거절 · stale write는 조용히 덮어쓰지 않는다 ·
// 삭제는 소유자만 · 유입 문서는 반드시 정규화(lib.normalizeTrip)된다.
import { beforeEach, describe, expect, it } from 'vitest';

import { ApiError } from '../../api/errors';
import type { RequestContext } from '../../auth/types';
import { MemoryMembershipRepository, MemoryStore, MemoryTripRepository } from '../../repositories/memory/memoryRepositories';
import type { MemberRole } from '../../repositories/types';
import { TripAuthorizationService } from '../authorization/tripAuthorization';
import { TripService } from './tripService';

const ctx = (userId: string): RequestContext => ({ userId, legacySupabaseUserId: userId, email: null, sessionId: null, tokenSource: 'supabase' });
const A = ctx('u-a'), B = ctx('u-b'), C = ctx('u-c');
const doc = (name: string, extra: Record<string, unknown> = {}) => ({
  id: 'trip1', name, start: '2026-10-25', days: [{ title: '1일차', mode: 'car', spots: [{ name: '숙소', city: '바르셀로나', lat: 41.4, lng: 2.17, stay: true }] }], ...extra
});

let store: MemoryStore;
let members: MemoryMembershipRepository;
let service: TripService;

beforeEach(() => {
  store = new MemoryStore();
  members = new MemoryMembershipRepository(store);
  const trips = new MemoryTripRepository(store);
  service = new TripService({ trips, members, authz: new TripAuthorizationService(members) });
});

async function code(p: Promise<unknown>): Promise<string> {
  try { await p; return 'OK'; } catch (e) { return e instanceof ApiError ? e.code : `THROWN:${String(e)}`; }
}

describe('create', () => {
  it('정규화된 문서가 revision 1로 저장되고 만든 사람이 OWNER다', async () => {
    const view = await service.create(A, doc('스페인', { timeZone: 'Not/AZone', junk: 1 }));
    expect(view.record.clientId).toBe('trip1');
    expect(view.record.revision).toBe(1);
    expect(view.role).toBe('OWNER');
    expect(view.memberCount).toBe(1);
    const saved = view.record.data as Record<string, unknown>;
    expect(saved.timeZone).toBeUndefined();          // 모르는 시간대는 떨어진다(normalizeTrip)
    expect(saved.schemaVersion).toBeDefined();
  });

  it('id가 없으면 서버가 만든다 — uid() 형식(영숫자·-·_)', async () => {
    const view = await service.create(A, { name: '무제', days: [{ spots: [] }] });
    expect(view.record.clientId).toMatch(/^[A-Za-z0-9_-]{6,}$/);
  });

  it('모양이 틀린 문서는 VALIDATION_ERROR — days가 없으면 여행이 아니다', async () => {
    expect(await code(service.create(A, { name: 'x' }))).toBe('VALIDATION_ERROR');
    expect(await code(service.create(A, 'string'))).toBe('VALIDATION_ERROR');
    expect(await code(service.create(A, { name: 'x', days: [] }))).toBe('VALIDATION_ERROR');
  });

  it('같은 id의 여행이 내 것으로 이미 있으면 CONFLICT — 조용히 덮어쓰지 않는다', async () => {
    await service.create(A, doc('스페인'));
    expect(await code(service.create(A, doc('다시')))).toBe('CONFLICT');
  });

  it('공유받은 여행의 id로 만들면 사본을 만들지 않고 CONFLICT다 — 사본이 생기면 "소유한 쪽 우선"이 원본을 가린다', async () => {
    const shared = await service.create(A, doc('A의 것'));
    await members.add({ tripId: shared.record.id, userId: B.userId, role: 'EDITOR', displayName: null, invitedBy: A.userId });
    await members.add({ tripId: shared.record.id, userId: C.userId, role: 'VIEWER', displayName: null, invitedBy: A.userId });
    for (const who of [B, C]) {
      try {
        await service.create(who, doc('로컬 사본'));
        expect.unreachable();
      } catch (e) {
        const err = e as ApiError;
        expect(err.code).toBe('CONFLICT');
        expect(err.details?.revision).toBe(1);
        expect(err.details?.document).toMatchObject({ name: 'A의 것' });   // 이미 볼 수 있는 여행이라 흘리는 것이 없다
      }
      expect((await service.get(who, 'trip1')).record.id).toBe(shared.record.id);
    }
    expect(store.trips.size).toBe(1);
  });

  it('공유받은 여행이 지워졌으면 그 사실과 함께 CONFLICT다 — 사본으로 되살아나지 않는다', async () => {
    const shared = await service.create(A, doc('A의 것'));
    await members.add({ tripId: shared.record.id, userId: B.userId, role: 'EDITOR', displayName: null, invitedBy: A.userId });
    await service.delete(A, 'trip1', 1);
    try {
      await service.create(B, doc('로컬 사본'));
      expect.unreachable();
    } catch (e) {
      expect((e as ApiError).code).toBe('CONFLICT');
      expect((e as ApiError).details?.deletedAt).toBeTruthy();
    }
    expect(store.trips.size).toBe(1);
  });

  it('나갔거나 내보내진 여행의 id로는 새로 만들 수 없다(FORBIDDEN) — 로컬 사본의 조용한 복제를 막는다', async () => {
    const owned = await service.create(A, doc('A의 것'));
    await members.add({ tripId: owned.record.id, userId: B.userId, role: 'EDITOR', displayName: null, invitedBy: A.userId });
    await members.setStatus(owned.record.id, B.userId, 'LEFT');
    expect(await code(service.create(B, doc('B의 사본')))).toBe('FORBIDDEN');
    expect(await code(service.create(C, doc('C의 새 여행')))).toBe('OK');   // 무관한 사람의 같은 id는 제 여행이 된다
  });
});

describe('list · get', () => {
  it('내가 볼 수 있는 여행만, 삭제된 것은 빼고', async () => {
    await service.create(A, doc('스페인'));
    await service.create(B, { ...doc('B의 것'), id: 'trip2' });
    expect((await service.list(A)).map((v) => v.record.clientId)).toEqual(['trip1']);
    expect((await service.get(A, 'trip1')).role).toBe('OWNER');
    expect(await code(service.get(B, 'trip1'))).toBe('NOT_FOUND');    // 남의 여행은 '없음'이다 — 존재를 흘리지 않는다
    expect(await code(service.get(A, 'nope'))).toBe('NOT_FOUND');
  });

  it('삭제된 여행의 상세는 NOT_FOUND', async () => {
    const v = await service.create(A, doc('스페인'));
    await service.delete(A, 'trip1', v.record.revision);
    expect(await code(service.get(A, 'trip1'))).toBe('NOT_FOUND');
    expect(await service.list(A)).toEqual([]);
  });
});

describe('update', () => {
  it('읽은 revision을 실어 보내면 저장되고 revision이 오른다', async () => {
    await service.create(A, doc('스페인'));
    const next = await service.update(A, 'trip1', doc('스페인 (편집)'), 1);
    expect(next.record.revision).toBe(2);
    expect((next.record.data as { name: string }).name).toBe('스페인 (편집)');
  });

  it('stale write는 STALE_VERSION이고 현재 revision을 details에 싣는다', async () => {
    await service.create(A, doc('스페인'));
    await service.update(A, 'trip1', doc('v2'), 1);
    try {
      await service.update(A, 'trip1', doc('낡은 것'), 1);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      expect((e as ApiError).code).toBe('STALE_VERSION');
      expect((e as ApiError).details?.revision).toBe(2);
    }
    expect((await service.get(A, 'trip1')).record.data).toMatchObject({ name: 'v2' });
  });

  it('EDITOR는 저장하고 VIEWER는 FORBIDDEN, 비멤버는 NOT_FOUND', async () => {
    const v = await service.create(A, doc('스페인'));
    await members.add({ tripId: v.record.id, userId: B.userId, role: 'EDITOR', displayName: '영희', invitedBy: A.userId });
    await members.add({ tripId: v.record.id, userId: C.userId, role: 'VIEWER', displayName: null, invitedBy: A.userId });
    expect((await service.update(B, 'trip1', doc('영희 편집'), 1)).record.revision).toBe(2);
    expect(await code(service.update(C, 'trip1', doc('몰래'), 2))).toBe('FORBIDDEN');
    expect(await code(service.update(ctx('u-x'), 'trip1', doc('몰래'), 2))).toBe('NOT_FOUND');
    expect((await service.get(A, 'trip1')).record.data).toMatchObject({ name: '영희 편집' });
  });

  it('나간 사람의 저장은 FORBIDDEN(복제하지 않는다)', async () => {
    const v = await service.create(A, doc('스페인'));
    await members.add({ tripId: v.record.id, userId: B.userId, role: 'EDITOR', displayName: null, invitedBy: A.userId });
    await members.setStatus(v.record.id, B.userId, 'LEFT');
    expect(await code(service.update(B, 'trip1', doc('나간 뒤'), 1))).toBe('FORBIDDEN');
  });

  it('모양이 틀린 문서는 저장하지 않는다', async () => {
    await service.create(A, doc('스페인'));
    expect(await code(service.update(A, 'trip1', { name: 'x' }, 1))).toBe('VALIDATION_ERROR');
  });

  it('응답을 못 받고 다시 보낸 같은 저장은 충돌이 아니다 — 이미 그 문서면 쓰지 않고 지금 상태를 돌려준다', async () => {
    await service.create(A, doc('스페인'));
    const first = await service.update(A, 'trip1', doc('스페인 (편집)'), 1);
    const retry = await service.update(A, 'trip1', doc('스페인 (편집)'), 1);
    expect(retry.record.revision).toBe(first.record.revision);
    expect(first.alreadyApplied).toBeUndefined();
    expect(retry.alreadyApplied).toBe(true);   // 쓰지 않았다는 것을 호출자(handlerKit.persist)가 알아야 한다
    expect(store.trips.get(first.record.id)!.revision).toBe(2);   // 한 번 더 쓰지 않는다
    expect(await code(service.update(A, 'trip1', doc('다른 편집'), 1))).toBe('STALE_VERSION');   // 실제로 바뀔 때만 충돌
  });

  it('역할은 저장과 같은 트랜잭션에서 다시 본다 — 미리 읽은 역할이 낡았어도 강등된 뒤의 저장은 FORBIDDEN', async () => {
    const v = await service.create(A, doc('스페인'));
    await members.add({ tripId: v.record.id, userId: B.userId, role: 'EDITOR', displayName: null, invitedBy: A.userId });
    // 앞쪽 검사(canEdit)는 강등 직전에 끝났다 — 그 사이 주최자가 B를 보기 권한으로 내렸다
    class StaleRoles extends MemoryMembershipRepository {
      async roleOf(): Promise<MemberRole | null> { return 'EDITOR'; }
    }
    const racing = new TripService({ trips: new MemoryTripRepository(store), members, authz: new TripAuthorizationService(new StaleRoles(store)) });
    await members.add({ tripId: v.record.id, userId: B.userId, role: 'VIEWER', displayName: null, invitedBy: A.userId });
    expect(await code(racing.update(B, 'trip1', doc('강등 뒤'), 1))).toBe('FORBIDDEN');
    expect(await code(racing.update(B, 'trip1', doc('강등 뒤'), 1, { force: true }))).toBe('FORBIDDEN');
    expect((await service.get(A, 'trip1')).record).toMatchObject({ revision: 1, data: { name: '스페인' } });
  });

  it('편집자의 "이 기기 버전"(force)은 주최자가 지운 여행을 되살리지 못한다 — 삭제됐다는 충돌로 돌려준다', async () => {
    const v = await service.create(A, doc('스페인'));
    await members.add({ tripId: v.record.id, userId: B.userId, role: 'EDITOR', displayName: null, invitedBy: A.userId });
    const gone = await service.delete(A, 'trip1', 1);
    try {
      await service.update(B, 'trip1', doc('편집자가 되살리기'), 1, { force: true });
      expect.unreachable();
    } catch (e) {
      expect((e as ApiError).code).toBe('STALE_VERSION');
      expect((e as ApiError).details?.deletedAt).toBeTruthy();   // 웹은 remote-deleted 충돌 카드로 다룬다
    }
    expect(store.trips.get(v.record.id)).toMatchObject({ revision: gone.record.revision, deletedAt: gone.record.deletedAt });
    // 지운 사람(주최자)의 "이 기기 버전"은 예전처럼 되살린다
    const revived = await service.update(A, 'trip1', doc('주최자가 되살리기'), 1, { force: true });
    expect(revived.record.deletedAt).toBeNull();
  });
});

describe('delete', () => {
  it('소유자만 tombstone한다 — EDITOR도 FORBIDDEN', async () => {
    const v = await service.create(A, doc('스페인'));
    await members.add({ tripId: v.record.id, userId: B.userId, role: 'EDITOR', displayName: null, invitedBy: A.userId });
    expect(await code(service.delete(B, 'trip1', 1))).toBe('FORBIDDEN');
    const gone = await service.delete(A, 'trip1', 1);
    expect(gone.record.deletedAt).not.toBeNull();
    expect(gone.record.revision).toBe(2);
  });

  it('revision이 다르면 STALE_VERSION · 이미 지워진 여행은 그대로 돌려준다(멱등)', async () => {
    await service.create(A, doc('스페인'));
    await service.update(A, 'trip1', doc('v2'), 1);
    expect(await code(service.delete(A, 'trip1', 1))).toBe('STALE_VERSION');
    const gone = await service.delete(A, 'trip1', 2);
    const again = await service.delete(A, 'trip1', 999);
    expect(again.record.revision).toBe(gone.record.revision);
  });

  it('없는 여행은 NOT_FOUND', async () => {
    expect(await code(service.delete(A, 'nope', 1))).toBe('NOT_FOUND');
  });
});

describe('동기화(웹의 CAS)를 위해 서버가 현재 상태를 함께 알린다', () => {
  it('stale write는 현재 revision과 **현재 문서**를 함께 준다 — 충돌 카드가 원격본을 보여야 한다', async () => {
    await service.create(A, doc('스페인'));
    await service.update(A, 'trip1', doc('서버가 먼저'), 1);
    try {
      await service.update(A, 'trip1', doc('내 것'), 1);
      expect.unreachable();
    } catch (e) {
      const err = e as ApiError;
      expect(err.code).toBe('STALE_VERSION');
      expect(err.details?.revision).toBe(2);
      expect(err.details?.document).toMatchObject({ name: '서버가 먼저' });
      expect(err.details?.deletedAt).toBeNull();
    }
  });

  it('삭제된 여행에 저장하면 그 사실을 알린다 — 웹은 remote-deleted 충돌로 다룬다', async () => {
    const made = await service.create(A, doc('스페인'));
    await service.delete(A, 'trip1', made.record.revision);
    try {
      await service.update(A, 'trip1', doc('되살리기?'), 1);
      expect.unreachable();
    } catch (e) {
      expect((e as ApiError).details?.deletedAt).toBeTruthy();
    }
  });

  it('같은 id로 처음 올리는데 서버에 이미 있으면 현재 문서를 준다', async () => {
    await service.create(A, doc('서버 것'));
    try {
      await service.create(A, doc('내 것'));
      expect.unreachable();
    } catch (e) {
      const err = e as ApiError;
      expect(err.code).toBe('CONFLICT');
      expect(err.details?.revision).toBe(1);
      expect(err.details?.document).toMatchObject({ name: '서버 것' });
    }
  });

  it('삭제 충돌도 현재 상태를 준다', async () => {
    await service.create(A, doc('스페인'));
    await service.update(A, 'trip1', doc('v2'), 1);
    try {
      await service.delete(A, 'trip1', 1);
      expect.unreachable();
    } catch (e) {
      expect((e as ApiError).details?.revision).toBe(2);
      expect((e as ApiError).details?.document).toMatchObject({ name: 'v2' });
    }
  });

  it('동기화 목록은 **삭제된 여행도** 준다 — 다른 기기의 삭제를 병합해야 한다', async () => {
    await service.create(A, doc('남은 것'));
    const gone = await service.create(A, { ...doc('지운 것'), id: 'trip2' });
    await service.delete(A, 'trip2', gone.record.revision);

    expect((await service.list(A)).map((v) => v.record.clientId)).toEqual(['trip1']);
    const forSync = await service.listForSync(A);
    expect(forSync.map((r) => [r.record.clientId, !!r.record.deletedAt]).sort()).toEqual([['trip1', false], ['trip2', true]]);
  });
});
