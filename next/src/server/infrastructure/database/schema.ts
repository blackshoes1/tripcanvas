// 독립 PostgreSQL 스키마(Drizzle). 운영 Supabase 스키마를 그대로 옮기되 Supabase 전용 부분만 뺐다:
//   auth.users → users (id는 Supabase user id를 그대로 보존 — 외래키·소유권이 안 깨진다, §13)
//   auth.uid() 기본값 · RLS · security definer RPC → 없음. 호출자는 API가 알고(RequestContext) 규칙은 application이 판정한다(§22~24)
//   trips.id 는 운영과 같은 uuid
// 마이그레이션 SQL은 drizzle-kit이 이 파일에서 만든다(migrations/). 손으로 SQL을 고치지 않는다(§62).
import { sql } from 'drizzle-orm';
import {
  bigint, boolean, check, date, doublePrecision, index, integer, jsonb, numeric, pgSequence, pgTable, primaryKey, text, timestamp,
  uniqueIndex, uuid
} from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: uuid('id').primaryKey(),
  email: text('email'),
  // Supabase 시절의 id. 지금은 id와 같다 — Phase 8(새 Auth)에서 계정을 새로 만들 때 매핑 근거가 된다
  legacySupabaseUserId: uuid('legacy_supabase_user_id').unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
  /** 자체 Auth 계정(Phase 8)과의 연결. Supabase 시절 사용자는 이메일 확인 뒤에 이어진다(§13 · server/auth/identity.ts) */
  authUserId: text('auth_user_id').unique()
});

/**
 * 저장이 일어난 순서. updated_at은 같은 순간(트랜잭션 시각·낮은 시계 해상도)에 여러 행이 같은 값을 받을 수 있어
 * "최근 수정 순" 목록의 순서가 갈린다 — 그때 무엇이 먼저인지를 이 값이 정한다.
 */
export const tripsUpdatedSeq = pgSequence('trips_updated_seq');

export const trips = pgTable('trips', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  clientId: text('client_id').notNull(),
  data: jsonb('data').notNull(),
  revision: bigint('revision', { mode: 'number' }).notNull().default(1),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  /** updated_at 동률을 가르는 2차 정렬 키(tripsUpdatedSeq). 저장할 때마다 새로 받는다 */
  updatedSeq: bigint('updated_seq', { mode: 'number' }).notNull().default(sql`nextval('trips_updated_seq')`)
}, (t) => [
  uniqueIndex('trips_user_client_uidx').on(t.userId, t.clientId),
  index('trips_user_updated_idx').on(t.userId, t.updatedAt),
  index('trips_client_idx').on(t.clientId),
  check('trips_revision_check', sql`${t.revision} > 0`)
]);

/**
 * 여행 버전 이력 — 저장 전에 떠 두는 사본. 운영 스키마 그대로다.
 * 사람마다 제 행을 본다(운영 RLS가 소유자 행만 보여줬다) — 여행당 최근 15개만 남긴다.
 */
export const tripSnapshots = pgTable('trip_snapshots', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedByDefaultAsIdentity(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  clientId: text('client_id').notNull(),
  name: text('name').notNull().default(''),
  data: jsonb('data').notNull(),
  sourceRevision: bigint('source_revision', { mode: 'number' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (t) => [
  index('trip_snapshots_user_client_created_idx').on(t.userId, t.clientId, t.createdAt),
  check('trip_snapshots_revision_check', sql`${t.sourceRevision} is null or ${t.sourceRevision} > 0`)
]);

export const tripMembers = pgTable('trip_members', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedByDefaultAsIdentity(),
  tripId: uuid('trip_id').notNull().references(() => trips.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  role: text('role').notNull(),
  status: text('status').notNull().default('ACTIVE'),
  // 이 여행에서 보일 이름. 계정 이메일은 여행에 노출하지 않는다(§69)
  displayName: text('display_name'),
  invitedBy: uuid('invited_by').references(() => users.id, { onDelete: 'set null' }),
  joinedAt: timestamp('joined_at', { withTimezone: true }),
  prefs: jsonb('prefs').notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
}, (t) => [
  uniqueIndex('trip_members_trip_user_uidx').on(t.tripId, t.userId),
  index('trip_members_user_idx').on(t.userId, t.status),
  check('trip_members_role_check', sql`${t.role} in ('OWNER','EDITOR','VIEWER')`),
  check('trip_members_status_check', sql`${t.status} in ('INVITED','ACTIVE','LEFT','REMOVED')`)
]);

// ── Adaptive 저장소(Phase 4) — 사용자별 기록. 판단은 adaptive.js, 여기는 "무엇을 이미 했는가"만 ──

export const suggestionFeedback = pgTable('suggestion_feedback', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedByDefaultAsIdentity(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tripClientId: text('trip_client_id').notNull(),
  dayIso: date('day_iso').notNull(),
  suggestionKey: text('suggestion_key').notNull(),
  action: text('action').notNull(),
  source: text('source').notNull().default('unknown'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
}, (t) => [
  uniqueIndex('suggestion_feedback_key_uidx').on(t.userId, t.tripClientId, t.dayIso, t.suggestionKey),
  index('suggestion_feedback_lookup_idx').on(t.userId, t.tripClientId, t.dayIso),
  check('suggestion_feedback_action_check', sql`${t.action} in ('ACCEPTED','SKIPPED','DISMISSED','REPLACED')`)
]);

export const deviceTokens = pgTable('device_tokens', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedByDefaultAsIdentity(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  deviceId: text('device_id').notNull(),
  platform: text('platform').notNull().default('ios'),
  pushToken: text('push_token').notNull(),
  enabled: boolean('enabled').notNull().default(true),
  preferences: jsonb('preferences').notNull().default(sql`'{}'::jsonb`),
  appVersion: text('app_version'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
}, (t) => [
  uniqueIndex('device_tokens_user_device_uidx').on(t.userId, t.deviceId),
  index('device_tokens_user_idx').on(t.userId, t.enabled),
  check('device_tokens_platform_check', sql`${t.platform} in ('ios','web')`)
]);

export const notificationLog = pgTable('notification_log', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedByDefaultAsIdentity(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tripClientId: text('trip_client_id').notNull(),
  dayIso: date('day_iso').notNull(),
  kind: text('kind').notNull(),
  // trip|day|kind|source|stage — 같은 상황은 한 번만 (§46)
  dedupeKey: text('dedupe_key').notNull(),
  stateVersion: text('state_version'),
  openedAt: timestamp('opened_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (t) => [
  uniqueIndex('notification_log_user_key_uidx').on(t.userId, t.dedupeKey),
  index('notification_log_lookup_idx').on(t.userId, t.tripClientId, t.dayIso)
]);

export const tripMemories = pgTable('trip_memories', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tripClientId: text('trip_client_id').notNull(),
  dayIndex: integer('day_index'),
  activityId: text('activity_id'),
  type: text('type').notNull(),
  caption: text('caption'),
  // PhotosPicker 식별자 목록 — 원본 이미지가 아니다
  assetRefs: jsonb('asset_refs').notNull().default(sql`'[]'::jsonb`),
  lat: doublePrecision('lat'),
  lng: doublePrecision('lng'),
  atMinutes: integer('at_minutes'),
  capturedAt: timestamp('captured_at', { withTimezone: true }).notNull().defaultNow(),
  clientKey: text('client_key'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (t) => [
  uniqueIndex('trip_memories_user_key_uidx').on(t.userId, t.clientKey),
  index('trip_memories_trip_idx').on(t.userId, t.tripClientId, t.dayIndex),
  check('trip_memories_type_check', sql`${t.type} in ('PHOTO','NOTE','VISIT','MOMENT')`)
]);

// ── 가격 관측(Pricing) — append-only. 판정은 price.js ──

export const hotelPriceSnapshots = pgTable('hotel_price_snapshots', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tripClientId: text('trip_client_id').notNull(),
  bookingId: text('booking_id').notNull(),
  seller: text('seller'),
  price: numeric('price'),
  currency: text('currency'),
  quality: text('quality'),
  verified: boolean('verified').notNull().default(false),
  ptoken: text('ptoken'),
  offers: jsonb('offers'),
  observedAt: timestamp('observed_at', { withTimezone: true }).notNull().defaultNow()
}, (t) => [
  index('hotel_price_snapshots_booking_idx').on(t.bookingId, t.observedAt),
  index('hotel_price_snapshots_user_idx').on(t.userId, t.observedAt),
  index('hotel_price_snapshots_trip_idx').on(t.userId, t.tripClientId)
]);

// ── 협업(함께하기) — 여행 문서 밖의 것들. 활동 기록은 Repository가 같은 트랜잭션에서 쓴다(Supabase의 트리거 대신) ──

export const tripInvites = pgTable('trip_invites', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedByDefaultAsIdentity(),
  tripId: uuid('trip_id').notNull().references(() => trips.id, { onDelete: 'cascade' }),
  // sha256(token) hex — 토큰 원문은 만든 순간 한 번만 돌려주고 어디에도 남기지 않는다
  tokenHash: text('token_hash').notNull().unique(),
  role: text('role').notNull(),
  createdBy: uuid('created_by').notNull().references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  maxUses: integer('max_uses'),
  useCount: integer('use_count').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (t) => [
  index('trip_invites_trip_idx').on(t.tripId, t.createdAt),
  check('trip_invites_role_check', sql`${t.role} in ('EDITOR','VIEWER')`),
  check('trip_invites_max_uses_check', sql`${t.maxUses} is null or ${t.maxUses} > 0`)
]);

export const tripCandidates = pgTable('trip_candidates', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedByDefaultAsIdentity(),
  tripId: uuid('trip_id').notNull().references(() => trips.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  placeId: text('place_id'),
  lat: doublePrecision('lat'),
  lng: doublePrecision('lng'),
  addr: text('addr'),
  note: text('note'),
  url: text('url'),
  proposedBy: uuid('proposed_by').notNull().references(() => users.id, { onDelete: 'cascade' }),
  status: text('status').notNull().default('PROPOSED'),
  // '2'(2일차) 같은 위치 표시 — 장소에는 안정적인 id가 없다
  scheduledRef: text('scheduled_ref'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
}, (t) => [
  index('trip_candidates_trip_idx').on(t.tripId, t.createdAt),
  check('trip_candidates_title_check', sql`btrim(${t.title}) <> ''`),
  check('trip_candidates_status_check', sql`${t.status} in ('PROPOSED','ACCEPTED','REJECTED','SCHEDULED')`)
]);

export const candidateReactions = pgTable('candidate_reactions', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedByDefaultAsIdentity(),
  candidateId: bigint('candidate_id', { mode: 'number' }).notNull().references(() => tripCandidates.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  reaction: text('reaction').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
}, (t) => [
  // 한 사람 한 표 — DB가 보장한다
  uniqueIndex('candidate_reactions_cand_user_uidx').on(t.candidateId, t.userId),
  check('candidate_reactions_reaction_check', sql`${t.reaction} in ('MUST','OK','PASS')`)
]);

export const tripComments = pgTable('trip_comments', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedByDefaultAsIdentity(),
  tripId: uuid('trip_id').notNull().references(() => trips.id, { onDelete: 'cascade' }),
  candidateId: bigint('candidate_id', { mode: 'number' }).notNull().references(() => tripCandidates.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  body: text('body').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
}, (t) => [
  index('trip_comments_cand_idx').on(t.candidateId, t.createdAt),
  check('trip_comments_body_check', sql`btrim(${t.body}) <> '' and length(${t.body}) <= 500`)
]);

export const tripActivity = pgTable('trip_activity', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedByDefaultAsIdentity(),
  tripId: uuid('trip_id').notNull().references(() => trips.id, { onDelete: 'cascade' }),
  actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
  kind: text('kind').notNull(),
  subject: jsonb('subject').notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (t) => [
  index('trip_activity_trip_idx').on(t.tripId, t.id),
  check('trip_activity_kind_check', sql`${t.kind} in ('MEMBER_JOINED','MEMBER_LEFT','MEMBER_REMOVED','CANDIDATE_PROPOSED','CANDIDATE_SCHEDULED','CANDIDATE_REJECTED','REACTION','COMMENT_ADDED','SCHEDULE_CHANGED','BOOKING_ADDED')`)
]);

// ── 자체 Auth(Phase 8) — better-auth가 소유하는 테이블. 모양은 라이브러리가 정한다(getAuthTables로 확인해 옮겼다).
// 비밀번호 해시·세션 토큰·인증 토큰을 우리가 설계하지 않는다(§18) — 이 테이블들은 라이브러리가 읽고 쓴다.
//
// 도메인 사용자(users)와는 **분리**한다(§12): users.id는 Supabase user id 그대로여서 기존 참조가 안 깨지고,
// 새 계정은 users.auth_user_id로 이어 붙인다(§13). 잇는 규칙은 server/auth/identity.ts.

export const authUser = pgTable('auth_user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
});

export const authSession = pgTable('auth_session', {
  id: text('id').primaryKey(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  token: text('token').notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  userId: text('user_id').notNull().references(() => authUser.id, { onDelete: 'cascade' })
}, (t) => [index('auth_session_user_idx').on(t.userId)]);

export const authAccount = pgTable('auth_account', {
  id: text('id').primaryKey(),
  issuer: text('issuer').notNull(),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  userId: text('user_id').notNull().references(() => authUser.id, { onDelete: 'cascade' }),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
  refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
  scope: text('scope'),
  // 비밀번호 해시 — better-auth가 만들고 검증한다. 우리 코드는 읽지 않는다
  password: text('password'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
}, (t) => [index('auth_account_user_idx').on(t.userId)]);

export const authVerification = pgTable('auth_verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
}, (t) => [index('auth_verification_identifier_idx').on(t.identifier)]);

/** rate limit(§66) — 로그인·가입·재설정·인증 메일. better-auth가 읽고 쓴다. 재시작에도 유지되도록 DB 저장소를 쓴다 */
export const authRateLimit = pgTable('auth_rate_limit', {
  id: text('id').primaryKey(),
  key: text('key').notNull(),
  count: integer('count').notNull(),
  lastRequest: bigint('last_request', { mode: 'number' }).notNull()
}, (t) => [index('auth_rate_limit_key_idx').on(t.key)]);

/** 메일 쿨다운(§67) — (이메일, 종류)당 마지막 발송 시각. 재시작·다중 인스턴스에서도 유지되도록 DB에 둔다 */
export const authMailCooldown = pgTable('auth_mail_cooldown', {
  email: text('email').notNull(),
  kind: text('kind').notNull(),
  lastSentAt: timestamp('last_sent_at', { withTimezone: true }).notNull().defaultNow()
}, (t) => [primaryKey({ columns: [t.email, t.kind] })]);
