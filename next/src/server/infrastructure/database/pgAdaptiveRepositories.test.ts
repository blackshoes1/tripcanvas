// Adaptive 저장소 + 가격 관측 — PGlite 위에서 Supabase 시절과 같은 규칙을 확인한다:
// 제안 거절은 unique 4열 upsert · 알림 키는 중복 무시 · 기기는 (user, device) upsert · 기록은 client_key 멱등 · 관측은 오래된 순.
// 전부 사용자별이다 — 다른 사용자의 행은 보이지 않는다(RLS가 하던 일을 userId 인자가 한다).
import { sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { createTestDatabase, type TestDatabase } from './testDb';
import {
  PgDeviceRepository, PgMemoryRepository, PgNotificationLogRepository, PgSuggestionFeedbackRepository
} from './pgAdaptiveRepositories';
import { PgPriceObservationRepository } from './pgPriceObservationRepository';
import { PgUserRepository } from './pgUserRepository';

const A = '00000000-0000-0000-0000-00000000000a';
const B = '00000000-0000-0000-0000-00000000000b';

let db: TestDatabase;
beforeEach(async () => {
  db = await createTestDatabase();
  const users = new PgUserRepository(db.db);
  await users.ensure({ id: A, email: null });
  await users.ensure({ id: B, email: null });
});

describe('suggestion_feedback', () => {
  it('거절한 제안만 그 날짜로 돌아오고, 두 번 기록해도 한 행이다', async () => {
    const repo = new PgSuggestionFeedbackRepository(db.db);
    await repo.record(A, 'trip1', '2026-09-01', 'sug-1', 'SKIPPED', 'ios');
    await repo.record(A, 'trip1', '2026-09-01', 'sug-1', 'SKIPPED', 'ios');
    await repo.record(A, 'trip1', '2026-09-01', 'sug-2', 'ACCEPTED', 'ios');
    await repo.record(A, 'trip1', '2026-09-02', 'sug-3', 'SKIPPED', 'ios');
    expect(await repo.listDismissed(A, 'trip1', '2026-09-01')).toEqual(['sug-1']);
    expect(await repo.listDismissed(B, 'trip1', '2026-09-01')).toEqual([]);
  });

  it('마음이 바뀌면 같은 키의 action이 갱신된다', async () => {
    const repo = new PgSuggestionFeedbackRepository(db.db);
    await repo.record(A, 'trip1', '2026-09-01', 'sug-1', 'SKIPPED', 'ios');
    await repo.record(A, 'trip1', '2026-09-01', 'sug-1', 'ACCEPTED', 'ios');
    expect(await repo.listDismissed(A, 'trip1', '2026-09-01')).toEqual([]);
  });
});

describe('notification_log', () => {
  it('보낸 키는 그 날짜로 돌아오고, 같은 dedupe_key는 오류 없이 무시된다', async () => {
    const repo = new PgNotificationLogRepository(db.db);
    const items = [{ kind: 'DEPARTURE', dedupeKey: 'trip1|2026-09-01|DEPARTURE|DEVICE|READY_TO_LEAVE', stateVersion: 'v1' }];
    await repo.record(A, 'trip1', '2026-09-01', items);
    await repo.record(A, 'trip1', '2026-09-01', [...items, { kind: 'PRICE', dedupeKey: 'trip1|2026-09-01|PRICE|SERVER|x', stateVersion: 'v1' }]);
    expect((await repo.listSentKeys(A, 'trip1', '2026-09-01')).sort()).toEqual([
      'trip1|2026-09-01|DEPARTURE|DEVICE|READY_TO_LEAVE', 'trip1|2026-09-01|PRICE|SERVER|x'
    ]);
    expect(await repo.listSentKeys(A, 'trip1', '2026-09-02')).toEqual([]);
    await repo.record(A, 'trip1', '2026-09-01', []);   // 빈 목록은 아무것도 안 한다
  });
});

describe('device_tokens', () => {
  it('(user, device)당 한 행 — 다시 저장하면 토큰·설정이 갱신되고, 지우면 사라진다', async () => {
    const repo = new PgDeviceRepository(db.db);
    const reg = { deviceId: 'dev-1', platform: 'ios' as const, pushToken: 'tok-1', enabled: true, preferences: { price: false }, appVersion: '1.0' };
    await repo.save(A, reg);
    await repo.save(A, { ...reg, pushToken: 'tok-2', enabled: false });
    await repo.save(B, reg);
    const rows = (await db.db.execute(sql`select user_id, push_token, enabled from device_tokens order by user_id`)) as { rows: unknown[] };
    expect(rows.rows).toEqual([
      { user_id: A, push_token: 'tok-2', enabled: false },
      { user_id: B, push_token: 'tok-1', enabled: true }
    ]);
    await repo.remove(A, 'dev-1');
    await repo.remove(A, 'dev-1');   // 두 번 지워도 오류 없음
    const after = (await db.db.execute(sql`select user_id from device_tokens`)) as { rows: unknown[] };
    expect(after.rows).toEqual([{ user_id: B }]);
  });
});

describe('trip_memories', () => {
  const row = (overrides: Partial<Parameters<PgMemoryRepository['save']>[2]> = {}) => ({
    day_index: 0, activity_id: 'd0s1', type: 'NOTE', caption: '좋았다', asset_refs: [], lat: null, lng: null,
    at_minutes: 600, captured_at: '2026-09-01T01:00:00.000Z', client_key: 'k1', ...overrides
  });

  it('저장하면 id가 생기고, 같은 client_key로 다시 저장하면 만들지 않고 그것을 돌려준다', async () => {
    const repo = new PgMemoryRepository(db.db);
    const first = await repo.save(A, 'trip1', row());
    expect(first.created).toBe(true);
    expect(first.row.id).toMatch(/^[0-9a-f-]{36}$/);
    const again = await repo.save(A, 'trip1', row({ caption: '다른 내용' }));
    expect(again.created).toBe(false);
    expect(again.row.id).toBe(first.row.id);
    expect(again.row.caption).toBe('좋았다');
    // 다른 사용자의 같은 client_key는 별개다
    expect((await repo.save(B, 'trip1', row())).created).toBe(true);
  });

  it('목록은 현지 시각 순이고 day_index로 거를 수 있다', async () => {
    const repo = new PgMemoryRepository(db.db);
    await repo.save(A, 'trip1', row({ client_key: 'k2', at_minutes: 900, day_index: 1 }));
    await repo.save(A, 'trip1', row({ client_key: 'k1', at_minutes: 600, day_index: 0 }));
    await repo.save(A, 'trip1', row({ client_key: null, at_minutes: 700, day_index: 0, type: 'PHOTO', asset_refs: ['ph://1'] }));
    expect((await repo.list(A, 'trip1', null)).map((m) => m.at_minutes)).toEqual([600, 700, 900]);
    const day0 = await repo.list(A, 'trip1', 0);
    expect(day0.map((m) => m.type)).toEqual(['NOTE', 'PHOTO']);
    expect(day0[1].asset_refs).toEqual(['ph://1']);
    expect(await repo.list(B, 'trip1', null)).toEqual([]);
  });
});

describe('hotel_price_snapshots', () => {
  it('관측은 오래된 순으로 돌아오고 사용자·여행별이다', async () => {
    const repo = new PgPriceObservationRepository(db.db);
    await repo.append(A, 'trip1', { booking_id: 'b1', seller: 'agoda', price: 120000, currency: 'KRW', quality: 'EXACT', verified: true, offers: [{ seller: 'agoda' }], observed_at: '2026-09-02T00:00:00.000Z' });
    await repo.append(A, 'trip1', { booking_id: 'b1', seller: 'booking', price: 110000, currency: 'KRW', quality: 'EXACT', verified: false, offers: null, observed_at: '2026-09-01T00:00:00.000Z' });
    await repo.append(B, 'trip1', { booking_id: 'b1', seller: 'x', price: 1, currency: 'KRW', quality: null, verified: false, offers: null });
    const list = await repo.listForTrip(A, 'trip1');
    expect(list.map((o) => [o.seller, o.price, o.verified])).toEqual([['booking', 110000, false], ['agoda', 120000, true]]);
    expect(list[1].offers).toEqual([{ seller: 'agoda' }]);
    expect(list[0].observed_at).toBe('2026-09-01T00:00:00.000Z');
    expect(await repo.listForTrip(A, 'other')).toEqual([]);
  });
});
