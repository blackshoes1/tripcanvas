// Repository 인터페이스(§9) — application/domain은 이것만 본다. SQL·ORM은 infrastructure/database 안에만 있다.

export type MemberRole = 'OWNER' | 'EDITOR' | 'VIEWER';
export type MemberStatus = 'INVITED' | 'ACTIVE' | 'LEFT' | 'REMOVED';

export interface UserRecord {
  id: string;
  email: string | null;
  legacySupabaseUserId: string | null;
}

export interface UserRepository {
  /** 있으면 그대로, 없으면 만든다(멱등). Phase A에서는 Supabase user id가 곧 id다 */
  ensure(user: { id: string; email: string | null }): Promise<UserRecord>;
  findById(id: string): Promise<UserRecord | null>;
}

/** trips 한 행 — 여행 문서(jsonb)와 CAS 메타. id는 DB 내부 키, clientId가 API가 아는 여행 id다 */
export interface TripRecord {
  id: string;
  ownerId: string;
  clientId: string;
  data: unknown;
  revision: number;
  deletedAt: string | null;
  updatedAt: string;
}

/** 호출자 눈으로 본 여행 — 역할과 활성 인원까지 (my_trip_roles와 같은 정보) */
export interface TripView {
  record: TripRecord;
  role: MemberRole;
  memberCount: number;
}

export interface CasResult {
  applied: boolean;
  conflict: boolean;
  record: TripRecord;
}

export interface TripRepository {
  /** 삭제되지 않은, 내가 소유하거나 활성 멤버인 여행. 같은 clientId가 둘이면 소유한 쪽만. 최근 수정 순 */
  listVisible(userId: string): Promise<TripView[]>;
  /** clientId로 하나 — 소유한 쪽 우선. tombstone도 돌려준다(호출측이 판단). 볼 수 없으면 null */
  findVisible(userId: string, clientId: string): Promise<TripView | null>;
  /** 새 여행(revision 1) + 같은 트랜잭션의 OWNER 멤버 행. (ownerId, clientId)가 이미 있으면 던진다 */
  create(input: { ownerId: string; clientId: string; data: unknown }): Promise<TripRecord>;
  /** revision CAS 저장. force면 revision·tombstone을 무시하고 덮어쓰며 되살린다(sync_trip p_force) */
  updateCas(id: string, data: unknown, expectedRevision: number, opts?: { force?: boolean }): Promise<CasResult>;
  /** revision CAS tombstone. 행은 남고 deleted_at·revision이 오른다 */
  tombstoneCas(id: string, expectedRevision: number, opts?: { force?: boolean }): Promise<CasResult>;
}

export interface MembershipRepository {
  /** 소유자면 OWNER(멤버 행이 없어도), 활성 멤버면 그 역할, 아니면 null (tc_trip_role) */
  roleOf(userId: string, tripId: string): Promise<MemberRole | null>;
  /** 이 clientId의 어떤 여행에서든 나갔거나 내보내진 적이 있는가 (tc_was_member) */
  wasMember(userId: string, clientId: string): Promise<boolean>;
  /** 멤버 추가 — 이미 있으면 역할·이름을 갱신하고 ACTIVE로 되돌린다 */
  add(input: { tripId: string; userId: string; role: MemberRole; displayName: string | null; invitedBy: string | null }): Promise<void>;
  setStatus(tripId: string, userId: string, status: MemberStatus): Promise<void>;
}
