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
  /** revision CAS 저장. force면 revision·tombstone을 무시하고 덮어쓰며 되살린다(sync_trip p_force). actorId는 활동 기록의 주체 */
  updateCas(id: string, data: unknown, expectedRevision: number, opts?: { force?: boolean; actorId?: string }): Promise<CasResult>;
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

// ── Adaptive 저장소(Phase 4) — 판단은 adaptive.js가 하고, 여기는 사용자별 기록만 ──

export interface SuggestionFeedbackRepository {
  /** 그 여행·그 날 이미 거절(SKIPPED)한 제안 키 */
  listDismissed(userId: string, tripClientId: string, dayISO: string): Promise<string[]>;
  /** 같은 제안을 두 번 기록해도 한 행(unique 4개 컬럼 upsert) */
  record(userId: string, tripClientId: string, dayISO: string, suggestionKey: string, action: string, source: string): Promise<void>;
}

export interface NotificationLogRepository {
  listSentKeys(userId: string, tripClientId: string, dayISO: string): Promise<string[]>;
  /** 같은 dedupe_key는 한 행 — 중복 발송이 오류가 되지 않게 */
  record(userId: string, tripClientId: string, dayISO: string, items: { kind: string; dedupeKey: string; stateVersion: string }[]): Promise<void>;
}

export interface DeviceRegistrationRow {
  deviceId: string;
  platform: 'ios' | 'web';
  pushToken: string;
  enabled: boolean;
  preferences: Record<string, boolean>;
  appVersion: string | null;
}

export interface DeviceRepository {
  save(userId: string, registration: DeviceRegistrationRow): Promise<void>;
  remove(userId: string, deviceId: string): Promise<void>;
}

/** intakeView.MemoryRow와 같은 모양(snake_case 유지 — 기존 핸들러·계약이 그대로 쓴다) */
export interface MemoryRecord {
  id: string;
  day_index: number | null;
  activity_id: string | null;
  type: string;
  caption: string | null;
  asset_refs: unknown;
  lat: number | null;
  lng: number | null;
  at_minutes: number | null;
  captured_at: string;
  client_key: string | null;
}

export interface MemoryRepository {
  list(userId: string, tripClientId: string, dayIndex: number | null): Promise<MemoryRecord[]>;
  /** client_key가 이미 있으면 새로 만들지 않고 그것을 돌려준다(오프라인 재시도) */
  save(userId: string, tripClientId: string, row: Omit<MemoryRecord, 'id'>): Promise<{ row: MemoryRecord; created: boolean }>;
}

// ── 가격 관측(Pricing) — 판정은 price.js, 여기는 관측 행만 ──

export interface PriceObservationRecord {
  booking_id: string;
  seller: string | null;
  price: number | null;
  currency: string | null;
  quality: string | null;
  verified: boolean;
  offers: unknown[] | null;
  observed_at: string;
}

export interface PriceObservationRepository {
  /** 여행의 관측 전부, 오래된 순, 최대 500 */
  listForTrip(userId: string, tripClientId: string): Promise<PriceObservationRecord[]>;
  append(userId: string, tripClientId: string, obs: Omit<PriceObservationRecord, 'observed_at'> & { observed_at?: string; ptoken?: string | null }): Promise<void>;
}

// ── 협업(함께하기) 저장소 — 인가·검증은 CollabService, 여기는 저장과 조회(이름표·집계는 SQL이 만든다) ──
// 활동 기록(trip_activity)은 Supabase에서 트리거가 쓰던 것을 **같은 트랜잭션에서 Repository가** 쓴다 — 어떤 경로로 바뀌든 같은 기록.

import type {
  ActivityView, CandidateInput, CandidateView, CommentView, InviteView, MemberView, PreferenceView
} from '../application/collaboration/types';

export interface MemberRow {
  id: number; tripId: string; userId: string; role: MemberRole; status: MemberStatus; displayName: string | null; updatedAt: string;
}
export interface InviteRow {
  id: number; tripId: string; role: string; createdBy: string; expiresAt: string; revokedAt: string | null; maxUses: number | null; useCount: number; createdAt: string;
  trip: { ownerId: string; clientId: string; deletedAt: string | null; name: string; start: string; dayCount: number };
}
export interface CandidateRow { id: number; tripId: string; proposedBy: string; title: string; status: string; createdAt: string }
export interface CommentRow { id: number; tripId: string; candidateId: number; userId: string }

export interface CollabRepository {
  listMembers(tripId: string, viewerId: string): Promise<MemberView[]>;
  findMember(memberId: number): Promise<MemberRow | null>;
  findMembership(tripId: string, userId: string): Promise<MemberRow | null>;
  renameMember(memberId: number, displayName: string | null): Promise<void>;
  setMemberRole(memberId: number, role: MemberRole): Promise<void>;
  /** 상태 변경 + 활동 기록(MEMBER_LEFT/MEMBER_REMOVED, 소유자 행은 기록하지 않는다). actorId는 기록의 주체 */
  setMemberStatus(memberId: number, status: MemberStatus, actorId: string): Promise<void>;
  listPreferences(tripId: string, viewerId: string): Promise<PreferenceView[]>;
  /** 활성 멤버 행이 없으면 false */
  setPreference(tripId: string, userId: string, prefs: Record<string, unknown>): Promise<boolean>;

  createInvite(input: { tripId: string; tokenHash: string; role: string; createdBy: string; expiresAt: string; maxUses: number | null }): Promise<{ id: number; expiresAt: string }>;
  listInvites(tripId: string): Promise<InviteView[]>;
  /** 소유자 확인은 서비스가 했다. 두 번 취소해도 첫 취소 시각 유지. 없으면 false */
  revokeInvite(inviteId: number, tripId: string): Promise<boolean>;
  findInviteByHash(tokenHash: string): Promise<InviteRow | null>;
  /** 멤버 upsert(ACTIVE) + use_count + MEMBER_JOINED — 한 트랜잭션 */
  acceptInvite(input: { inviteId: number; tripId: string; userId: string; role: string; displayName: string | null; invitedBy: string }): Promise<void>;

  listCandidates(tripId: string, viewerId: string): Promise<CandidateView[]>;
  findCandidate(candidateId: number): Promise<CandidateRow | null>;
  /** 후보 + 제안자 자동 MUST + CANDIDATE_PROPOSED — 한 트랜잭션 */
  addCandidate(tripId: string, userId: string, input: Required<CandidateInput>): Promise<number>;
  /** null이면 거두기(기록 없음). 새 반응·바뀐 반응만 REACTION 기록. 제안자의 자동 MUST는 기록하지 않는다 */
  setReaction(candidateId: number, userId: string, reaction: string | null): Promise<void>;
  /** SCHEDULED로 바뀌면 CANDIDATE_SCHEDULED, REJECTED로 바뀌면 CANDIDATE_REJECTED 기록 */
  setCandidateStatus(candidateId: number, status: string, scheduledRef: string | null, actorId: string): Promise<void>;
  removeCandidate(candidateId: number): Promise<void>;

  listComments(candidateId: number, viewerId: string): Promise<CommentView[]>;
  /** 코멘트 + COMMENT_ADDED(excerpt 60자) */
  addComment(tripId: string, candidateId: number, userId: string, body: string): Promise<number>;
  findComment(commentId: number): Promise<CommentRow | null>;
  deleteComment(commentId: number): Promise<boolean>;

  listActivity(tripId: string, viewerId: string, limit: number): Promise<ActivityView[]>;
}

// ── 자체 Auth 계정 ↔ 도메인 사용자 연결(§13). 규칙은 server/auth/identity.ts ──

export interface AuthIdentityRepository {
  /** 이 Auth 계정에 이어진 도메인 users.id */
  findByAuthUserId(authUserId: string): Promise<string | null>;
  /** 아직 아무 Auth 계정과도 이어지지 않은, 이 이메일의 기존 사용자 */
  findUnlinkedByEmail(email: string): Promise<string | null>;
  /** 이어 붙인다. 그 사이 다른 계정이 먼저 이어졌으면 false */
  link(userId: string, authUserId: string): Promise<boolean>;
  /** 새 도메인 사용자(새 uuid)를 만들고 이어 붙인다 */
  createLinked(email: string, authUserId: string): Promise<string>;
}

// ── 여행 버전 이력 — 사람마다 제 행, 여행당 최근 15개(운영과 같은 규칙) ──

export interface TripSnapshotSummary {
  id: number;
  name: string;
  source_revision: number | null;
  created_at: string;
}
export interface TripSnapshotRecord extends TripSnapshotSummary {
  data: unknown;
}

export interface TripSnapshotRepository {
  /** 만들고 나서 오래된 것을 정리한다(같은 트랜잭션) */
  create(userId: string, clientId: string, input: { name: string; data: unknown; sourceRevision: number | null }): Promise<TripSnapshotSummary>;
  list(userId: string, clientId: string): Promise<TripSnapshotSummary[]>;
  /** 남의 스냅샷은 id를 알아도 돌려주지 않는다 */
  find(userId: string, clientId: string, id: number): Promise<TripSnapshotRecord | null>;
}
