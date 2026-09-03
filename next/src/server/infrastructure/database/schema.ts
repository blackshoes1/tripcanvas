// 독립 PostgreSQL 스키마(Drizzle). 운영 Supabase 스키마를 그대로 옮기되 Supabase 전용 부분만 뺐다:
//   auth.users → users (id는 Supabase user id를 그대로 보존 — 외래키·소유권이 안 깨진다, §13)
//   auth.uid() 기본값 · RLS · security definer RPC → 없음. 호출자는 API가 알고(RequestContext) 규칙은 application이 판정한다(§22~24)
//   trips.id 는 운영과 같은 uuid
// 마이그레이션 SQL은 drizzle-kit이 이 파일에서 만든다(migrations/). 손으로 SQL을 고치지 않는다(§62).
import { sql } from 'drizzle-orm';
import {
  bigint, boolean, check, date, doublePrecision, index, integer, jsonb, numeric, pgTable, text, timestamp, uniqueIndex, uuid
} from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: uuid('id').primaryKey(),
  email: text('email'),
  // Supabase 시절의 id. 지금은 id와 같다 — Phase 8(새 Auth)에서 계정을 새로 만들 때 매핑 근거가 된다
  legacySupabaseUserId: uuid('legacy_supabase_user_id').unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true })
});

export const trips = pgTable('trips', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  clientId: text('client_id').notNull(),
  data: jsonb('data').notNull(),
  revision: bigint('revision', { mode: 'number' }).notNull().default(1),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
}, (t) => [
  uniqueIndex('trips_user_client_uidx').on(t.userId, t.clientId),
  index('trips_user_updated_idx').on(t.userId, t.updatedAt),
  index('trips_client_idx').on(t.clientId),
  check('trips_revision_check', sql`${t.revision} > 0`)
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
