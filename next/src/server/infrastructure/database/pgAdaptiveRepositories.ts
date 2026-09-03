// Adaptive 저장소 Repository — Supabase 시절 gateway가 하던 쿼리를 그대로 옮겼다(unique upsert · ignoreDuplicates · client_key 멱등).
// 전부 사용자별이다: RLS가 하던 격리를 userId 인자가 한다. 호출자는 RequestContext의 userId만 넣는다.
import { and, asc, eq, sql } from 'drizzle-orm';

import type {
  DeviceRegistrationRow, DeviceRepository, MemoryRecord, MemoryRepository,
  NotificationLogRepository, SuggestionFeedbackRepository
} from '../../repositories/types';
import type { Db } from './db';
import { deviceTokens, notificationLog, suggestionFeedback, tripMemories } from './schema';

export class PgSuggestionFeedbackRepository implements SuggestionFeedbackRepository {
  constructor(private readonly db: Db) {}

  async listDismissed(userId: string, tripClientId: string, dayISO: string): Promise<string[]> {
    const rows = await this.db.select({ key: suggestionFeedback.suggestionKey }).from(suggestionFeedback)
      .where(and(eq(suggestionFeedback.userId, userId), eq(suggestionFeedback.tripClientId, tripClientId),
        eq(suggestionFeedback.dayIso, dayISO), eq(suggestionFeedback.action, 'SKIPPED')));
    return rows.map((r) => r.key);
  }

  async record(userId: string, tripClientId: string, dayISO: string, suggestionKey: string, action: string, source: string): Promise<void> {
    await this.db.insert(suggestionFeedback)
      .values({ userId, tripClientId, dayIso: dayISO, suggestionKey, action, source })
      .onConflictDoUpdate({
        target: [suggestionFeedback.userId, suggestionFeedback.tripClientId, suggestionFeedback.dayIso, suggestionFeedback.suggestionKey],
        set: { action, source, updatedAt: sql`now()` }
      });
  }
}

export class PgNotificationLogRepository implements NotificationLogRepository {
  constructor(private readonly db: Db) {}

  async listSentKeys(userId: string, tripClientId: string, dayISO: string): Promise<string[]> {
    const rows = await this.db.select({ key: notificationLog.dedupeKey }).from(notificationLog)
      .where(and(eq(notificationLog.userId, userId), eq(notificationLog.tripClientId, tripClientId), eq(notificationLog.dayIso, dayISO)));
    return rows.map((r) => r.key);
  }

  async record(userId: string, tripClientId: string, dayISO: string, items: { kind: string; dedupeKey: string; stateVersion: string }[]): Promise<void> {
    if (!items.length) return;
    await this.db.insert(notificationLog)
      .values(items.map((n) => ({ userId, tripClientId, dayIso: dayISO, kind: n.kind, dedupeKey: n.dedupeKey, stateVersion: n.stateVersion })))
      .onConflictDoNothing({ target: [notificationLog.userId, notificationLog.dedupeKey] });
  }
}

export class PgDeviceRepository implements DeviceRepository {
  constructor(private readonly db: Db) {}

  async save(userId: string, r: DeviceRegistrationRow): Promise<void> {
    const values = { userId, deviceId: r.deviceId, platform: r.platform, pushToken: r.pushToken, enabled: r.enabled, preferences: r.preferences, appVersion: r.appVersion };
    await this.db.insert(deviceTokens).values(values)
      .onConflictDoUpdate({
        target: [deviceTokens.userId, deviceTokens.deviceId],
        set: { platform: r.platform, pushToken: r.pushToken, enabled: r.enabled, preferences: r.preferences, appVersion: r.appVersion, updatedAt: sql`now()` }
      });
  }

  async remove(userId: string, deviceId: string): Promise<void> {
    await this.db.delete(deviceTokens).where(and(eq(deviceTokens.userId, userId), eq(deviceTokens.deviceId, deviceId)));
  }
}

type MemoryRow = typeof tripMemories.$inferSelect;
function toMemoryRecord(row: MemoryRow): MemoryRecord {
  return {
    id: row.id, day_index: row.dayIndex, activity_id: row.activityId, type: row.type, caption: row.caption,
    asset_refs: row.assetRefs, lat: row.lat, lng: row.lng, at_minutes: row.atMinutes,
    captured_at: row.capturedAt.toISOString(), client_key: row.clientKey
  };
}

export class PgMemoryRepository implements MemoryRepository {
  constructor(private readonly db: Db) {}

  async list(userId: string, tripClientId: string, dayIndex: number | null): Promise<MemoryRecord[]> {
    const where = [eq(tripMemories.userId, userId), eq(tripMemories.tripClientId, tripClientId)];
    if (dayIndex != null) where.push(eq(tripMemories.dayIndex, dayIndex));
    const rows = await this.db.select().from(tripMemories).where(and(...where)).orderBy(asc(tripMemories.atMinutes)).limit(500);
    return rows.map(toMemoryRecord);
  }

  async save(userId: string, tripClientId: string, row: Omit<MemoryRecord, 'id'>): Promise<{ row: MemoryRecord; created: boolean }> {
    if (row.client_key) {
      const [found] = await this.db.select().from(tripMemories)
        .where(and(eq(tripMemories.userId, userId), eq(tripMemories.clientKey, row.client_key))).limit(1);
      if (found) return { row: toMemoryRecord(found), created: false };
    }
    const [inserted] = await this.db.insert(tripMemories).values({
      userId, tripClientId, dayIndex: row.day_index, activityId: row.activity_id, type: row.type, caption: row.caption,
      assetRefs: row.asset_refs ?? [], lat: row.lat, lng: row.lng, atMinutes: row.at_minutes,
      capturedAt: row.captured_at ? new Date(row.captured_at) : new Date(), clientKey: row.client_key
    }).returning();
    return { row: toMemoryRecord(inserted), created: true };
  }
}
