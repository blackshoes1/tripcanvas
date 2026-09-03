// 독립 PostgreSQL 스키마(Drizzle). 운영 Supabase 스키마를 그대로 옮기되 Supabase 전용 부분만 뺐다:
//   auth.users → users (id는 Supabase user id를 그대로 보존 — 외래키·소유권이 안 깨진다, §13)
//   auth.uid() 기본값 · RLS · security definer RPC → 없음. 호출자는 API가 알고(RequestContext) 규칙은 application이 판정한다(§22~24)
//   trips.id 는 운영과 같은 uuid
// 마이그레이션 SQL은 drizzle-kit이 이 파일에서 만든다(migrations/). 손으로 SQL을 고치지 않는다(§62).
import { sql } from 'drizzle-orm';
import {
  bigint, check, index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid
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
