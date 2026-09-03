// RLS 대체(§22~24, §41·§83) — OWNER · EDITOR · VIEWER · 비멤버 · 내보내진 멤버를 application이 판정한다.
// 규칙 자체는 웹과 같은 collab.js(canEdit/canManage/canDelete)를 쓴다 — 두 곳이 다른 답을 내면 안 된다.
import { beforeEach, describe, expect, it } from 'vitest';

import { MemoryMembershipRepository, MemoryStore, MemoryTripRepository } from '../../repositories/memory/memoryRepositories';
import { TripAuthorizationService } from './tripAuthorization';

const OWNER = 'u-owner', EDITOR = 'u-editor', VIEWER = 'u-viewer', STRANGER = 'u-stranger', REMOVED = 'u-removed';

let authz: TripAuthorizationService;
let tripId: string;

beforeEach(async () => {
  const store = new MemoryStore();
  const trips = new MemoryTripRepository(store);
  const members = new MemoryMembershipRepository(store);
  tripId = (await trips.create({ ownerId: OWNER, clientId: 'trip1', data: {} })).id;
  await members.add({ tripId, userId: EDITOR, role: 'EDITOR', displayName: null, invitedBy: OWNER });
  await members.add({ tripId, userId: VIEWER, role: 'VIEWER', displayName: null, invitedBy: OWNER });
  await members.add({ tripId, userId: REMOVED, role: 'EDITOR', displayName: null, invitedBy: OWNER });
  await members.setStatus(tripId, REMOVED, 'REMOVED');
  authz = new TripAuthorizationService(members);
});

describe('TripAuthorizationService', () => {
  it.each([
    [OWNER, true, true, true, true],
    [EDITOR, true, true, false, false],
    [VIEWER, true, false, false, false],
    [STRANGER, false, false, false, false],
    [REMOVED, false, false, false, false]
  ])('%s → read %s · edit %s · manage %s · delete %s', async (user, read, edit, manage, del) => {
    expect(await authz.canRead(user, tripId)).toBe(read);
    expect(await authz.canEdit(user, tripId)).toBe(edit);
    expect(await authz.canManageMembers(user, tripId)).toBe(manage);
    expect(await authz.canDelete(user, tripId)).toBe(del);
  });

  it('모르는 여행은 누구에게도 아무 권한이 없다', async () => {
    expect(await authz.canRead(OWNER, 'no-such-trip')).toBe(false);
  });
});
