// DUAL_READ(§32) — 이관 기간 한정. 읽기는 새 DB → 레거시 순, 쓰기는 그 행이 온 곳으로. 새 여행은 새 DB에.
// dual write는 하지 않는다(§33): 레거시에만 있는 여행을 새 DB로 조용히 복제하면 두 진실이 생긴다 — 그건 이관 스크립트(Phase 10)의 일이다.
import type {
  CasResult, MemberRole, MemberStatus, MembershipRepository, TripRecord, TripRepository, TripView
} from './types';

export class DualReadTripRepository implements TripRepository {
  /** 이 요청에서 레거시로부터 읽은 행의 id — 그쪽으로 쓰기를 돌려보내기 위해 */
  private readonly fromFallback = new Set<string>();
  constructor(private readonly primary: TripRepository, private readonly fallback: TripRepository) {}

  async listVisible(userId: string): Promise<TripView[]> {
    const [a, b] = await Promise.all([this.primary.listVisible(userId), this.fallback.listVisible(userId)]);
    const seen = new Set(a.map((v) => v.record.clientId));
    const extra = b.filter((v) => !seen.has(v.record.clientId));
    extra.forEach((v) => this.fromFallback.add(v.record.id));
    return [...a, ...extra].sort((x, y) => y.record.updatedAt.localeCompare(x.record.updatedAt));
  }

  async listForSync(userId: string): Promise<TripView[]> {
    const [a, b] = await Promise.all([this.primary.listForSync(userId), this.fallback.listForSync(userId)]);
    const seen = new Set(a.map((v) => v.record.clientId));
    const extra = b.filter((v) => !seen.has(v.record.clientId));
    extra.forEach((v) => this.fromFallback.add(v.record.id));
    return [...a, ...extra].sort((x, y) => y.record.updatedAt.localeCompare(x.record.updatedAt));
  }

  async findVisible(userId: string, clientId: string): Promise<TripView | null> {
    const hit = await this.primary.findVisible(userId, clientId);
    if (hit) return hit;
    const legacy = await this.fallback.findVisible(userId, clientId);
    if (legacy) this.fromFallback.add(legacy.record.id);
    return legacy;
  }

  create(input: { ownerId: string; clientId: string; data: unknown }): Promise<TripRecord> {
    return this.primary.create(input);
  }

  private sourceOf(id: string): TripRepository {
    if (this.fromFallback.has(id)) return this.fallback;
    return this.primary;
  }

  updateCas(id: string, data: unknown, expectedRevision: number, opts?: { force?: boolean }): Promise<CasResult> {
    return this.sourceOf(id).updateCas(id, data, expectedRevision, opts);
  }

  tombstoneCas(id: string, expectedRevision: number, opts?: { force?: boolean }): Promise<CasResult> {
    return this.sourceOf(id).tombstoneCas(id, expectedRevision, opts);
  }
}

export class DualReadMembershipRepository implements MembershipRepository {
  constructor(private readonly primary: MembershipRepository, private readonly fallback: MembershipRepository) {}

  async roleOf(userId: string, tripId: string): Promise<MemberRole | null> {
    return (await this.primary.roleOf(userId, tripId)) ?? (await this.fallback.roleOf(userId, tripId));
  }
  async wasMember(userId: string, clientId: string): Promise<boolean> {
    return (await this.primary.wasMember(userId, clientId)) || (await this.fallback.wasMember(userId, clientId));
  }
  add(input: { tripId: string; userId: string; role: MemberRole; displayName: string | null; invitedBy: string | null }): Promise<void> {
    return this.primary.add(input);
  }
  setStatus(tripId: string, userId: string, status: MemberStatus): Promise<void> {
    return this.primary.setStatus(tripId, userId, status);
  }
}
