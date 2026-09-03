// DUAL_READ(§32) — 새 PostgreSQL에서 먼저 찾고 없으면 레거시(Supabase)에서 읽는다. 이관 기간에만 쓴다.
// 쓰기는 그 행이 온 곳으로 간다 — 레거시에만 있는 여행을 새 DB에 몰래 복제하지 않는다(dual write 금지, §33).
import { beforeEach, describe, expect, it } from 'vitest';

import { DualReadMembershipRepository, DualReadTripRepository } from './dualRead';
import { MemoryMembershipRepository, MemoryStore, MemoryTripRepository } from './memory/memoryRepositories';

const A = 'u-a';
let primary: MemoryTripRepository, fallback: MemoryTripRepository;
let primaryMembers: MemoryMembershipRepository, fallbackMembers: MemoryMembershipRepository;
let trips: DualReadTripRepository;
let members: DualReadMembershipRepository;

beforeEach(() => {
  const p = new MemoryStore(), f = new MemoryStore();
  primary = new MemoryTripRepository(p); fallback = new MemoryTripRepository(f);
  primaryMembers = new MemoryMembershipRepository(p); fallbackMembers = new MemoryMembershipRepository(f);
  trips = new DualReadTripRepository(primary, fallback);
  members = new DualReadMembershipRepository(primaryMembers, fallbackMembers);
});

describe('DualReadTripRepository', () => {
  it('목록은 두 곳을 합치되 같은 clientId는 새 DB가 이긴다', async () => {
    await primary.create({ ownerId: A, clientId: 'both', data: { name: 'new' } });
    await fallback.create({ ownerId: A, clientId: 'both', data: { name: 'old' } });
    await fallback.create({ ownerId: A, clientId: 'legacy-only', data: { name: 'legacy' } });
    const list = await trips.listVisible(A);
    expect(list.map((v) => [v.record.clientId, (v.record.data as { name: string }).name]).sort()).toEqual([['both', 'new'], ['legacy-only', 'legacy']]);
  });

  it('상세는 새 DB 우선, 없으면 레거시', async () => {
    await fallback.create({ ownerId: A, clientId: 'legacy-only', data: { name: 'legacy' } });
    expect((await trips.findVisible(A, 'legacy-only'))?.record.data).toEqual({ name: 'legacy' });
    expect(await trips.findVisible(A, 'nope')).toBeNull();
  });

  it('레거시에서 읽은 행의 저장·삭제는 레거시로 간다 — 새 DB에 복제되지 않는다', async () => {
    const legacy = await fallback.create({ ownerId: A, clientId: 'legacy-only', data: { name: 'legacy' } });
    const view = await trips.findVisible(A, 'legacy-only');
    const saved = await trips.updateCas(view!.record.id, { name: 'edited' }, 1);
    expect(saved.applied).toBe(true);
    expect((await fallback.findVisible(A, 'legacy-only'))?.record.revision).toBe(2);
    expect(await primary.findVisible(A, 'legacy-only')).toBeNull();
    const gone = await trips.tombstoneCas(legacy.id, 2);
    expect(gone.record.deletedAt).not.toBeNull();
  });

  it('새 여행은 새 DB에 만든다', async () => {
    await trips.create({ ownerId: A, clientId: 'fresh', data: {} });
    expect(await primary.findVisible(A, 'fresh')).not.toBeNull();
    expect(await fallback.findVisible(A, 'fresh')).toBeNull();
  });

  it('이 요청에서 읽지 않은 id의 저장은 던진다 — 어느 쪽 행인지 모른다', async () => {
    await expect(trips.updateCas('unknown-id', {}, 1)).rejects.toThrow();
  });
});

describe('DualReadMembershipRepository', () => {
  it('역할은 새 DB 우선, 나간 기록은 어느 쪽에 있든 인정한다', async () => {
    const t = await fallback.create({ ownerId: A, clientId: 'legacy-only', data: {} });
    await fallbackMembers.add({ tripId: t.id, userId: 'u-b', role: 'EDITOR', displayName: null, invitedBy: A });
    expect(await members.roleOf('u-b', t.id)).toBe('EDITOR');
    await fallbackMembers.setStatus(t.id, 'u-b', 'REMOVED');
    expect(await members.roleOf('u-b', t.id)).toBeNull();
    expect(await members.wasMember('u-b', 'legacy-only')).toBe(true);
    expect(await members.wasMember('u-c', 'legacy-only')).toBe(false);
  });
});
