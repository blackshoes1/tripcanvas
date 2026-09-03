// 메모리 Repository — application 테스트용. PgRepository와 같은 계약(소유한 쪽 우선 · CAS · tombstone)을 지킨다.
// 두 구현이 같은 결론을 내는지는 pgRepositories.test.ts(PGlite)와 tripService.test.ts가 각각 확인한다.
import type {
  CasResult, MemberRole, MemberStatus, MembershipRepository, TripRecord, TripRepository, TripView, UserRecord, UserRepository
} from '../types';

interface MemberRow { tripId: string; userId: string; role: MemberRole; status: MemberStatus; displayName: string | null }

export class MemoryStore {
  users = new Map<string, UserRecord>();
  trips = new Map<string, TripRecord>();
  members: MemberRow[] = [];
  private seq = 0;
  private clock = 0;
  nextId(): string { return `row-${++this.seq}`; }
  /** 테스트 안에서 순서가 결정적이도록 1ms씩 증가하는 시각 */
  now(): string { return new Date(1_756_000_000_000 + ++this.clock * 1000).toISOString(); }
}

export class MemoryUserRepository implements UserRepository {
  constructor(private readonly store: MemoryStore) {}
  async ensure(user: { id: string; email: string | null }): Promise<UserRecord> {
    const existing = this.store.users.get(user.id);
    const rec: UserRecord = existing ?? { id: user.id, email: user.email, legacySupabaseUserId: user.id };
    if (existing && user.email) rec.email = user.email;
    this.store.users.set(user.id, rec);
    return rec;
  }
  async findById(id: string): Promise<UserRecord | null> { return this.store.users.get(id) ?? null; }
}

export class MemoryMembershipRepository implements MembershipRepository {
  constructor(private readonly store: MemoryStore) {}
  async roleOf(userId: string, tripId: string): Promise<MemberRole | null> {
    const trip = this.store.trips.get(tripId);
    if (trip?.ownerId === userId) return 'OWNER';
    const m = this.store.members.find((x) => x.tripId === tripId && x.userId === userId && x.status === 'ACTIVE');
    return m?.role ?? null;
  }
  async wasMember(userId: string, clientId: string): Promise<boolean> {
    return this.store.members.some((m) => m.userId === userId && (m.status === 'LEFT' || m.status === 'REMOVED')
      && this.store.trips.get(m.tripId)?.clientId === clientId);
  }
  async add(input: { tripId: string; userId: string; role: MemberRole; displayName: string | null }): Promise<void> {
    const existing = this.store.members.find((m) => m.tripId === input.tripId && m.userId === input.userId);
    if (existing) Object.assign(existing, { role: input.role, status: 'ACTIVE', displayName: input.displayName });
    else this.store.members.push({ tripId: input.tripId, userId: input.userId, role: input.role, status: 'ACTIVE', displayName: input.displayName });
  }
  async setStatus(tripId: string, userId: string, status: MemberStatus): Promise<void> {
    const m = this.store.members.find((x) => x.tripId === tripId && x.userId === userId);
    if (m) m.status = status;
  }
}

export class MemoryTripRepository implements TripRepository {
  private readonly members: MemoryMembershipRepository;
  constructor(private readonly store: MemoryStore) {
    this.members = new MemoryMembershipRepository(store);
  }

  private async viewOf(userId: string, rec: TripRecord): Promise<TripView | null> {
    const role = await this.members.roleOf(userId, rec.id);
    if (!role) return null;
    const memberCount = this.store.members.filter((m) => m.tripId === rec.id && m.status === 'ACTIVE').length;
    return { record: { ...rec }, role, memberCount };
  }

  private async visible(userId: string): Promise<TripView[]> {
    const views: TripView[] = [];
    for (const rec of this.store.trips.values()) {
      const v = await this.viewOf(userId, rec);
      if (v) views.push(v);
    }
    return views.sort((a, b) => Number(b.role === 'OWNER') - Number(a.role === 'OWNER'));
  }

  async listVisible(userId: string): Promise<TripView[]> {
    const seen = new Set<string>();
    return (await this.visible(userId))
      .filter((v) => !v.record.deletedAt && !seen.has(v.record.clientId) && seen.add(v.record.clientId))
      .sort((a, b) => b.record.updatedAt.localeCompare(a.record.updatedAt));
  }

  async findVisible(userId: string, clientId: string): Promise<TripView | null> {
    return (await this.visible(userId)).find((v) => v.record.clientId === clientId) ?? null;
  }

  async create(input: { ownerId: string; clientId: string; data: unknown }): Promise<TripRecord> {
    for (const t of this.store.trips.values()) {
      if (t.ownerId === input.ownerId && t.clientId === input.clientId) throw new Error('duplicate (user_id, client_id)');
    }
    const rec: TripRecord = {
      id: this.store.nextId(), ownerId: input.ownerId, clientId: input.clientId, data: input.data,
      revision: 1, deletedAt: null, updatedAt: this.store.now()
    };
    this.store.trips.set(rec.id, rec);
    this.store.members.push({ tripId: rec.id, userId: input.ownerId, role: 'OWNER', status: 'ACTIVE', displayName: null });
    return { ...rec };
  }

  async updateCas(id: string, data: unknown, expectedRevision: number, opts: { force?: boolean } = {}): Promise<CasResult> {
    const rec = this.store.trips.get(id);
    if (!rec) throw new Error(`trip ${id} not found`);
    if (!opts.force && (rec.deletedAt || rec.revision !== expectedRevision)) return { applied: false, conflict: true, record: { ...rec } };
    Object.assign(rec, { data, revision: rec.revision + 1, deletedAt: null, updatedAt: this.store.now() });
    return { applied: true, conflict: false, record: { ...rec } };
  }

  async tombstoneCas(id: string, expectedRevision: number, opts: { force?: boolean } = {}): Promise<CasResult> {
    const rec = this.store.trips.get(id);
    if (!rec) throw new Error(`trip ${id} not found`);
    if (!opts.force && rec.revision !== expectedRevision) return { applied: false, conflict: true, record: { ...rec } };
    Object.assign(rec, { revision: rec.revision + 1, deletedAt: this.store.now(), updatedAt: this.store.now() });
    return { applied: true, conflict: false, record: { ...rec } };
  }
}
