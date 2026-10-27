import { randomUUID } from 'node:crypto';
import { and, desc, eq, isNull, ne, sql } from 'drizzle-orm';
import { LIVE_ACTIVITY_LEASE_MS, type LiveActivityClaim, type LiveActivityDelivery, type LiveActivityKey, type LiveActivityRepository } from '../../live-activities/types';
import { LIVE_ACTIVITY_LIFETIME_MS } from '../../live-activities/service';
import type { Db } from './db';
import { liveActivitySubscriptions as subscriptions, users } from './schema';

const keyOf = (key: LiveActivityKey) => and(eq(subscriptions.userId, key.userId),
  eq(subscriptions.deviceId, key.deviceId), eq(subscriptions.activityId, key.activityId));
const leaseOf = (claim: LiveActivityClaim) => and(keyOf(claim), eq(subscriptions.leaseId, claim.leaseId));

export class PgLiveActivityRepository implements LiveActivityRepository {
  constructor(private readonly db: Db) {}

  async register(input: Parameters<LiveActivityRepository['register']>[0]) {
    return this.db.transaction(async tx => {
      // 같은 사용자의 동시 등록도 총량 상한을 함께 지킨다.
      await tx.select({ id: users.id }).from(users).where(eq(users.id, input.userId)).for('update');
      const session = await tx.execute(sql`select 1 from auth_session s
        join users u on u.auth_user_id = s.user_id join auth_user a on a.id = s.user_id
        where s.id = ${input.sessionId} and u.id = ${input.userId}
          and s.expires_at > ${input.now} and a.email_verified = true`) as { rows: unknown[] };
      if (!session.rows.length) return 'unauthorized' as const;
      const [existing] = await tx.select().from(subscriptions).where(keyOf(input)).limit(1);
      if (existing?.endedAt) return 'ended' as const;
      if (existing && existing.tokenRevision >= input.tokenRevision) {
        return existing.tokenRevision === input.tokenRevision && existing.pushToken === input.pushToken
          ? 'registered' as const : 'stale' as const;
      }
      const [latest] = await tx.select({ revision: subscriptions.tokenRevision }).from(subscriptions)
        .where(and(eq(subscriptions.userId, input.userId), eq(subscriptions.deviceId, input.deviceId)))
        .orderBy(desc(subscriptions.tokenRevision)).limit(1);
      if (latest && latest.revision >= input.tokenRevision) return 'stale' as const;
      const count = await tx.execute(sql`select count(*)::int as n from live_activity_subscriptions
        where user_id = ${input.userId} and device_id <> ${input.deviceId}
          and ended_at is null and expires_at > ${input.now}`) as { rows: { n: number }[] };
      if (Number(count.rows[0].n) >= 10) return 'limit' as const;
      // 앱도 기기당 하나만 띄운다. 지난 활동의 늦은 토큰 콜백은 종료 기록을 지울 수 없다.
      await tx.update(subscriptions).set({ endedAt: input.now, pushToken: null, leaseId: null, leaseUntil: null })
        .where(and(eq(subscriptions.userId, input.userId), eq(subscriptions.deviceId, input.deviceId),
          ne(subscriptions.activityId, input.activityId), isNull(subscriptions.endedAt)));
      const values = {
        userId: input.userId, deviceId: input.deviceId, activityId: input.activityId,
        sessionId: input.sessionId, tripId: input.tripId, pushToken: input.pushToken,
        environment: input.environment, tokenRevision: input.tokenRevision,
        startedAt: input.startedAt, expiresAt: input.expiresAt, nextUpdateAt: input.now,
        endedAt: null, leaseId: null, leaseUntil: null, failures: 0, lastError: null,
        lastStateVersion: null, updatedAt: input.now
      };
      await tx.insert(subscriptions).values(values).onConflictDoUpdate({
        target: [subscriptions.userId, subscriptions.deviceId, subscriptions.activityId], set: values
      });
      return 'registered' as const;
    });
  }

  async stop(input: Parameters<LiveActivityRepository['stop']>[0]) {
    const expiresAt = new Date(input.now.getTime() + LIVE_ACTIVITY_LIFETIME_MS);
    await this.db.transaction(async tx => {
      await tx.select({ id: users.id }).from(users).where(eq(users.id, input.userId)).for('update');
      await tx.insert(subscriptions).values({
      userId: input.userId, deviceId: input.deviceId, activityId: input.activityId,
      sessionId: input.sessionId, startedAt: input.now, expiresAt,
      nextUpdateAt: expiresAt, endedAt: input.now
    }).onConflictDoUpdate({
      target: [subscriptions.userId, subscriptions.deviceId, subscriptions.activityId],
      set: { endedAt: input.now, pushToken: null, leaseId: null, leaseUntil: null, updatedAt: input.now }
      });
    });
  }

  async claimDue(now: Date, limit: number): Promise<LiveActivityClaim[]> {
    await this.db.execute(sql`delete from live_activity_subscriptions where (user_id, device_id, activity_id) in (
      select user_id, device_id, activity_id from live_activity_subscriptions
      where ended_at is not null and expires_at <= ${now} order by expires_at limit 100)`);
    const leaseId = randomUUID();
    const leaseUntil = new Date(now.getTime() + LIVE_ACTIVITY_LEASE_MS);
    const result = await this.db.execute(sql`with due as (
      select user_id, device_id, activity_id from live_activity_subscriptions
      where ended_at is null and next_update_at <= ${now} and (lease_until is null or lease_until <= ${now})
      order by next_update_at limit ${Math.max(1, Math.min(50, limit))} for update skip locked
    ) update live_activity_subscriptions s set lease_id = ${leaseId}::uuid, lease_until = ${leaseUntil}
      from due where s.user_id = due.user_id and s.device_id = due.device_id and s.activity_id = due.activity_id
      returning s.user_id, s.device_id, s.activity_id, s.expires_at, s.failures, s.last_state_version`);
    return (result as { rows: unknown[] }).rows.map(raw => {
      const row = raw as { user_id: string; device_id: string; activity_id: string; expires_at: Date | string; failures: number; last_state_version: string | null };
      return { userId: row.user_id, deviceId: row.device_id, activityId: row.activity_id,
        leaseId, expiresAt: new Date(row.expires_at), failures: row.failures, lastStateVersion: row.last_state_version };
    });
  }

  async delivery(claim: LiveActivityClaim, now: Date): Promise<LiveActivityDelivery | null> {
    // 발송 직전에 세션·현재 여행 권한을 다시 본다. 로그아웃은 FK cascade로 등록 자체도 지운다.
    const result = await this.db.execute(sql`select s.push_token, s.environment, t.client_id,
      t.data, t.revision, t.updated_at, u.j_tone
      from live_activity_subscriptions s join trips t on t.id = s.trip_id
      join users u on u.id = s.user_id join auth_session a on a.id = s.session_id
      join auth_user au on au.id = a.user_id
      where s.user_id = ${claim.userId} and s.device_id = ${claim.deviceId} and s.activity_id = ${claim.activityId}
        and s.lease_id = ${claim.leaseId}::uuid and s.lease_until > ${now} and s.ended_at is null and s.expires_at > ${now}
        and a.expires_at > ${now} and au.email_verified = true and u.auth_user_id = a.user_id
        and t.deleted_at is null and (t.user_id = s.user_id or exists (
          select 1 from trip_members m where m.trip_id = t.id and m.user_id = s.user_id
            and m.status = 'ACTIVE' and m.role in ('OWNER','EDITOR','VIEWER')))`);
    const row = (result as { rows: unknown[] }).rows[0] as { push_token: string; environment: 'sandbox' | 'production'; client_id: string;
      data: LiveActivityDelivery['document']; revision: number; updated_at: Date | string; j_tone: string } | undefined;
    if (!row) return null;
    return { pushToken: row.push_token, environment: row.environment, tripId: row.client_id,
      document: row.data, revision: Number(row.revision), updatedAt: new Date(row.updated_at).toISOString(),
      jTone: row.j_tone === 'CASUAL' || row.j_tone === 'POLITE' ? row.j_tone : 'FRIENDLY' };
  }

  async complete(claim: LiveActivityClaim, nextAt: Date, stateVersion: string | null, error?: string) {
    await this.db.update(subscriptions).set({ nextUpdateAt: nextAt, lastStateVersion: stateVersion,
      failures: 0, lastError: error?.slice(0, 128) ?? null, leaseId: null, leaseUntil: null }).where(leaseOf(claim));
  }

  async retry(claim: LiveActivityClaim, nextAt: Date, reason: string) {
    await this.db.update(subscriptions).set({ nextUpdateAt: nextAt, failures: claim.failures + 1,
      lastError: reason.slice(0, 128), leaseId: null, leaseUntil: null }).where(leaseOf(claim));
  }

  async discard(claim: LiveActivityClaim, now: Date) {
    await this.db.update(subscriptions).set({ endedAt: now, pushToken: null, leaseId: null, leaseUntil: null }).where(leaseOf(claim));
  }
}
