// RLS 대체(§22~24). 정책이 하던 판정을 application이 한다 — DB는 더 이상 authorization을 대신하지 않는다.
// 규칙은 웹과 같은 collab.js(canEdit/canManage/canDelete)를 쓴다 — 두 곳의 답이 갈리면 안 된다.
import collab from '@legacy/collab.js';

import type { MemberRole, MembershipRepository } from '../../repositories/types';

export class TripAuthorizationService {
  constructor(private readonly members: MembershipRepository) {}

  /** 소유자면 OWNER, 활성 멤버면 그 역할, 아니면 null (tc_trip_role) */
  roleOf(userId: string, tripId: string): Promise<MemberRole | null> {
    return this.members.roleOf(userId, tripId);
  }
  async canRead(userId: string, tripId: string): Promise<boolean> {
    return (await this.roleOf(userId, tripId)) != null;
  }
  async canEdit(userId: string, tripId: string): Promise<boolean> {
    return collab.canEdit(await this.roleOf(userId, tripId));
  }
  async canManageMembers(userId: string, tripId: string): Promise<boolean> {
    return collab.canManage(await this.roleOf(userId, tripId));
  }
  async canDelete(userId: string, tripId: string): Promise<boolean> {
    return collab.canDelete(await this.roleOf(userId, tripId));
  }
}
